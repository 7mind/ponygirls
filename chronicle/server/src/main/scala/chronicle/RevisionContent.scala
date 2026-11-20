package chronicle

import chronicle.api.*
import java.sql.Connection
import java.util.UUID
import scala.util.Using

/** Where one stored revision's content is (append-only ingest spec §1.3): a legacy revision has its snapshot and message
  * rows of its own; an epoch revision is the prefix of its epoch below its counts. Readers resolve the layout once and
  * query the relation it names: a view over both layouts sorts a whole epoch for every ordered page. */
private[chronicle] sealed trait RevisionContent {
  def id: UUID
  def revision: Int
  /** The relation `(position,message_id,value)` of the revision's messages, positions from 0. */
  def messages: ReadSources.Query
}
private[chronicle] object RevisionContent {
  final case class Legacy(id: UUID,revision: Int) extends RevisionContent {
    def messages: ReadSources.Query = ReadSources.Query("(SELECT position,message_id,value FROM ch_messages WHERE session_id=? AND revision=?)",List(id,revision))
  }
  /** Epoch rows past the counts belong to later revisions (or to no revision yet): every read filters on them. */
  final case class Epoch(id: UUID,revision: Int,epoch: UUID,messageCount: Int,rawBytes: Long) extends RevisionContent {
    def messages: ReadSources.Query = ReadSources.Query("(SELECT position,message_id,value FROM ch_epoch_messages WHERE epoch=? AND position<?)",List(epoch,messageCount))
  }
  def resolve(c: Connection,id: UUID,revision: Int): Option[RevisionContent] =
    Sql.one(c,"SELECT epoch,message_count,raw_bytes FROM ch_revisions WHERE session_id=? AND revision=?",id,revision) { r =>
      Option(r.getObject("epoch",classOf[UUID])).fold[RevisionContent](Legacy(id,revision))(epoch => Epoch(id,revision,epoch,r.getInt("message_count"),r.getLong("raw_bytes")))
    }
  private def snapshot(c: Connection,content: Legacy): IngestRequest =
    Sql.one(c,"SELECT snapshot FROM ch_revisions WHERE session_id=? AND revision=?",content.id,content.revision)(r => Wire.decode(IngestRequest.codecJson,Sql.json(r,"snapshot"))).get
  /** The envelope as a request without messages and files, and the revision's binding id. */
  private def envelope(c: Connection,content: RevisionContent): (IngestRequest,UUID) = {
    val stored=content match { case _: Legacy => "snapshot-'messages'-'files'"; case _: Epoch => "envelope" }
    Sql.one(c,s"""SELECT $stored||'{"messages":[],"files":[]}'::jsonb,binding_id FROM ch_revisions WHERE session_id=? AND revision=?""",content.id,content.revision) { r =>
      (Wire.decode(IngestRequest.codecJson,Wire.parse(r.getString(1))),r.getObject(2,classOf[UUID]))
    }.get
  }
  /** The epoch revision's one raw file: its segments below `raw_bytes` are whole lines, so they concatenate to the raw. */
  private def rawFile(c: Connection,content: Epoch): RawFile =
    Sql.one(c,"SELECT e.raw_path,r.envelope->>'digest',(SELECT coalesce(string_agg(w.content,'' ORDER BY w.byte_offset),'') FROM ch_epoch_raw w WHERE w.epoch=r.epoch AND w.byte_offset<r.raw_bytes) FROM ch_revisions r JOIN ch_epochs e ON e.id=r.epoch WHERE r.session_id=? AND r.revision=?",content.id,content.revision) { r =>
      RawFile(r.getString(1),r.getString(2),r.getString(3))
    }.get
  /** Decodes the messages one at a time in position order, `fetchSize` rows per round trip. */
  def messages(c: Connection,content: RevisionContent,fetchSize: Int): List[Message] = {
    // A legacy claim streams its snapshot's array (no message rows are read for it, as before the epoch layout).
    val query=content match {
      case _: Legacy => ReadSources.Query("SELECT item.value FROM ch_revisions r CROSS JOIN LATERAL jsonb_array_elements(r.snapshot->'messages') WITH ORDINALITY item(value,position) WHERE r.session_id=? AND r.revision=? ORDER BY item.position",List(content.id,content.revision))
      case epoch: Epoch => ReadSources.Query(s"SELECT value FROM ${epoch.messages.sql} m ORDER BY position",epoch.messages.args)
    }
    val messages=List.newBuilder[Message]
    Using.resource(c.prepareStatement(query.sql)) { statement =>
      Sql.bind(statement,query.args); statement.setFetchSize(fetchSize)
      Using.resource(statement.executeQuery()) { rows => while(rows.next()) messages += Wire.decode(Message.codecJson,Wire.parse(rows.getString(1))) }
    }
    messages.result()
  }
  /** The revision as it was ingested (after the display projection): envelope, messages and raw files. */
  def request(c: Connection,content: RevisionContent): IngestRequest = content match {
    case legacy: Legacy => snapshot(c,legacy)
    case epoch: Epoch => envelope(c,epoch)._1.copy(messages=messages(c,epoch,PostgresArchive.claimedMessagesPerFetch),files=List(rawFile(c,epoch)))
  }
  def files(c: Connection,content: RevisionContent): List[RawFile] = content match {
    case legacy: Legacy => snapshot(c,legacy).files
    case epoch: Epoch => List(rawFile(c,epoch))
  }
  /** The revision for indexing (envelope and messages, without raw files) and its binding id. */
  def claimed(c: Connection,content: RevisionContent,fetchSize: Int): (IngestRequest,UUID) = {
    val (request,binding)=envelope(c,content)
    (request.copy(messages=messages(c,content,fetchSize)),binding)
  }
}
