package chronicle

import chronicle.api.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.sql.{Connection,ResultSet}
import java.util.{Base64,UUID}
import scala.util.Try

final case class ArchiveVector(operand: String,values: List[Double])
trait ArchiveIndex {
  def browse(reader: String,query: ArchiveQuery,parsed: ParsedArchiveExpression,vectors: List[ArchiveVector]): ArchiveResult
}
private[chronicle] final case class ArchiveSql(text: String,args: List[Sql.Param])
private[chronicle] final case class ArchiveCursor(query: String,sort: String,direction: String,owner: String,last: Option[String],id: UUID)
object ArchivePaging {
  def page(limit: Int): Unit = Check(limit >= 1 && limit <= 100,"invalid","invalid page bounds")
  def cursor(query: ArchiveQuery,owner: String,value: Option[String],id: UUID): String = {
    val json=Json.obj("query"->Json.fromString(Wire.hash(query.expression)),"owner"->Json.fromString(owner),"sort"->Json.fromString(query.sort.toString),"direction"->Json.fromString(query.direction.toString),"last"->value.fold(Json.Null)(Json.fromString),"id"->Json.fromString(id.toString))
    Base64.getUrlEncoder.withoutPadding.encodeToString(json.noSpaces.getBytes(UTF_8))
  }
  def decode(query: ArchiveQuery,owner: String): Option[ArchiveCursor] = query.cursor.map { value =>
    val parsed=Try {
      val c=Wire.parse(new String(Base64.getUrlDecoder.decode(value),UTF_8)).hcursor
      ArchiveCursor(c.get[String]("query").toTry.get,c.get[String]("sort").toTry.get,c.get[String]("direction").toTry.get,c.get[String]("owner").toTry.get,c.get[Option[String]]("last").toTry.get,UUID.fromString(c.get[String]("id").toTry.get))
    }.getOrElse(throw DomainError("invalid","invalid archive cursor"))
    Check(parsed.owner==owner && parsed.query==Wire.hash(query.expression) && parsed.sort==query.sort.toString && parsed.direction==query.direction.toString,"invalid","cursor belongs to a different archive query")
    parsed
  }
}
final class PostgresArchiveIndex(db: Database,archive: PostgresArchive,config: Config) extends ArchiveIndex {
  import ArchiveExpression.*
  private val unicode = "COLLATE \"pg_unicode_fast\""
  private val columns = "c.*"
  private def literal(value: String): String = "%"+value.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%"
  private def insensitive(column: String,value: String): ArchiveSql = ArchiveSql(s"COALESCE(lower(($column) $unicode)=lower(? $unicode),false)",List(value))
  private def predicate(value: ArchivePredicate): ArchiveSql = value match {
    case ArchivePredicate.User(user) => ArchiveSql("c.owner=?",List(user))
    case ArchivePredicate.Tag(tag) => ArchiveSql(s"EXISTS(SELECT 1 FROM unnest(c.tags) item(tag) WHERE lower(item.tag $unicode)=lower(? $unicode))",List(tag))
    case ArchivePredicate.Project(project) => insensitive("c.metadata->>'project'",project)
    case ArchivePredicate.Branch(branch) => insensitive("c.metadata->>'gitBranch'",branch)
    case ArchivePredicate.Producer(producer) => insensitive("c.metadata->>'producer'",producer)
    case ArchivePredicate.Model(model) => insensitive("c.metadata->>'model'",model)
    case ArchivePredicate.Format(format) => insensitive("c.source->>'format'",format.toString)
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
  private def positive(value: ArchiveExpression,negated: Boolean): List[String] = value match {
    case Text(text) => if(negated) Nil else List(text)
    case And(left,right) => positive(left,negated)++positive(right,negated)
    case Or(left,right) => positive(left,negated)++positive(right,negated)
    case Not(nested) => positive(nested,!negated)
    case _ => Nil
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
        if(numeric) Check(Try(new java.math.BigDecimal(last)).isSuccess,"invalid","invalid numeric archive cursor")
        val cast=if(numeric) "::numeric" else ""
        val comparison=if(direction==SortDirection.Asc) ">" else "<"
        ArchiveSql(s"(r.sort_key $comparison ?$cast OR (r.sort_key=?$cast AND r.id>?) OR r.sort_key IS NULL)",List(last,last,value.id))
    }
  }
  private[chronicle] def statement(reader: String,query: ArchiveQuery,parsed: ParsedArchiveExpression,vectors: List[ArchiveVector]): ArchiveSql = {
    val corpus=s"""corpus AS MATERIALIZED(SELECT s.id,s.owner,s.revision,s.published,i.metadata,i.source,i.completion,i.redacted,i.last_timestamp,i.last_timestamp_order,i.message_count,g.revision AS indexed_revision,g.id AS generation,
      j.id AS job_id,j.state AS job_state,j.attempts AS job_attempts,j.error AS job_error,j.completed_windows,j.total_windows,
      ARRAY(SELECT tag FROM (SELECT jsonb_array_elements_text(i.metadata->'tags') AS tag UNION SELECT tag FROM ch_generation_tags WHERE generation=s.published) tag_values ORDER BY lower(tag $unicode),tag) AS tags
      FROM ch_sources s JOIN ch_revision_info i ON i.session_id=s.id AND i.revision=s.revision
      JOIN ch_profile profile ON profile.singleton LEFT JOIN ch_generations g ON g.id=s.published
      LEFT JOIN ch_jobs j ON j.session_id=s.id AND j.revision=s.revision AND j.profile=profile.target WHERE ${archive.visible})"""
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
        ctes+=s"a$index AS MATERIALIZED(SELECT ch.session_id,ch.revision,ch.generation FROM ch_search_chunks ch WHERE vector_dims(ch.embedding)=$dimensions AND ch.profile=? AND (SELECT true FROM corpus c WHERE c.id=ch.session_id AND c.published=ch.generation AND (${restrictions.text}) OFFSET 0) ORDER BY l2_normalize(ch.embedding)::halfvec($dimensions) <=> l2_normalize(?::vector)::halfvec($dimensions) LIMIT ${SearchPolicy.candidatesPerLeg})"
        args+=config.profile; args++=restrictions.args; args+=SearchPolicy.vector(vector.values,config)
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
    val cursor=seek(ArchivePaging.decode(query,reader),numeric,query.direction)
    val direction=if(query.direction==SortDirection.Asc) "ASC" else "DESC"
    ArchiveSql("WITH "+ctes.result().mkString(",")+s" SELECT counted.total,page.*,page.sort_key::text AS sort_value FROM (SELECT count(*) AS total FROM matched) counted LEFT JOIN LATERAL(SELECT r.* FROM matched r WHERE (${cursor.text}) ORDER BY r.sort_key $direction NULLS LAST,r.id LIMIT ?) page ON true ORDER BY page.sort_key $direction NULLS LAST,page.id",args.result()++cursor.args++List(query.limit+1))
  }
  private def row(r: ResultSet): ArchiveRow = {
    val id=r.getObject("id",classOf[UUID])
    val indexed=Option(r.getObject("indexed_revision",classOf[java.lang.Integer])).map(_.intValue)
    val head=SessionInfo(ContentView(r.getInt("revision"),None),id,r.getString("owner"),r.getInt("revision"),indexed,Wire.decode(Metadata.codecJson,Sql.json(r,"metadata")),Wire.decode(SourceIdentity.codecJson,Sql.json(r,"source")),Completion.parse(r.getString("completion")).get,r.getBoolean("redacted"))
    val published=Option(r.getObject("generation",classOf[UUID])).map(generation => ContentView(indexed.get,generationId=Some(generation)))
    val matched=Option(r.getObject("matched_revision",classOf[java.lang.Integer])).map(revision => ContentView(revision.intValue,Option(r.getObject("matched_generation",classOf[UUID]))))
    val job=Option(r.getObject("job_id",classOf[UUID])).map(jobId => JobInfo(jobId,id,head.revision,JobState.parse(r.getString("job_state")).get,r.getInt("job_attempts"),Option(r.getString("job_error")),r.getInt("completed_windows"),Option(r.getObject("total_windows",classOf[java.lang.Integer])).map(_.intValue)))
    val tags=Sql.json(r,"tag_values").as[List[String]].getOrElse(throw DomainError("projection","invalid projected tags"))
    ArchiveRow(head,published,matched,Option(r.getString("last_timestamp")),r.getInt("message_count"),tags,job)
  }
  def browse(reader: String,query: ArchiveQuery,parsed: ParsedArchiveExpression,vectors: List[ArchiveVector]): ArchiveResult = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    ArchivePaging.page(query.limit)
    val bounded=parsed.mode!=SearchMode.Lexical && parsed.textOperands.nonEmpty
    if(bounded) {
      Check(Sql.one(c,"SELECT 1 FROM ch_profile WHERE NOT maintenance AND active=?",config.profile)(_ => true).contains(true),"unavailable","semantic profile requires maintenance reindex")
      SearchPolicy.configure(c)
    }
    val sql=statement(reader,query,parsed,vectors)
    val rows=Sql.rows(c,sql.text,sql.args*) { r =>
      val result=Option(r.getObject("id",classOf[UUID])).map(_ => (row(r),Option(r.getString("sort_value"))))
      (r.getLong("total"),result)
    }
    val page=rows.flatMap(_._2)
    val values=page.take(query.limit)
    val next=if(page.size>query.limit) values.lastOption.map { case (value,key) => ArchivePaging.cursor(query,reader,key,value.head.id) } else None
    ArchiveResult(values.map(_._1),rows.head._1,next,if(bounded) ArchiveTextScope.BoundedCandidateSets else ArchiveTextScope.ExactLexical,if(bounded) Some(SearchPolicy.candidatesPerLeg) else None)
  }
}
