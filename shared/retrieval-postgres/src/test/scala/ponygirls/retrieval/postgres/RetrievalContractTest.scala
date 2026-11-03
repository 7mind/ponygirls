package ponygirls.retrieval.postgres

import ponygirls.retrieval.*
import java.sql.{Connection,DriverManager}
import java.util.UUID
import scala.util.Using

private[postgres] object ControlledFixtures {
  val profile=RetrievalProfile(EmbeddingSpace("a"*64,"controlled-fixture","immutable-v1",3,false,"","","cosine"),"controlled-metadata-v1")
  val field=AttributeKey.parse("project")
  val provenance=ChunkProvenance("metadata",Some("/description"),None,None)
  def source(id: String,text: String,audience: Set[String]): SourceProjection = SourceProjection(id,"version-1",List(InputChunk("first",text,provenance)),Vector(ProjectionAttribute(field,AttributeValue("controlled"))),audience,true,false,None)
  def query(mode: RetrievalMode): RetrievalQuery = RetrievalQuery("reader","alpha",mode,Vector.empty,false,0,100,EpochSeconds(BigDecimal("4102444800")))
}
private[postgres] trait RetrievalContractStore {
  def put(source: SourceProjection): Unit
  def remove(id: String): Unit
  def publishAll(): Unit
  def search(query: RetrievalQuery): RetrievalPage
  def visible(query: RetrievalQuery,id: String): Boolean
}
/** Hand-written strict in-memory reference for the common publication/visibility contract;
  * FTS stemming and ANN scan behavior are intentionally tested separately on PostgreSQL. */
private[postgres] final class MemoryStore extends RetrievalContractStore {
  import ControlledFixtures.*
  private var sources=Map.empty[String,SourceProjection]
  private var published=Map.empty[String,(SourceProjection,String)]
  def put(source: SourceProjection): Unit = {
    sources.get(source.id).foreach(old => RetrievalChecks(old.version!=source.version || old.chunks==source.chunks,"conflict","source version reused"))
    sources+=source.id->source
  }
  def remove(id: String): Unit = { sources.get(id).foreach(s => sources+=id->s.copy(eligible=false,audience=Set.empty)); published-=id }
  def publishAll(): Unit = sources.values.filter(_.eligible).foreach(s => published+=s.id->(s,UUID.randomUUID().toString))
  def visible(q: RetrievalQuery,id: String): Boolean = sources.get(id).exists { s =>
    s.eligible && (q.includeArchived || !s.archived) && s.expiresAt.forall(_.value>q.now.value) && s.audience.contains(q.principal) && q.filters.forall {
      case AttributeFilter.Equal(k,v) => s.attributes.contains(ProjectionAttribute(k,v))
    }
  }
  def search(q: RetrievalQuery): RetrievalPage = {
    val selected=sources.values.toList.filter(s => visible(q,s.id)).flatMap { current =>
      val (s,generation)=if(q.mode==RetrievalMode.Lexical) (current,"head") else published.getOrElse(current.id,throw RetrievalError("unavailable","not ready"))
      s.chunks.filter(ch => q.mode!=RetrievalMode.Lexical || ch.text.contains(q.text)).sortBy(_.id).headOption.map { ch =>
        RetrievalHit(s.id,s.version,generation,if(q.mode==RetrievalMode.Lexical) None else Some(profile.id),if(q.mode==RetrievalMode.Lexical) None else Some(profile.space.id),ch,1.0)
      }
    }.sortBy(_.id)
    val semantic=q.mode!=RetrievalMode.Lexical
    RetrievalPage(selected.drop(q.offset).take(q.limit),selected.size.toLong,if(semantic) CountScope.CandidateWindow else CountScope.ExactMatches,if(semantic) Some(CandidatePolicy.rankingLimit(q.mode)) else None)
  }
}
private[postgres] final class PgFixture(val profile: Option[RetrievalProfile]) {
  val index=new PostgresRetrieval("controlled-"+UUID.randomUUID().toString,profile)
  val url=sys.env.getOrElse("CHRONICLE_TEST_JDBC",throw new IllegalStateException("CHRONICLE_TEST_JDBC required: real PostgreSQL tests must execute"))
  def tx[A](run: Connection => A): A = Using.resource(DriverManager.getConnection(url,"postgres","")) { c =>
    c.setAutoCommit(false)
    try { val out=run(c); c.commit(); out } catch { case scala.util.control.NonFatal(e) => c.rollback(); throw e }
  }
  tx(index.initialize)
  val store: RetrievalContractStore = new RetrievalContractStore {
    def put(source: SourceProjection): Unit = tx(c => index.put(c,source))
    def remove(id: String): Unit = tx(c => index.remove(c,id))
    def publishAll(): Unit = {
      var claim=tx(c => index.claim(c,30))
      while(claim.nonEmpty) {
        val work=claim.get
        if(work.chunks.nonEmpty) tx(c => index.accept(c,work,0,List.fill(work.chunks.size)(List(1.0,0.0,0.0))))
        tx(c => index.publish(c,work))
        claim=tx(c => index.claim(c,30))
      }
    }
    def search(query: RetrievalQuery): RetrievalPage = tx(c => index.search(c,query,if(query.mode==RetrievalMode.Lexical) None else Some(List(1.0,0.0,0.0))))
    def visible(query: RetrievalQuery,id: String): Boolean = tx(c => index.visible(c,query,id))
  }
}
abstract class RetrievalContractTest extends munit.FunSuite {
  import ControlledFixtures.*
  protected def fresh(): RetrievalContractStore
  test("Blackbox: opaque non-UUID IDs, NUL metadata/content round trip without invalidating writes") {
    val store=fresh(); val s=source("not-a-uuid\u0000/α","alpha\u0000original",Set("reader")).copy(version="v\u0000one",attributes=Vector(ProjectionAttribute(field,AttributeValue("with\u0000nul"))))
    store.put(s); store.publishAll()
    List(RetrievalMode.Lexical,RetrievalMode.Semantic,RetrievalMode.Hybrid).foreach { mode =>
      val page=store.search(query(mode).copy(filters=Vector(AttributeFilter.Equal(field,AttributeValue("with\u0000nul")))))
      assertEquals(page.total,1L); assertEquals(page.hits.head.id,s.id); assertEquals(page.hits.head.version,s.version); assertEquals(page.hits.head.chunk,s.chunks.head)
    }
  }
  test("Blackbox: current ACL/filter/archive/exact expiry are applied before counts and selection") {
    val store=fresh(); val base=source("visible","alpha",Set("reader"))
    List(base,base.copy(id="hidden",audience=Set("other")),base.copy(id="archived",archived=true),base.copy(id="expired",expiresAt=Some(EpochSeconds(BigDecimal("4102444800")))),base.copy(id="tiny-future",expiresAt=Some(EpochSeconds(BigDecimal("4102444800.00000000001"))))).foreach(store.put)
    store.publishAll()
    List(RetrievalMode.Lexical,RetrievalMode.Semantic,RetrievalMode.Hybrid).foreach { mode =>
      val page=store.search(query(mode)); assertEquals(page.hits.map(_.id).toSet,Set("visible","tiny-future")); assertEquals(page.total,2L)
      assertEquals(store.search(query(mode).copy(filters=Vector(AttributeFilter.Equal(field,AttributeValue("absent"))))).total,0L)
      assertEquals(store.search(query(mode).copy(includeArchived=true)).total,3L)
    }
  }
  test("Blackbox: live revocation/delete prevents hydration of previously pinned hit") {
    val store=fresh(); val s=source("one","alpha",Set("reader")); store.put(s); store.publishAll()
    val hit=store.search(query(RetrievalMode.Semantic)).hits.head
    store.put(s.copy(audience=Set.empty))
    assert(!store.visible(query(RetrievalMode.Semantic),hit.id)); assertEquals(store.search(query(RetrievalMode.Lexical)).total,0L)
    store.put(s); store.remove(s.id)
    assert(!store.visible(query(RetrievalMode.Lexical),hit.id)); assertEquals(store.search(query(RetrievalMode.Lexical)).total,0L)
  }
  test("Blackbox: old immutable publication remains served until complete source replacement") {
    val store=fresh(); val old=source("one","alpha old",Set("reader")); store.put(old); store.publishAll()
    store.put(old.copy(version="version-2",chunks=List(InputChunk("second","alpha new",provenance))))
    assertEquals(store.search(query(RetrievalMode.Semantic)).hits.head.version,"version-1")
    assertEquals(store.search(query(RetrievalMode.Lexical)).hits.head.version,"version-2")
    store.publishAll(); assertEquals(store.search(query(RetrievalMode.Semantic)).hits.head.version,"version-2")
  }
  test("Blackbox: exact lexical vs bounded semantic/hybrid count scope is explicit even empty pages") {
    val store=fresh(); store.put(source("one","alpha",Set("reader"))); store.publishAll()
    val lex=store.search(query(RetrievalMode.Lexical).copy(offset=1)); assertEquals(lex.total,1L); assertEquals(lex.hits,Nil); assertEquals(lex.countScope,CountScope.ExactMatches); assertEquals(lex.rankingLimit,None)
    List(RetrievalMode.Semantic,RetrievalMode.Hybrid).foreach { mode => val page=store.search(query(mode)); assertEquals(page.countScope,CountScope.CandidateWindow); assertEquals(page.rankingLimit,Some(CandidatePolicy.rankingLimit(mode))) }
  }
}
class MemoryRetrievalContractTest extends RetrievalContractTest {
  protected def fresh(): RetrievalContractStore = new MemoryStore
}
class PostgresRetrievalContractTest extends RetrievalContractTest {
  protected def fresh(): RetrievalContractStore = new PgFixture(Some(ControlledFixtures.profile)).store
}
