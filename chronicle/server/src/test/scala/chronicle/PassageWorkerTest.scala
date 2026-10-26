package chronicle

import chronicle.api.*
import cats.effect.{Deferred,IO,Ref}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.Json
import org.http4s.{Message as _,*}
import org.http4s.client.Client
import java.util.UUID
import java.nio.charset.StandardCharsets.UTF_8
import scala.collection.mutable.ListBuffer
import scala.concurrent.duration.*

abstract class PassageWorkerContract extends munit.FunSuite {
  protected def withArchive(f: (Config,IndexProfileCatalog,SessionArchive & PassageReader,(String,String) => Unit) => Unit): Unit
  private final class Recording(delegate: SessionArchive) extends SessionArchive {
    val progressCalls=ListBuffer.empty[(Int,Int)]
    val publications=ListBuffer.empty[ProblemsPublication]
    var legacyPublications=0
    def knownProfiles: Set[String] = delegate.knownProfiles
    def ingest(owner: String,r: IngestRequest): IngestReceipt = delegate.ingest(owner,r)
    def session(reader: String,id: UUID): SessionInfo = delegate.session(reader,id)
    def headSnapshot(reader: String,id: UUID): IngestRequest = delegate.headSnapshot(reader,id)
    def claim(profiles: Set[String],scope: ClaimScope,lease: Int): Option[Claim] = delegate.claim(profiles,scope,lease)
    def renew(claim: Claim,lease: Int): Boolean = delegate.renew(claim,lease)
    def progress(claim: Claim,done: Int,total: Int): Boolean = synchronized { progressCalls+=((done,total)); delegate.progress(claim,done,total) }
    def publish(claim: Claim,chunks: List[IndexedChunk]): Boolean = synchronized { legacyPublications+=1; delegate.publish(claim,chunks) }
    def publishProblems(claim: Claim,publication: ProblemsPublication): Boolean = synchronized { publications+=publication; delegate.publishProblems(claim,publication) }
    def fail(claim: Claim,code: String): Unit = delegate.fail(claim,code)
  }
  private def source(texts: List[String]): IngestRequest = {
    val messages=texts.zipWithIndex.map((text,index) => Message(s"m$index",None,"assistant",text,None,index))
    val raw=messages.map(m => Json.obj("id"->Json.fromString(m.id),"text"->Json.fromString(m.text)).noSpaces+"\n").mkString
    Fixtures.snapshot().copy(messages=messages,files=List(RawFile("synthetic.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  private val forbiddenLegacy=new Annotator {
    def annotate(owner: String,window: List[Chunk],messages: List[Message]): IO[List[Chunk]] = IO.raiseError(new AssertionError("passage profile invoked legacy annotator"))
  }
  private final class Embeddings extends Embedder {
    val batches=ListBuffer.empty[List[String]]
    val vectors=ListBuffer.empty[List[Double]]
    def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("worker queried embedding"))
    def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO {
      assertEquals(owner,"a"); batches+=text
      text.map { _ => val vector=List(1.0,vectors.size.toDouble,0.0); vectors+=vector; vector }
    }
  }
  private def worker(archive: SessionArchive,config: Config,catalog: IndexProfileCatalog,model: ProblemPassageAnnotator,embedder: Embedder): Worker =
    new Worker(archive,forbiddenLegacy,model,embedder,config,catalog,ModelAdmission.make(config.indexing).unsafeRunSync(),logstage.IzLogger())

  test("BG/GoodCommunication: actual passage Worker carries one problem, embeds each prefix in batches, coalesces spans and publishes final metadata") { withArchive { (config,catalog,delegate,_) =>
    val archive=new Recording(delegate)
    val request=source(List("A"+"α🙂\u0001\n"*50000))
    val receipt=archive.ingest("a",request)
    val embedding=new Embeddings
    var calls=0
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO {
        assertEquals(owner,"a")
        if(calls>0) { assert(embedding.batches.nonEmpty); assertEquals(previous.get.initialSummary,"status 1") }
        assertEquals(archive.progressCalls.last._1,calls)
        calls+=1
        ProblemPassageFixtures.one(window,previous.nonEmpty,s"status $calls",List("one"))
      }
    }
    val worked1=worker(archive,config,catalog,model,embedding).once.unsafeRunSync(); assert(worked1)
    assert(calls>=3); assertEquals(archive.progressCalls.toList,(0 to calls).map(i => (i,calls)).toList)
    assert(embedding.batches.forall(batch => batch.nonEmpty && batch.size<=config.indexing.embeddingBatchSize))
    assertEquals(embedding.batches.flatten.mkString,request.messages.map(_.text).mkString)
    val published=archive.publications.last
    assertEquals(published.passages.size,1); assertEquals(published.spans.size,1)
    assertEquals(published.spans.head.source.end,request.messages.head.text.getBytes(UTF_8).length)
    assertEquals(published.chunks.map(_.vector),embedding.vectors.toList)
    assert(published.chunks.forall(_.chunk.summary==s"status $calls"))
    assertEquals(archive.legacyPublications,0); assertEquals(delegate.session("a",receipt.sessionId).indexedRevision,Some(1))
    assertEquals(delegate.passages("a",receipt.sessionId,0,100,None).format,PassageFormat.ContiguousProblems)
  }}
  test("BG/GoodCommunication: actual Worker publishes inside-message A-B-A as three passages with exact source and fresh namespaces") { withArchive { (config,catalog,delegate,_) =>
    val archive=new Recording(delegate); val request=source(List("AAA🙂BBBBAAAA")); val receipt=archive.ingest("a",request)
    val embedding=new Embeddings; val model=new ProblemPassageFixtures.Dummy
    val worked2=worker(archive,config,catalog,model,embedding).once.unsafeRunSync(); assert(worked2)
    val first=archive.publications.last
    assertEquals(first.passages.map(_.tags),Vector(List("A"),List("B"),List("A")))
    assertEquals(first.chunks.map(_.chunk.text).mkString,request.messages.head.text)
    val view=delegate.session("a",receipt.sessionId).view
    val page=delegate.passages("a",receipt.sessionId,0,100,Some(view))
    assertEquals(page.total,3L)
    page.passages.foreach(p => assertEquals(delegate.passageSpans("a",receipt.sessionId,p.id,0,100,Some(view)).total,1L))
    archive.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    val worked3=worker(archive,config,catalog,model,new Embeddings).once.unsafeRunSync(); assert(worked3)
    val second=archive.publications.last
    assert(first.passages.map(_.id).toSet.intersect(second.passages.map(_.id).toSet).isEmpty)
    assert(first.chunks.map(_.chunk.id).toSet.intersect(second.chunks.map(_.chunk.id).toSet).isEmpty)
    assertEquals(delegate.passages("a",receipt.sessionId,0,100,Some(view)),page)
  }}
  List(false,true).foreach { exhaust =>
    test(s"BG/GoodCommunication: actual HTTP passage retries ${if(exhaust) "exhaust five" else "only the truncated window"} without recomputing embedded prefixes") { withArchive { (config,catalog,delegate,_) =>
      val archive=new Recording(delegate); val request=source((0 until 160).map(i => s"A substep $i").toList); archive.ingest("a",request)
      val embedding=new Embeddings; val requests=ListBuffer.empty[Json]
      val clock=new JavaModelTelemetryClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO])
      val store=ModelTelemetry.make(clock,Set("a")).unsafeRunSync()
      val admission=ModelAdmission.make(config.indexing).unsafeRunSync()
      val app: HttpApp[IO]=cats.data.Kleisli { req => req.as[String].map { body =>
        val payload=Wire.parse(body)
        assertEquals(payload.hcursor.get[Int]("max_tokens").toOption,Some(65536))
        assertEquals(payload.hcursor.downField("chat_template_kwargs").get[String]("reasoning_effort").toOption,Some("max"))
        val input=Wire.parse(payload.hcursor.downField("messages").downN(1).get[String]("content").toOption.get)
        requests+=payload
        val texts=input.hcursor.get[Vector[Json]]("fragments").toOption.get.map(_.hcursor.get[String]("text").toOption.get)
        if(requests.size>1 && (exhaust || requests.size<=3)) assertEquals(embedding.batches.flatten.size,64)
        else if(requests.size==4) assertEquals(embedding.batches.flatten.size,128)
        val previous=input.hcursor.downField("previous").get[List[String]]("tags").toOption.flatMap(_.headOption)
        val finish=if(requests.size==2 || (exhaust && requests.size>1)) "length" else "stop"
        val response=ProblemPassageFixtures.envelope(ProblemPassageFixtures.json(ProblemPassageFixtures.plan(texts,previous)).noSpaces,finish)
          .mapObject(_.add("usage",Json.obj("prompt_tokens"->Json.fromInt(1),"completion_tokens"->Json.fromInt(1))))
        Response[IO](Status.Ok).withEntity(response.noSpaces)
      }}
      val model=new OpenAIProblemPassageAnnotator(new ModelHttp(Client.fromHttpApp(app),store,admission),config)
      val worked4=new Worker(archive,forbiddenLegacy,model,embedding,config,catalog,admission,logstage.IzLogger()).once.unsafeRunSync(); assert(worked4)
      if(exhaust) {
        assertEquals(requests.size,6); assertEquals(embedding.batches.flatten.size,64); assertEquals(archive.publications.size,0)
        assertEquals(archive.progressCalls.toList,List((0,3),(1,3)))
        assert(requests.drop(1).forall(_==requests(1)))
      } else {
        assertEquals(requests.size,4); assertEquals(requests(1),requests(2)); assertEquals(embedding.batches.flatten.size,160)
        assertEquals(archive.progressCalls.toList,List((0,3),(1,3),(2,3),(3,3))); assertEquals(archive.publications.size,1)
      }
      val value=store.snapshot("a").unsafeRunSync().samples.find(_.purpose==ModelWorkload.IndexAnnotation).get
      assertEquals(value.inFlight,0); assertEquals(value.finishedCalls,requests.size.toLong); assertEquals(value.input.knownTokens,requests.size.toLong)
    }}
  }
  test("BG/GoodCommunication: a stale claim after embedding cannot annotate another window or publish") { withArchive { (config,catalog,delegate,_) =>
    val archive=new Recording(delegate); val request=source((0 until 160).map(i => s"A substep $i").toList); archive.ingest("a",request)
    var calls=0; var invalidated=false
    val base=new ProblemPassageFixtures.Dummy
    val model=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = { calls+=1; base.annotate(owner,window,previous) }
    }
    val embedder=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("unexpected query"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO {
        if(!invalidated) { invalidated=true; archive.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1)) }
        text.map(_ => List(1.0,0.0,0.0))
      }
    }
    val worked5=worker(archive,config,catalog,model,embedder).once.unsafeRunSync(); assert(worked5)
    assertEquals(calls,1); assertEquals(archive.publications.size,0); assertEquals(archive.progressCalls.toList,List((0,3),(1,3)))
  }}
  test("BG/GoodCommunication: authoritative retained legacy profile never invokes passage annotation or publishes P1") { withArchive { (config,catalog,delegate,retain) =>
    retain("a",config.profile)
    val archive=new Recording(delegate); val receipt=archive.ingest("a",source(List.fill(12)("A substep")))
    val legacy=new Annotator {
      def annotate(owner: String,window: List[Chunk],messages: List[Message]): IO[List[Chunk]] = IO {
        AnnotationPartition.project(window,Json.obj("chunks"->Json.arr(Json.obj("first"->Json.fromInt(0),"last"->Json.fromInt(window.size-1),"summary"->Json.fromString("legacy"),"tags"->Json.arr()))))
      }
    }
    val forbidden=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO.raiseError(new AssertionError("legacy claim mislabeled as passage"))
    }
    val worked6=new Worker(archive,legacy,forbidden,new Embeddings,config,catalog,ModelAdmission.make(config.indexing).unsafeRunSync(),logstage.IzLogger()).once.unsafeRunSync(); assert(worked6)
    assertEquals(archive.publications.size,0); assertEquals(archive.legacyPublications,1)
    assertEquals(delegate.passages("a",receipt.sessionId,0,100,None).format,PassageFormat.LegacyAnnotations)
    assertEquals(archive.progressCalls.toList,List((0,3),(1,3),(2,3),(3,3)))
  }}
  test("BG/GoodCommunication: finite worker lanes let an independent owner publish while another annotation is blocked; cancellation releases both gates") { withArchive { (config,catalog,delegate,_) =>
    val a=delegate.ingest("a",source(List("A blocked"))); val b=delegate.ingest("b",source(List("A ready")))
    (for {
      blocked <- Deferred[IO,Unit]
      published <- Deferred[IO,Unit]
      admission <- ModelAdmission.make(config.indexing)
      model=new ProblemPassageAnnotator {
        def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] =
          if(owner=="a") blocked.complete(()).void *> IO.never else IO.pure(ProblemPassageFixtures.one(window,false,"ready",Nil))
      }
      embedder=new Embedder {
        def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("unexpected query"))
        def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO.pure(text.map(_ => List(1.0,0.0,0.0)))
      }
      archive=new SessionArchive {
        def knownProfiles=delegate.knownProfiles
        def ingest(owner: String,r: IngestRequest)=delegate.ingest(owner,r)
        def session(owner: String,id: UUID)=delegate.session(owner,id)
        def headSnapshot(owner: String,id: UUID)=delegate.headSnapshot(owner,id)
        def claim(p: Set[String],s: ClaimScope,l: Int)=delegate.claim(p,s,l)
        def renew(c: Claim,l: Int)=delegate.renew(c,l)
        def progress(c: Claim,n: Int,t: Int)=delegate.progress(c,n,t)
        def publish(c: Claim,chunks: List[IndexedChunk])=delegate.publish(c,chunks)
        def publishProblems(c: Claim,p: ProblemsPublication): Boolean = {
          val result=delegate.publishProblems(c,p)
          if(c.owner=="b") published.complete(()).unsafeRunSync()
          result
        }
        def fail(c: Claim,code: String)=delegate.fail(c,code)
      }
      fiber <- new Worker(archive,forbiddenLegacy,model,embedder,config,catalog,admission,logstage.IzLogger()).run.start
      _ <- blocked.get.timeout(3.seconds)
      _ <- published.get.timeout(3.seconds)
      _ <- IO { assertEquals(delegate.session("a",a.sessionId).indexedRevision,None); assertEquals(delegate.session("b",b.sessionId).indexedRevision,Some(1)) }
      _ <- fiber.cancel
      _ <- admission.annotationSession.use(_ => admission.request(ModelWorkload.IndexAnnotation).use(_ => IO.unit)).timeout(1.second)
    } yield ()).unsafeRunSync()
  }}
}
class DummyPassageWorkerTest extends PassageWorkerContract {
  protected def withArchive(f: (Config,IndexProfileCatalog,SessionArchive & PassageReader,(String,String) => Unit) => Unit): Unit = {
    val base=Fixtures.config(); val config=base.copy(annotation=base.annotation.copy(timeoutSeconds=900,requestPolicy=AnnotationRequestPolicy.GlmMaxReasoning),indexing=IndexingCapacity(2,2,3))
    val catalog=IndexProfileCatalog.passages(config,PassagePolicyIdentity(ProblemPassages.identity)); val archive=new DummyArchive(config,catalog)
    f(config,catalog,archive,(owner,profile) => archive.retainTarget(owner,profile))
  }
}
class PostgresPassageWorkerTest extends PassageWorkerContract {
  protected def withArchive(f: (Config,IndexProfileCatalog,SessionArchive & PassageReader,(String,String) => Unit) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val base=Fixtures.config(); val config=base.copy(annotation=base.annotation.copy(timeoutSeconds=900,requestPolicy=AnnotationRequestPolicy.GlmMaxReasoning),indexing=IndexingCapacity(2,2,3))
    val catalog=IndexProfileCatalog.passages(config,PassagePolicyIdentity(ProblemPassages.identity)); val db=new Database(config,catalog); db.initialize()
    db.transaction(c => { Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE"); Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",catalog.preferred.profile) })
    f(config,catalog,new PostgresArchive(db,config),(owner,profile) => { db.transaction(c => Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0 WHERE owner=?",profile,owner)); () })
  }
}
