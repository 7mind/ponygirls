package chronicle

import chronicle.api.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.util.UUID
import scala.collection.mutable.ListBuffer

trait ContextWorkerFixture {
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
  private def worker(f: ContextWorkerFixture,model: ProblemPassageAnnotator,embedding: Embedder): Worker =
    new Worker(f.archive(),model,embedding,f.config,IndexProfileCatalog.current(f.config),ModelAdmission.make(f.config.indexing).unsafeRunSync(),logstage.IzLogger())
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
      assert(worker(f,model,embedding).once.unsafeRunSync())
      assertEquals(archive.session("a",receipt.sessionId).indexedRevision,Some(1))
      assertEquals(annotations.count(_=='a'),1); assertEquals(embedded.count(_=="a0"),1)
      assertEquals(annotations.count(_=='b'),if(failureStage==IndexingStage.Annotation) 2 else 1)
      assertEquals(embedded.count(_=="b64"),if(failureStage==IndexingStage.Embedding) 2 else 1)
      assertEquals(f.stage(receipt.jobId),None)
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
    })
  }
}
final class PostgresContextWorkerRecoveryTest extends ContextWorkerRecoveryContract {
  def withFixture(run: ContextWorkerFixture => Unit): Unit = CurrentIndexDatabase.withDatabase { (c,db,_) =>
    run(new ContextWorkerFixture {
      val config: Config=c
      def archive(): SessionArchive=new PostgresArchive(db,c)
      def stage(id: UUID): Option[IndexingStage]=db.transaction(connection => Sql.one(connection,"SELECT failure_stage FROM ch_jobs WHERE id=?",id)(row => Option(row.getString(1)).map(IndexingStage.valueOf)).flatten)
    })
  }
}
