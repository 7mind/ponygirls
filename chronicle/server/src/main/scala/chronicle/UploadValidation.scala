package chronicle

import chronicle.api.*
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest

/** The request rules of ingestion, one implementation each: `SnapshotValidation` applies them to a whole `/api/ingest`
  * request, part uploads to a declaration at the open and to every part on its own (append-only ingest spec §4.6). */
object UploadValidation {
  def scalar(value: String): Unit = Check(scalarText(value),"invalid","unpaired Unicode surrogate")
  /** No unpaired surrogate: the string has an exact UTF-8 encoding (`getBytes(UTF_8)` writes `?` for an unpaired one). */
  def scalarText(value: String): Boolean = {
    var index=0
    var paired=true
    while(paired && index<value.length) {
      val char=value.charAt(index)
      if(Character.isHighSurrogate(char)) {
        paired=index+1<value.length && Character.isLowSurrogate(value.charAt(index+1))
        index+=2
      } else {
        paired= !Character.isLowSurrogate(char)
        index+=1
      }
    }
    paired
  }
  def structured(value: String): Unit = {
    scalar(value)
    Check(!value.contains('\u0000'),"invalid","NUL in structured field")
  }
  def source(s: SourceIdentity): Unit = {
    List(s.collectorNamespace,s.discoveryRootId,s.producerSessionId).foreach(Check.text(_,256))
    s.subagentId.foreach(Check.text(_,256))
    (List(s.collectorNamespace,s.discoveryRootId,s.producerSessionId)++s.subagentId).foreach(structured)
  }
  def metadata(m: Metadata): Unit = {
    (List(m.title,m.producer)++m.project++m.gitRemote++m.gitBranch++m.gitCommit++m.model++m.tags).foreach(scalar)
    m.workdir.foreach(structured)
    Check(m.tags.size <= 32 && m.tags.forall(t => SnapshotProjection.text(t).length <= 128), "invalid", "invalid tags")
    List(m.startedAt,m.endedAt).flatten.foreach(t => Check(scala.util.Try(java.time.Instant.parse(t)).isSuccess,"invalid","invalid timestamp"))
  }
  /** A raw file's logical path: relative, without `..`. */
  def path(value: String): Unit = {
    structured(value)
    Check(!value.startsWith("/") && !value.split('/').contains(".."),"invalid","invalid file")
  }
  /** The logical records of JSONL `content`, the one rule of record counts, indexes and sizes: its non-empty lines as
    * `linesIterator` splits them (at LF, CRLF and a bare CR), without their terminators. */
  def recordLines(content: String): Iterator[String] = content.linesIterator.filter(_.nonEmpty)
  /** The record ids that can be a message's parent: an id with an unpaired surrogate equals no parentId (parentIds are
    * structured) and has no exact UTF-8 key, so it is never offered as one. */
  def parentKeys(ids: List[String]): List[String] = ids.filter(scalarText)
  /** The records of JSONL `content` (`recordLines`), each one JSON value, parsed once and not retained (a large
    * snapshot's syntax trees would take several times its size of heap). `found` receives each record's `id` and `uuid`
    * strings. Returns the number of records. */
  def records(content: String)(found: List[String] => Unit): Int = {
    var count=0
    recordLines(content).foreach { line =>
      val record=io.circe.parser.parse(line).fold(_ => throw DomainError("invalid","invalid file digest or JSONL"),identity)
      found(List("id","uuid").flatMap(field => record.hcursor.get[String](field).toOption))
      count+=1
    }
    count
  }
  /** A message's own fields; its recordIndex and parentId are checked against the records and ids of its request. */
  def message(m: Message): Unit = {
    (List(m.id,m.role)++m.parentId++m.timestamp).foreach(structured); scalar(m.text)
    Check.text(m.id,256); Check.text(m.role,64); Check(m.recordIndex>=0,"invalid","invalid message provenance")
  }
  private val partDomain="chronicle.upload-part.v1".getBytes(UTF_8)
  /** SHA-256("chronicle.upload-part.v1" ‖ 0x00 ‖ u64be(len raw) ‖ raw ‖ u32be(n) ‖ m(x₁) ‖ … ‖ m(xₙ)) as lowercase hex,
    * with m of message chain v1 (spec §5). */
  def partDigest(raw: Array[Byte],messages: List[Message]): String = {
    val digest=MessageDigest.getInstance("SHA-256")
    digest.update(partDomain); digest.update(0.toByte)
    digest.update(ByteBuffer.allocate(8).putLong(raw.length.toLong).array()); digest.update(raw)
    digest.update(ByteBuffer.allocate(4).putInt(messages.size).array())
    messages.foreach(m => digest.update(MessageChain.message(m)))
    digest.digest().map(b => f"${b & 255}%02x").mkString
  }
}
