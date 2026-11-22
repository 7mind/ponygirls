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
  /** For the rest of the transaction, epoch rows read in position order come through the primary key's range: the
    * planner expects an epoch it has no statistics for (one written after the last ANALYZE, or outside its most common
    * values) to hold a few rows, and otherwise reads the whole epoch through the (epoch,message_id) key or a bitmap scan
    * and sorts it, on disk for a large session (U4 rehearsal). Without sorts the key's range is the only ordered path. */
  def keyOrdered(c: Connection): Unit = {
    Sql.exec(c,"SET LOCAL enable_sort = off")
    Sql.exec(c,"SET LOCAL enable_incremental_sort = off")
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
  private def messages(c: Connection,content: RevisionContent,fetchSize: Int): List[Message] = {
    // A legacy revision streams its snapshot's array.
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
  /** The revision for indexing without decoding a message (ingest-limits spec §5.2.1): its envelope (no messages, no raw
    * files), binding id and message count. */
  def claimed(c: Connection,content: RevisionContent): (IngestRequest,UUID,Int) = {
    val (request,binding)=envelope(c,content)
    val count=content match {
      case epoch: Epoch => epoch.messageCount
      case legacy: Legacy => Sql.one(c,"SELECT message_count FROM ch_revision_info WHERE session_id=? AND revision=?",legacy.id,legacy.revision)(_.getInt(1))
        .getOrElse(throw DomainError("projection","message projection missing"))
    }
    (request,binding,count)
  }
}

/** What a claim holds of its revision's messages instead of them (ingest-limits spec §5.2.1): their number and their reader. */
trait ClaimedMessages {
  def count: Int
  def reader(fetch: MessageFetch): ProblemPassages.SourceMessages
}
object ClaimedMessages {
  /** Messages already decoded (an archive without stored message rows). */
  def decoded(messages: Seq[Message]): ClaimedMessages = new ClaimedMessages {
    def count: Int = messages.size
    def reader(fetch: MessageFetch): ProblemPassages.SourceMessages = ProblemPassages.SourceMessages(messages)
  }
}
/** How the messages of an indexed revision are fetched (ingest-limits spec §5.2.2, §5.2.7, §5.2.8): a message whose decode,
  * `IndexingBudget.messageDecodeFactor` times its stored text, exceeds `budgetBytes` is refused before a value of its batch is
  * fetched; a message above `SnapshotAdmission.largeBodyBytes` is fetched and decoded alone, inside `large`. */
final case class MessageFetch(budgetBytes: Long,large: LargeDecodes)
/** The fetch and decode of one large message: inside the process-wide large-decode admission (SnapshotAdmission). */
trait LargeDecodes {
  def apply[A](decode: => A): A
}
/** A stored revision's messages read by position, each read a short transaction of its own (ingest-limits spec §5.2.2): the
  * stored text sizes of the next `sizeBatch` positions first (PostgreSQL detoasts, the JVM receives integers; kept for the
  * following reads), then the values of consecutive messages up to `runBytes` of text in one fetch, a longer message alone,
  * so the driver holds at most one run; a large message is admitted first, then read. Fewer rows than the count (a
  * purge) end the claim. */
private[chronicle] final class StoredMessages(db: Database,content: RevisionContent,val count: Int) extends ClaimedMessages {
  def reader(fetch: MessageFetch): ProblemPassages.SourceMessages = new ProblemPassages.SourceMessages {
    private var sizes=Vector.empty[Long]
    private var sizesFrom=0
    def count: Int = StoredMessages.this.count
    private def sizedAt(from: Int): Boolean = from>=sizesFrom && from<sizesFrom+sizes.size
    private def large(from: Int): Boolean = sizes(from-sizesFrom)>SnapshotAdmission.largeBodyBytes
    /** The values of the run from `from`. */
    private def run(c: Connection,from: Int): Vector[Message] = {
      val first=from-sizesFrom
      var end=first+1; var bytes=sizes(first)
      while(end<sizes.size && !large(sizesFrom+end) && bytes+sizes(end)<=StoredMessages.runBytes) { bytes+=sizes(end); end+=1 }
      values(c,from,end-first)
    }
    def read(from: Int): Vector[Message] = {
      Check(from>=0 && from<count,"internal","stored message read outside the revision")
      // A large message waits for its admission with no transaction open (the wait can last a whole large ingest); its
      // value is read in a transaction of its own once admitted.
      def admitted: Vector[Message] = fetch.large(db.transaction { c => keyed(c); values(c,from,1) })
      if(sizedAt(from)) { if(large(from)) admitted else db.transaction { c => keyed(c); run(c,from) } }
      else db.transaction { c =>
        keyed(c)
        sizes=sized(c,from,fetch); sizesFrom=from
        Option.unless(large(from))(run(c,from))
      }.getOrElse(admitted)
    }
  }
  /** A read's transaction reads an epoch's rows in key order (`RevisionContent.keyOrdered`). */
  private[chronicle] def keyed(c: Connection): Unit = content match { case _: RevisionContent.Epoch => RevisionContent.keyOrdered(c); case _: RevisionContent.Legacy => () }
  private[chronicle] def sizesQuery(from: Int,limit: Int): ReadSources.Query = {
    val stored=content.messages
    ReadSources.Query(s"SELECT position,octet_length(value::text) FROM ${stored.sql} m WHERE position>=? ORDER BY position LIMIT ?",stored.args++List(from,limit))
  }
  private[chronicle] def valuesQuery(from: Int,until: Int): ReadSources.Query = {
    val stored=content.messages
    ReadSources.Query(s"SELECT position,value FROM ${stored.sql} m WHERE position>=? AND position<? ORDER BY position",stored.args++List(from,until))
  }
  private def current(rows: Int,expected: Int): Unit = Check(rows==expected,"stale-claim","indexing claim is no longer current")
  /** The stored text sizes of the messages from `from` on, each within the fetch's budget. */
  private def sized(c: Connection,from: Int,fetch: MessageFetch): Vector[Long] = {
    val expected=StoredMessages.sizeBatch.min(count-from)
    val query=sizesQuery(from,expected)
    val rows=Sql.rows(c,query.sql,query.args*)(r => (r.getInt(1),r.getLong(2))).toVector
    current(rows.size,expected)
    rows.zipWithIndex.foreach { case ((position,size),index) =>
      Check(position==from+index,"stale-claim","indexing claim is no longer current")
      Check(BigInt(size)*IndexingBudget.messageDecodeFactor<=BigInt(fetch.budgetBytes),IndexingBudget.exceededCode,
        s"message $position of $size stored bytes would take ${BigInt(size)*IndexingBudget.messageDecodeFactor} bytes to decode, above the budget of ${fetch.budgetBytes}")
    }
    rows.map(_._2)
  }
  private def values(c: Connection,from: Int,limit: Int): Vector[Message] = {
    val query=valuesQuery(from,from+limit)
    val rows=Sql.rows(c,query.sql,query.args*) { r =>
      (r.getInt(1),ProblemPassages.SourceMessages.checked(Wire.decode(Message.codecJson,Wire.parse(r.getString(2)))))
    }.toVector
    current(rows.size,limit)
    rows.zipWithIndex.foreach { case ((position,_),index) => Check(position==from+index,"stale-claim","indexing claim is no longer current") }
    rows.map(_._2)
  }
}
object StoredMessages {
  /** Positions whose sizes one read fetches. */
  val sizeBatch = 64
  /** Text bytes of consecutive messages fetched together: a window's source is at most 128 KiB of JSON. */
  val runBytes: Long = 1024L*1024
}
