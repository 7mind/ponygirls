package chronicle

import chronicle.api.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.sql.Connection
import java.time.{Clock,Instant}
import java.util.{Locale,UUID}

trait ExpressionHintIndex {
  def hints(reader: String,query: ExpressionHintQuery): ExpressionHintsResult
}
private[chronicle] final case class HintValues(observedAt: Instant,values: List[String],truncated: Boolean)
private[chronicle] trait ExpressionHintStore {
  def read(reader: String,target: ExpressionHintTarget,field: Option[HintField],prefix: String,limit: Int): HintValues
}

private[chronicle] object ExpressionHintVocabulary {
  private val archive=List(HintField.After,HintField.Before,HintField.Branch,HintField.Format,HintField.Mode,HintField.Model,HintField.Producer,HintField.Project,HintField.Status,HintField.Tag,HintField.Tags,HintField.User)
  def fields(target: ExpressionHintTarget): List[HintField] = target match {
    case _: ExpressionHintTarget.Archive => archive
    case _: ExpressionHintTarget.ActivityCollectors => List(HintField.After,HintField.Before,HintField.Collector,HintField.Freshness,HintField.Phase)
    case _: ExpressionHintTarget.ActivityJobs => (archive.filterNot(_==HintField.Mode)++List(HintField.Classification,HintField.Collector,HintField.Lease,HintField.Profile,HintField.Reason)).sortBy(_.name)
  }
  def fixed(target: ExpressionHintTarget,field: HintField): Option[List[String]] = field match {
    case HintField.Mode => Some(List("hybrid","lexical","semantic"))
    case HintField.Format => Some(List("claude","codex","pi"))
    case HintField.Status => Some(List("complete","failed","queued","running")++(if(target.isInstanceOf[ExpressionHintTarget.Archive]) List("unscheduled") else Nil))
    case HintField.Classification => Some(List("current","obsolete-profile","superseded-revision","superseded-revision-and-profile"))
    case HintField.Lease => Some(List("active","expired","inactive","unleased"))
    case HintField.Phase => Some(List("discovering","failed","idle","scanning","uploading"))
    case HintField.Freshness => Some(List("recent","stale","unknown"))
    case _ => None
  }
  def literal(value: String): Option[String] = {
    if(value.isEmpty || value.contains('\u0000') || !UTF_8.newEncoder().canEncode(value) || value.getBytes(UTF_8).length>ExpressionHintBounds.literalBytes) None
    else {
      val quoted=new java.lang.StringBuilder("\"")
      value.codePoints().forEach { point => point match {
        case '"' => quoted.append("\\\"")
        case '\\' => quoted.append("\\\\")
        case control if Character.isISOControl(control) => quoted.append(f"\\u$control%04x")
        case scalar => quoted.appendCodePoint(scalar)
      }}
      Some(quoted.append('"').toString)
    }
  }
}

private[chronicle] final class CorpusExpressionHintIndex(store: ExpressionHintStore) extends ExpressionHintIndex {
  private val envelopeId=new UUID(0,0)
  private def matching(value: String,prefix: String): Boolean = value.toLowerCase(Locale.ROOT).startsWith(prefix.toLowerCase(Locale.ROOT))
  private def hint(kind: ExpressionHintKind,label: String,insertion: String): ExpressionHint = ExpressionHint(kind,label,insertion,insertion.length)
  private def encodedBytes(result: ExpressionHintsResult): Int = Wire.encode(ServerEnvelope.codecJson,ServerEnvelope(envelopeId,Result.ExpressionHints(result))).noSpaces.getBytes(UTF_8).length
  def hints(reader: String,query: ExpressionHintQuery): ExpressionHintsResult = {
    Check(query.limit>=1 && query.limit<=ExpressionHintBounds.maximumHints,"invalid","invalid hint limit")
    val context=ExpressionHintContext.read(query.expression,query.caretUtf16)
    Check(context.start>=0 && context.start<=query.caretUtf16 && query.caretUtf16<=context.end && context.end<=query.expression.length && UTF_8.newEncoder().canEncode(query.expression.substring(0,context.start)) && UTF_8.newEncoder().canEncode(query.expression.substring(0,context.end)),"internal","invalid hint replacement range")
    val fields=ExpressionHintVocabulary.fields(query.target)
    val selected=context.focus match {
      case HintFocus.Value(Some(field),Some(prefix),mode) if fields.contains(field) && (field!=HintField.Mode || mode) => Some((field,prefix))
      case _ => None
    }
    val dynamic=selected.filter { case (field,_) => ExpressionHintVocabulary.fixed(query.target,field).isEmpty }
    val corpus=store.read(reader,query.target,dynamic.map(_._1),dynamic.fold("")(_._2),query.limit+1)
    Check(corpus.values.size<=query.limit+1,"internal","hint candidate count exceeded")
    var omitted=corpus.truncated
    val candidates=context.focus match {
      case HintFocus.Field(prefix,binary,mode) =>
        val names=fields.filter(field => (field!=HintField.Mode || mode) && matching(field.name,prefix)).map(field => hint(ExpressionHintKind.Field,field.name,field.name+":"))
        val operators=(if(binary) List("AND","NOT","OR") else List("NOT")).filter(matching(_,prefix)).map(value => hint(ExpressionHintKind.Operator,value,value))
        (names++operators).sortBy(value => (value.label,value.kind.toString))
      case _: HintFocus.Value => selected.toList.flatMap { case (field,prefix) =>
        val values=ExpressionHintVocabulary.fixed(query.target,field).fold(corpus.values)(_.filter(matching(_,prefix)))
        values.flatMap { value => ExpressionHintVocabulary.literal(value) match {
          case Some(insertion) => Some(hint(ExpressionHintKind.Value,value,insertion))
          case None => omitted=true; None
        }}
      }
      case HintFocus.Unavailable => Nil
    }
    val hash=Wire.hash(Json.arr(Json.fromString(reader),Wire.encode(ExpressionHintQuery.codecJson,query)).noSpaces)
    var result=ExpressionHintsResult(hash,corpus.observedAt.toString,context.start,context.end,Nil,omitted || candidates.size>query.limit)
    val outsideBytes=query.expression.substring(0,context.start).getBytes(UTF_8).length+query.expression.substring(context.end).getBytes(UTF_8).length
    candidates.take(query.limit).foreach { candidate =>
      val next=result.copy(hints=result.hints:+candidate)
      if(outsideBytes+candidate.insertText.getBytes(UTF_8).length<=ExpressionHintBounds.expressionBytes && encodedBytes(next)<=ExpressionHintBounds.responseBytes) result=next
      else result=result.copy(truncated=true)
    }
    Check(encodedBytes(result)<=ExpressionHintBounds.responseBytes,"internal","hint response bound exceeded")
    result
  }
}

final class PostgresExpressionHintIndex(db: Database,archive: PostgresArchive,clock: Clock) extends ExpressionHintIndex {
  private val index=new CorpusExpressionHintIndex(new PostgresExpressionHintStore(db,archive,clock))
  def hints(reader: String,query: ExpressionHintQuery): ExpressionHintsResult = index.hints(reader,query)
}
private[chronicle] final class PostgresExpressionHintStore(db: Database,archive: PostgresArchive,clock: Clock) extends ExpressionHintStore {
  private val unicode="COLLATE pg_unicode_fast"
  private val statementMillis=5000
  private def archiveValues(reader: String,field: HintField): ActivitySql = {
    val heads=s"""WITH hint_heads AS MATERIALIZED(SELECT s.owner,s.published,i.metadata,i.source,i.last_timestamp
      FROM ch_sources s JOIN ch_revision_info i ON i.session_id=s.id AND i.revision=s.revision WHERE ${archive.visible})"""
    val scalar=field match {
      case HintField.User => "owner"
      case HintField.Project => "metadata->>'project'"
      case HintField.Branch => "metadata->>'gitBranch'"
      case HintField.Producer => "metadata->>'producer'"
      case HintField.Model => "metadata->>'model'"
      case HintField.After | HintField.Before => "last_timestamp"
      case HintField.Tag | HintField.Tags => "jsonb_array_elements_text(metadata->'tags')"
      case _ => throw DomainError("internal","unsupported archive hint field")
    }
    val tags=if(field==HintField.Tag || field==HintField.Tags) " UNION ALL SELECT tag AS value FROM hint_heads h JOIN ch_generation_tags t ON t.generation=h.published" else ""
    ActivitySql(heads+s", hint_universe AS (SELECT $scalar AS value FROM hint_heads$tags)",List(reader,reader,reader))
  }
  private def activityValues(reader: String,now: Instant,target: ExpressionHintTarget,field: HintField): ActivitySql = {
    val universe=target match {
      case _: ExpressionHintTarget.ActivityCollectors => field match {
        case HintField.Collector => "SELECT collector_id AS value FROM collectors"
        case HintField.After | HintField.Before => "SELECT to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS value FROM reports"
        case _ => throw DomainError("internal","unsupported collector hint field")
      }
      case ExpressionHintTarget.ActivityJobs(scope,collectorId) =>
        val condition=scope match {
          case ActivityJobScope.Current => "j.is_current"
          case ActivityJobScope.Historical => "NOT j.is_current"
          case ActivityJobScope.All => "true"
        }
        val scalar=field match {
          case HintField.User => "j.owner"
          case HintField.Project => "i.metadata->>'project'"
          case HintField.Branch => "i.metadata->>'gitBranch'"
          case HintField.Producer => "i.metadata->>'producer'"
          case HintField.Model => "i.metadata->>'model'"
          case HintField.Tag | HintField.Tags => "jsonb_array_elements_text(i.metadata->'tags')"
          case HintField.After | HintField.Before => "i.last_timestamp"
          case HintField.Collector => "j.collector_id"
          case HintField.Profile => "j.profile"
          case HintField.Reason => "j.error"
          case _ => throw DomainError("internal","unsupported job hint field")
        }
        s"SELECT $scalar AS value FROM jobs j JOIN ch_revision_info i ON i.session_id=j.session_id AND i.revision=j.revision WHERE $condition"+(if(collectorId.nonEmpty) " AND j.collector_id=?" else "")
      case _ => throw DomainError("internal","unsupported activity hint target")
    }
    val extra=target match { case ExpressionHintTarget.ActivityJobs(_,collector) => collector.toList; case _ => Nil }
    ActivitySql(ActivityMetadataCorpus.base+s", hint_universe AS ($universe)",ActivityMetadataCorpus.parameters(reader,now)++extra)
  }
  def read(reader: String,target: ExpressionHintTarget,field: Option[HintField],prefix: String,limit: Int): HintValues = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    Sql.exec(c,"SELECT set_config('statement_timeout',?,true)",statementMillis.toString)
    Check(Sql.one(c,"SELECT 1 FROM ch_users WHERE id=? AND enabled",reader)(_ => true).contains(true),"unauthorized","reader disabled")
    val now=clock.instant()
    field match {
      case None => HintValues(now,Nil,false)
      case Some(selected) =>
        val source=target match {
          case _: ExpressionHintTarget.Archive => archiveValues(reader,selected)
          case _ => activityValues(reader,now,target,selected)
        }
        val ctes=source.text+s""", hint_distinct AS MATERIALIZED(SELECT DISTINCT value COLLATE "C" AS value FROM hint_universe
          WHERE value IS NOT NULL AND starts_with(lower(value $unicode),lower(? $unicode))),
          hint_candidates AS MATERIALIZED(SELECT value FROM hint_distinct WHERE octet_length(value) BETWEEN 1 AND ${ExpressionHintBounds.literalBytes}
            ORDER BY lower(value $unicode) COLLATE "C",value COLLATE "C" LIMIT ?)"""
        val arguments=source.args++List[Sql.Param](prefix,limit)
        val (count,bytes,omitted)=Sql.one(c,ctes+s""" SELECT count(*)::int,COALESCE(max(octet_length(value)),0),
          EXISTS(SELECT 1 FROM hint_distinct WHERE octet_length(value)>${ExpressionHintBounds.literalBytes} OR value='') FROM hint_candidates""",arguments*)(r => (r.getInt(1),r.getInt(2),r.getBoolean(3))).get
        Check(count<=limit && bytes<=ExpressionHintBounds.literalBytes,"internal","hint preflight bound exceeded")
        val values=if(count==0) Nil else Sql.rows(c,ctes+s" SELECT value FROM hint_candidates ORDER BY lower(value $unicode) COLLATE \"C\",value COLLATE \"C\"",arguments*)(_.getString(1))
        Check(values.size==count && values.forall(_.getBytes(UTF_8).length<=bytes),"internal","hint preflight changed")
        HintValues(now,values,omitted)
    }
  }
}
