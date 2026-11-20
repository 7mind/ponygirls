package chronicle

import chronicle.api.*
import io.circe.Json
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets.UTF_8
import java.security.{MessageDigest,SecureRandom}
import java.sql.{Connection,SQLException}
import java.util.{Base64,UUID}
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import scala.util.Try

trait MessageSearchReader {
  final def searchSessionMessages(reader: String,id: UUID,view: ContentView,literal: String,cursor: Option[String],limit: Int): SessionMessageSearchResult =
    searchSessionMessages(reader,id,view,literal,cursor,limit,ReadMaterialization.unrestricted)
  def searchSessionMessages(reader: String,id: UUID,view: ContentView,literal: String,cursor: Option[String],limit: Int,materialization: ReadMaterialization): SessionMessageSearchResult
}
object SessionMessageSearchPolicy {
  val maximumQueryBytes=2048
  val maximumCursorBytes=4096
  val maximumPageSize=100
  val maximumLocatorBytes=64*1024
  val statementDeadlineMillis=5000
  /** Find in a current epoch scans under this limit first, then verifies the candidates of the epoch's trigram index. */
  val scanDeadlineMillis=1000
  val matchingPolicy="normalized-message-text/pg-lower-strpos/v1"
  def validate(literal: String,cursor: Option[String],limit: Int): Unit = {
    Check(literal.nonEmpty && literal.length<=maximumQueryBytes && UTF_8.newEncoder().canEncode(literal) && literal.getBytes(UTF_8).length<=maximumQueryBytes,"invalid","invalid message search literal")
    Check(limit>=1 && limit<=maximumPageSize,"invalid","invalid message search page bounds")
    cursor.foreach(value => Check(value.nonEmpty && value.length<=maximumCursorBytes && UTF_8.newEncoder().canEncode(value) && value.getBytes(UTF_8).length<=maximumCursorBytes,"invalid","invalid message search cursor"))
  }
  def locatorBytes(bytes: Long): Unit = Check(bytes>=0 && bytes<=maximumLocatorBytes,"read-budget","message search locator budget exceeded")
}
/** Stable per reader instance, not per request. Restart invalidates cursors; cursors never grant authorization. */
private[chronicle] final class MessageSearchCursors {
  private val key = {
    val bytes=new Array[Byte](32); new SecureRandom().nextBytes(bytes); new SecretKeySpec(bytes,"HmacSHA256")
  }
  private val encoder=Base64.getUrlEncoder.withoutPadding
  private def signature(payload: String): Array[Byte] = {
    val mac=Mac.getInstance("HmacSHA256"); mac.init(key); mac.doFinal(payload.getBytes(UTF_8))
  }
  private def binding(reader: String,id: UUID,view: ContentView,literal: String): Vector[Json] =
    Vector("session-message-search-v1",Wire.hash(reader),id.toString,view.revision.toString,view.generationId.fold("")(_.toString),SessionMessageSearchPolicy.matchingPolicy,Wire.hash(literal)).map(Json.fromString)
  def encode(reader: String,id: UUID,view: ContentView,literal: String,position: Int): String = {
    val payload=encoder.encodeToString(Json.fromValues(binding(reader,id,view,literal):+Json.fromInt(position)).noSpaces.getBytes(UTF_8))
    payload+"."+encoder.encodeToString(signature(payload))
  }
  def decode(reader: String,id: UUID,view: ContentView,literal: String,cursor: Option[String]): Int = cursor.fold(-1) { value =>
    Try {
      val parts=value.split("\\.",-1)
      Check(parts.length==2,"invalid","invalid message search cursor")
      val sig=Base64.getUrlDecoder.decode(parts(1))
      Check(encoder.encodeToString(sig)==parts(1) && MessageDigest.isEqual(signature(parts(0)),sig),"invalid","invalid message search cursor")
      val bytes=Base64.getUrlDecoder.decode(parts(0))
      Check(encoder.encodeToString(bytes)==parts(0),"invalid","invalid message search cursor")
      val text=UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString
      val fields=Wire.parse(text).asArray.get
      val expected=binding(reader,id,view,literal)
      Check(fields.size==expected.size+1 && fields.take(expected.size)==expected,"invalid","cursor belongs to a different message search")
      val position=fields.last.asNumber.flatMap(_.toInt).get
      Check(position>=0,"invalid","invalid message search cursor position")
      position
    }.getOrElse(throw DomainError("invalid","invalid message search cursor"))
  }
}
/** `scanDeadlineMillis`: the limit of the first phase of Find in a current epoch (SessionMessageSearchPolicy). */
private[chronicle] final class PostgresMessageSearch(db: Database,archive: PostgresArchive,cursors: MessageSearchCursors,val scanDeadlineMillis: Int) extends MessageSearchReader {
  private def deadline(c: Connection,millis: Int): Unit =
    Sql.exec(c,"SELECT set_config('statement_timeout',least(coalesce(nullif(setting::bigint,0),?),?)::text,true) FROM pg_settings WHERE name='statement_timeout'",millis,millis)
  private val matches="strpos(lower((value->>'text') COLLATE pg_unicode_fast),lower(? COLLATE pg_unicode_fast))>0"
  def searchSessionMessages(reader: String,id: UUID,selector: ContentView,literal: String,cursor: Option[String],limit: Int,materialization: ReadMaterialization): SessionMessageSearchResult = {
    SessionMessageSearchPolicy.validate(literal,cursor,limit)
    try db.transaction { c =>
      c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
      // Apply even to unrestricted browser reads, preserving any stricter configured deadline.
      deadline(c,SessionMessageSearchPolicy.statementDeadlineMillis)
      val (view,content)=archive.selectContent(c,reader,id,Some(selector),materialization)
      val after=cursors.decode(reader,id,view,literal,cursor)
      val needle=SnapshotProjection.text(literal)
      val stored=content.messages
      val scan=ReadSources.Selection(ReadSources.Query(
        s"SELECT message_id AS \"messageId\",position FROM ${stored.sql} m WHERE position>? AND $matches ORDER BY position LIMIT ?",
        stored.args++List(after,needle,limit+1)),"position",limit+1)
      // Always measure/charge the bounded selected locators BEFORE fetching or decoding IDs.
      // The extra lookahead locator counts too: exceeding the budget is an error, never a partial page.
      val bounded=ReadMaterialization.admitted(new ReadAdmission {
        def consume(bytes: Long): Unit = { SessionMessageSearchPolicy.locatorBytes(bytes); materialization.admit(bytes) }
      })
      def page(selection: ReadSources.Selection): List[MessageSearchHit] = bounded.selected(c,selection)(json => Wire.decode(MessageSearchHit.codecJson,json))
      val selected=content match {
        case epoch: RevisionContent.Epoch if candidates(c,epoch,needle) =>
          // The first phase runs inside a savepoint: its timeout aborts only the savepoint and its shorter limit.
          val scanning=c.setSavepoint()
          try { deadline(c,scanDeadlineMillis); page(scan) }
          catch {
            case error: SQLException if error.getSQLState=="57014" =>
              c.rollback(scanning)
              page(ReadSources.Selection(ReadSources.Query(
                s"SELECT message_id AS \"messageId\",position FROM ${stored.sql} m WHERE position>? AND position IN(SELECT position FROM ch_epoch_fragments WHERE epoch=? AND head_candidate AND position>? AND position<? AND value LIKE lower(? COLLATE pg_unicode_fast) ESCAPE '\\') AND $matches ORDER BY position LIMIT ?",
                stored.args++List(after,epoch.epoch,after,epoch.messageCount,LexicalCandidates.pattern(needle),needle,limit+1)),"position",limit+1))
          }
        case _ => page(scan)
      }
      val hits=selected.take(limit)
      val next=if(selected.size>limit) hits.lastOption.map(hit => cursors.encode(reader,id,view,literal,hit.position)) else None
      SessionMessageSearchResult(view,hits,next)
    } catch {
      case error: SQLException if error.getSQLState=="57014" => throw DomainError("deadline","message search statement deadline exceeded")
    }
  }
  /** Whether the epoch's fragments can answer the literal: the epoch is current (every fragment is a head candidate),
    * the literal has trigram keys, and its folded form has at most as many scalars as fragments overlap, so each of its
    * occurrences lies inside one fragment. */
  private def candidates(c: Connection,epoch: RevisionContent.Epoch,needle: String): Boolean =
    LexicalCandidates.trigrams(needle) && Sql.one(c,"SELECT candidates='current' AND char_length(lower(? COLLATE pg_unicode_fast))<=? FROM ch_epochs WHERE id=?",needle,ArchiveProjection.overlapScalars,epoch.epoch)(_.getBoolean(1)).contains(true)
}
