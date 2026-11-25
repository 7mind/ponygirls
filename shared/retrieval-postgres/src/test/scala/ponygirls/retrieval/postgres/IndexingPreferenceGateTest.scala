package ponygirls.retrieval.postgres

import cats.effect.{Deferred,IO,Ref,Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import org.http4s.{Response,Status}
import org.http4s.client.Client
import ponygirls.auth.{IndexingChoice,IndexingPolicy,IndexingPreferenceSql,IndexingService}
import ponygirls.retrieval.*
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.Files
import java.sql.Connection
import java.time.Instant
import scala.concurrent.duration.*

class IndexingPreferenceGateTest extends munit.FunSuite {
  import ControlledFixtures.*
  import IndexingChoice.*
  private val service=IndexingService.Manure
  private val vector=List(1.0,0.0,0.0)
  private final class Fixture(val db: PgFixture,policy: IndexingPolicy) {
    val owner=s"${db.index.namespace}\u0000/α"
    val editor=s"${db.index.namespace}/editor"
    val index=new PostgresRetrieval(db.index.namespace,db.profile,service,policy)
    db.tx(index.initialize)
    def choice(owner: String,value: IndexingChoice): Unit = db.tx(c => { IndexingPreferenceSql.store(c,service,policy).setChoice(owner,value); () })
    def projected(id: String,text: String): SourceProjection = source(id,text,Set("reader")).copy(owners=Set(owner))
    def put(s: SourceProjection): Unit = db.tx(c => index.put(c,s))
    def search(mode: RetrievalMode,text: String="alpha"): RetrievalPage = search(index,query(mode).copy(text=text),vector)
    def search(store: PostgresRetrieval,q: RetrievalQuery,v: List[Double]): RetrievalPage = db.tx(c => store.search(c,q,Option.when(q.mode!=RetrievalMode.Lexical)(v)))
    def claim(): Option[WorkClaim] = db.tx(c => index.claim(c,120,Instant.now()))
    def publish(claim: WorkClaim,v: List[Double]=vector): Unit = db.tx { c =>
      index.accept(c,claim,0,List.fill(claim.chunks.size)(v))
      index.publish(c,claim)
      ()
    }
    def worker(client: EmbeddingClient): IndexingWorker = new IndexingWorker(index,new RetrievalTransactions {
      def transaction[A](run: Connection => A): IO[A] = IO.blocking(db.tx(run))
    },client,1,120,500.millis,IO.realTimeInstant,_ => IO.unit)
  }
  private def fixture(p: Option[RetrievalProfile]=Some(profile),defaultEnabled: Boolean=true): Fixture =
    new Fixture(new PgFixture(p),IndexingPolicy(defaultEnabled,allowOptIn=true,allowOptOut=true))
  /** Scoped recording transport: runs the production admission, credential and JSON pipeline, with no external models. */
  private def provider(calls: Ref[IO,List[List[String]]],telemetry: EmbeddingTelemetry=EmbeddingTelemetry.noop)(beforeResponse: List[String] => IO[Unit]): Resource[IO,EmbeddingClient] =
    Resource.make(IO.blocking(Files.createTempFile("indexing-gate-credential",".txt")))(file => IO.blocking(Files.delete(file))).evalMap { file =>
      val transport=Client[IO](request => Resource.eval(request.as[String].flatMap { raw =>
        val inputs=io.circe.parser.parse(raw).flatMap(_.hcursor.get[List[String]]("input")).fold(throw _,identity)
        calls.update(_:+inputs) *> beforeResponse(inputs).as(Response[IO](Status.Ok).withEntity("""{"data":[{"index":0,"embedding":[1,0,0]}]}"""))
      }))
      val endpoint=EmbeddingEndpoint("http://localhost/fixture","recording","v1",3,false,"doc:","query:","cosine",file.toString,15.seconds,4096,1,4096,8192)
      EmbeddingClient.make(transport,endpoint,1,1,telemetry)
    }

  test("Effectual-GoodCommunication: opt-out hides and retains both indexes, parks newer payloads without deriving lexical entries or sending them") {
    val f=fixture(); val old=f.projected("artifact","alpha original")
    def indexedBodies: List[String] = f.db.tx { c =>
      Jdbc.rows(c,"SELECT body FROM pony_retrieval_head_chunks WHERE namespace=? ORDER BY source_id,ordinal",Jdbc.key(f.index.namespace))(r => new String(r.getBytes(1),UTF_8))
    }
    (for {
      calls <- Ref.of[IO,List[List[String]]](Nil)
      _ <- provider(calls)(_ => IO.unit).use { client =>
        val worker=f.worker(client)
        for {
          _ <- IO.blocking(f.put(old))
          _ <- worker.once.map(assertEquals(_,true))
          original <- IO.blocking(List(RetrievalMode.Lexical,RetrievalMode.Semantic,RetrievalMode.Hybrid).map(f.search(_)))
          _ <- IO.blocking {
            f.choice(f.owner,Disable)
            original.foreach { page => assertEquals(page.total,1L) }
            List(RetrievalMode.Lexical,RetrievalMode.Semantic,RetrievalMode.Hybrid).foreach { mode =>
              val hidden=f.search(mode)
              assertEquals((hidden.hits,hidden.total,hidden.pending),(Nil,0L,0L))
            }
            f.choice(f.owner,Enable)
            assertEquals(List(RetrievalMode.Lexical,RetrievalMode.Semantic,RetrievalMode.Hybrid).map(f.search(_)),original)
            f.choice(f.owner,Disable)
            f.put(old.copy(version="version-2",chunks=List(InputChunk("new","alpha\u0000changed",provenance))))
            f.put(f.projected("new-source","alpha newly written"))
            assertEquals(indexedBodies,List("alpha original"))
            assertEquals(f.search(RetrievalMode.Lexical).total,0L)
            assertEquals(f.search(RetrievalMode.Semantic).pending,0L)
          }
          _ <- worker.once.map(assertEquals(_,false))
          _ <- calls.get.map(assertEquals(_,List(List("doc:alpha original"))))
          _ <- IO.blocking {
            f.choice(f.owner,Enable)
            val lexical=f.search(RetrievalMode.Lexical)
            assertEquals(lexical.hits.map(_.chunk.text).toSet,Set("alpha\u0000changed","alpha newly written"))
            assertEquals(f.search(RetrievalMode.Lexical,"original").total,0L)
            val semantic=f.search(RetrievalMode.Semantic)
            assertEquals((semantic.hits,semantic.pending),(original(1).hits,2L))
          }
          _ <- worker.once.map(assertEquals(_,true))
          _ <- worker.once.map(assertEquals(_,true))
          _ <- worker.once.map(assertEquals(_,false))
          _ <- calls.get.map(values => assertEquals(values.drop(1).toSet,Set(List("doc:alpha\u0000changed"),List("doc:alpha newly written"))))
          _ <- IO.blocking {
            assertEquals(indexedBodies.toSet,Set("alpha\u0000changed","alpha newly written"))
            val semantic=f.search(RetrievalMode.Semantic)
            assertEquals((semantic.hits.map(_.version).toSet,semantic.pending),(Set("version-1","version-2"),0L))
          }
        } yield ()
      }
    } yield ()).unsafeRunSync()
  }

  test("Blackbox-GoodCommunication: default-off lexical-only, multi-owner policy, and explicit source removal") {
    val f=fixture(None,defaultEnabled=false)
    val source=f.projected("cold","alpha cold").copy(owners=Set(f.owner,f.editor))
    f.put(source)
    f.put(f.projected("unknown","alpha unknown").copy(owners=Set.empty))
    assertEquals(f.search(RetrievalMode.Lexical).total,0L)
    f.choice(f.owner,Enable)
    assertEquals(f.search(RetrievalMode.Lexical).total,0L)
    f.choice(f.editor,Enable)
    val lexical=f.search(RetrievalMode.Lexical)
    assertEquals(lexical.hits.map(_.id),List("cold"))
    assertEquals(f.search(RetrievalMode.Lexical,"").hits,lexical.hits.map(_.copy(score=0.0)))
    assert(f.db.tx(c => f.index.visible(c,query(RetrievalMode.Lexical),lexical.hits.head)))
    f.choice(f.owner,Disable)
    assert(!f.db.tx(c => f.index.visible(c,query(RetrievalMode.Lexical),lexical.hits.head)))
    f.db.tx(c => f.index.remove(c,source.id))
    f.choice(f.owner,Enable)
    assertEquals(f.search(RetrievalMode.Lexical).total,0L)
  }

  test("Blackbox-GoodCommunication: legacy publication is reattributed by indexed version without borrowing its editor's policy") {
    val f=fixture(); val old=f.projected("item","alpha old")
    // An old backend published this exact revision with no stored owner keys.
    f.db.store.put(old); f.db.store.publishAll()
    val published=f.db.store.search(query(RetrievalMode.Semantic)).hits.head
    val lexicalPin=f.db.store.search(query(RetrievalMode.Lexical)).hits.head
    assertEquals(f.search(RetrievalMode.Semantic).total,0L)
    assertEquals(f.search(RetrievalMode.Lexical).total,0L)
    val edited=old.copy(version="version-2",chunks=List(InputChunk("edit","alpha revised",provenance)),owners=Set(f.editor))
    f.put(edited)
    f.choice(f.owner,Disable)
    f.db.tx { c => f.index.backfillPublishedOwners(c,old.id) { version =>
      assertEquals(version,old.version)
      Set(f.owner)
    } }
    assertEquals(f.search(RetrievalMode.Lexical).hits.map(_.version),List(edited.version))
    List(RetrievalMode.Semantic,RetrievalMode.Hybrid).foreach { mode =>
      val hidden=f.search(mode)
      assertEquals((hidden.hits,hidden.total,hidden.pending),(Nil,0L,1L))
      assert(!f.db.tx(c => f.index.visible(c,query(mode),published)))
    }
    f.choice(f.owner,Enable)
    assert(!f.db.tx(c => f.index.visible(c,query(RetrievalMode.Lexical),lexicalPin)))
    assertEquals(f.search(RetrievalMode.Semantic).hits,List(published))
    val pinned=f.search(RetrievalMode.Semantic).hits.head
    assert(f.db.tx(c => f.index.visible(c,query(RetrievalMode.Semantic),pinned)))
    f.choice(f.owner,Disable)
    assert(!f.db.tx(c => f.index.visible(c,query(RetrievalMode.Semantic),pinned)))
    f.publish(f.claim().get)
    assertEquals(f.search(RetrievalMode.Semantic).hits.map(_.version),List(edited.version))
  }

  test("Blackbox-GoodCommunication: unavailable legacy attribution stays hidden and schedules one head rebuild") {
    val f=fixture(); val s=f.projected("legacy","alpha legacy")
    f.db.store.put(s); f.db.store.publishAll()
    val old=f.db.store.search(query(RetrievalMode.Semantic)).hits.head
    f.put(s)
    (1 to 2).foreach { _ =>
      f.db.tx(c => f.index.backfillPublishedOwners(c,s.id)(_ => Set.empty))
      val hidden=f.search(RetrievalMode.Semantic)
      assertEquals((hidden.total,hidden.pending),(0L,1L))
    }
    f.publish(f.claim().get)
    assertEquals(f.claim(),None)
    val repaired=f.search(RetrievalMode.Semantic)
    assertEquals((repaired.total,repaired.pending),(1L,0L))
    assertNotEquals(repaired.hits.head.generation,old.generation)
  }

  test("Blackbox-GoodCommunication: off/on fences checkpoint, accept and publish even before another worker reclaims") {
    val f=fixture(); val s=f.projected("two","alpha first")
    f.put(s.copy(chunks=s.chunks :+ InputChunk("second","alpha second",provenance)))
    val old=f.claim().get
    f.db.tx(c => f.index.accept(c,old,0,List(vector)))
    def stale(ops: Connection => Any): Unit = assertEquals(intercept[RetrievalError](f.db.tx(ops)).code,"stale-claim")
    f.choice(f.owner,Disable)
    assertEquals(f.claim(),None)
    stale(c => f.index.renew(c,old,120))
    stale(c => f.index.accepted(c,old,0,1))
    stale(c => f.index.accept(c,old,1,List(vector)))
    stale(c => f.index.publish(c,old))
    f.choice(f.owner,Enable)
    stale(c => f.index.accept(c,old,1,List(vector)))
    stale(c => f.index.publish(c,old))
    assertEquals(f.db.tx(c => f.index.fail(c,old,Instant.now())),None)
    val reclaimed=f.claim().get // without waiting for lease expiry
    assertEquals(reclaimed.jobId,old.jobId)
    assertEquals(f.db.tx(c => f.index.accepted(c,reclaimed,0,1)),Some(List(vector)))
    assertEquals(f.db.tx(c => f.index.accepted(c,reclaimed,1,1)),None)
    f.db.tx(c => f.index.accept(c,reclaimed,1,List(vector)))
    f.db.tx(c => f.index.publish(c,reclaimed))
    assertEquals(f.search(RetrievalMode.Semantic).pending,0L)
    f.choice(f.owner,Disable)
    stale(c => f.index.publish(c,reclaimed)) // even completed idempotent publish cannot bypass policy
  }

  test("Effectual-GoodCommunication: work waiting inside actual model admission cannot send after opt-out") {
    val f=fixture(); f.put(f.projected("queued","alpha queued"))
    (for {
      calls <- Ref.of[IO,List[List[String]]](Nil)
      inQuery <- Deferred[IO,Unit]
      release <- Deferred[IO,Unit]
      docQueued <- Deferred[IO,Unit]
      telemetry = new EmbeddingTelemetry {
        def queued(purpose: EmbeddingPurpose): IO[Unit] = if(purpose==EmbeddingPurpose.Document) docQueued.complete(()).void else IO.unit
        def started(purpose: EmbeddingPurpose): IO[Unit] = IO.unit
        def finished(purpose: EmbeddingPurpose,outcome: ModelOutcome): IO[Unit] = IO.unit
      }
      _ <- provider(calls,telemetry)(inputs => if(inputs==List("query:slot")) inQuery.complete(()).void *> release.get else IO.unit).use { client =>
        val worker=f.worker(client)
        client.query("slot").background.use { queryResult =>
          inQuery.get *> worker.once.attempt.background.use { workResult => for {
            _ <- docQueued.get
            _ <- IO.blocking(f.choice(f.owner,Disable))
            _ <- release.complete(())
            _ <- queryResult.flatMap(_.embedNever).map(assertEquals(_,vector))
            _ <- workResult.flatMap(_.embedNever).map(r => assertEquals(r.left.toOption.map(IndexingEvent.code),Some("stale-claim")))
            _ <- calls.get.map(assertEquals(_,List(List("query:slot"))))
            _ <- worker.once.map(assertEquals(_,false))
            _ <- IO.blocking(f.choice(f.owner,Enable))
            _ <- worker.once.map(assertEquals(_,true))
            _ <- calls.get.map(assertEquals(_,List(List("query:slot"),List("doc:alpha queued"))))
          } yield () }
        }
      }
    } yield ()).unsafeRunSync()
  }

  test("Effectual-GoodCommunication: an already admitted provider response cannot land across a quick off/on") {
    val f=fixture(); val s=f.projected("in-flight","alpha in flight")
    f.put(s.copy(chunks=s.chunks :+ InputChunk("second","alpha second",provenance)))
    (for {
      calls <- Ref.of[IO,List[List[String]]](Nil)
      entered <- Deferred[IO,Unit]
      release <- Deferred[IO,Unit]
      _ <- provider(calls)(_ => entered.complete(()).void *> release.get).use { client =>
        val worker=f.worker(client)
        worker.once.attempt.background.use { result => for {
          _ <- entered.get
          _ <- IO.blocking {
            f.choice(f.owner,Disable) // must commit despite the provider response being held
            assertEquals(f.search(RetrievalMode.Semantic).pending,0L)
            f.choice(f.owner,Enable)
          }
          _ <- release.complete(())
          _ <- result.flatMap(_.embedNever).map(r => assertEquals(r.left.toOption.map(IndexingEvent.code),Some("stale-claim")))
          _ <- calls.get.map(assertEquals(_,List(List("doc:alpha in flight"))))
          _ <- IO.blocking(assertEquals(f.search(RetrievalMode.Semantic).total,0L))
          _ <- worker.once.map(assertEquals(_,true))
          _ <- calls.get.map(assertEquals(_,List(List("doc:alpha in flight"),List("doc:alpha in flight"),List("doc:alpha second"))))
          _ <- IO.blocking(assertEquals(f.search(RetrievalMode.Semantic).total,1L))
        } yield () }
      }
    } yield ()).unsafeRunSync()
  }

  test("Blackbox-GoodCommunication: opt-out gates both exact and ANN hybrid candidate windows before ranking") {
    val window=2; val dimensions=5
    val p=profile.copy(space=profile.space.copy(dimensions=dimensions)); val f=fixture(Some(p))
    val policy=IndexingPolicy.defaults.copy(allowOptIn=true,allowOptOut=true)
    def leaning(offset: Double): List[Double] = vector.take(1)++List(offset)++List.fill(dimensions-2)(0.0)
    val exclusions=(1 to (window*CandidatePolicy.annChunksPerCandidate+1)).map(i => f.projected(s"excluded-$i","alpha alpha alpha alpha nearest"))
    val expected=(1 to window).map(i => f.projected(s"allowed-$i","alpha permitted").copy(owners=Set(f.editor)))
    (exclusions++expected).foreach(f.put)
    (exclusions++expected).sortBy(s => Jdbc.key(s.id)).zipWithIndex.foreach { (s,i) =>
      val claim=f.claim().get
      assertEquals(claim.sourceId,s.id)
      f.publish(claim,leaning(if(s.id.startsWith("excluded-")) 0.01+i*0.001 else 0.2+i*0.001))
    }
    // Both gates are necessary: some retained publications have an enabled current head with a different author.
    exclusions.take(4).foreach(s => f.put(s.copy(version="new-head",owners=Set(f.editor))))
    f.choice(f.owner,Disable)
    val stores=List(new PostgresRetrieval(f.index.namespace,Some(p),window,CandidatePolicy.exactScanChunks,Some(service->policy)),
      new PostgresRetrieval(f.index.namespace,Some(p),window,0,Some(service->policy)))
    stores.foreach { store =>
      List(RetrievalMode.Semantic,RetrievalMode.Hybrid).foreach { mode =>
        val page=f.search(store,query(mode),leaning(0.0))
        assertEquals((page.hits.map(_.id).toSet,page.total,page.pending),(expected.map(_.id).toSet,window.toLong,4L))
      }
    }
  }
}
