package chronicle

import chronicle.api.*
import java.sql.Connection
import java.time.Instant
import java.util.UUID
import scala.util.{Try,Using}

object ArchiveProjection {
  val fragmentBytes = 4096
  val overlapScalars = 512
  private val backfillRevisions = 4
  private val messageFetchSize = 32
  private val batchSize = 128

  def fragments(value: String): Iterator[String] = new Iterator[String] {
    private var start = 0
    def hasNext: Boolean = start < value.length
    def next(): String = {
      if(!hasNext) throw new NoSuchElementException("archive fragment")
      var end = start
      var bytes = 0
      while(end < value.length && bytes + utf8Bytes(value.codePointAt(end)) <= fragmentBytes) {
        val point = value.codePointAt(end)
        bytes += utf8Bytes(point)
        end += Character.charCount(point)
      }
      val result = value.substring(start,end)
      if(end == value.length) start = end
      else {
        val next = value.offsetByCodePoints(end,-overlapScalars)
        Check(next > start,"projection","archive fragment did not advance")
        start = next
      }
      result
    }
  }
  private def utf8Bytes(point: Int): Int = if(point <= 0x7f) 1 else if(point <= 0x7ff) 2 else if(point <= 0xffff) 3 else 4
  def parsedTime(value: Option[String]): Option[Instant] = value.flatMap(s => Try(Instant.parse(s)).toOption)
  def latest(metadata: Metadata,messages: Iterator[Message]): Option[Instant] = {
    val times = messages.flatMap(m => parsedTime(m.timestamp))
    val maximum = times.foldLeft(Option.empty[Instant]) { (previous,next) => Some(previous.fold(next)(old => if(next.isAfter(old)) next else old)) }
    maximum.orElse(parsedTime(metadata.endedAt)).orElse(parsedTime(metadata.startedAt))
  }
  def timestampOrder(time: Instant): String = java.math.BigDecimal.valueOf(time.getEpochSecond).add(java.math.BigDecimal.valueOf(time.getNano.toLong,9)).toPlainString
  def metadataValues(metadata: Metadata,source: SourceIdentity): List[String] =
    List(metadata.title,metadata.producer,source.format.toString,source.producerSessionId) ++ metadata.project ++ metadata.workdir ++ metadata.gitRemote ++ metadata.gitBranch ++ metadata.gitCommit ++ metadata.model ++ metadata.tags

  private final class Writer(c: Connection,id: UUID,revision: Int) extends AutoCloseable {
    private val message = c.prepareStatement("INSERT INTO ch_messages(session_id,revision,position,message_id,value) VALUES(?,?,?,?,?::jsonb)")
    private val fragment = c.prepareStatement("INSERT INTO ch_archive_fragments(session_id,revision,ordinal,value) VALUES(?,?,?,?)")
    private var messageBatch = 0
    private var fragmentBatch = 0
    private var ordinal = 0
    def addText(value: String): Unit = fragments(value).foreach { text =>
      Sql.bind(fragment,List(id,revision,ordinal,text)); fragment.addBatch(); ordinal += 1; fragmentBatch += 1
      if(fragmentBatch == batchSize) { fragment.executeBatch(); fragmentBatch = 0 }
    }
    def addMessage(value: Message,position: Int): Unit = {
      Sql.bind(message,List(id,revision,position,value.id,Wire.encode(Message.codecJson,value).noSpaces))
      message.addBatch(); messageBatch += 1
      if(messageBatch == batchSize) { message.executeBatch(); messageBatch = 0 }
      addText(value.text)
    }
    def flush(): Unit = {
      if(messageBatch > 0) { message.executeBatch(); messageBatch = 0 }
      if(fragmentBatch > 0) { fragment.executeBatch(); fragmentBatch = 0 }
    }
    def close(): Unit = { message.close(); fragment.close() }
  }
  private def info(c: Connection,id: UUID,revision: Int,metadata: Metadata,source: SourceIdentity,completion: Completion,redacted: Boolean,time: Option[Instant],count: Int): Unit = {
    val timestamp = time.fold("NULL")(_ => "?")
    val args: List[Sql.Param] = List(id,revision,Wire.encode(Metadata.codecJson,metadata).noSpaces,Wire.encode(SourceIdentity.codecJson,source).noSpaces,completion.toString,redacted) ++ time.toList.flatMap(t => List[Sql.Param](t.toString,timestampOrder(t))) ++ List(count)
    Sql.exec(c,s"INSERT INTO ch_revision_info(session_id,revision,metadata,source,completion,redacted,last_timestamp,last_timestamp_order,message_count) VALUES(?,?,?::jsonb,?::jsonb,?,?,$timestamp,${if(time.isDefined) "?::numeric" else "NULL"},?)",args*)
  }
  def persist(c: Connection,id: UUID,revision: Int,request: IngestRequest): Unit = {
    Using.resource(new Writer(c,id,revision)) { writer =>
      metadataValues(request.metadata,request.source).foreach(writer.addText)
      request.messages.zipWithIndex.foreach { case (message,position) => writer.addMessage(message,position) }
      writer.flush()
    }
    info(c,id,revision,request.metadata,request.source,request.completion,request.redacted,latest(request.metadata,request.messages.iterator),request.messages.size)
  }
  def backfill(db: Database): Unit = {
    var more = true
    while(more) more = db.transaction { c =>
      Sql.lock(c,"archive-projection-backfill")
      val missing = Sql.rows(c,s"SELECT r.session_id,r.revision FROM ch_revisions r LEFT JOIN ch_revision_info i ON i.session_id=r.session_id AND i.revision=r.revision WHERE i.session_id IS NULL ORDER BY r.session_id,r.revision LIMIT $backfillRevisions FOR UPDATE OF r")(r => (r.getObject(1,classOf[UUID]),r.getInt(2)))
      missing.foreach { case (id,revision) =>
        val (metadata,source,completion,redacted) = Sql.one(c,"SELECT snapshot->'metadata' AS metadata,snapshot->'source' AS source,snapshot->>'completion' AS completion,(snapshot->>'redacted')::boolean AS redacted FROM ch_revisions WHERE session_id=? AND revision=?",id,revision) { r =>
          (Wire.decode(Metadata.codecJson,Sql.json(r,"metadata")),Wire.decode(SourceIdentity.codecJson,Sql.json(r,"source")),Completion.parse(r.getString("completion")).get,r.getBoolean("redacted"))
        }.get
        var count = 0
        var maximum = Option.empty[Instant]
        Using.resource(new Writer(c,id,revision)) { writer =>
          metadataValues(metadata,source).foreach(writer.addText)
          Using.resource(c.prepareStatement("SELECT item.value FROM ch_revisions r CROSS JOIN LATERAL jsonb_array_elements(r.snapshot->'messages') WITH ORDINALITY item(value,position) WHERE r.session_id=? AND r.revision=? ORDER BY item.position")) { statement =>
            Sql.bind(statement,List(id,revision)); statement.setFetchSize(messageFetchSize)
            Using.resource(statement.executeQuery()) { rows => while(rows.next()) {
              val message = Wire.decode(Message.codecJson,Wire.parse(rows.getString(1)))
              writer.addMessage(message,count); count += 1
              parsedTime(message.timestamp).foreach { time => maximum = Some(maximum.fold(time)(old => if(time.isAfter(old)) time else old)) }
            }}
          }
          writer.flush()
        }
        info(c,id,revision,metadata,source,completion,redacted,maximum.orElse(parsedTime(metadata.endedAt)).orElse(parsedTime(metadata.startedAt)),count)
      }
      if(missing.isEmpty) Sql.exec(c,"INSERT INTO ch_schema_migrations VALUES(6) ON CONFLICT DO NOTHING")
      missing.nonEmpty
    }
  }
}
