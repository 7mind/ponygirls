package ponygirls.retrieval.postgres

import ponygirls.retrieval.*
import java.sql.Connection

class PublicationFenceTest extends munit.FunSuite {
  import ControlledFixtures.*
  private def fixture(): PgFixture = new PgFixture(Some(profile))
  test("Effectual-GoodCommunication: projection and durable job roll back with authoritative mutation") {
    val f=fixture()
    intercept[IllegalStateException] { f.tx { c => f.index.put(c,source("rolled-back","alpha",Set("reader"))); throw new IllegalStateException("controlled rollback") } }
    assertEquals(f.tx(c => f.index.claim(c,30)),None)
    assertEquals(f.store.search(query(RetrievalMode.Lexical)).total,0L)
  }
  test("Blackbox-GoodCommunication: incomplete publication cannot expose partial vectors; accepted batch retry immutable") {
    val f=fixture(); val s=source("one","alpha",Set("reader")).copy(chunks=List(InputChunk("a","alpha a",provenance),InputChunk("b","alpha b",provenance)))
    f.store.put(s)
    val claim=f.tx(c => f.index.claim(c,30)).get
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
    val old=f.tx(c => f.index.claim(c,30)).get
    f.tx(c => f.index.accept(c,old,0,List(List(1.0,0.0,0.0))))
    f.tx(c => Jdbc.exec(c,"UPDATE pony_retrieval_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",old.jobId))
    val fresh=f.tx(c => f.index.claim(c,30)).get
    assert(fresh.fence>old.fence); assertEquals(fresh.run,old.run)
    assertEquals(intercept[RetrievalError](f.tx(c => f.index.publish(c,old))).code,"stale-claim")
    assertEquals(f.tx(c => f.index.accepted(c,fresh,0,1)),Some(List(List(1.0,0.0,0.0))))
    f.tx(c => f.index.publish(c,fresh)); assertEquals(f.store.search(query(RetrievalMode.Semantic)).total,1L)
  }
  test("Blackbox-GoodCommunication: claim snapshot cannot relabel or substitute source versions/content") {
    val f=fixture(); f.store.put(source("one","alpha",Set("reader")))
    val claim=f.tx(c => f.index.claim(c,30)).get
    List(claim.copy(version="fabricated"),claim.copy(chunks=claim.chunks.map(_.copy(text="fabricated"))),claim.copy(run="fabricated")).foreach { forged =>
      assertEquals(intercept[RetrievalError](f.tx(c => f.index.accept(c,forged,0,List(List(1.0,0.0,0.0))))).code,"stale-claim")
    }
  }
  test("Blackbox-GoodCommunication: delete/archive/expiry cannot be bypassed by a still-running old worker") {
    val f=fixture(); f.store.put(source("one","alpha",Set("reader")))
    val claim=f.tx(c => f.index.claim(c,30)).get
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
  test("Blackbox-GoodCommunication: incompatible profile rebuild retains publication but never mixes embedding spaces") {
    val f=fixture(); val s=source("one","alpha",Set("reader")); f.store.put(s); f.store.publishAll()
    val changed=profile.copy(space=profile.space.copy(revision="immutable-v2"))
    val replacement=new PostgresRetrieval(f.index.namespace,Some(changed))
    f.tx(replacement.initialize); f.tx(c => replacement.put(c,s))
    assertEquals(f.store.search(query(RetrievalMode.Semantic)).hits.head.embeddingSpace,Some(profile.space.id))
    assertEquals(intercept[RetrievalError](f.tx(c => replacement.search(c,query(RetrievalMode.Semantic),Some(List(1.0,0.0,0.0))))).code,"unavailable")
    val claim=f.tx(c => replacement.claim(c,30)).get
    f.tx(c => replacement.accept(c,claim,0,List(List(0.0,1.0,0.0))))
    f.tx(c => replacement.publish(c,claim))
    assertEquals(f.tx(c => replacement.search(c,query(RetrievalMode.Semantic),Some(List(0.0,1.0,0.0)))).hits.head.embeddingSpace,Some(changed.space.id))
  }
  test("Blackbox-GoodCommunication: superseded source cannot overwrite current publication") {
    val f=fixture(); val s=source("one","alpha",Set("reader")); f.store.put(s)
    val stale=f.tx(c => f.index.claim(c,30)).get
    f.store.put(s.copy(version="version-2",chunks=s.chunks.map(_.copy(text="alpha newer"))))
    assertEquals(intercept[RetrievalError](f.tx(c => f.index.accept(c,stale,0,List(List(1.0,0.0,0.0))))).code,"stale-claim")
    f.store.publishAll(); assertEquals(f.store.search(query(RetrievalMode.Semantic)).hits.head.version,"version-2")
  }
  test("Blackbox-GoodCommunication regression: remove then same-version restore creates executable durable replacement job") {
    val f=fixture(); val s=source("one","alpha",Set("reader")); f.store.put(s); f.store.publishAll()
    f.store.remove(s.id); f.store.put(s)
    val claim=f.tx(c => f.index.claim(c,30))
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
    // No implicit corpus compatibility: until approved rebuild, requesting this profile must fail.
    assertEquals(intercept[RetrievalError](f.tx(c => candidate.search(c,query(RetrievalMode.Semantic),Some(List(1.0,0.0,0.0))))).code,"unavailable")
  }
  test("Blackbox-GoodCommunication: pending semantic publication is explicitly unavailable, not an unlabelled empty result") {
    val f=fixture(); f.store.put(source("one","alpha",Set("reader")))
    assertEquals(intercept[RetrievalError](f.store.search(query(RetrievalMode.Semantic))).code,"unavailable")
  }

  test("Effectual-GoodCommunication: lease expiry DURING publication restores old generation even when caller catches failure and commits") {
    val f=fixture(); val old=source("one","alpha old",Set("reader")); f.store.put(old); f.store.publishAll()
    val before=f.store.search(query(RetrievalMode.Semantic)).hits.head
    f.store.put(old.copy(version="version-2",chunks=List(InputChunk("new","alpha new",provenance))))
    val claim=f.tx(c => f.index.claim(c,1)).get
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
    assertEquals(f.tx(c => f.index.claim(c,30)),None)
  }

  test("Blackbox-GoodCommunication regression: empty complete generation is idempotent under repeated same-version projection") {
    val f=fixture(); val empty=source("empty","",Set("reader")).copy(chunks=Nil)
    f.store.put(empty); f.store.publishAll(); f.store.put(empty)
    assertEquals(f.tx(c => f.index.claim(c,30)),None)
    assertEquals(f.store.search(query(RetrievalMode.Semantic)).total,0L)
  }
  test("Effectual-GoodCommunication regression: crashed last-attempt lease becomes terminal Failed, not stranded Running") {
    val f=fixture(); f.store.put(source("one","alpha",Set("reader")))
    val claim=f.tx(c => f.index.claim(c,30)).get
    f.tx(c => Jdbc.exec(c,"UPDATE pony_retrieval_jobs SET attempts=5,lease_until=clock_timestamp()-interval '1 second' WHERE id=?",claim.jobId))
    assertEquals(f.tx(c => f.index.claim(c,30)),None)
    assertEquals(f.tx(c => Jdbc.one(c,"SELECT state FROM pony_retrieval_jobs WHERE id=?",claim.jobId)(_.getString(1))),Some("Failed"))
  }

}
