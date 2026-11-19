package ponygirls.retrieval.postgres

import ponygirls.retrieval.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import java.sql.Connection
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.*
import scala.util.Using

class PublicationFenceTest extends munit.FunSuite {
  import ControlledFixtures.*
  private def fixture(): PgFixture = new PgFixture(Some(profile))
  test("Effectual-GoodCommunication: projection and durable job roll back with authoritative mutation") {
    val f=fixture()
    intercept[IllegalStateException] { f.tx { c => f.index.put(c,source("rolled-back","alpha",Set("reader"))); throw new IllegalStateException("controlled rollback") } }
    assertEquals(f.tx(c => f.index.claim(c,30,Instant.now())),None)
    assertEquals(f.store.search(query(RetrievalMode.Lexical)).total,0L)
  }
  test("Blackbox-GoodCommunication: incomplete publication cannot expose partial vectors; accepted batch retry immutable") {
    val f=fixture(); val s=source("one","alpha",Set("reader")).copy(chunks=List(InputChunk("a","alpha a",provenance),InputChunk("b","alpha b",provenance)))
    f.store.put(s)
    val claim=f.tx(c => f.index.claim(c,30,Instant.now())).get
    f.tx(c => f.index.accept(c,claim,0,List(List(1.0,0.0,0.0))))
    assertEquals(f.tx(c => f.index.accepted(c,claim,0,1)),Some(List(List(1.0,0.0,0.0))))
    assertEquals(f.tx(c => f.index.accepted(c,claim,0,2)),None)
    assertEquals(intercept[RetrievalError](f.tx(c => f.index.publish(c,claim))).code,"incomplete-generation")
    assertEquals(intercept[RetrievalError](f.tx(c => f.index.accept(c,claim,0,List(List(0.0,1.0,0.0))))).code,"conflict")
    f.tx(c => f.index.accept(c,claim,1,List(List(0.0,1.0,0.0))))
    val generation=f.tx(c => f.index.publish(c,claim))
    assertEquals(f.tx(c => f.index.publish(c,claim)),generation)
    assertEquals(f.store.search(query(RetrievalMode.Semantic)).total,1L)
  }
  test("Effectual-GoodCommunication: expired/reclaimed worker cannot overwrite and replacement reuses accepted batches") {
    val f=fixture(); f.store.put(source("one","alpha",Set("reader")))
    val old=f.tx(c => f.index.claim(c,30,Instant.now())).get
    f.tx(c => f.index.accept(c,old,0,List(List(1.0,0.0,0.0))))
    f.tx(c => Jdbc.exec(c,"UPDATE pony_retrieval_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",old.jobId))
    val fresh=f.tx(c => f.index.claim(c,30,Instant.now())).get
    assert(fresh.fence>old.fence); assertEquals(fresh.run,old.run)
    assertEquals(intercept[RetrievalError](f.tx(c => f.index.publish(c,old))).code,"stale-claim")
    assertEquals(f.tx(c => f.index.accepted(c,fresh,0,1)),Some(List(List(1.0,0.0,0.0))))
    f.tx(c => f.index.publish(c,fresh)); assertEquals(f.store.search(query(RetrievalMode.Semantic)).total,1L)
  }
  test("Blackbox-GoodCommunication: claim snapshot cannot relabel or substitute source versions/content") {
    val f=fixture(); f.store.put(source("one","alpha",Set("reader")))
    val claim=f.tx(c => f.index.claim(c,30,Instant.now())).get
    List(claim.copy(version="fabricated"),claim.copy(chunks=claim.chunks.map(_.copy(text="fabricated"))),claim.copy(run="fabricated")).foreach { forged =>
      assertEquals(intercept[RetrievalError](f.tx(c => f.index.accept(c,forged,0,List(List(1.0,0.0,0.0))))).code,"stale-claim")
    }
  }
  test("Blackbox-GoodCommunication: delete/archive/expiry cannot be bypassed by a still-running old worker") {
    val f=fixture(); f.store.put(source("one","alpha",Set("reader")))
    val claim=f.tx(c => f.index.claim(c,30,Instant.now())).get
    f.store.remove("one")
    assertEquals(intercept[RetrievalError](f.tx(c => f.index.accept(c,claim,0,List(List(1.0,0.0,0.0))))).code,"stale-claim")
    assertEquals(f.store.search(query(RetrievalMode.Lexical)).total,0L)
    val archived=source("archive","alpha",Set("reader")).copy(archived=true,expiresAt=Some(EpochSeconds(BigDecimal(999))))
    f.store.put(archived); f.store.publishAll()
    assertEquals(f.store.search(query(RetrievalMode.Semantic)).total,0L)
    assertEquals(f.store.search(query(RetrievalMode.Semantic).copy(includeArchived=true)).total,0L)
  }
  test("Blackbox-GoodCommunication: model absence declares lexical-only; namespace never merges corpora") {
    val lexical=new PgFixture(None); lexical.store.put(source("one","alpha",Set("reader")))
    assertEquals(lexical.store.search(query(RetrievalMode.Lexical)).total,1L)
    assertEquals(intercept[RetrievalError](lexical.store.search(query(RetrievalMode.Semantic))).code,"unavailable")
    val other=fixture(); assertEquals(other.store.search(query(RetrievalMode.Lexical)).total,0L)
  }
  test("U1: unavailable reasons are closed and fixed: no profile is not-configured, a failed query embedding is embedding-failed") {
    def reason(error: Throwable): (String,String,Option[UnavailableReason]) = error match {
      case e: RetrievalError => (e.code,e.detail,e.reason)
      case other => fail("expected a typed retrieval error, got "+other)
    }
    val notConfigured=("unavailable","semantic retrieval is not configured; lexical-only capability",Some(UnavailableReason.NotConfigured))
    val embeddingFailed=("unavailable","query embedding failed",Some(UnavailableReason.EmbeddingFailed))
    assertEquals(reason(intercept[RetrievalError](new PgFixture(None).store.search(query(RetrievalMode.Hybrid)))),notConfigured)
    val f=fixture()
    assertEquals(reason(intercept[RetrievalError](f.tx(c => f.index.search(c,query(RetrievalMode.Semantic),None)))),embeddingFailed)
    val outage=new EmbeddingClient {
      def documents(text: List[String]): IO[List[List[Double]]] = IO.raiseError(new AssertionError("not a document call"))
      def query(text: String): IO[List[Double]] = IO.raiseError(RetrievalError("model-http","model returned HTTP 503"))
    }
    assertEquals(QueryVector(None,RetrievalMode.Semantic,"alpha").attempt.unsafeRunSync().left.map(reason),Left(notConfigured))
    assertEquals(QueryVector(Some(outage),RetrievalMode.Hybrid,"alpha").attempt.unsafeRunSync().left.map(reason),Left(embeddingFailed))
    assertEquals(QueryVector(Some(outage),RetrievalMode.Lexical,"alpha").unsafeRunSync(),None)
  }
  test("Blackbox-GoodCommunication: incompatible profile rebuild retains publication but never mixes embedding spaces") {
    val f=fixture(); val s=source("one","alpha",Set("reader")); f.store.put(s); f.store.publishAll()
    val changed=profile.copy(space=profile.space.copy(revision="immutable-v2"))
    val replacement=new PostgresRetrieval(f.index.namespace,Some(changed))
    f.tx(replacement.initialize); f.tx(c => replacement.put(c,s))
    assertEquals(f.store.search(query(RetrievalMode.Semantic)).hits.head.embeddingSpace,Some(profile.space.id))
    val rebuilding=f.tx(c => replacement.search(c,query(RetrievalMode.Semantic),Some(List(1.0,0.0,0.0))))
    assertEquals((rebuilding.hits,rebuilding.pending),(Nil,1L))
    val claim=f.tx(c => replacement.claim(c,30,Instant.now())).get
    f.tx(c => replacement.accept(c,claim,0,List(List(0.0,1.0,0.0))))
    f.tx(c => replacement.publish(c,claim))
    assertEquals(f.tx(c => replacement.search(c,query(RetrievalMode.Semantic),Some(List(0.0,1.0,0.0)))).hits.head.embeddingSpace,Some(changed.space.id))
  }
  test("Blackbox-GoodCommunication: superseded source cannot overwrite current publication") {
    val f=fixture(); val s=source("one","alpha",Set("reader")); f.store.put(s)
    val stale=f.tx(c => f.index.claim(c,30,Instant.now())).get
    f.store.put(s.copy(version="version-2",chunks=s.chunks.map(_.copy(text="alpha newer"))))
    assertEquals(intercept[RetrievalError](f.tx(c => f.index.accept(c,stale,0,List(List(1.0,0.0,0.0))))).code,"stale-claim")
    f.store.publishAll(); assertEquals(f.store.search(query(RetrievalMode.Semantic)).hits.head.version,"version-2")
  }
  test("Blackbox-GoodCommunication regression: remove then same-version restore creates executable durable replacement job") {
    val f=fixture(); val s=source("one","alpha",Set("reader")); f.store.put(s); f.store.publishAll()
    f.store.remove(s.id); f.store.put(s)
    val claim=f.tx(c => f.index.claim(c,30,Instant.now()))
    assert(claim.nonEmpty,"restored eligible source is stranded without an indexing job")
    f.tx(c => f.index.accept(c,claim.get,0,List(List(1.0,0.0,0.0))))
    f.tx(c => f.index.publish(c,claim.get))
    assertEquals(f.store.search(query(RetrievalMode.Semantic)).total,1L)
  }
  test("Blackbox-GoodCommunication regression: same vector space does not authorize old corpus-policy snippets") {
    val f=fixture(); val s=source("one","alpha removed-field",Set("reader")); f.store.put(s); f.store.publishAll()
    val restrictive=profile.copy(policy="controlled-restrictive-metadata-v2")
    val candidate=new PostgresRetrieval(f.index.namespace,Some(restrictive))
    f.tx(candidate.initialize)
    f.tx(c => candidate.put(c,s.copy(version="policy-v2",chunks=List(InputChunk("approved","alpha approved",provenance)))))
    // No implicit corpus compatibility: until approved rebuild, this profile serves nothing and declares the source pending.
    val page=f.tx(c => candidate.search(c,query(RetrievalMode.Semantic),Some(List(1.0,0.0,0.0))))
    assertEquals((page.hits,page.pending),(Nil,1L))
  }
  test("P1: semantic/hybrid serve published sources and declare in-scope unpublished ones as pending; lexical pending is 0") {
    val f=fixture()
    f.store.put(source("published","alpha",Set("reader"))); f.store.publishAll()
    f.store.put(source("unpublished","alpha",Set("reader")))
    f.store.put(source("other-principal","alpha",Set("other")))
    f.store.put(source("filtered-out","alpha",Set("reader")).copy(attributes=Vector(ProjectionAttribute(field,AttributeValue("excluded")))))
    val scoped=Vector(AttributeFilter.Equal(field,AttributeValue("controlled")))
    List(RetrievalMode.Semantic,RetrievalMode.Hybrid).foreach { mode =>
      val page=f.store.search(query(mode).copy(filters=scoped))
      assertEquals((page.hits.map(_.id),page.total,page.pending),(List("published"),1L,1L))
      assertEquals(f.store.search(query(mode)).pending,2L)
    }
    val lexical=f.store.search(query(RetrievalMode.Lexical).copy(filters=scoped))
    assertEquals((lexical.hits.map(_.id).toSet,lexical.pending),(Set("published","unpublished"),0L))
  }
  test("R2: a failed attempt is claimable only after its back-off; delays double from 2 s and are capped at 5 min") {
    val f=fixture(); f.store.put(source("one","alpha",Set("reader")))
    val t0=Instant.parse("2030-01-01T00:00:00Z")
    val first=f.tx(c => f.index.claim(c,30,t0)).get
    assertEquals(f.tx(c => f.index.fail(c,first,t0)),Some(t0.plusSeconds(2)))
    assertEquals(f.tx(c => f.index.claim(c,30,t0.plusMillis(1999))),None)
    val second=f.tx(c => f.index.claim(c,30,t0.plusSeconds(2))).get
    assertEquals((second.jobId,second.attempt),(first.jobId,2))
    assertEquals(f.tx(c => f.index.fail(c,second,t0.plusSeconds(2))),Some(t0.plusSeconds(6)))
    assertEquals(f.tx(c => f.index.claim(c,30,t0.plusMillis(5999))),None)
    assertEquals(List(1,2,8,9,Int.MaxValue).map(PostgresRetrieval.retryDelay),List(2.seconds,4.seconds,256.seconds,5.minutes,5.minutes))
  }
  test("M1: a v1-initialized database holding a Failed job: initialize requeues it, idempotently") {
    val f=fixture(); val schema="retrieval_v1_"+UUID.randomUUID().toString.replace("-","")
    def v1[A](run: Connection => A): A = f.tx { c => Jdbc.exec(c,s"SET LOCAL search_path TO $schema,public"); run(c) }
    f.tx(c => Jdbc.exec(c,s"CREATE SCHEMA $schema"))
    try {
      val index=new PostgresRetrieval("controlled-v1",Some(profile))
      v1 { c =>
        // The state a v1-only initialize left behind, with a job its claim had turned terminal.
        Jdbc.exec(c,"CREATE TABLE pony_retrieval_migrations(version integer PRIMARY KEY,digest text NOT NULL)")
        Using.resource(c.createStatement())(_.execute(Schema.v1))
        Jdbc.exec(c,"INSERT INTO pony_retrieval_migrations VALUES(1,?)",RetrievalChecks.hash(Schema.v1))
        index.put(c,source("one","alpha",Set("reader")))
        Jdbc.exec(c,"UPDATE pony_retrieval_jobs SET state='Failed',attempts=5")
      }
      def state: (List[(Int,String)],List[(String,Long)]) = v1 { c =>
        (Jdbc.rows(c,"SELECT version,digest FROM pony_retrieval_migrations ORDER BY version")(r => (r.getInt(1),r.getString(2))),
          Jdbc.rows(c,"SELECT state,fence FROM pony_retrieval_jobs")(r => (r.getString(1),r.getLong(2))))
      }
      v1(index.initialize)
      val migrated=state
      assertEquals(migrated,(List(1 -> RetrievalChecks.hash(Schema.v1),2 -> RetrievalChecks.hash(Schema.v2)),List("Queued" -> 1L)))
      v1(index.initialize)
      assertEquals(state,migrated)
      assertEquals(v1(c => index.claim(c,30,Instant.now())).map(claim => (claim.sourceId,claim.attempt)),Some(("one",6)))
    } finally f.tx(c => Jdbc.exec(c,s"DROP SCHEMA $schema CASCADE"))
  }

  test("Effectual-GoodCommunication: lease expiry DURING publication restores old generation even when caller catches failure and commits") {
    val f=fixture(); val old=source("one","alpha old",Set("reader")); f.store.put(old); f.store.publishAll()
    val before=f.store.search(query(RetrievalMode.Semantic)).hits.head
    f.store.put(old.copy(version="version-2",chunks=List(InputChunk("new","alpha new",provenance))))
    val claim=f.tx(c => f.index.claim(c,1,Instant.now())).get
    f.tx(c => f.index.accept(c,claim,0,List(List(0.0,1.0,0.0))))
    f.tx { c =>
      Jdbc.exec(c,"CREATE FUNCTION pg_temp.controlled_publication_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END $$")
      Jdbc.exec(c,"CREATE TRIGGER controlled_publication_delay BEFORE INSERT ON pony_retrieval_chunks FOR EACH ROW EXECUTE FUNCTION pg_temp.controlled_publication_delay()")
      try {
        assertEquals(intercept[RetrievalError](f.index.publish(c,claim)).code,"stale-claim")
        // The caller intentionally swallows the error and commits this transaction.
        assertEquals(Jdbc.one(c,"SELECT count(*) FROM pony_retrieval_generations WHERE namespace=?",Jdbc.key(f.index.namespace))(_.getInt(1)),Some(1))
      } finally Jdbc.exec(c,"DROP TRIGGER controlled_publication_delay ON pony_retrieval_chunks")
    }
    val after=f.store.search(query(RetrievalMode.Semantic)).hits.head
    assertEquals(after,before)
  }

  test("Blackbox-GoodCommunication regression: expired sources are never claimed for a new model call") {
    val f=fixture()
    f.store.put(source("expired","alpha",Set("reader")).copy(expiresAt=Some(EpochSeconds(BigDecimal(1000)))))
    assertEquals(f.tx(c => f.index.claim(c,30,Instant.now())),None)
  }

  test("Blackbox-GoodCommunication regression: empty complete generation is idempotent under repeated same-version projection") {
    val f=fixture(); val empty=source("empty","",Set("reader")).copy(chunks=Nil)
    f.store.put(empty); f.store.publishAll(); f.store.put(empty)
    assertEquals(f.tx(c => f.index.claim(c,30,Instant.now())),None)
    assertEquals(f.store.search(query(RetrievalMode.Semantic)).total,0L)
  }
  test("Effectual-GoodCommunication regression: a crashed lease is reclaimed after expiry at any attempt count, never stranded or terminal") {
    val f=fixture(); f.store.put(source("one","alpha",Set("reader")))
    val claim=f.tx(c => f.index.claim(c,30,Instant.now())).get
    f.tx(c => Jdbc.exec(c,"UPDATE pony_retrieval_jobs SET attempts=5,lease_until=clock_timestamp()-interval '1 second' WHERE id=?",claim.jobId))
    val reclaimed=f.tx(c => f.index.claim(c,30,Instant.now())).get
    assertEquals((reclaimed.jobId,reclaimed.attempt),(claim.jobId,6)); assert(reclaimed.fence>claim.fence)
  }

}
