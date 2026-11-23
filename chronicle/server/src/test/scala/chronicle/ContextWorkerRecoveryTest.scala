package chronicle

import chronicle.api.*
import cats.effect.{Deferred,IO,OutcomeIO}
import cats.effect.unsafe.implicits.global
import io.circe.Json
import izumi.logstage.api.Log
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import scala.collection.mutable.ListBuffer
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

final case class WorkerEvidence(claims: Int,reservations: Int,rejections: Int)
trait ContextWorkerFixture {
  def evidence(id: UUID): WorkerEvidence
  def config: Config
  def archive(): SessionArchive
  def stage(id: UUID): Option[IndexingStage]
  def acceptedParts(id: UUID,stage: IndexingStage): Int
  def rebuild(owner: String): Unit
}
/** Worker log lines as the code interpolated them. */
final class WorkerLog {
  private val entries=new ConcurrentLinkedQueue[String]()
  private def render(entry: Log.Entry): String =
    entry.message.template.parts.zipAll(entry.message.args.map(arg => String.valueOf(arg.value)),"","").map(_+_).mkString
  val logger: logstage.IzLogger = logstage.IzLogger(Log.Level.Info,List(new izumi.logstage.api.logger.LogSink { def flush(entry: Log.Entry): Unit = { entries.add(render(entry)); () } }))
  def lines: List[String] = entries.asScala.toList
}
/** Delegates every archive call; tests override the calls they observe or fail. */
class ForwardingArchive(delegate: SessionArchive) extends SessionArchive {
  def knownProfiles: Set[String]=delegate.knownProfiles
  def ingest(owner: String,r: IngestRequest): IngestReceipt=delegate.ingest(owner,r)
  def session(reader: String,id: UUID): SessionInfo=delegate.session(reader,id)
  def headSnapshot(reader: String,id: UUID): IngestRequest=delegate.headSnapshot(reader,id)
  def claim(profiles: Set[String],scope: ClaimScope,lease: Int,large: LargeJobs): Option[Claim]=delegate.claim(profiles,scope,lease,large)
  def renew(c: Claim,lease: Int): Boolean=delegate.renew(c,lease)
  def defer(c: Claim,total: Int): Boolean=delegate.defer(c,total)
  def progress(c: Claim,done: Int,total: Int): Boolean=delegate.progress(c,done,total)
  def publishProblems(c: Claim,p: ProblemRows): Boolean=delegate.publishProblems(c,p)
  def publicationParent(c: Claim): Option[PublicationParent]=delegate.publicationParent(c)
  def retire(c: Claim): Unit=delegate.retire(c)
  def fail(c: Claim,code: String): Unit=delegate.fail(c,code)
  def fail(c: Claim,code: String,stage: IndexingStage): Unit=delegate.fail(c,code,stage)
  def checkpoint(c: Claim,key: CheckpointKey): Option[Json]=delegate.checkpoint(c,key)
  def checkpoint(c: Claim,key: CheckpointKey,value: Json): Unit=delegate.checkpoint(c,key,value)
  def windowWork(c: Claim,key: CheckpointKey): Option[WindowWork]=delegate.windowWork(c,key)
  def discardCheckpoints(c: Claim,stage: IndexingStage,window: Int): Int=delegate.discardCheckpoints(c,stage,window)
  def reserveAnnotation(c: Claim,key: CheckpointKey): AnnotationReservation=delegate.reserveAnnotation(c,key)
  def rejectAnnotation(c: Claim,key: CheckpointKey,attempt: Int,reason: String): Int=delegate.rejectAnnotation(c,key,attempt,reason)
  def holdTransient(c: Claim,stage: Option[IndexingStage]): TransientOutcome=delegate.holdTransient(c,stage)
}
abstract class ContextWorkerRecoveryContract extends munit.FunSuite {
  def withFixture(run: ContextWorkerFixture => Unit): Unit
  protected def request(values: List[(String,String)]): IngestRequest = {
    val original=Fixtures.snapshot(); val messages=values.zipWithIndex.map { case ((role,text),i) => Message(s"m$i",None,role,text,None,i) }
    val content=messages.map(message => Json.obj("id"->Json.fromString(message.id),"text"->Json.fromString(message.text)).noSpaces+"\n").mkString
    val raw=if(content.isEmpty) "{}\n" else content
    original.copy(messages=messages,files=List(RawFile("source.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  private def worker(f: ContextWorkerFixture,model: ProblemPassageAnnotator,embedding: Embedder): Worker = worker(f.archive(),f.config,model,embedding)
  protected def worker(archive: SessionArchive,config: Config,model: ProblemPassageAnnotator,embedding: Embedder): Worker = worker(archive,config,model,embedding,ModelFixtures.failureBackoff)
  private def worker(archive: SessionArchive,config: Config,model: ProblemPassageAnnotator,embedding: Embedder,backoff: Worker.FailureBackoff): Worker =
    worker(archive,config,model,embedding,backoff,logstage.IzLogger())
  private def worker(archive: SessionArchive,config: Config,model: ProblemPassageAnnotator,embedding: Embedder,backoff: Worker.FailureBackoff,logger: logstage.IzLogger): Worker =
    new Worker(archive,model,embedding,config,IndexProfileCatalog.current(config),ModelAdmission.make(config.indexing).unsafeRunSync(),logger,backoff,ModelFixtures.snapshots)
  protected def one(window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): ProblemPassages.Decision =
    ProblemPassages.Decision(Vector(ProblemPassages.Part(ProblemPassages.Point(0,0),window.terminal,previous.nonEmpty,"synthetic goal",Nil)))
  test("BG/GoodCommunication: a worker lane stays idle for the failure back-off after the failed job is recorded, and not shorter") { withFixture { f =>
    val backoff=Worker.FailureBackoff(300.millis)
    @volatile var recordedAt=0L
    val recording=new ForwardingArchive(f.archive()) {
      override def fail(c: Claim,code: String,stage: IndexingStage): Unit = { super.fail(c,code,stage); recordedAt=System.nanoTime() }
    }
    val receipt=recording.ingest("a",request(List("user"->"synthetic task")))
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO.raiseError(DomainError("model-timeout","model deadline exceeded"))
    }
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("unexpected embedding"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("unexpected embedding"))
    }
    assert(worker(recording,f.config,model,embedding,backoff).once.unsafeRunSync())
    val idle=(System.nanoTime()-recordedAt).nanos
    assertEquals(f.stage(receipt.jobId),Some(IndexingStage.Annotation))
    assert(idle>=backoff.delay,s"worker lane resumed $idle after the failure was recorded")
  }}
  List(IndexingStage.Annotation,IndexingStage.Embedding).foreach { failureStage =>
    test(s"BG/GoodCommunication: durable current-policy prefix survives later $failureStage failure and a fresh worker/archive connection") { withFixture { f =>
      val archive=f.archive()
      val values=(0 until 160).map(i => "user"->s"${if(i<64) 'a' else if(i<128) 'b' else 'c'}$i").toList
      val receipt=archive.ingest("a",request(values)); val annotations=ListBuffer.empty[Char]; val embedded=ListBuffer.empty[String]; var failed=false
      val model=new ProblemPassageAnnotator {
        def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO {
          val label=window.fragments.head.text.head; annotations+=label
          if(failureStage==IndexingStage.Annotation && label=='b' && !failed) { failed=true; throw DomainError("model-timeout","model deadline exceeded") }
          one(window,previous)
        }
      }
      val embedding=new Embedder {
        def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
        def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO {
          embedded++=text
          if(failureStage==IndexingStage.Embedding && text.head=="b64" && !failed) { failed=true; throw DomainError("model-timeout","model deadline exceeded") }
          text.map(_ => List(1e-10,-0.0,1.25))
        }
      }
      assert(worker(f,model,embedding).once.unsafeRunSync()); assert(failed)
      assertEquals(archive.session("a",receipt.sessionId).indexedRevision,None)
      assertEquals(f.stage(receipt.jobId),Some(failureStage))
      assertEquals(f.evidence(receipt.jobId),WorkerEvidence(1,2,0),"transport failure must not consume a validation rejection")
      assert(worker(f,model,embedding).once.unsafeRunSync())
      assertEquals(archive.session("a",receipt.sessionId).indexedRevision,Some(1))
      assertEquals(annotations.count(_=='a'),1); assertEquals(embedded.count(_=="a0"),1)
      assertEquals(annotations.count(_=='b'),if(failureStage==IndexingStage.Annotation) 2 else 1)
      assertEquals(embedded.count(_=="b64"),if(failureStage==IndexingStage.Embedding) 2 else 1)
      assertEquals(f.stage(receipt.jobId),None)
      assertEquals(f.evidence(receipt.jobId),WorkerEvidence(2,if(failureStage==IndexingStage.Annotation) 4 else 3,0))
    }}
  }
  List(16->4,4->16).foreach { (stored,current) =>
    test(s"BG/GoodCommunication regression: embedding parts accepted under batch size $stored are discarded and the window is embedded again under $current") { withFixture { f =>
      val texts=(0 until 40).map(i => s"source-$i").toList; val failedText="source-32"
      def configured(batchSize: Int): Config = f.config.copy(indexing=f.config.indexing.copy(embeddingBatchSize=batchSize))
      val published=ListBuffer.empty[ProblemsPublication]
      val archive=new ForwardingArchive(f.archive()) {
        override def publishProblems(c: Claim,p: ProblemRows): Boolean = { published+=ProblemsPublication.collect(p); super.publishProblems(c,p) }
      }
      var annotations=0; var failed=false; val batches=ListBuffer.empty[List[String]]
      val model=new ProblemPassageAnnotator {
        def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO { annotations+=1; one(window,previous) }
      }
      val embedding=new Embedder {
        def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
        def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO {
          batches+=text
          if(text.head==failedText && !failed) { failed=true; throw DomainError("model-timeout","model deadline exceeded") }
          text.map(value => List(1.0,value.stripPrefix("source-").toDouble,0.0))
        }
      }
      val receipt=archive.ingest("a",request(texts.map("assistant"->_)))
      assert(worker(archive,configured(stored),model,embedding).once.unsafeRunSync()); assert(failed)
      assertEquals(f.acceptedParts(receipt.jobId,IndexingStage.Embedding),texts.indexOf(failedText)/stored)
      batches.clear(); val log=new WorkerLog
      // Within a budget of exactly the window's pieces: they count once, also when the parts accepted under the other
      // grouping are discarded and the window is embedded again.
      val tight=configured(current).copy(maxIndexingBudgetBytes=IndexingBudget.window(texts.size,0,f.config.embedding.dimensions).toLong)
      assert(worker(archive,tight,model,embedding,ModelFixtures.failureBackoff,log.logger).once.unsafeRunSync())
      assertEquals(batches.toList,texts.grouped(current).toList,"the window is embedded again, under the current batch size")
      assertEquals(f.acceptedParts(receipt.jobId,IndexingStage.Embedding),texts.grouped(current).size,"no part of the other grouping remains")
      assertEquals(archive.session("a",receipt.sessionId).indexedRevision,Some(1)); assertEquals(annotations,1)
      val audit=log.lines.filter(_.startsWith("accepted work discarded")); assertEquals(audit.size,1)
      assert(audit.head.matches(s"accepted work discarded jobId=${receipt.jobId} fence=[0-9]+ windowOrdinal=0 totalWindows=1 stage=embedding discardedParts=${texts.indexOf(failedText)/stored} currentParts=${texts.grouped(current).size} embeddingBatchSize=$current"),audit.head)
      archive.ingest("b",request(texts.map("assistant"->_)))
      assert(worker(archive,configured(current),model,embedding).once.unsafeRunSync())
      assertEquals(published.size,2)
      assertEquals(published(0).chunks.map(c => (c.chunk.text,c.vector)),published(1).chunks.map(c => (c.chunk.text,c.vector)),"the clean run under the current batch size publishes the same vectors")
    }}
  }
  test("BG/GoodCommunication regression: a failed claim is logged and the lane claims again after the failure back-off instead of ending the worker") { withFixture { f =>
    val config=f.config.copy(indexing=f.config.indexing.copy(annotationSessions=1)); val log=new WorkerLog
    val receipt=f.archive().ingest("a",request(List("user"->"synthetic task")))
    @volatile var claims=0
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO(one(window,previous))
    }
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.pure(text.map(_ => List(1.0,0.0,0.0)))
    }
    val outcome=(for {
      published <- Deferred[IO,Unit]
      terminated <- Deferred[IO,OutcomeIO[Nothing]]
      archive=new ForwardingArchive(f.archive()) {
        override def claim(profiles: Set[String],scope: ClaimScope,lease: Int,large: LargeJobs): Option[Claim] = {
          claims+=1
          if(claims==1) throw new java.sql.SQLException("canceling statement due to statement timeout","57014")
          super.claim(profiles,scope,lease,large)
        }
        override def publishProblems(c: Claim,p: ProblemRows): Boolean = { val result=super.publishProblems(c,p); published.complete(()).unsafeRunSync(); result }
      }
      fiber <- worker(archive,config,model,embedding,ModelFixtures.failureBackoff,log.logger).run.guaranteeCase(outcome => terminated.complete(outcome).void).start
      first <- IO.race(terminated.get,published.get).timeout(10.seconds)
      _ <- IO(first.left.foreach(outcome => fail(s"the worker run ended: $outcome")))
      _ <- fiber.cancel.timeout(5.seconds)
      outcome <- terminated.get
    } yield outcome).unsafeRunSync()
    assert(outcome.isCanceled,s"cancellation stops the lane: $outcome")
    assert(claims>=2); assertEquals(f.archive().session("a",receipt.sessionId).indexedRevision,Some(1))
    val failures=log.lines.filter(_.startsWith("job claim failed")); assertEquals(failures.size,1)
    assert(failures.head.matches("job claim failed code=worker-fault exceptionClass=java\\.sql\\.SQLException sqlState=57014 origin=\\S+"),failures.head)
  }}
  test("BG/GoodCommunication regression: a job failure that cannot be recorded is logged and the lane keeps indexing instead of ending the worker") { withFixture { f =>
    val config=f.config.copy(indexing=f.config.indexing.copy(annotationSessions=1)); val log=new WorkerLog
    val failing=f.archive().ingest("a",request(List("user"->"synthetic failing task")))
    val healthy=f.archive().ingest("b",request(List("user"->"synthetic task")))
    @volatile var records=0
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] =
        if(owner=="a") IO.raiseError(DomainError("model-timeout","model deadline exceeded")) else IO(one(window,previous))
    }
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.pure(text.map(_ => List(1.0,0.0,0.0)))
    }
    val outcome=(for {
      published <- Deferred[IO,Unit]
      terminated <- Deferred[IO,OutcomeIO[Nothing]]
      archive=new ForwardingArchive(f.archive()) {
        override def fail(c: Claim,code: String,stage: IndexingStage): Unit = { records+=1; throw new java.sql.SQLException("canceling statement due to statement timeout","57014") }
        override def publishProblems(c: Claim,p: ProblemRows): Boolean = { val result=super.publishProblems(c,p); published.complete(()).unsafeRunSync(); result }
      }
      fiber <- worker(archive,config,model,embedding,ModelFixtures.failureBackoff,log.logger).run.guaranteeCase(outcome => terminated.complete(outcome).void).start
      first <- IO.race(terminated.get,published.get).timeout(10.seconds)
      _ <- IO(first.left.foreach(outcome => fail(s"the worker run ended: $outcome")))
      _ <- fiber.cancel.timeout(5.seconds)
      outcome <- terminated.get
    } yield outcome).unsafeRunSync()
    assert(outcome.isCanceled,s"cancellation stops the lane: $outcome")
    assertEquals(records,1); assertEquals(f.archive().session("b",healthy.sessionId).indexedRevision,Some(1))
    assertEquals(f.stage(failing.jobId),None,"nothing was recorded for the failed job: it keeps its lease until it expires")
    val unrecorded=log.lines.filter(_.startsWith("job failure not recorded")); assertEquals(unrecorded.size,1)
    assert(unrecorded.head.matches(s"job failure not recorded jobId=${failing.jobId} failureCode=model-timeout code=worker-fault exceptionClass=java\\.sql\\.SQLException sqlState=57014 origin=\\S+"),unrecorded.head)
  }}
  test("BG/GoodCommunication regression: a model-telemetry invariant still ends the worker run instead of being contained") { withFixture { f =>
    val config=f.config.copy(indexing=f.config.indexing.copy(annotationSessions=1))
    val receipt=f.archive().ingest("a",request(List("user"->"synthetic task")))
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO.raiseError(DomainError("model-telemetry-invariant","synthetic telemetry invariant"))
    }
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("no embedding"))
    }
    val ended=worker(f.archive(),config,model,embedding).run.attempt.timeout(10.seconds).unsafeRunSync()
    assertEquals(ended.left.map { case error: DomainError => error.code; case error => error.toString },Left("model-telemetry-invariant"))
    assertEquals(f.stage(receipt.jobId),None,"nothing is recorded for the job")
  }}
  test("BG/GoodCommunication regression: a fatal domain error raised while recording a job failure still ends the worker run") { withFixture { f =>
    val config=f.config.copy(indexing=f.config.indexing.copy(annotationSessions=1))
    f.archive().ingest("a",request(List("user"->"synthetic task")))
    val archive=new ForwardingArchive(f.archive()) {
      override def fail(c: Claim,code: String,stage: IndexingStage): Unit = throw DomainError("internal","synthetic invariant while recording")
    }
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO.raiseError(DomainError("model-timeout","model deadline exceeded"))
    }
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("no embedding"))
    }
    val ended=worker(archive,config,model,embedding).run.attempt.timeout(10.seconds).unsafeRunSync()
    assertEquals(ended.left.map { case error: DomainError => error.code; case error => error.toString },Left("internal"))
  }}
  test("BG/GoodCommunication: partial embedding batches commit individually and only the failed batch is recomputed") { withFixture { f =>
    val archive=f.archive(); val receipt=archive.ingest("a",request((0 until 40).map(i => "assistant"->s"source-$i").toList))
    var annotations=0; var failed=false; val embedded=ListBuffer.empty[String]
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO { annotations+=1; one(window,previous) }
    }
    val failedText=s"source-${f.config.indexing.embeddingBatchSize}"
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO {
        embedded++=text
        if(text.head==failedText && !failed) { failed=true; throw DomainError("model-timeout","model deadline exceeded") }
        text.map(_ => List(1e-10,-0.0,1.25))
      }
    }
    assert(worker(f,model,embedding).once.unsafeRunSync()); assert(failed)
    assert(worker(f,model,embedding).once.unsafeRunSync())
    assertEquals(archive.session("a",receipt.sessionId).indexedRevision,Some(1)); assertEquals(annotations,1)
    assertEquals(embedded.count(_=="source-0"),1); assertEquals(embedded.count(_==failedText),2)
  }}
  test("BG/GoodCommunication regression: independent invalid windows do not spend a session-wide five-failure budget") { withFixture { f =>
    val archive=f.archive(); val windows=7
    val receipt=archive.ingest("a",request((0 until windows*ProblemPassages.maximumWindowFragments).map(i => "user"->s"synthetic source $i").toList))
    val calls=scala.collection.mutable.Map.empty[Int,Int]
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO {
        val ordinal=window.fragments.head.messagePosition/ProblemPassages.maximumWindowFragments
        val count=calls.getOrElse(ordinal,0)+1; calls(ordinal)=count
        if(count==1) ProblemPassages.Decision(Vector(ProblemPassages.Part.context(ProblemPassages.Point(0,0),ProblemPassages.Point(1,0))))
        else one(window,previous)
      }
    }
    val embedded=ListBuffer.empty[String]
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("unexpected query"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO { embedded++=text; text.map(_ => List(1.0,0.0,0.0)) }
    }
    (0 until windows+1).foreach(_ => worker(f,model,embedding).once.unsafeRunSync())
    assertEquals(archive.session("a",receipt.sessionId).indexedRevision,Some(1),"a progressing source must not fail after five independent invalid windows")
    assertEquals(calls.values.toList.sorted,List.fill(windows)(2))
    assertEquals(f.evidence(receipt.jobId),WorkerEvidence(1,windows*2,windows))
    assertEquals(embedded.toList.distinct.size,windows*ProblemPassages.maximumWindowFragments)
    assertEquals(embedded.size,embedded.distinct.size,"accepted prefix embeddings must not be repeated")
  }}
  test("BG/GoodCommunication regression: annotation attempts are bounded across fresh workers, not multiplied by job claims") { withFixture { f =>
    val archive=f.archive(); val receipt=archive.ingest("a",request(List("user"->"synthetic task"))); var calls=0
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO { calls+=1; throw DomainError("model-output/truncated","synthetic truncation") }
    }
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("unexpected query"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("invalid annotation must not embed"))
    }
    assert(worker(f,model,embedding).once.unsafeRunSync())
    assertEquals(archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300),None,"exhaustion must be terminal, not another queued claim")
    (0 until 5).foreach(_ => assert(!worker(f,model,embedding).once.unsafeRunSync()))
    assertEquals(f.evidence(receipt.jobId),WorkerEvidence(1,5,5))
    assertEquals(calls,5,"reclaiming the job must not multiply the per-window provider-call bound")
    assertEquals(archive.session("a",receipt.sessionId).indexedRevision,None)
    assertEquals(f.stage(receipt.jobId),Some(IndexingStage.Annotation))
  }}
  test("BG/GoodCommunication regression: supersession during invalid output prevents another authorization or provider call") { withFixture { f =>
    val archive=f.archive(); val original=request(List("user"->"synthetic task")); val receipt=archive.ingest("a",original); var calls=0
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO {
        calls+=1; f.rebuild("a")
        ProblemPassages.Decision(Vector(ProblemPassages.Part.context(ProblemPassages.Point(0,0),ProblemPassages.Point(0,1))))
      }
    }
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("unexpected query"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("stale output must not embed"))
    }
    assert(worker(f,model,embedding).once.unsafeRunSync()); assertEquals(calls,1)
    assertEquals(archive.session("a",receipt.sessionId).indexedRevision,None)
    assertEquals(f.stage(receipt.jobId),None)
  }}
  test("BG/GoodCommunication regression: corrupt accepted annotation fails internally instead of entering a provider retry loop") { withFixture { f =>
    val archive=f.archive(); archive.ingest("a",request(List("user"->"synthetic task")))
    val claim=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    val window=ProblemPassages.Source(claim.messages.decoded).next(ProblemPassages.SourceCursor.start).get
    val key=IndexCheckpoints.key(claim,IndexingStage.Annotation,0,0,ProblemPassages.identity,Json.arr(window.sourceJson,Json.Null))
    val corrupt=ProblemPassages.Decision(Vector(ProblemPassages.Part.context(ProblemPassages.Point(0,0),ProblemPassages.Point(0,1))))
    archive.checkpoint(claim,key,CheckpointJson.decision(corrupt)); archive.fail(claim,"model-timeout",IndexingStage.Annotation)
    var calls=0
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO { calls+=1; one(window,previous) }
    }
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("unexpected query"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("corrupt accepted output must not embed"))
    }
    assertEquals(intercept[DomainError](worker(f,model,embedding).once.unsafeRunSync()).code,"internal")
    assertEquals(calls,0)
    assertEquals(f.evidence(claim.jobId),WorkerEvidence(2,0,0))
  }}
  List(false,true).foreach { reservationFailure =>
    test(s"BG/GoodCommunication regression: an unknown ${if(reservationFailure) "reservation" else "rejection"} commit outcome releases the claim instead of locally replaying") { withFixture { f =>
      val archive=f.archive(); val receipt=archive.ingest("a",request(List("user"->"synthetic task"))); var interrupted=false; var calls=0
      val uncertain=new ForwardingArchive(archive) {
        override def reserveAnnotation(c: Claim,key: CheckpointKey): AnnotationReservation = {
          val result=super.reserveAnnotation(c,key)
          if(reservationFailure && !interrupted) { interrupted=true; throw new java.sql.SQLException("synthetic unknown commit outcome") }
          result
        }
        override def rejectAnnotation(c: Claim,key: CheckpointKey,attempt: Int,reason: String): Int = {
          val result=super.rejectAnnotation(c,key,attempt,reason)
          if(!reservationFailure && !interrupted) { interrupted=true; throw new java.sql.SQLException("synthetic unknown commit outcome") }
          result
        }
      }
      val model=new ProblemPassageAnnotator {
        def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO {
          calls+=1
          if(!reservationFailure && calls==1) ProblemPassages.Decision(Vector(ProblemPassages.Part.context(ProblemPassages.Point(0,0),ProblemPassages.Point(0,1))))
          else one(window,previous)
        }
      }
      val embedding=new Embedder {
        def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("unexpected query"))
        def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.pure(text.map(_ => List(1.0,0.0,0.0)))
      }
      assert(worker(uncertain,f.config,model,embedding).once.unsafeRunSync()); assert(interrupted)
      assertEquals(calls,if(reservationFailure) 0 else 1,"uncertain commit must not enter a local provider retry")
      assertEquals(f.evidence(receipt.jobId),WorkerEvidence(1,1,if(reservationFailure) 0 else 1))
      assertEquals(archive.session("a",receipt.sessionId).indexedRevision,None)
      assert(worker(f,model,embedding).once.unsafeRunSync())
      assertEquals(archive.session("a",receipt.sessionId).indexedRevision,Some(1))
      assertEquals(f.evidence(receipt.jobId),WorkerEvidence(2,2,if(reservationFailure) 0 else 1))
    }}
  }
  test("BG/GoodCommunication specified: Historian role and normalized summary reach the unchanged annotation and embedding pipeline") { withFixture { f =>
    val archive=f.archive(); val original=HistorianFixtures.snapshot(); val receipt=archive.ingest("a",original)
    var annotations=0; val embedded=ListBuffer.empty[String]
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO {
        annotations+=1; assertEquals(window.fragments.map(_.role).distinct,Vector("historian"))
        assertEquals(window.fragments.map(_.text).mkString,original.messages.head.text)
        one(window,previous)
      }
    }
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("unexpected query embedding"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO { embedded++=text; text.map(_ => List(1.0,0.0,0.0)) }
    }
    assert(worker(f,model,embedding).once.unsafeRunSync()); assertEquals(annotations,1)
    assertEquals(embedded.mkString,original.messages.head.text)
    assertEquals(archive.session("a",receipt.sessionId).indexedRevision,Some(1))
  }}
  test("BG/GoodCommunication: long bootstrap and context-only source publish truthfully without any embedding call") { withFixture { f =>
    val archive=f.archive(); val receipt=archive.ingest("a",request(List.fill(130)("system"->"synthetic runtime context")))
    var annotations=0
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO {
        annotations+=1; assertEquals(previous,None)
        ProblemPassages.Decision(Vector(ProblemPassages.Part.context(ProblemPassages.Point(0,0),window.terminal)))
      }
    }
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("context must not embed"))
    }
    assert(worker(f,model,embedding).once.unsafeRunSync()); assertEquals(annotations,3)
    val info=archive.session("a",receipt.sessionId); assertEquals(info.indexedRevision,Some(1)); assert(info.view.generationId.nonEmpty)
  }}
  test("BG/GoodCommunication: five exact truncations remain local attempts and the persisted failure stage is annotation") { withFixture { f =>
    val archive=f.archive(); val receipt=archive.ingest("a",request(List("developer"->"genuine task"))); var calls=0
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO { calls+=1; throw DomainError("model-output/truncated","synthetic truncation") }
    }
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("unexpected embedding"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("unexpected embedding"))
    }
    assert(worker(f,model,embedding).once.unsafeRunSync()); assertEquals(calls,5)
    assertEquals(archive.session("a",receipt.sessionId).indexedRevision,None); assertEquals(f.stage(receipt.jobId),Some(IndexingStage.Annotation))
  }}
}
final class DummyContextWorkerRecoveryTest extends ContextWorkerRecoveryContract {
  def withFixture(run: ContextWorkerFixture => Unit): Unit = {
    val c=Fixtures.config(); val value=new DummyArchive(c,IndexProfileCatalog.current(c))
    run(new ContextWorkerFixture {
      val config: Config=c
      def archive(): SessionArchive=value
      def stage(id: UUID): Option[IndexingStage]=value.failureStage(id)
      def acceptedParts(id: UUID,stage: IndexingStage): Int=value.acceptedParts(id,stage)
      def evidence(id: UUID): WorkerEvidence=value.workerEvidence(id)
      def rebuild(owner: String): Unit={ val plan=value.preview(owner); value(owner,UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true); () }
    })
  }
  test("BG/GoodCommunication regression: one large job runs at a time; another large job stays queued while lanes take small ones") { withFixture { f =>
    val config=f.config.copy(indexing=f.config.indexing.copy(annotationSessions=2))
    def large(owner: String): IngestRequest = request((0 to LargeJobs.windows*ProblemPassages.maximumWindowFragments).map(i => "user"->s"$owner message $i").toList)
    val first=f.archive().ingest("a",large("a")); val second=f.archive().ingest("b",large("b"))
    (for {
      blocked <- Deferred[IO,Unit]
      release <- Deferred[IO,Unit]
      skipped <- Deferred[IO,Unit]
      published <- cats.effect.Ref.of[IO,Int](0)
      both <- Deferred[IO,Unit]
      archive=new ForwardingArchive(f.archive()) {
        override def claim(profiles: Set[String],scope: ClaimScope,lease: Int,large: LargeJobs): Option[Claim] = {
          if(large==LargeJobs.Skipped && blocked.tryGet.unsafeRunSync().nonEmpty) skipped.complete(()).unsafeRunSync()
          super.claim(profiles,scope,lease,large)
        }
        override def publishProblems(c: Claim,p: ProblemRows): Boolean = {
          val result=super.publishProblems(c,p)
          if(published.updateAndGet(_+1).unsafeRunSync()==2) both.complete(()).unsafeRunSync()
          result
        }
      }
      model=new ProblemPassageAnnotator {
        def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] =
          (if(previous.isEmpty) blocked.complete(()) *> release.get else IO.unit).as(one(window,previous))
      }
      embedding=new Embedder {
        def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
        def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.pure(text.map(_ => List(1.0,0.0,0.0)))
      }
      fiber <- worker(archive,config,model,embedding).run.start
      _ <- blocked.get.timeout(10.seconds)
      _ <- skipped.get.timeout(10.seconds)
      _ <- IO(assertEquals(List(first,second).map(receipt => f.evidence(receipt.jobId).claims).sorted,List(0,1),"the other large job is deferred without an attempt and then passed by"))
      _ <- release.complete(())
      _ <- both.get.timeout(30.seconds)
      _ <- fiber.cancel
    } yield ()).unsafeRunSync()
    assertEquals(f.archive().session("a",first.sessionId).indexedRevision,Some(1)); assertEquals(f.archive().session("b",second.sessionId).indexedRevision,Some(1))
  }}
}
final class PostgresContextWorkerRecoveryTest extends ContextWorkerRecoveryContract {
  def withFixture(run: ContextWorkerFixture => Unit): Unit = CurrentIndexDatabase.withDatabase { (c,db,_) =>
    run(new ContextWorkerFixture {
      val config: Config=c
      def archive(): SessionArchive=new PostgresArchive(db,c)
      def stage(id: UUID): Option[IndexingStage]=db.transaction(connection => Sql.one(connection,"SELECT failure_stage FROM ch_jobs WHERE id=?",id)(row => Option(row.getString(1)).map(IndexingStage.valueOf)).flatten)
      def acceptedParts(id: UUID,stage: IndexingStage): Int=db.transaction(connection => Sql.one(connection,"SELECT count(*) FROM ch_index_checkpoints WHERE job_id=? AND stage=?",id,stage.toString)(_.getInt(1)).get)
      def evidence(id: UUID): WorkerEvidence=db.transaction { connection =>
        val claims=Sql.one(connection,"SELECT attempts FROM ch_jobs WHERE id=?",id)(_.getInt(1)).get
        Sql.one(connection,"SELECT count(*),count(rejection_reason) FROM ch_annotation_attempts WHERE job_id=?",id)(r => WorkerEvidence(claims,r.getInt(1),r.getInt(2))).get
      }
      def rebuild(owner: String): Unit={ Fixtures.rebuild(db,owner); () }
    })
  }
  test("BG/GoodCommunication regression: a corrupt accepted embedding part stays an internal fault that ends the worker run and is never discarded with its window") { CurrentIndexDatabase.withDatabase { (config,db,archive) =>
    val texts=(0 until 40).map(i => s"source-$i").toList; var failed=false; var calls=0
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO(one(window,previous))
    }
    val embedding=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("no query embedding"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO {
        calls+=1
        if(text.head=="source-32" && !failed) { failed=true; throw DomainError("model-timeout","model deadline exceeded") }
        text.map(_ => List(1.0,0.0,0.0))
      }
    }
    val receipt=archive.ingest("a",request(texts.map("assistant"->_)))
    assert(worker(archive,config,model,embedding).once.unsafeRunSync()); assert(failed)
    def parts: Int = db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_index_checkpoints WHERE job_id=? AND stage='Embedding'",receipt.jobId)(_.getInt(1)).get)
    assertEquals(parts,32/config.indexing.embeddingBatchSize)
    db.transaction(c => Sql.exec(c,"UPDATE ch_index_checkpoints SET value='[[1.0,2.0,3.0]]' WHERE job_id=? AND stage='Embedding' AND part=1",receipt.jobId)); calls=0
    val regrouped=config.copy(indexing=config.indexing.copy(embeddingBatchSize=4))
    val ended=worker(archive,regrouped,model,embedding).run.attempt.timeout(10.seconds).unsafeRunSync()
    assertEquals(ended.left.map { case error: DomainError => error.code; case error => error.toString },Left("internal"))
    assertEquals(parts,32/config.indexing.embeddingBatchSize,"the corrupt part and its window are kept for inspection"); assertEquals(calls,0)
    assertEquals(db.transaction(c => Sql.one(c,"SELECT state FROM ch_jobs WHERE id=?",receipt.jobId)(_.getString(1))),Some("Running"),"the job keeps its lease until it expires")
  }}
}
