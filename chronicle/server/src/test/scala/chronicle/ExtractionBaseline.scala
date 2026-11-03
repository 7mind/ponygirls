package chronicle

// Test-only differential oracle copied from pre-extraction source e9fda183.
// Not a deployed compatibility API or fallback. Keep while extraction is validated.
import chronicle.api.*
import io.circe.Json
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets.UTF_8
import java.sql.{Connection,ResultSet,SQLException}
import java.util.{Base64,Locale,UUID}
import scala.util.Try

final class ExtractionBaselinePostgresSearch(db: Database, archive: PostgresArchive,config: Config) extends SearchIndex {
  private def filter(f: SearchFilter): (String,List[Sql.Param]) = {
    val b = List.newBuilder[String]; val p = List.newBuilder[Sql.Param]
    List(("project",f.project),("gitBranch",f.gitBranch)).foreach { case (key,v) => v.foreach { s => Check.text(s,256); b += s"r.metadata->>'$key'=?"; p += s } }
    f.after.foreach { s => Check(scala.util.Try(java.time.Instant.parse(s)).isSuccess,"invalid","invalid time filter"); b += "(r.metadata->>'startedAt')::timestamptz>=?::timestamptz"; p += s }
    f.before.foreach { s => Check(scala.util.Try(java.time.Instant.parse(s)).isSuccess,"invalid","invalid time filter"); b += "(r.metadata->>'startedAt')::timestamptz<=?::timestamptz"; p += s }
    Check(f.tags.size<=32,"invalid","tag filter limit")
    f.tags.foreach { s => Check.text(s,128); b += "((r.metadata->'tags') @> ?::jsonb OR EXISTS(SELECT 1 FROM ch_generation_tags tagged WHERE tagged.generation=s.published AND tagged.tag=?))"; val tag=io.circe.Json.arr(io.circe.Json.fromString(s)).noSpaces; p += tag; p += s }
    (b.result().map(" AND "+_).mkString,p.result())
  }
  private def facetCorpus(reader: String,f: SearchFilter): SearchStatement = {
    val (fs,p)=filter(f)
    SearchStatement(s"WITH corpus AS MATERIALIZED(SELECT s.id,s.published,r.metadata FROM ch_sources s JOIN ch_generations g ON g.id=s.published JOIN ch_revision_info r ON r.session_id=s.id AND r.revision=g.revision WHERE ${archive.visible}$fs)",List(reader,reader,reader)++p)
  }
  private[chronicle] def statement(reader: String,q: SearchQuery,vector: Option[List[Double]]): SearchStatement = {
    val (fs,fp)=filter(q.filter)
    // OFFSET 0 keeps the live authorization check inside the ordered index scan, before its limit.
    val authorized=s"(SELECT true FROM ch_sources s JOIN ch_revision_info r ON r.session_id=s.id AND r.revision=ch.revision WHERE s.id=ch.session_id AND s.published=ch.generation AND ${archive.visible}$fs OFFSET 0)"
    val acl: List[Sql.Param]=List(reader,reader,reader)++fp
    val lexicalPredicate=if(q.query.nonEmpty) "ch.document @@ websearch_to_tsquery('english',?) AND " else ""
    val lexicalArgs: List[Sql.Param]=(if(q.query.nonEmpty) List(q.query) else Nil)++acl
    val fields="ch.id,ch.generation,ch.session_id,ch.revision,ch.document,ch.embedding"
    if(q.mode==SearchMode.Lexical) {
      SearchStatement(s"WITH candidates AS(SELECT $fields,ts_rank_cd(ch.document,websearch_to_tsquery('english',?)) AS lex FROM ch_search_chunks ch WHERE $lexicalPredicate$authorized),scored AS(SELECT *,lex AS score FROM candidates),sessions AS(SELECT DISTINCT ON(session_id) * FROM scored ORDER BY session_id,score DESC,id)",List(q.query)++lexicalArgs)
    } else {
      val dimensions=SearchPolicy.dimensions(config)
      val queryVector=SearchPolicy.vector(vector.getOrElse(throw DomainError("unavailable","query embedding unavailable")),config)
      val ann=s"ann AS MATERIALIZED(SELECT $fields FROM ch_search_chunks ch WHERE vector_dims(ch.embedding)=$dimensions AND ${IndexProfiles.compatibleSql("ch.profile")} AND $authorized ORDER BY l2_normalize(ch.embedding)::halfvec($dimensions) <=> l2_normalize(?::vector)::halfvec($dimensions) LIMIT ${SearchPolicy.candidatesPerLeg})"
      val annArgs: List[Sql.Param]=List(EmbeddingSpaceDescriptor.from(config.embedding).id)++acl++List(queryVector)
      val (legs,legArgs)=if(q.mode==SearchMode.Hybrid && q.query.nonEmpty) {
        (s",lexical AS MATERIALIZED(SELECT $fields FROM ch_search_chunks ch WHERE vector_dims(ch.embedding)=$dimensions AND ${IndexProfiles.compatibleSql("ch.profile")} AND $lexicalPredicate$authorized ORDER BY ts_rank_cd(ch.document,websearch_to_tsquery('english',?)) DESC,ch.id LIMIT ${SearchPolicy.candidatesPerLeg}),candidates AS(SELECT * FROM ann UNION SELECT * FROM lexical)",List(EmbeddingSpaceDescriptor.from(config.embedding).id)++lexicalArgs++List(q.query))
      } else (",candidates AS(SELECT * FROM ann)",Nil)
      // Cover-density rank can be positive even when a negated term makes the full query false.
      val lexicalScore="CASE WHEN document @@ websearch_to_tsquery('english',?) THEN ts_rank_cd(document,websearch_to_tsquery('english',?)) ELSE 0 END"
      val score=if(q.mode==SearchMode.Semantic) "1.0-distance" else s"(CASE WHEN lex>0 THEN 1.0/(${SearchPolicy.reciprocalRankConstant}+lr) ELSE 0 END)+1.0/(${SearchPolicy.reciprocalRankConstant}+vr)"
      SearchStatement(s"WITH $ann$legs,ranked AS(SELECT *,$lexicalScore AS lex,embedding <=> ?::vector AS distance FROM candidates),ranked2 AS(SELECT *,row_number() OVER(ORDER BY lex DESC,id) AS lr,row_number() OVER(ORDER BY distance,id) AS vr FROM ranked),scored AS(SELECT *,$score AS score FROM ranked2),sessions AS(SELECT DISTINCT ON(session_id) * FROM scored ORDER BY session_id,score DESC,id)",annArgs++legArgs++List(q.query,q.query,queryVector))
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
    val compatibility=if(semantic) " AND "+IndexProfiles.compatibleSql("g.profile") else ""
    SearchStatement(s"WITH corpus AS MATERIALIZED(SELECT ch.id,ch.document,ch.embedding,s.id AS session_id,g.id AS generation,g.revision FROM ch_chunks ch JOIN ch_sources s ON s.published=ch.generation JOIN ch_generations g ON g.id=s.published JOIN ch_revision_info r ON r.session_id=s.id AND r.revision=g.revision WHERE ${archive.visible}$fs$compatibility),ranked AS(SELECT *,ts_rank_cd(document,websearch_to_tsquery('english',?)) AS lex,$distance AS distance FROM corpus),ranked2 AS(SELECT *,row_number() OVER(ORDER BY lex DESC,id) AS lr,row_number() OVER(ORDER BY distance,id) AS vr FROM ranked),scored AS(SELECT *,$score AS score FROM ranked2 $matches),sessions AS(SELECT DISTINCT ON(session_id) * FROM scored ORDER BY session_id,score DESC,id)",List(reader,reader,reader)++fp++(if(semantic) List(EmbeddingSpaceDescriptor.from(config.embedding).id) else Nil)++List(q.query)++(if(semantic) List(SearchPolicy.vector(vector.getOrElse(throw DomainError("unavailable","query embedding unavailable")),config)) else Nil))
  }
  private[chronicle] def pageStatement(plan: SearchStatement,q: SearchQuery): SearchStatement =
    SearchStatement(plan.sql+",result_sessions AS MATERIALIZED(SELECT id,generation,session_id,revision,score FROM sessions) SELECT counted.total,page.id,page.generation,page.session_id,page.revision,page.score FROM (SELECT count(*) AS total FROM result_sessions) counted LEFT JOIN LATERAL(SELECT * FROM result_sessions ORDER BY score DESC,session_id LIMIT ? OFFSET ?) page ON true ORDER BY page.score DESC,page.session_id",plan.args++List(q.limit,q.offset))
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
      SearchPolicy.configure(c)
    }
    val plan=if(legacy) legacyStatement(reader,q,vector) else statement(reader,q,vector)
    val page=pageStatement(plan,q)
    val rows=Sql.rows(c,page.sql,page.args*) { r =>
      // A null session ID is the LEFT JOIN padding row for an empty page, not a nullable hit.
      val reference=Option(r.getObject("session_id",classOf[UUID])).map { id =>
        Reference(r.getObject("id",classOf[UUID]),id,ContentView(r.getInt("revision"),Some(r.getObject("generation",classOf[UUID]))),r.getDouble("score"))
      }
      (r.getInt("total"),reference)
    }
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
    val source=facetCorpus(reader,f)
    val corpus=source.sql
    val args=source.args
    def field(key: String): String = s"SELECT metadata->>'$key' AS value,count(DISTINCT id) AS n FROM corpus WHERE metadata->>'$key' IS NOT NULL GROUP BY value ORDER BY n DESC,value LIMIT ${SearchPolicy.facetValuesPerField}"
    val tags=s"SELECT tag AS value,count(DISTINCT id) AS n FROM (SELECT id,jsonb_array_elements_text(metadata->'tags') COLLATE \"default\" AS tag FROM corpus UNION SELECT corpus.id,ch.tag COLLATE \"default\" FROM corpus JOIN ch_generation_tags ch ON ch.generation=corpus.published) t GROUP BY tag ORDER BY n DESC,value LIMIT ${SearchPolicy.facetValuesPerField}"
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
      "SELECT corpus.id,ch.tag COLLATE \"C\" FROM corpus JOIN ch_generation_tags ch ON ch.generation=corpus.published) "+
      "SELECT tag AS value,count(DISTINCT id) AS n FROM tag_sessions WHERE strpos(lower(tag COLLATE pg_unicode_fast),lower(? COLLATE pg_unicode_fast))>0"+position+
      " GROUP BY tag ORDER BY tag COLLATE \"C\" LIMIT ?"
    val args=corpus.args++List[Sql.Param](q.query)++q.afterTag.toList++List(q.limit)
    db.transaction { c =>
      c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
      materialization.begin(c)
      materialization.selected(c,ReadSources.Selection(ReadSources.Query(selection,args),"value COLLATE \"C\"",q.limit)) { value =>
        val cursor=value.hcursor
        val text=cursor.get[String]("value").fold(_ => throw DomainError("projection","invalid tag value"),identity)
        val count=cursor.get[Long]("n").fold(_ => throw DomainError("projection","invalid tag count"),TagSearchPolicy.count)
        Facet(text,count)
      }
    }
  }
}

final class ExtractionBaselinePostgresArchiveIndex(db: Database,archive: PostgresArchive,config: Config) extends ArchiveIndex {
  import ArchiveExpression.*
  private val unicode = "COLLATE \"pg_unicode_fast\""
  private val columns = "c.*"
  private val trigramWidth=3
  private val minimumGlobalTrigrams=2
  private def globalLiteralCandidates(value: String): Boolean =
    value.sliding(trigramWidth).filter(_.forall(ch => ch>='a' && ch<='z' || ch>='A' && ch<='Z' || ch>='0' && ch<='9')).map(_.toLowerCase(Locale.ROOT)).distinct.take(minimumGlobalTrigrams).size==minimumGlobalTrigrams
  private final case class PageRow(value: ArchiveRow,key: Option[String],relevanceScore: Option[String],witnesses: List[ArchiveSemanticWitness])
  private def literal(value: String): String = "%"+value.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%"
  private def insensitive(column: String,value: String): ArchiveSql = ArchiveSql(s"COALESCE(lower(($column) $unicode)=lower(? $unicode),false)",List(value))
  private def predicate(value: ArchivePredicate): ArchiveSql = value match {
    case ArchivePredicate.User(user) => ArchiveSql("c.owner=?",List(user))
    case ArchivePredicate.Tag(tag) => ArchiveSql(s"EXISTS(SELECT 1 FROM unnest(c.tags) item(tag) WHERE lower(item.tag $unicode)=lower(? $unicode))",List(tag))
    case ArchivePredicate.Project(project) => insensitive("c.metadata->>'project'",project)
    case ArchivePredicate.Branch(branch) => insensitive("c.metadata->>'gitBranch'",branch)
    case ArchivePredicate.Producer(producer) => insensitive("c.metadata->>'producer'",producer)
    case ArchivePredicate.Model(model) => insensitive("c.metadata->>'model'",model)
    case ArchivePredicate.YoloProfile(profile) => ArchiveSql(s"COALESCE((${RecordedYoloProfile.sql("c.source")}) COLLATE \"C\"=? COLLATE \"C\",false)",List(profile))
    case ArchivePredicate.Format(format) => insensitive("c.source->>'format'",format.toString)
    case ArchivePredicate.Agent(kind) => ArchiveSql(AgentKind.sql("c.source",kind),Nil)
    case ArchivePredicate.Status(ArchiveStatus.Unscheduled) => ArchiveSql("c.job_id IS NULL",Nil)
    case ArchivePredicate.Status(status) => ArchiveSql("COALESCE(c.job_state=?,false)",List(status.toString))
    case ArchivePredicate.After(time) => ArchiveSql("COALESCE(c.last_timestamp_order>=?::numeric,false)",List(ArchiveProjection.timestampOrder(time)))
    case ArchivePredicate.Before(time) => ArchiveSql("COALESCE(c.last_timestamp_order<?::numeric,false)",List(ArchiveProjection.timestampOrder(time)))
  }
  private def combine(left: ArchiveSql,right: ArchiveSql,operator: String): ArchiveSql = ArchiveSql(s"(${left.text} $operator ${right.text})",left.args++right.args)
  private def expression(value: ArchiveExpression,text: String => ArchiveSql): ArchiveSql = value match {
    case True => ArchiveSql("true",Nil)
    case Text(operand) => text(operand)
    case Field(field) => predicate(field)
    case And(left,right) => combine(expression(left,text),expression(right,text),"AND")
    case Or(left,right) => combine(expression(left,text),expression(right,text),"OR")
    case Not(nested) => val compiled=expression(nested,text); ArchiveSql(s"NOT (${compiled.text})",compiled.args)
  }
  private def sort(query: ArchiveQuery): (String,Boolean) = query.sort match {
    case ArchiveSort.LastTimestamp => ("c.last_timestamp_order",true)
    case ArchiveSort.MessageCount => ("c.message_count::numeric",true)
    case ArchiveSort.Title => (s"lower((c.metadata->>'title') $unicode)",false)
    case ArchiveSort.Owner => (s"lower(c.owner $unicode)",false)
    case ArchiveSort.Project => (s"lower((c.metadata->>'project') $unicode)",false)
    case ArchiveSort.Branch => (s"lower((c.metadata->>'gitBranch') $unicode)",false)
    case ArchiveSort.Producer => (s"lower((c.metadata->>'producer') $unicode)",false)
    case ArchiveSort.Format => (s"lower((c.source->>'format') $unicode)",false)
    case ArchiveSort.Model => (s"lower((c.metadata->>'model') $unicode)",false)
    case ArchiveSort.Status => ("c.job_state",false)
    case ArchiveSort.Tags => (s"lower(c.tags[1] $unicode)",false)
  }
  private def seek(cursor: Option[ArchiveCursor],numeric: Boolean,direction: SortDirection): ArchiveSql = cursor match {
    case None => ArchiveSql("true",Nil)
    case Some(value) => value.last match {
      case None => ArchiveSql("r.sort_key IS NULL AND r.id>?",List(value.id))
      case Some(last) =>
        if(numeric) Check(last.matches("-?[0-9]{1,19}(\\.[0-9]{1,9})?"),"invalid","invalid numeric archive cursor")
        val cast=if(numeric) "::numeric" else ""
        val comparison=if(direction==SortDirection.Asc) ">" else "<"
        ArchiveSql(s"(r.sort_key $comparison ?$cast OR (r.sort_key=?$cast AND r.id>?) OR r.sort_key IS NULL)",List(last,last,value.id))
    }
  }
  private def seekRelevance(cursor: Option[ArchiveCursor]): ArchiveSql = cursor match {
    case None => ArchiveSql("true",Nil)
    case Some(value) =>
      val score=value.relevanceScore.getOrElse(throw DomainError("internal","missing ranked archive cursor score"))
      value.last match {
        case None => ArchiveSql("(r.relevance<?::numeric OR (r.relevance=?::numeric AND r.sort_key IS NULL AND r.id>?))",List(score,score,value.id))
        case Some(timestamp) => ArchiveSql("(r.relevance<?::numeric OR (r.relevance=?::numeric AND (r.sort_key<?::numeric OR r.sort_key IS NULL OR (r.sort_key=?::numeric AND r.id>?))))",List(score,score,timestamp,timestamp,value.id))
      }
  }
  private def resolve(c: Connection,reader: String,query: ArchiveQuery,position: ArchiveCursor,materialization: Option[ReadMaterialization]): ArchiveCursor = position.anchor match {
    case None => position
    case Some(anchor) =>
      val expression=sort(query)._1
      val selection=ReadSources.Query(s"""SELECT $expression AS sort_value FROM (
        SELECT s.owner,i.metadata FROM ch_sources s
        JOIN ch_revision_info i ON i.session_id=s.id AND i.revision=?
        WHERE s.id=? AND ${archive.visible}) c""",List(anchor.revision,position.id,reader,reader,reader))
      materialization.foreach(_.admit(ReadSources.bytes(c,selection)))
      val key=Sql.one(c,selection.sql,selection.args*)(r => Option(r.getString(1)))
        .getOrElse(throw DomainError("conflict","sort cursor anchor unavailable; restart query"))
      position.copy(last=RevisionSortAnchor.resolve(anchor,key),anchor=None)
  }
  private[chronicle] def statement(reader: String,query: ArchiveQuery,parsed: ParsedArchiveExpression,vectors: List[ArchiveVector],position: Option[ArchiveCursor]): ArchiveSql =
    compile(reader,query,parsed,vectors,position,false)

  private def compile(reader: String,query: ArchiveQuery,parsed: ParsedArchiveExpression,vectors: List[ArchiveVector],position: Option[ArchiveCursor],witnesses: Boolean): ArchiveSql = {
    val ranked=relevanceOrdered(query,parsed)
    val corpus=s"""corpus AS MATERIALIZED(SELECT s.id,s.owner,s.revision,s.published,i.metadata,i.source,i.completion,i.redacted,i.last_timestamp,i.last_timestamp_order,i.message_count,g.revision AS indexed_revision,g.id AS generation,g.passage_format AS published_format,
      j.id AS job_id,j.state AS job_state,j.attempts AS job_attempts,j.error AS job_error,j.failure_stage,j.completed_windows,j.total_windows,
      ARRAY(SELECT tag FROM (SELECT jsonb_array_elements_text(i.metadata->'tags') AS tag UNION SELECT tag FROM ch_generation_tags WHERE generation=s.published) tag_values ORDER BY lower(tag $unicode),tag) AS tags
      FROM ch_sources s JOIN ch_revision_info i ON i.session_id=s.id AND i.revision=s.revision
      JOIN ch_owner_targets profile ON profile.owner=s.owner LEFT JOIN ch_generations g ON g.id=s.published
      LEFT JOIN ch_jobs j ON j.session_id=s.id AND j.revision=s.revision AND j.profile=profile.profile WHERE ${archive.visible})"""
    val ctes=List.newBuilder[String]; ctes+=corpus
    val args=List.newBuilder[Sql.Param]; args++=List(reader,reader,reader)
    val semantic=parsed.mode!=SearchMode.Lexical
    val lexical=parsed.mode!=SearchMode.Semantic
    val restrictions=expression(parsed.candidateFilter,_ => throw DomainError("query","text in candidate metadata restriction"))
    parsed.textOperands.zipWithIndex.foreach { case (operand,index) =>
      if(lexical) {
        // Lexical v1 already folds whole fields before fragmentation; folding again transforms every candidate on reads.
        // Keep single-key and unextractable patterns on the early-exit path; bind multi-key scans before the corpus join.
        if(globalLiteralCandidates(operand)) {
          ctes+=s"g$index AS MATERIALIZED(SELECT fragment.session_id,fragment.revision FROM ch_archive_fragments fragment WHERE fragment.head_candidate AND fragment.value LIKE lower(? $unicode) ESCAPE '\\')"
          ctes+=s"l$index AS MATERIALIZED(SELECT DISTINCT c.id FROM corpus c JOIN g$index fragment ON fragment.session_id=c.id AND fragment.revision=c.revision)"
        } else ctes+=s"l$index AS MATERIALIZED(SELECT c.id FROM corpus c WHERE EXISTS(SELECT 1 FROM ch_archive_fragments fragment WHERE fragment.head_candidate AND fragment.session_id=c.id AND fragment.revision=c.revision AND fragment.value LIKE lower(? $unicode) ESCAPE '\\'))"
        args+=literal(operand)
      }
      if(semantic) {
        val dimensions=SearchPolicy.dimensions(config)
        val vector=vectors.find(_.operand==operand).getOrElse(throw DomainError("unavailable","query embedding unavailable"))
        val value=SearchPolicy.vector(vector.values,config)
        ctes+=s"a$index AS MATERIALIZED(SELECT ch.id,ch.session_id,ch.revision,ch.generation,ch.embedding <=> ?::vector AS distance FROM ch_search_chunks ch WHERE vector_dims(ch.embedding)=$dimensions AND ${IndexProfiles.compatibleSql("ch.profile")} AND (SELECT true FROM corpus c WHERE c.id=ch.session_id AND c.published=ch.generation AND (${restrictions.text}) OFFSET 0) ORDER BY l2_normalize(ch.embedding)::halfvec($dimensions) <=> l2_normalize(?::vector)::halfvec($dimensions) LIMIT ${SearchPolicy.candidatesPerLeg})"
        args+=value; args+=EmbeddingSpaceDescriptor.from(config.embedding).id; args++=restrictions.args; args+=value
      }
    }
    def membership(operand: String): ArchiveSql = {
      val index=parsed.textOperands.indexOf(operand)
      Check(index>=0,"query","unregistered text operand")
      val parts=(if(lexical) List(s"EXISTS(SELECT 1 FROM l$index WHERE id=c.id)") else Nil)++(if(semantic) List(s"EXISTS(SELECT 1 FROM a$index WHERE session_id=c.id)") else Nil)
      ArchiveSql(parts.mkString("("," OR ",")"),Nil)
    }
    val compiled=expression(parsed.expression,membership)
    val positives=positive(parsed.expression,false).distinct.map(parsed.textOperands.indexOf)
    val terms=List.newBuilder[String]; terms+="0::numeric"
    val joins=List.newBuilder[String]
    if(ranked) positives.foreach { index =>
      if(lexical) terms+=s"CASE WHEN EXISTS(SELECT 1 FROM l$index WHERE id=c.id) THEN 1::numeric/(${SearchPolicy.reciprocalRankConstant}+1) ELSE 0 END"
      if(semantic) {
        ctes+=s"r$index AS MATERIALIZED(SELECT session_id,rank() OVER(ORDER BY nearest) AS rank FROM (SELECT session_id,min(distance) AS nearest FROM a$index GROUP BY session_id) nearest_session)"
        joins+=s"LEFT JOIN r$index ON r$index.session_id=c.id"
        terms+=s"COALESCE(1::numeric/(${SearchPolicy.reciprocalRankConstant}+r$index.rank),0)"
      }
    }
    def any(prefix: String,column: String,enabled: Boolean): String = if(enabled && positives.nonEmpty) positives.map(i => s"EXISTS(SELECT 1 FROM $prefix$i WHERE $column=c.id)").mkString("("," OR ",")") else "false"
    val lexicalMatch=any("l","id",lexical)
    val semanticMatch=any("a","session_id",semantic)
    val score=terms.result().mkString("+")
    val (columnKey,numeric)=sort(query)
    val sortKey=if(ranked) "c.last_timestamp_order" else columnKey
    ctes+=s"matched AS MATERIALIZED(SELECT $columns,to_json(c.tags) AS tag_values,$sortKey AS sort_key,($score) AS relevance,CASE WHEN $lexicalMatch THEN c.revision WHEN $semanticMatch THEN c.indexed_revision END AS matched_revision,CASE WHEN NOT $lexicalMatch AND $semanticMatch THEN c.generation END AS matched_generation FROM corpus c ${joins.result().mkString(" ")} WHERE (${compiled.text}))"
    args++=compiled.args
    val cursor=if(ranked) seekRelevance(position) else seek(position,numeric,query.direction)
    val direction=if(ranked || query.direction==SortDirection.Desc) "DESC" else "ASC"
    def order(alias: String): String = (if(ranked) s"$alias.relevance DESC," else "")+s"$alias.sort_key $direction NULLS LAST,$alias.id"
    val references=if(witnesses && semantic && positives.nonEmpty) {
      val candidates=positives.map(i => s"SELECT $i AS operand,id,revision,generation,distance FROM a$i WHERE session_id=page.id").mkString(" UNION ALL ")
      s"(SELECT coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) FROM (SELECT operand,id,revision,generation FROM ($candidates) candidates ORDER BY distance,operand,id LIMIT ${ArchiveSearchPolicy.maximumMatches}) w)"
    } else "'[]'::jsonb"
    ArchiveSql("WITH "+ctes.result().mkString(",")+s" SELECT counted.total,page.*,page.sort_key::text AS sort_value,page.relevance::text AS relevance_value,$references AS witnesses FROM (SELECT count(*) AS total FROM matched) counted LEFT JOIN LATERAL(SELECT r.* FROM matched r WHERE (${cursor.text}) ORDER BY ${order("r")} LIMIT ?) page ON true ORDER BY ${order("page")}",args.result()++cursor.args++List(query.limit+1))
  }
  private def row(r: ResultSet): ArchiveRow = {
    val id=r.getObject("id",classOf[UUID])
    val indexed=Option(r.getObject("indexed_revision",classOf[java.lang.Integer])).map(_.intValue)
    val head=SessionInfo(ContentView(r.getInt("revision"),None),id,r.getString("owner"),r.getInt("revision"),indexed,Wire.decode(Metadata.codecJson,Sql.json(r,"metadata")),Wire.decode(SourceIdentity.codecJson,Sql.json(r,"source")),Completion.parse(r.getString("completion")).get,r.getBoolean("redacted"))
    val published=Option(r.getObject("generation",classOf[UUID])).map(generation => ContentView(indexed.get,generationId=Some(generation)))
    val matched=Option(r.getObject("matched_revision",classOf[java.lang.Integer])).map(revision => ContentView(revision.intValue,Option(r.getObject("matched_generation",classOf[UUID]))))
    val job=Option(r.getObject("job_id",classOf[UUID])).map(jobId => JobInfo(jobId,id,head.revision,JobState.parse(r.getString("job_state")).get,r.getInt("job_attempts"),Option(r.getString("job_error")),r.getInt("completed_windows"),Option(r.getObject("total_windows",classOf[java.lang.Integer])).map(_.intValue),Option(r.getString("failure_stage")).map(IndexingFailureStage.parse(_).getOrElse(throw DomainError("internal","invalid persisted failure stage")))))
    val tags=Sql.json(r,"tag_values").as[List[String]].getOrElse(throw DomainError("projection","invalid projected tags"))
    val format=Option(r.getString("published_format")).map(value => PassageFormat.parse(value).getOrElse(throw DomainError("projection","invalid published passage format")))
    ArchiveRow(head,published,matched,Option(r.getString("last_timestamp")),r.getInt("message_count"),tags,job,format)
  }
  def browse(reader: String,query: ArchiveQuery,parsed: ParsedArchiveExpression,vectors: List[ArchiveVector]): ArchiveResult = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    execute(c,reader,query,parsed,vectors,None)._1
  }
  def sourceSearch(reader: String,query: ArchiveQuery,parsed: ParsedArchiveExpression,vectors: List[ArchiveVector],materialization: ReadMaterialization): ArchiveSearchResult = {
    ArchiveSearchPolicy.page(query.limit)
    val bounded=ArchiveSearchPolicy.materialization(materialization)
    try db.transaction { c =>
      c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
      Sql.exec(c,"SELECT set_config('statement_timeout',least(coalesce(nullif(setting::bigint,0),?),?)::text,true) FROM pg_settings WHERE name='statement_timeout'",ArchiveSearchPolicy.statementDeadlineMillis,ArchiveSearchPolicy.statementDeadlineMillis)
      val (page,selected)=execute(c,reader,query,parsed,vectors,Some(bounded))
      val evidence=selected.map { value =>
        ArchiveSearchEvidence(value.value.head.id,ArchiveSearchWitnesses.read(c,archive,reader,value.value,parsed,value.witnesses,bounded))
      }
      ArchiveSearchPolicy.result(ArchiveSearchResult(page,evidence))
    } catch {
      case error: SQLException if error.getSQLState=="57014" => throw DomainError("deadline","archive search statement deadline exceeded")
    }
  }
  private def execute(c: Connection,reader: String,query: ArchiveQuery,parsed: ParsedArchiveExpression,vectors: List[ArchiveVector],materialization: Option[ReadMaterialization]): (ArchiveResult,List[PageRow]) = {
    ArchivePaging.page(query.limit)
    val bounded=parsed.mode!=SearchMode.Lexical && parsed.textOperands.nonEmpty
    if(parsed.mode!=SearchMode.Semantic && parsed.textOperands.nonEmpty)
      ArchiveSearchPolicy.configureLexical(c)
    if(bounded) {
      IndexProfiles.semantic(c,reader,archive.visible,EmbeddingSpaceDescriptor.from(config.embedding))
      SearchPolicy.configure(c)
    }
    val ranked=relevanceOrdered(query,parsed)
    val position=ArchivePaging.decode(query,reader,ranked).map(resolve(c,reader,query,_,materialization))
    val sql=compile(reader,query,parsed,vectors,position,materialization.nonEmpty)
    def decode(r: ResultSet): (Long,Option[PageRow]) = {
      val result=Option(r.getObject("id",classOf[UUID])).map { _ =>
        val refs=if(materialization.isEmpty) Nil else ArchiveSearchWitnesses.decode(Sql.json(r,"witnesses"))
        PageRow(row(r),Option(r.getString("sort_value")),if(ranked) Some(r.getString("relevance_value")) else None,refs)
      }
      (r.getLong("total"),result)
    }
    val rows=materialization match {
      case None => Sql.rows(c,sql.text,sql.args*)(decode)
      case Some(admission) =>
        // Keep the page in a transaction-local relation so witnesses and the count come from the same ANN execution.
        Sql.exec(c,"CREATE TEMP TABLE ch_archive_search_page ON COMMIT DROP AS "+sql.text,sql.args*)
        val bytes=Sql.one(c,"SELECT coalesce(sum(octet_length(convert_to(to_jsonb(p)::text,'UTF8'))::numeric),0) FROM ch_archive_search_page p")(r => ReadSources.checked(r.getBigDecimal(1))).get
        admission.admit(bytes)
        Sql.rows(c,"SELECT * FROM ch_archive_search_page ORDER BY "+(if(ranked) "relevance DESC," else "")+"sort_key "+(if(ranked || query.direction==SortDirection.Desc) "DESC" else "ASC")+" NULLS LAST,id")(decode)
    }
    val page=rows.flatMap(_._2)
    val values=page.take(query.limit)
    val next=if(page.size>query.limit) values.lastOption.map { row =>
      row.relevanceScore match {
        case Some(score) => ArchivePaging.relevanceCursor(query,reader,score,row.key,row.value.head.id)
        case None => ArchivePaging.cursor(query,reader,row.key,row.value.head.id,row.value.head.view.revision)
      }
    } else None
    (ArchiveResult(values.map(_.value),rows.head._1,next,if(bounded) ArchiveTextScope.BoundedCandidateSets else ArchiveTextScope.ExactLexical,if(bounded) Some(SearchPolicy.candidatesPerLeg) else None,ranked),values)
  }
}

