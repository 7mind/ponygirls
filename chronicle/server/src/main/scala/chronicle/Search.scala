package chronicle
import chronicle.api.*
import java.util.UUID
import java.sql.Connection
import ponygirls.retrieval.{CandidatePolicy,CandidateSql,RetrievalMode,Vectors}

trait SearchIndex {
  def search(reader: String,q: SearchQuery,vector: Option[List[Double]]): SearchResult
  def search(reader: String,q: SearchQuery,vector: Option[List[Double]],materialization: ReadMaterialization): SearchResult
  def searchLegacy(reader: String,q: SearchQuery,vector: Option[List[Double]]): SearchResult
  def searchLegacy(reader: String,q: SearchQuery,vector: Option[List[Double]],materialization: ReadMaterialization): SearchResult
  def facets(reader: String,f: SearchFilter): FacetsResult
  def facets(reader: String,f: SearchFilter,materialization: ReadMaterialization): FacetsResult
  def tags(reader: String,q: TagSearchQuery): List[Facet]
  def tags(reader: String,q: TagSearchQuery,materialization: ReadMaterialization): List[Facet]
}
object SearchPolicy {
  val maxDimensions = Vectors.maxDimensions
  val candidatesPerLeg = CandidatePolicy.candidatesPerLeg
  val efSearch = CandidatePolicy.efSearch
  val maxScanTuples = CandidatePolicy.maxScanTuples
  val scanMemoryMultiplier = CandidatePolicy.scanMemoryMultiplier
  val reciprocalRankConstant = CandidatePolicy.reciprocalRankConstant
  val facetValuesPerField = 100
  val facetFields = 3
  /** Exactly equal scores are ordered by these columns of the candidates (ascending; a chunk of an earlier release has no
    * ordinal and comes after the ordered ones): a chunk's place in its session, not its id, which a publication assigns
    * anew (ingest-limits spec §5.6.2 "Ranking"). */
  val tieBreak: List[String] = List("session_id","ordinal","id")
  def tieBreakSql(prefix: String): String = tieBreak.map(prefix+_).mkString(",")
  def rankingLimit(mode: SearchMode): Int = if(mode==SearchMode.Hybrid) candidatesPerLeg*2 else candidatesPerLeg
  def validateQuery(q: SearchQuery,legacy: Boolean): Unit = {
    Check.page(q.offset,q.limit); Check(q.query.length<=2048,"invalid","query too long")
    Check(legacy || q.mode==SearchMode.Lexical || q.offset<rankingLimit(q.mode),"invalid","offset exceeds candidate ranking window")
  }
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
    CandidateSql.configureStatements.foreach(Sql.exec(c,_))
  }
}
/** `ann`: the statement holds a semantic leg (CTE `ann`) whose rows the page reports. */
private[chronicle] final case class SearchStatement(sql: String,args: List[Sql.Param],ann: Boolean=false)
final class PostgresSearch(db: Database, archive: PostgresArchive,config: Config,budget: SemanticLegBudget) extends SearchIndex {
  def this(db: Database,archive: PostgresArchive,config: Config) = this(db,archive,config,SemanticLegBudget.production)
  /** The filters of a relation with ch_sources `s`, the published revision's ch_revision_info `r` and the published
    * ch_generations row `published`. */
  private def filter(f: SearchFilter,published: String): (String,List[Sql.Param]) = {
    val b = List.newBuilder[String]; val p = List.newBuilder[Sql.Param]
    List(("project",f.project),("gitBranch",f.gitBranch)).foreach { case (key,v) => v.foreach { s => Check.text(s,256); b += s"r.metadata->>'$key'=?"; p += s } }
    f.after.foreach { s => Check(scala.util.Try(java.time.Instant.parse(s)).isSuccess,"invalid","invalid time filter"); b += "(r.metadata->>'startedAt')::timestamptz>=?::timestamptz"; p += s }
    f.before.foreach { s => Check(scala.util.Try(java.time.Instant.parse(s)).isSuccess,"invalid","invalid time filter"); b += "(r.metadata->>'startedAt')::timestamptz<=?::timestamptz"; p += s }
    Check(f.tags.size<=32,"invalid","tag filter limit")
    f.tags.foreach { s => Check.text(s,128); b += s"((r.metadata->'tags') @> ?::jsonb OR EXISTS(SELECT 1 FROM ${GenerationRows.tags(s"$published.id",s"$published.lineage")} tagged WHERE tagged.tag=?))"; val tag=io.circe.Json.arr(io.circe.Json.fromString(s)).noSpaces; p += tag; p += s }
    (b.result().map(" AND "+_).mkString,p.result())
  }
  private def facetCorpus(reader: String,f: SearchFilter): SearchStatement = {
    val (fs,p)=filter(f,"g")
    SearchStatement(s"WITH corpus AS MATERIALIZED(SELECT s.id,s.published,g.lineage,r.metadata FROM ch_sources s JOIN ch_generations g ON g.id=s.published JOIN ch_revision_info r ON r.session_id=s.id AND r.revision=g.revision WHERE ${archive.visible}$fs)",List(reader,reader,reader)++p)
  }
  private[chronicle] def statement(reader: String,q: SearchQuery,vector: Option[List[Double]]): SearchStatement = statement(reader,q,vector,LegPass.Index)
  private def statement(reader: String,q: SearchQuery,vector: Option[List[Double]],pass: LegPass): SearchStatement = {
    val (fs,fp)=filter(q.filter,"p")
    // OFFSET 0 keeps the live authorization check inside the ordered index scan, before its limit: the row is a piece of
    // the published generation, whose revision's metadata the filters read.
    val authorized=s"(SELECT true FROM ch_sources s JOIN ch_generations p ON p.id=s.published JOIN ch_revision_info r ON r.session_id=s.id AND r.revision=p.revision WHERE s.id=ch.session_id AND ${GenerationRows.piece("s.published","p.lineage","p.lineage_version","ch")} AND ${archive.visible}$fs OFFSET 0)"
    val acl: List[Sql.Param]=List(reader,reader,reader)++fp
    val lexicalPredicate=if(q.query.nonEmpty) "ch.document @@ websearch_to_tsquery('english',?) AND " else ""
    val lexicalArgs: List[Sql.Param]=(if(q.query.nonEmpty) List(q.query) else Nil)++acl
    val fields="ch.id,ch.generation,ch.session_id,ch.revision,ch.ordinal,ch.document,ch.embedding"
    if(q.mode==SearchMode.Lexical) {
      SearchStatement(s"WITH candidates AS(SELECT $fields,ts_rank_cd(ch.document,websearch_to_tsquery('english',?)) AS lex FROM ch_search_chunks ch WHERE $lexicalPredicate$authorized),scored AS(SELECT *,lex AS score FROM candidates),sessions AS(SELECT DISTINCT ON(session_id) * FROM scored ORDER BY session_id,score DESC,${SearchPolicy.tieBreakSql("")})",List(q.query)++lexicalArgs)
    } else {
      val dimensions=SearchPolicy.dimensions(config)
      val queryVector=SearchPolicy.vector(vector.getOrElse(throw DomainError("unavailable","query embedding unavailable")),config)
      val (ann,annArgs)=pass match {
        case LegPass.Index =>
          (s"ann AS MATERIALIZED(SELECT $fields FROM ch_search_chunks ch WHERE vector_dims(ch.embedding)=$dimensions AND ${IndexProfiles.compatibleSql("ch.profile")} AND $authorized ORDER BY ${CandidateSql.annDistance(dimensions,"ch.embedding")} LIMIT ${SearchPolicy.candidatesPerLeg})",
            List[Sql.Param](EmbeddingSpaceDescriptor.from(config.embedding).id)++acl++List(queryVector))
        case LegPass.Exact =>
          (s"ann AS MATERIALIZED(SELECT $fields FROM ${visibleChunks(fs)} AND vector_dims(ch.embedding)=$dimensions ORDER BY ch.embedding <=> ?::vector,${SearchPolicy.tieBreakSql("ch.")} LIMIT ${SearchPolicy.candidatesPerLeg})",
            acl++List(EmbeddingSpaceDescriptor.from(config.embedding).id,queryVector))
      }
      val (legs,legArgs)=if(q.mode==SearchMode.Hybrid && q.query.nonEmpty) {
        (s",lexical AS MATERIALIZED(SELECT $fields FROM ch_search_chunks ch WHERE vector_dims(ch.embedding)=$dimensions AND ${IndexProfiles.compatibleSql("ch.profile")} AND $lexicalPredicate$authorized ORDER BY ts_rank_cd(ch.document,websearch_to_tsquery('english',?)) DESC,${SearchPolicy.tieBreakSql("ch.")} LIMIT ${SearchPolicy.candidatesPerLeg}),candidates AS(SELECT * FROM ann UNION SELECT * FROM lexical)",List(EmbeddingSpaceDescriptor.from(config.embedding).id)++lexicalArgs++List(q.query))
      } else (",candidates AS(SELECT * FROM ann)",Nil)
      // Shared executable reranking retains the exact original-vector/RRF/entity algorithm.
      val mode=if(q.mode==SearchMode.Semantic) RetrievalMode.Semantic else RetrievalMode.Hybrid
      SearchStatement(s"WITH $ann$legs,"+CandidateSql.rerankCtes(mode,"session_id",SearchPolicy.tieBreak),annArgs++legArgs++List(q.query,q.query,queryVector),ann=true)
    }
  }
  /** The leg's visible set from the source side (the session index, not the vector index): pieces of the published
    * generations of visible sessions passing the filters, of a compatible profile. Arguments: the ACL's and filters',
    * then the space. */
  private def visibleChunks(fs: String): String =
    s"ch_sources s JOIN ch_generations p ON p.id=s.published JOIN ch_search_chunks ch ON ch.session_id=s.id AND ${GenerationRows.piece("s.published","p.lineage","p.lineage_version","ch")} JOIN ch_revision_info r ON r.session_id=s.id AND r.revision=p.revision WHERE ${archive.visible}$fs AND ${IndexProfiles.compatibleSql("ch.profile")}"
  private def visibleCount(c: Connection,reader: String,q: SearchQuery): Long = {
    val (fs,fp)=filter(q.filter,"p")
    Sql.one(c,s"SELECT count(*) FROM (SELECT 1 FROM ${visibleChunks(fs)} AND vector_dims(ch.embedding)=${SearchPolicy.dimensions(config)} LIMIT ?) visible",
      (List[Sql.Param](reader,reader,reader)++fp++List(EmbeddingSpaceDescriptor.from(config.embedding).id,SemanticLeg.visibleCap(budget)))*)(_.getLong(1)).get
  }
  private[chronicle] def legacyStatement(reader: String,q: SearchQuery,vector: Option[List[Double]]): SearchStatement = {
    val (fs,fp)=filter(q.filter,"g")
    val semantic=q.mode!=SearchMode.Lexical
    val distance=if(semantic) "embedding <=> ?::vector" else "0.0"
    val score=q.mode match {
      case SearchMode.Lexical => "lex"
      case SearchMode.Semantic => "1.0-distance"
      case SearchMode.Hybrid => s"(CASE WHEN lex>0 THEN 1.0/(${SearchPolicy.reciprocalRankConstant}+lr) ELSE 0 END)+1.0/(${SearchPolicy.reciprocalRankConstant}+vr)"
    }
    val matches=if(q.mode==SearchMode.Lexical && q.query.nonEmpty) "WHERE lex>0" else ""
    val compatibility=if(semantic) " AND "+IndexProfiles.compatibleSql("g.profile") else ""
    val ties=SearchPolicy.tieBreakSql("")
    SearchStatement(s"WITH corpus AS MATERIALIZED(SELECT ch.id,ch.ordinal,ch.document,ch.embedding,s.id AS session_id,g.id AS generation,g.revision FROM ch_sources s JOIN ch_generations g ON g.id=s.published JOIN ch_revision_info r ON r.session_id=s.id AND r.revision=g.revision CROSS JOIN LATERAL(${GenerationRows.members(GenerationRows.Kind.Piece,"g.id")}) m JOIN ch_chunks ch ON ch.generation=m.origin AND ch.ordinal>=m.lo AND ch.ordinal<m.hi WHERE ${archive.visible}$fs$compatibility),ranked AS(SELECT *,ts_rank_cd(document,websearch_to_tsquery('english',?)) AS lex,$distance AS distance FROM corpus),ranked2 AS(SELECT *,row_number() OVER(ORDER BY lex DESC,$ties) AS lr,row_number() OVER(ORDER BY distance,$ties) AS vr FROM ranked),scored AS(SELECT *,$score AS score FROM ranked2 $matches),sessions AS(SELECT DISTINCT ON(session_id) * FROM scored ORDER BY session_id,score DESC,$ties)",List(reader,reader,reader)++fp++(if(semantic) List(EmbeddingSpaceDescriptor.from(config.embedding).id) else Nil)++List(q.query)++(if(semantic) List(SearchPolicy.vector(vector.getOrElse(throw DomainError("unavailable","query embedding unavailable")),config)) else Nil))
  }
  private[chronicle] def pageStatement(plan: SearchStatement,q: SearchQuery): SearchStatement = {
    val annRows=if(plan.ann) "(SELECT count(*) FROM ann) AS ann_rows," else ""
    // A hit's view is its session's published generation and revision (the chunk's row may be an earlier origin's).
    SearchStatement(plan.sql+s",result_sessions AS MATERIALIZED(SELECT hit.id,hs.published AS generation,hit.session_id,hp.revision,hit.score FROM sessions hit JOIN ch_sources hs ON hs.id=hit.session_id JOIN ch_generations hp ON hp.id=hs.published) SELECT counted.total,${annRows}page.id,page.generation,page.session_id,page.revision,page.score FROM (SELECT count(*) AS total FROM result_sessions) counted LEFT JOIN LATERAL(SELECT * FROM result_sessions ORDER BY score DESC,session_id LIMIT ? OFFSET ?) page ON true ORDER BY page.score DESC,page.session_id",plan.args++List(q.limit,q.offset),plan.ann)
  }
  def search(reader: String,q: SearchQuery,vector: Option[List[Double]]): SearchResult = search(reader,q,vector,ReadMaterialization.unrestricted)
  def search(reader: String,q: SearchQuery,vector: Option[List[Double]],materialization: ReadMaterialization): SearchResult = run(reader,q,vector,false,materialization)
  def searchLegacy(reader: String,q: SearchQuery,vector: Option[List[Double]]): SearchResult = searchLegacy(reader,q,vector,ReadMaterialization.unrestricted)
  def searchLegacy(reader: String,q: SearchQuery,vector: Option[List[Double]],materialization: ReadMaterialization): SearchResult = run(reader,q,vector,true,materialization)
  private final case class Reference(id: UUID,sessionId: UUID,view: ContentView,score: Double)
  private def referenceBytes(total: Int,reference: Option[Reference]): Long = JsonUtf8Size(io.circe.Json.obj(
    "total"->io.circe.Json.fromInt(total),"id"->reference.map(r => io.circe.Json.fromString(r.id.toString)).getOrElse(io.circe.Json.Null),
    "generation"->reference.flatMap(_.view.generationId).map(id => io.circe.Json.fromString(id.toString)).getOrElse(io.circe.Json.Null),
    "session_id"->reference.map(r => io.circe.Json.fromString(r.sessionId.toString)).getOrElse(io.circe.Json.Null),
    "revision"->reference.map(r => io.circe.Json.fromInt(r.view.revision)).getOrElse(io.circe.Json.Null),
    "score"->reference.map(r => io.circe.Json.fromDoubleOrNull(r.score)).getOrElse(io.circe.Json.Null)))
  private def run(reader: String,q: SearchQuery,vector: Option[List[Double]],legacy: Boolean,materialization: ReadMaterialization): SearchResult = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    materialization.begin(c)
    SearchPolicy.validateQuery(q,legacy)
    if(q.mode!=SearchMode.Lexical) {
      val guard=ReadSources.Query("SELECT t.profile,t.epoch,p.embedding_space,e.descriptor FROM ch_users u LEFT JOIN ch_owner_targets t ON t.owner=u.id LEFT JOIN ch_index_profiles p ON p.profile=t.profile LEFT JOIN ch_embedding_spaces e ON e.id=p.embedding_space WHERE u.id=? AND u.enabled",List(reader))
      materialization.admit(ReadSources.bytes(c,guard))
      IndexProfiles.semantic(c,reader,archive.visible,EmbeddingSpaceDescriptor.from(config.embedding))
      SemanticLeg.configure(c,budget)
    }
    val semanticLeg= !legacy && q.mode!=SearchMode.Lexical
    def execute(pass: LegPass): List[(Int,Option[Reference],Long)] = {
      val page=pageStatement(if(legacy) legacyStatement(reader,q,vector) else statement(reader,q,vector,pass),q)
      Sql.rows(c,page.sql,page.args*) { r =>
        // A null session ID is the LEFT JOIN padding row for an empty page, not a nullable hit.
        val reference=Option(r.getObject("session_id",classOf[UUID])).map { id =>
          Reference(r.getObject("id",classOf[UUID]),id,ContentView(r.getInt("revision"),Some(r.getObject("generation",classOf[UUID]))),r.getDouble("score"))
        }
        (r.getInt("total"),reference,if(semanticLeg) r.getLong("ann_rows") else 0L)
      }
    }
    val rows=if(!semanticLeg) execute(LegPass.Index).map((total,reference,_) => (total,reference)) else
      SemanticLeg.complete(c,budget,List(()))(passes => execute(passes.getOrElse((),LegPass.Index)))(rows => Map(() -> rows.head._3))(_ => visibleCount(c,reader,q))
        .map((total,reference,_) => (total,reference))
    materialization.admit(ReadSources.sum(rows.map((total,reference) => referenceBytes(total,reference))))
    val references=rows.flatMap(_._2)
    val checked=references.map(reference => reference.copy(view=archive.selectView(c,reader,reference.sessionId,Some(reference.view),materialization)))
    val chunksQuery=ReadSources.Query("SELECT id,value FROM ch_chunks WHERE id IN ("+checked.map(_ => "?").mkString(",")+")",checked.map(_.id))
    materialization.admit(ReadSources.sum(checked.map(reference => ReadSources.bytes(c,archive.infoQuery(reference.sessionId,reference.view)))++
      (if(checked.isEmpty) Nil else List(ReadSources.bytes(c,chunksQuery)))))
    val chunks=if(checked.isEmpty) Map.empty[UUID,Chunk] else Sql.rows(c,chunksQuery.sql,chunksQuery.args*)(r => r.getObject("id",classOf[UUID])->Wire.decode(Chunk.codecJson,Sql.json(r,"value"))).toMap
    val hits=checked.map { reference =>
      val chunk=chunks.getOrElse(reference.id,throw DomainError("projection","search chunk projection missing")).copy(score=reference.score)
      SearchHit(archive.infoForView(c,reference.sessionId,reference.view),List(chunk),reference.score)
    }
    val exact=legacy || q.mode==SearchMode.Lexical
    SearchResult(hits,rows.head._1,if(exact) SearchCountScope.ExactMatches else SearchCountScope.CandidateWindow,if(exact) None else Some(SearchPolicy.rankingLimit(q.mode)))
  }
  def facets(reader: String,f: SearchFilter): FacetsResult = facets(reader,f,ReadMaterialization.unrestricted)
  def facets(reader: String,f: SearchFilter,materialization: ReadMaterialization): FacetsResult = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    materialization.begin(c)
    PassageStorage.requireCurrentPublications(c,archive.visible,reader)
    val source=facetCorpus(reader,f)
    val corpus=source.sql
    val args=source.args
    def field(key: String): String = s"SELECT metadata->>'$key' AS value,count(DISTINCT id) AS n FROM corpus WHERE metadata->>'$key' IS NOT NULL GROUP BY value ORDER BY n DESC,value LIMIT ${SearchPolicy.facetValuesPerField}"
    val tags=s"SELECT tag AS value,count(DISTINCT id) AS n FROM (SELECT id,jsonb_array_elements_text(metadata->'tags') COLLATE \"default\" AS tag FROM corpus UNION SELECT corpus.id,ch.tag COLLATE \"default\" FROM corpus CROSS JOIN LATERAL ${GenerationRows.tags("corpus.published","corpus.lineage")} ch) t GROUP BY tag ORDER BY n DESC,value LIMIT ${SearchPolicy.facetValuesPerField}"
    val selection=corpus+s",projects AS(${field("project")}),branches AS(${field("gitBranch")}),tags AS($tags),selected AS("+
      "SELECT 0 AS kind,row_number() OVER(ORDER BY n DESC,value) AS ordinal,value,n FROM projects UNION ALL "+
      "SELECT 1 AS kind,row_number() OVER(ORDER BY n DESC,value) AS ordinal,value,n FROM branches UNION ALL "+
      "SELECT 2 AS kind,row_number() OVER(ORDER BY n DESC,value) AS ordinal,value,n FROM tags) SELECT kind,ordinal,value,n FROM selected ORDER BY kind,ordinal"
    val rows=materialization.selected(c,ReadSources.Selection(ReadSources.Query(selection,args),"kind,ordinal",SearchPolicy.facetFields*SearchPolicy.facetValuesPerField)) { value =>
      val cursor=value.hcursor
      val kind=cursor.get[Int]("kind").fold(_ => throw DomainError("projection","invalid facet field"),identity)
      val text=cursor.get[String]("value").fold(_ => throw DomainError("projection","invalid facet value"),identity)
      val count=cursor.get[Int]("n").fold(_ => throw DomainError("projection","invalid facet count"),identity)
      (kind,Facet(text,count))
    }
    def values(kind: Int): List[Facet] = rows.collect { case (`kind`,facet) => facet }
    FacetsResult(values(0),values(1),values(2))
  }
  def tags(reader: String,q: TagSearchQuery): List[Facet] = tags(reader,q,ReadMaterialization.unrestricted)
  def tags(reader: String,q: TagSearchQuery,materialization: ReadMaterialization): List[Facet] = {
    TagSearchPolicy.validate(q)
    val corpus=facetCorpus(reader,q.filter)
    val position=if(q.afterTag.nonEmpty) " AND tag COLLATE \"C\">? COLLATE \"C\"" else ""
    val selection=corpus.sql+",tag_sessions AS (SELECT id,jsonb_array_elements_text(metadata->'tags') COLLATE \"C\" AS tag FROM corpus UNION "+
      s"SELECT corpus.id,ch.tag COLLATE \"C\" FROM corpus CROSS JOIN LATERAL ${GenerationRows.tags("corpus.published","corpus.lineage")} ch) "+
      "SELECT tag AS value,count(DISTINCT id) AS n FROM tag_sessions WHERE strpos(lower(tag COLLATE pg_unicode_fast),lower(? COLLATE pg_unicode_fast))>0"+position+
      " GROUP BY tag ORDER BY tag COLLATE \"C\" LIMIT ?"
    val args=corpus.args++List[Sql.Param](q.query)++q.afterTag.toList++List(q.limit)
    db.transaction { c =>
      c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
      materialization.begin(c)
      PassageStorage.requireCurrentPublications(c,archive.visible,reader)
      materialization.selected(c,ReadSources.Selection(ReadSources.Query(selection,args),"value COLLATE \"C\"",q.limit)) { value =>
        val cursor=value.hcursor
        val text=cursor.get[String]("value").fold(_ => throw DomainError("projection","invalid tag value"),identity)
        val count=cursor.get[Long]("n").fold(_ => throw DomainError("projection","invalid tag count"),TagSearchPolicy.count)
        Facet(text,count)
      }
    }
  }
}
