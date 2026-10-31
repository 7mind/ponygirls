package chronicle

import chronicle.api.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.util.UUID
import scala.collection.mutable.ListBuffer

final case class WorkerEvidence(claims: Int,reservations: Int,rejections: Int)
trait ContextWorkerFixture {
  def evidence(id: UUID): WorkerEvidence
  def config: Config
  def archive(): SessionArchive
  def stage(id: UUID): Option[IndexingStage]
}
abstract class ContextWorkerRecoveryContract extends munit.FunSuite {
  def withFixture(run: ContextWorkerFixture => Unit): Unit
  private def request(values: List[(String,String)]): IngestRequest = {
    val original=Fixtures.snapshot(); val messages=values.zipWithIndex.map { case ((role,text),i) => Message(s"m$i",None,role,text,None,i) }
    val content=messages.map(message => Json.obj("id"->Json.fromString(message.id),"text"->Json.fromString(message.text)).noSpaces+"\n").mkString
    val raw=if(content.isEmpty) "{}\n" else content
    original.copy(messages=messages,files=List(RawFile("source.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  private def worker(f: ContextWorkerFixture,model: ProblemPassageAnnotator,embedding: Embedder): Worker = worker(f.archive(),f.config,model,embedding)
  private def worker(archive: SessionArchive,config: Config,model: ProblemPassageAnnotator,embedding: Embedder): Worker =
    new Worker(archive,model,embedding,config,IndexProfileCatalog.current(config),ModelAdmission.make(config.indexing).unsafeRunSync(),logstage.IzLogger())
  private class ForwardingArchive(delegate: SessionArchive) extends SessionArchive {
    def knownProfiles: Set[String]=delegate.knownProfiles
    def ingest(owner: String,r: IngestRequest): IngestReceipt=delegate.ingest(owner,r)
    def session(reader: String,id: UUID): SessionInfo=delegate.session(reader,id)
    def headSnapshot(reader: String,id: UUID): IngestRequest=delegate.headSnapshot(reader,id)
    def claim(profiles: Set[String],scope: ClaimScope,lease: Int): Option[Claim]=delegate.claim(profiles,scope,lease)
    def renew(c: Claim,lease: Int): Boolean=delegate.renew(c,lease)
    def progress(c: Claim,done: Int,total: Int): Boolean=delegate.progress(c,done,total)
    def publishProblems(c: Claim,p: ProblemsPublication): Boolean=delegate.publishProblems(c,p)
    def fail(c: Claim,code: String): Unit=delegate.fail(c,code)
    def fail(c: Claim,code: String,stage: IndexingStage): Unit=delegate.fail(c,code,stage)
    def checkpoint(c: Claim,key: CheckpointKey): Option[Json]=delegate.checkpoint(c,key)
    def checkpoint(c: Claim,key: CheckpointKey,value: Json): Unit=delegate.checkpoint(c,key,value)
    def reserveAnnotation(c: Claim,key: CheckpointKey): AnnotationReservation=delegate.reserveAnnotation(c,key)
    def rejectAnnotation(c: Claim,key: CheckpointKey,attempt: Int,reason: String): Int=delegate.rejectAnnotation(c,key,attempt,reason)
  }
  private def one(window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): ProblemPassages.Decision =
    ProblemPassages.Decision(Vector(ProblemPassages.Part(ProblemPassages.Point(0,0),window.terminal,previous.nonEmpty,"synthetic goal",Nil)))
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
        calls+=1; archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1))
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
    val window=ProblemPassages.Source(claim.snapshot.messages).next(ProblemPassages.SourceCursor.start).get
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
      def evidence(id: UUID): WorkerEvidence=value.workerEvidence(id)
    })
  }
}
final class PostgresContextWorkerRecoveryTest extends ContextWorkerRecoveryContract {
  def withFixture(run: ContextWorkerFixture => Unit): Unit = CurrentIndexDatabase.withDatabase { (c,db,_) =>
    run(new ContextWorkerFixture {
      val config: Config=c
      def archive(): SessionArchive=new PostgresArchive(db,c)
      def stage(id: UUID): Option[IndexingStage]=db.transaction(connection => Sql.one(connection,"SELECT failure_stage FROM ch_jobs WHERE id=?",id)(row => Option(row.getString(1)).map(IndexingStage.valueOf)).flatten)
      def evidence(id: UUID): WorkerEvidence=db.transaction { connection =>
        val claims=Sql.one(connection,"SELECT attempts FROM ch_jobs WHERE id=?",id)(_.getInt(1)).get
        Sql.one(connection,"SELECT count(*),count(rejection_reason) FROM ch_annotation_attempts WHERE job_id=?",id)(r => WorkerEvidence(claims,r.getInt(1),r.getInt(2))).get
      }
    })
  }
}
