package chronicle

import chronicle.api.*
import io.circe.Json
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets.UTF_8
import java.sql.{Connection,ResultSet}
import java.util.{Base64,UUID}
import scala.util.Try

final case class ArchiveVector(operand: String,values: List[Double])
trait ArchiveIndex {
  def browse(reader: String,query: ArchiveQuery,parsed: ParsedArchiveExpression,vectors: List[ArchiveVector]): ArchiveResult
}
private[chronicle] final case class ArchiveSql(text: String,args: List[Sql.Param])
private[chronicle] final case class ArchiveCursor(query: String,sort: String,direction: String,owner: String,last: Option[String],id: UUID,anchor: Option[RevisionSortAnchor],relevanceScore: Option[String])
object ArchivePaging {
  private val cursorVersion=2
  private val relevanceCursorVersion=3
  private val maximumScoreScale=40
  private def validScore(value: String): Boolean = value.matches(s"0(\\.[0-9]{1,$maximumScoreScale})?")
  private[chronicle] def referenced(sort: ArchiveSort): Boolean = sort match {
    case ArchiveSort.Title | ArchiveSort.Owner | ArchiveSort.Project | ArchiveSort.Branch | ArchiveSort.Producer | ArchiveSort.Model => true
    case _ => false
  }
  def page(limit: Int): Unit = Check(limit >= 1 && limit <= 100,"invalid","invalid page bounds")
  def cursor(query: ArchiveQuery,owner: String,value: Option[String],id: UUID,revision: Int): String = {
    val last=if(referenced(query.sort) && value.nonEmpty) RevisionSortAnchor.encode(RevisionSortAnchor.capture(revision,value)) else value.fold(Json.Null)(Json.fromString)
    val json=Json.obj("version"->Json.fromInt(cursorVersion),"query"->Json.fromString(Wire.hash(query.expression)),"owner"->Json.fromString(Wire.hash(owner)),"sort"->Json.fromString(query.sort.toString),"direction"->Json.fromString(query.direction.toString),"last"->last,"id"->Json.fromString(id.toString))
    Base64.getUrlEncoder.withoutPadding.encodeToString(json.noSpaces.getBytes(UTF_8))
  }
  def relevanceCursor(query: ArchiveQuery,owner: String,score: String,timestamp: Option[String],id: UUID): String = {
    Check(validScore(score),"internal","invalid ranked archive score")
    val last=Json.arr(Json.fromString(score),timestamp.fold(Json.Null)(Json.fromString))
    val json=Json.obj("version"->Json.fromInt(relevanceCursorVersion),"query"->Json.fromString(Wire.hash(query.expression)),"owner"->Json.fromString(Wire.hash(owner)),"sort"->Json.fromString(query.sort.toString),"direction"->Json.fromString(query.direction.toString),"last"->last,"id"->Json.fromString(id.toString))
    Base64.getUrlEncoder.withoutPadding.encodeToString(json.noSpaces.getBytes(UTF_8))
  }
  def decode(query: ArchiveQuery,owner: String,relevanceOrdered: Boolean): Option[ArchiveCursor] = query.cursor.map { value =>
    val parsed=Try {
      val text=UTF_8.newDecoder().decode(ByteBuffer.wrap(Base64.getUrlDecoder.decode(value))).toString
      val c=Wire.parse(text).hcursor
      val expectedVersion=if(relevanceOrdered) relevanceCursorVersion else cursorVersion
      Check(c.get[Int]("version").toTry.get==expectedVersion,"invalid","invalid archive cursor version")
      val selected=c.get[Json]("last").toTry.get
      val (score,position)=if(relevanceOrdered) {
        val parts=selected.asArray.getOrElse(throw DomainError("invalid","invalid ranked archive cursor"))
        Check(parts.size==2,"invalid","invalid ranked archive cursor")
        val score=parts.head.asString.getOrElse(throw DomainError("invalid","invalid ranked archive score"))
        Check(validScore(score),"invalid","invalid ranked archive score")
        (Some(score),parts(1))
      } else (None,selected)
      val anchor=if(!relevanceOrdered && referenced(query.sort) && !position.isNull) Some(RevisionSortAnchor.decode(position)) else None
      val last=if(position.isNull || anchor.nonEmpty) None else Some(position.asString.getOrElse(throw DomainError("invalid","invalid archive cursor value")))
      if(relevanceOrdered) last.foreach(v => Check(v.matches("-?[0-9]{1,19}(\\.[0-9]{1,9})?"),"invalid","invalid numeric archive cursor"))
      val id=c.get[String]("id").toTry.get
      val uuid=UUID.fromString(id)
      Check(uuid.toString==id,"invalid","invalid archive cursor ID")
      last.foreach(v => Check(!v.contains('\u0000') && UTF_8.newEncoder().canEncode(v),"invalid","invalid archive cursor value"))
      ArchiveCursor(c.get[String]("query").toTry.get,c.get[String]("sort").toTry.get,c.get[String]("direction").toTry.get,c.get[String]("owner").toTry.get,last,uuid,anchor,score)
    }.getOrElse(throw DomainError("invalid","invalid archive cursor"))
    Check(parsed.owner==Wire.hash(owner) && parsed.query==Wire.hash(query.expression) && parsed.sort==query.sort.toString && parsed.direction==query.direction.toString,"invalid","cursor belongs to a different archive query")
    parsed
  }
}
final class PostgresArchiveIndex(db: Database,archive: PostgresArchive,config: Config) extends ArchiveIndex {
  import ArchiveExpression.*
  private val unicode = "COLLATE \"pg_unicode_fast\""
  private val columns = "c.*"
  private final case class PageRow(value: ArchiveRow,key: Option[String],relevanceScore: Option[String])
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
  private def resolve(c: Connection,reader: String,query: ArchiveQuery,position: ArchiveCursor): ArchiveCursor = position.anchor match {
    case None => position
    case Some(anchor) =>
      val expression=sort(query)._1
      val key=Sql.one(c,s"""SELECT $expression FROM (
        SELECT s.owner,i.metadata FROM ch_sources s
        JOIN ch_revision_info i ON i.session_id=s.id AND i.revision=?
        WHERE s.id=? AND ${archive.visible}) c""",anchor.revision,position.id,reader,reader,reader)(r => Option(r.getString(1)))
        .getOrElse(throw DomainError("conflict","sort cursor anchor unavailable; restart query"))
      position.copy(last=RevisionSortAnchor.resolve(anchor,key),anchor=None)
  }
  private[chronicle] def statement(reader: String,query: ArchiveQuery,parsed: ParsedArchiveExpression,vectors: List[ArchiveVector],position: Option[ArchiveCursor]): ArchiveSql =
    if(relevanceOrdered(query,parsed)) rankedStatement(reader,query,parsed,vectors,position) else columnStatement(reader,query,parsed,vectors,position)

  private def rankedStatement(reader: String,query: ArchiveQuery,parsed: ParsedArchiveExpression,vectors: List[ArchiveVector],position: Option[ArchiveCursor]): ArchiveSql = {
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
        ctes+=s"l$index AS MATERIALIZED(SELECT c.id FROM corpus c WHERE EXISTS(SELECT 1 FROM ch_archive_fragments fragment WHERE fragment.session_id=c.id AND fragment.revision=c.revision AND lower(fragment.value $unicode) LIKE lower(? $unicode) ESCAPE '\\'))"
        args+=literal(operand)
      }
      if(semantic) {
        val dimensions=SearchPolicy.dimensions(config)
        val vector=vectors.find(_.operand==operand).getOrElse(throw DomainError("unavailable","query embedding unavailable"))
        val value=SearchPolicy.vector(vector.values,config)
        ctes+=s"a$index AS MATERIALIZED(SELECT ch.session_id,ch.revision,ch.generation,ch.embedding <=> ?::vector AS distance FROM ch_search_chunks ch WHERE vector_dims(ch.embedding)=$dimensions AND ${IndexProfiles.compatibleSql("ch.profile")} AND (SELECT true FROM corpus c WHERE c.id=ch.session_id AND c.published=ch.generation AND (${restrictions.text}) OFFSET 0) ORDER BY l2_normalize(ch.embedding)::halfvec($dimensions) <=> l2_normalize(?::vector)::halfvec($dimensions) LIMIT ${SearchPolicy.candidatesPerLeg})"
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
    val positives=positiveTextOperands(parsed).map(parsed.textOperands.indexOf)
    val terms=List.newBuilder[String]; terms+="0::numeric"
    val joins=List.newBuilder[String]
    positives.foreach { index =>
      if(lexical) terms+=s"CASE WHEN EXISTS(SELECT 1 FROM l$index WHERE id=c.id) THEN 1::numeric/(${SearchPolicy.reciprocalRankConstant}+1) ELSE 0 END"
      if(semantic) {
        ctes+=s"r$index AS MATERIALIZED(SELECT session_id,rank() OVER(ORDER BY nearest) AS rank FROM (SELECT session_id,min(distance) AS nearest FROM a$index GROUP BY session_id) nearest_session)"
        joins+=s"LEFT JOIN r$index ON r$index.session_id=c.id"
        terms+=s"COALESCE(1::numeric/(${SearchPolicy.reciprocalRankConstant}+r$index.rank),0)"
      }
    }
    def any(prefix: String,column: String,enabled: Boolean): String = if(enabled) positives.map(i => s"EXISTS(SELECT 1 FROM $prefix$i WHERE $column=c.id)").mkString("("," OR ",")") else "false"
    val lexicalMatch=any("l","id",lexical)
    val semanticMatch=any("a","session_id",semantic)
    val score=terms.result().mkString("+")
    ctes+=s"matched AS MATERIALIZED(SELECT $columns,to_json(c.tags) AS tag_values,c.last_timestamp_order AS sort_key,($score) AS relevance,CASE WHEN $lexicalMatch THEN c.revision WHEN $semanticMatch THEN c.indexed_revision END AS matched_revision,CASE WHEN NOT $lexicalMatch AND $semanticMatch THEN c.generation END AS matched_generation FROM corpus c ${joins.result().mkString(" ")} WHERE (${compiled.text}))"
    args++=compiled.args
    val cursor=seekRelevance(position)
    ArchiveSql("WITH "+ctes.result().mkString(",")+s" SELECT counted.total,page.*,page.sort_key::text AS sort_value,page.relevance::text AS relevance_value FROM (SELECT count(*) AS total FROM matched) counted LEFT JOIN LATERAL(SELECT r.* FROM matched r WHERE (${cursor.text}) ORDER BY r.relevance DESC,r.sort_key DESC NULLS LAST,r.id LIMIT ?) page ON true ORDER BY page.relevance DESC,page.sort_key DESC NULLS LAST,page.id",args.result()++cursor.args++List(query.limit+1))
  }

  private def columnStatement(reader: String,query: ArchiveQuery,parsed: ParsedArchiveExpression,vectors: List[ArchiveVector],position: Option[ArchiveCursor]): ArchiveSql = {
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
        ctes+=s"l$index AS MATERIALIZED(SELECT c.id FROM corpus c WHERE EXISTS(SELECT 1 FROM ch_archive_fragments fragment WHERE fragment.session_id=c.id AND fragment.revision=c.revision AND lower(fragment.value $unicode) LIKE lower(? $unicode) ESCAPE '\\'))"
        args+=literal(operand)
      }
      if(semantic) {
        val dimensions=SearchPolicy.dimensions(config)
        val vector=vectors.find(_.operand==operand).getOrElse(throw DomainError("unavailable","query embedding unavailable"))
        ctes+=s"a$index AS MATERIALIZED(SELECT ch.session_id,ch.revision,ch.generation FROM ch_search_chunks ch WHERE vector_dims(ch.embedding)=$dimensions AND ${IndexProfiles.compatibleSql("ch.profile")} AND (SELECT true FROM corpus c WHERE c.id=ch.session_id AND c.published=ch.generation AND (${restrictions.text}) OFFSET 0) ORDER BY l2_normalize(ch.embedding)::halfvec($dimensions) <=> l2_normalize(?::vector)::halfvec($dimensions) LIMIT ${SearchPolicy.candidatesPerLeg})"
        args+=EmbeddingSpaceDescriptor.from(config.embedding).id; args++=restrictions.args; args+=SearchPolicy.vector(vector.values,config)
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
    def any(prefix: String,column: String,enabled: Boolean): String = if(enabled && positives.nonEmpty) positives.map(i => s"EXISTS(SELECT 1 FROM $prefix$i WHERE $column=c.id)").mkString("("," OR ",")") else "false"
    val lexicalMatch=any("l","id",lexical)
    val semanticMatch=any("a","session_id",semantic)
    val (sortKey,numeric)=sort(query)
    ctes+=s"matched AS MATERIALIZED(SELECT $columns,to_json(c.tags) AS tag_values,$sortKey AS sort_key,CASE WHEN $lexicalMatch THEN c.revision WHEN $semanticMatch THEN c.indexed_revision END AS matched_revision,CASE WHEN NOT $lexicalMatch AND $semanticMatch THEN c.generation END AS matched_generation FROM corpus c WHERE (${compiled.text}))"
    args++=compiled.args
    val cursor=seek(position,numeric,query.direction)
    val direction=if(query.direction==SortDirection.Asc) "ASC" else "DESC"
    ArchiveSql("WITH "+ctes.result().mkString(",")+s" SELECT counted.total,page.*,page.sort_key::text AS sort_value FROM (SELECT count(*) AS total FROM matched) counted LEFT JOIN LATERAL(SELECT r.* FROM matched r WHERE (${cursor.text}) ORDER BY r.sort_key $direction NULLS LAST,r.id LIMIT ?) page ON true ORDER BY page.sort_key $direction NULLS LAST,page.id",args.result()++cursor.args++List(query.limit+1))
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
    ArchivePaging.page(query.limit)
    val bounded=parsed.mode!=SearchMode.Lexical && parsed.textOperands.nonEmpty
    if(bounded) {
      IndexProfiles.semantic(c,reader,archive.visible,EmbeddingSpaceDescriptor.from(config.embedding))
      SearchPolicy.configure(c)
    }
    val ranked=relevanceOrdered(query,parsed)
    val position=ArchivePaging.decode(query,reader,ranked).map(resolve(c,reader,query,_))
    val sql=statement(reader,query,parsed,vectors,position)
    val rows=Sql.rows(c,sql.text,sql.args*) { r =>
      val result=Option(r.getObject("id",classOf[UUID])).map(_ => PageRow(row(r),Option(r.getString("sort_value")),if(ranked) Some(r.getString("relevance_value")) else None))
      (r.getLong("total"),result)
    }
    val page=rows.flatMap(_._2)
    val values=page.take(query.limit)
    val next=if(page.size>query.limit) values.lastOption.map { row =>
      row.relevanceScore match {
        case Some(score) => ArchivePaging.relevanceCursor(query,reader,score,row.key,row.value.head.id)
        case None => ArchivePaging.cursor(query,reader,row.key,row.value.head.id,row.value.head.view.revision)
      }
    } else None
    ArchiveResult(values.map(_.value),rows.head._1,next,if(bounded) ArchiveTextScope.BoundedCandidateSets else ArchiveTextScope.ExactLexical,if(bounded) Some(SearchPolicy.candidatesPerLeg) else None,ranked)
  }
}
