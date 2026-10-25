package chronicle
import chronicle.api.*
import java.util.UUID
import java.sql.Connection

trait SearchIndex {
  def search(reader: String,q: SearchQuery,vector: Option[List[Double]]): SearchResult
  def searchLegacy(reader: String,q: SearchQuery,vector: Option[List[Double]]): SearchResult
  def facets(reader: String,f: SearchFilter): FacetsResult
}
object SearchPolicy {
  val maxDimensions = 4000
  val candidatesPerLeg = 1000
  val efSearch = 200
  val maxScanTuples = 200000
  val scanMemoryMultiplier = 4
  val reciprocalRankConstant = 60
  def rankingLimit(mode: SearchMode): Int = if(mode==SearchMode.Hybrid) candidatesPerLeg*2 else candidatesPerLeg
  def dimensions(config: Config): Int = {
    val n=config.embedding.dimensions
    Check(n>0 && n<=maxDimensions,"config",s"indexed embeddings require 1..$maxDimensions dimensions")
    n
  }
  def vector(values: List[Double],config: Config): String = {
    Check(values.size==dimensions(config) && values.forall(v => v.isFinite && v.toFloat.isFinite) && values.exists(_.toFloat!=0.0f),"invalid","invalid search vector dimension/value")
    values.mkString("[",",","]")
  }
  def configure(c: Connection): Unit = {
    Sql.exec(c,"SET LOCAL hnsw.iterative_scan = strict_order")
    Sql.exec(c,s"SET LOCAL hnsw.ef_search = $efSearch")
    Sql.exec(c,s"SET LOCAL hnsw.max_scan_tuples = $maxScanTuples")
    Sql.exec(c,s"SET LOCAL hnsw.scan_mem_multiplier = $scanMemoryMultiplier")
  }
}
private[chronicle] final case class SearchStatement(sql: String,args: List[Sql.Param])
final class PostgresSearch(db: Database, archive: PostgresArchive,config: Config) extends SearchIndex {
  private def filter(f: SearchFilter): (String,List[Sql.Param]) = {
    val b = List.newBuilder[String]; val p = List.newBuilder[Sql.Param]
    List(("project",f.project),("gitBranch",f.gitBranch)).foreach { case (key,v) => v.foreach { s => Check.text(s,256); b += s"r.snapshot->'metadata'->>'$key'=?"; p += s } }
    f.after.foreach { s => Check(scala.util.Try(java.time.Instant.parse(s)).isSuccess,"invalid","invalid time filter"); b += "(r.snapshot->'metadata'->>'startedAt')::timestamptz>=?::timestamptz"; p += s }
    f.before.foreach { s => Check(scala.util.Try(java.time.Instant.parse(s)).isSuccess,"invalid","invalid time filter"); b += "(r.snapshot->'metadata'->>'startedAt')::timestamptz<=?::timestamptz"; p += s }
    Check(f.tags.size<=32,"invalid","tag filter limit")
    f.tags.foreach { s => Check.text(s,128); b += "((r.snapshot->'metadata'->'tags') @> ?::jsonb OR EXISTS(SELECT 1 FROM ch_chunks tagged WHERE tagged.generation=s.published AND tagged.value->'tags' @> ?::jsonb))"; val tag=io.circe.Json.arr(io.circe.Json.fromString(s)).noSpaces; p += tag; p += tag }
    (b.result().map(" AND "+_).mkString,p.result())
  }
  private[chronicle] def statement(reader: String,q: SearchQuery,vector: Option[List[Double]]): SearchStatement = {
    val (fs,fp)=filter(q.filter)
    // OFFSET 0 keeps the live authorization check inside the ordered index scan, before its limit.
    val authorized=s"(SELECT true FROM ch_sources s JOIN ch_revisions r ON r.session_id=s.id AND r.revision=ch.revision WHERE s.id=ch.session_id AND s.published=ch.generation AND ${archive.visible}$fs OFFSET 0)"
    val acl: List[Sql.Param]=List(reader,reader,reader)++fp
    val lexicalPredicate=if(q.query.nonEmpty) "ch.document @@ websearch_to_tsquery('english',?) AND " else ""
    val lexicalArgs: List[Sql.Param]=(if(q.query.nonEmpty) List(q.query) else Nil)++acl
    val fields="ch.id,ch.generation,ch.session_id,ch.revision,ch.document,ch.embedding"
    if(q.mode==SearchMode.Lexical) {
      SearchStatement(s"WITH candidates AS(SELECT $fields,ts_rank_cd(ch.document,websearch_to_tsquery('english',?)) AS lex FROM ch_search_chunks ch WHERE $lexicalPredicate$authorized),scored AS(SELECT *,lex AS score FROM candidates),sessions AS(SELECT DISTINCT ON(session_id) * FROM scored ORDER BY session_id,score DESC,id)",List(q.query)++lexicalArgs)
    } else {
      val dimensions=SearchPolicy.dimensions(config)
      val queryVector=SearchPolicy.vector(vector.getOrElse(throw DomainError("unavailable","query embedding unavailable")),config)
      val ann=s"ann AS MATERIALIZED(SELECT $fields FROM ch_search_chunks ch WHERE vector_dims(ch.embedding)=$dimensions AND ch.profile=? AND $authorized ORDER BY l2_normalize(ch.embedding)::halfvec($dimensions) <=> l2_normalize(?::vector)::halfvec($dimensions) LIMIT ${SearchPolicy.candidatesPerLeg})"
      val annArgs: List[Sql.Param]=List(config.profile)++acl++List(queryVector)
      val (legs,legArgs)=if(q.mode==SearchMode.Hybrid && q.query.nonEmpty) {
        (s",lexical AS MATERIALIZED(SELECT $fields FROM ch_search_chunks ch WHERE vector_dims(ch.embedding)=$dimensions AND ch.profile=? AND $lexicalPredicate$authorized ORDER BY ts_rank_cd(ch.document,websearch_to_tsquery('english',?)) DESC,ch.id LIMIT ${SearchPolicy.candidatesPerLeg}),candidates AS(SELECT * FROM ann UNION SELECT * FROM lexical)",List(config.profile)++lexicalArgs++List(q.query))
      } else (",candidates AS(SELECT * FROM ann)",Nil)
      val score=if(q.mode==SearchMode.Semantic) "1.0-distance" else s"(CASE WHEN lex>0 THEN 1.0/(${SearchPolicy.reciprocalRankConstant}+lr) ELSE 0 END)+1.0/(${SearchPolicy.reciprocalRankConstant}+vr)"
      SearchStatement(s"WITH $ann$legs,ranked AS(SELECT *,ts_rank_cd(document,websearch_to_tsquery('english',?)) AS lex,embedding <=> ?::vector AS distance FROM candidates),ranked2 AS(SELECT *,row_number() OVER(ORDER BY lex DESC,id) AS lr,row_number() OVER(ORDER BY distance,id) AS vr FROM ranked),scored AS(SELECT *,$score AS score FROM ranked2),sessions AS(SELECT DISTINCT ON(session_id) * FROM scored ORDER BY session_id,score DESC,id)",annArgs++legArgs++List(q.query,queryVector))
    }
  }
  private[chronicle] def legacyStatement(reader: String,q: SearchQuery,vector: Option[List[Double]]): SearchStatement = {
    val (fs,fp)=filter(q.filter)
    val semantic=q.mode!=SearchMode.Lexical
    val distance=if(semantic) "embedding <=> ?::vector" else "0.0"
    val score=q.mode match {
      case SearchMode.Lexical => "lex"
      case SearchMode.Semantic => "1.0-distance"
      case SearchMode.Hybrid => s"(CASE WHEN lex>0 THEN 1.0/(${SearchPolicy.reciprocalRankConstant}+lr) ELSE 0 END)+1.0/(${SearchPolicy.reciprocalRankConstant}+vr)"
    }
    val matches=if(q.mode==SearchMode.Lexical && q.query.nonEmpty) "WHERE lex>0" else ""
    SearchStatement(s"WITH corpus AS MATERIALIZED(SELECT ch.id,ch.value,ch.document,ch.embedding,s.id AS session_id,g.id AS generation,g.revision FROM ch_chunks ch JOIN ch_sources s ON s.published=ch.generation JOIN ch_generations g ON g.id=s.published JOIN ch_revisions r ON r.session_id=s.id AND r.revision=g.revision WHERE ${archive.visible}$fs),ranked AS(SELECT *,ts_rank_cd(document,websearch_to_tsquery('english',?)) AS lex,$distance AS distance FROM corpus),ranked2 AS(SELECT *,row_number() OVER(ORDER BY lex DESC,id) AS lr,row_number() OVER(ORDER BY distance,id) AS vr FROM ranked),scored AS(SELECT *,$score AS score FROM ranked2 $matches),sessions AS(SELECT DISTINCT ON(session_id) * FROM scored ORDER BY session_id,score DESC,id)",List(reader,reader,reader)++fp++List(q.query)++(if(semantic) List(SearchPolicy.vector(vector.getOrElse(throw DomainError("unavailable","query embedding unavailable")),config)) else Nil))
  }
  private[chronicle] def pageStatement(plan: SearchStatement,q: SearchQuery): SearchStatement =
    SearchStatement(plan.sql+",result_sessions AS MATERIALIZED(SELECT * FROM sessions) SELECT counted.total,page.* FROM (SELECT count(*) AS total FROM result_sessions) counted LEFT JOIN LATERAL(SELECT result_sessions.*,ch.value AS chunk_value FROM result_sessions JOIN ch_chunks ch ON ch.id=result_sessions.id ORDER BY score DESC,session_id LIMIT ? OFFSET ?) page ON true ORDER BY page.score DESC,page.session_id",plan.args++List(q.limit,q.offset))
  def search(reader: String,q: SearchQuery,vector: Option[List[Double]]): SearchResult = run(reader,q,vector,false)
  def searchLegacy(reader: String,q: SearchQuery,vector: Option[List[Double]]): SearchResult = run(reader,q,vector,true)
  private def run(reader: String,q: SearchQuery,vector: Option[List[Double]],legacy: Boolean): SearchResult = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    Check.page(q.offset,q.limit); Check(q.query.length<=2048,"invalid","query too long")
    if(q.mode!=SearchMode.Lexical) {
      Check(legacy || q.offset<SearchPolicy.rankingLimit(q.mode),"invalid","offset exceeds candidate ranking window")
      Check(Sql.one(c,"SELECT 1 FROM ch_profile WHERE NOT maintenance AND active=?",config.profile)(_ => true).contains(true),"unavailable","semantic profile requires maintenance reindex")
      SearchPolicy.configure(c)
    }
    val plan=if(legacy) legacyStatement(reader,q,vector) else statement(reader,q,vector)
    val page=pageStatement(plan,q)
    val rows=Sql.rows(c,page.sql,page.args*) { r =>
      // A null session ID is the LEFT JOIN padding row for an empty page, not a nullable hit.
      val hit=Option(r.getObject("session_id",classOf[UUID])).map { id =>
        val score=r.getDouble("score"); val chunk=Wire.decode(Chunk.codecJson,Sql.json(r,"chunk_value")).copy(score=score)
        SearchHit(archive.info(c,reader,id,Some(ContentView(r.getInt("revision"),Some(r.getObject("generation",classOf[UUID]))))),List(chunk),score)
      }
      (r.getInt("total"),hit)
    }
    val exact=legacy || q.mode==SearchMode.Lexical
    SearchResult(rows.flatMap(_._2),rows.head._1,if(exact) SearchCountScope.ExactMatches else SearchCountScope.CandidateWindow,if(exact) None else Some(SearchPolicy.rankingLimit(q.mode)))
  }
  def facets(reader: String,f: SearchFilter): FacetsResult = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    val (fs,p)=filter(f)
    val corpus=s"WITH corpus AS MATERIALIZED(SELECT s.id,s.published,r.snapshot FROM ch_sources s JOIN ch_generations g ON g.id=s.published JOIN ch_revisions r ON r.session_id=s.id AND r.revision=g.revision WHERE ${archive.visible}$fs)"
    val args: List[Sql.Param]=List(reader,reader,reader)++p
    def field(k: String): List[Facet] = Sql.rows(c,corpus+s" SELECT snapshot->'metadata'->>'$k' AS value,count(DISTINCT id) AS n FROM corpus WHERE snapshot->'metadata'->>'$k' IS NOT NULL GROUP BY value ORDER BY n DESC,value LIMIT 100",args*)(r => Facet(r.getString(1),r.getInt(2)))
    val tags=Sql.rows(c,corpus+" SELECT tag,count(DISTINCT id) FROM (SELECT id,jsonb_array_elements_text(snapshot->'metadata'->'tags') AS tag FROM corpus UNION SELECT corpus.id,jsonb_array_elements_text(ch.value->'tags') AS tag FROM corpus JOIN ch_chunks ch ON ch.generation=corpus.published) t GROUP BY tag ORDER BY count(DISTINCT id) DESC,tag LIMIT 100",args*)(r => Facet(r.getString(1),r.getInt(2)))
    FacetsResult(field("project"),field("gitBranch"),tags)
  }
}
