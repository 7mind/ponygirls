package chronicle

import chronicle.api.*
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.sql.{Connection,PreparedStatement,Types}
import java.time.Instant
import java.util.UUID
import scala.util.Using

/** How `/api/ingest` stores a new revision. `Legacy` writes a snapshot with per-revision message and fragment rows;
  * `Epochs` stores every epoch-safe revision in an epoch (append-only ingest spec §3) and the others as `Legacy`. */
enum RevisionLayoutPolicy {
  case Legacy,Epochs
}
object RevisionLayoutPolicy {
  /** `Legacy` until every reader resolves epoch revisions (spec §11, U3). */
  val production: RevisionLayoutPolicy = Legacy
}

/** The revision writer of `/api/ingest`, inside its transaction before the switch: the layout decision, the legacy writer
  * and the epoch writer, which appends only the delta to the head's epoch or writes the whole revision into a new epoch. */
object EpochWriter {
  /** The head's epoch before the switch and the written revision's epoch; None is the legacy layout. */
  final case class Written(previous: Option[UUID],epoch: Option[UUID])
  private final case class Head(epoch: UUID,rawPath: String,digest: String,rawBytes: Long,messages: Int,records: Int,messageBytes: Long,fragments: Long,rawState: Array[Byte],chain: Array[Byte],messageTime: Option[Instant])
  /** Raw segments hold whole lines and stay within this size unless one line is longer. */
  val segmentBytes: Int = 1024*1024
  /** A Problem passage fragment ends at the last scalar that fits, so each fragment of a text but its last holds at least
    * this many bytes: ceil(text bytes / fragmentTextBytes) bounds a text's fragments (the indexing budget). */
  val fragmentTextBytes: Int = ProblemPassages.maximumFragmentBytes-3
  private val batchSize = 128
  private val messageFetchSize = 32

  def write(c: Connection,layout: RevisionLayoutPolicy,id: UUID,head: Int,next: Int,snapshot: IngestRequest): Written = {
    val current=if(head==0) None else Sql.one(c,"SELECT r.epoch,e.raw_path,r.envelope->>'digest',r.raw_bytes,r.message_count,r.record_count,r.message_bytes,r.fragment_count,r.raw_state,r.message_chain,r.message_time FROM ch_revisions r LEFT JOIN ch_epochs e ON e.id=r.epoch WHERE r.session_id=? AND r.revision=?",id,head) { r =>
      Option(r.getObject(1,classOf[UUID])).map(epoch => Head(epoch,r.getString(2),r.getString(3),r.getLong(4),r.getInt(5),r.getInt(6),r.getLong(7),r.getLong(8),r.getBytes(9),r.getBytes(10),Option(r.getString(11)).map(Instant.parse)))
    }.get
    val previous=current.map(_.epoch)
    if(layout==RevisionLayoutPolicy.Legacy || !epochSafe(snapshot)) {
      Sql.exec(c,"INSERT INTO ch_revisions(session_id,revision,snapshot) VALUES(?,?,?::jsonb)",id,next,Wire.encode(IngestRequest.codecJson,snapshot).noSpaces)
      ArchiveProjection.persist(c,id,next,snapshot)
      Written(previous,None)
    } else {
      val file=snapshot.files.head
      val base=current.flatMap(head => prefixEnd(head,file,snapshot.messages).map(head -> _))
      val epoch=base.fold {
        val epoch=UUID.randomUUID()
        Sql.exec(c,"INSERT INTO ch_epochs(id,session_id,raw_path) VALUES(?,?,?)",epoch,id,file.path)
        epoch
      }(_._1.epoch)
      epochRevision(c,id,next,epoch,snapshot,base)
      Written(previous,Some(epoch))
    }
  }
  /** In the switch, after the source row moved to the written revision: leaving the previous head's epoch supersedes it. */
  def switched(c: Connection,written: Written): Unit =
    written.previous.filterNot(written.epoch.contains).foreach(epoch => Sql.exec(c,"UPDATE ch_epochs SET candidates='prune' WHERE id=? AND candidates='current'",epoch))

  /** One file whose raw is empty or ends with a newline. Several files, or a last record without a newline (which
    * SnapshotValidation accepts), have no line-aligned epoch representation and keep the legacy layout. */
  private def epochSafe(snapshot: IngestRequest): Boolean =
    snapshot.files.size==1 && (snapshot.files.head.content.isEmpty || snapshot.files.head.content.endsWith("\n"))
  /** The end (exclusive) of the line of `content` that starts at `from`: after its newline, or the end of the content. */
  private def lineEnd(content: String,from: Int): Int = { val newline=content.indexOf('\n',from); if(newline<0) content.length else newline+1 }
  private def hex(bytes: Array[Byte]): String = bytes.map(b => f"${b & 255}%02x").mkString
  /** Where the head's raw ends in `file` when the request extends the head: the same path, the head's messages are the
    * request's first ones (chain v1), and the head's raw bytes are whole lines of the file with the head's digest. */
  private def prefixEnd(head: Head,file: RawFile,messages: List[Message]): Option[Int] =
    if(file.path!=head.rawPath || messages.size<head.messages || !java.util.Arrays.equals(MessageChain.extend(MessageChain.initial,messages.iterator.take(head.messages)),head.chain)) None
    else {
      val digest=MessageDigest.getInstance("SHA-256")
      var chars=0
      var bytes=0L
      while(bytes<head.rawBytes && chars<file.content.length) {
        val end=lineEnd(file.content,chars)
        val line=file.content.substring(chars,end).getBytes(UTF_8)
        digest.update(line); bytes+=line.length; chars=end
      }
      Option.when(bytes==head.rawBytes && hex(digest.digest())==head.digest)(chars)
    }

  /** Writes the messages, raw lines and record keys past the base (the head in the same epoch, or nothing in a new epoch),
    * their fragments, and the revision row with its counts, raw SHA-256 midstate and message chain. */
  private def epochRevision(c: Connection,id: UUID,next: Int,epoch: UUID,snapshot: IngestRequest,base: Option[(Head,Int)]): Unit = {
    val head=base.map(_._1)
    val content=snapshot.files.head.content
    val firstPosition=head.fold(0)(_.messages)
    val delta=snapshot.messages.drop(firstPosition)
    var messageBytes=head.fold(0L)(_.messageBytes)
    var fragmentCount=head.fold(0L)(_.fragments)
    Using.resource(new Batch(c,"INSERT INTO ch_epoch_messages(epoch,position,message_id,value) VALUES(?,?,?,?::jsonb)")) { messages =>
      delta.zipWithIndex.foreach { case (message,index) =>
        val value=Wire.encode(Message.codecJson,message).noSpaces
        messageBytes+=value.getBytes(UTF_8).length
        fragmentCount+=(message.text.getBytes(UTF_8).length+fragmentTextBytes-1)/fragmentTextBytes
        messages.add { s => s.setObject(1,epoch); s.setInt(2,firstPosition+index); s.setString(3,message.id); s.setString(4,value) }
      }
      messages.flush()
    }
    val digest=head.fold(ResumableSha256())(h => ResumableSha256.resume(h.rawState))
    var records=head.fold(0)(_.records)
    Using.resource(new Batch(c,"INSERT INTO ch_epoch_records(epoch,record_index,record_key) VALUES(?,?,?)")) { keys =>
      Using.resource(c.prepareStatement("INSERT INTO ch_epoch_raw(epoch,byte_offset,content) VALUES(?,?,?)")) { raw =>
        val keyDigest=MessageDigest.getInstance("SHA-256")
        var offset=head.fold(0L)(_.rawBytes)
        var start=base.fold(0)(_._2)
        var end=start
        var size=0L
        def segment(): Unit = if(end>start) {
          raw.setObject(1,epoch); raw.setLong(2,offset); raw.setString(3,content.substring(start,end)); raw.executeUpdate()
          offset+=size; start=end; size=0L
        }
        while(end<content.length) {
          val stop=lineEnd(content,end)
          val line=content.substring(end,stop)
          val bytes=line.getBytes(UTF_8)
          if(size>0 && size+bytes.length>segmentBytes) segment()
          digest.update(bytes); size+=bytes.length; end=stop
          // SnapshotValidation's records: the non-empty lines of linesIterator, which also ends lines at CR. The count
          // composes across revisions because each revision's raw ends with a newline.
          line.linesIterator.filter(_.nonEmpty).foreach { record =>
            val json=io.circe.parser.parse(record).fold(_ => throw DomainError("internal","validated raw record does not parse"),identity)
            val index=records
            List("id","uuid").flatMap(field => json.hcursor.get[String](field).toOption).distinct.foreach { key =>
              val hashed=keyDigest.digest(key.getBytes(UTF_8))
              keys.add { s => s.setObject(1,epoch); s.setInt(2,index); s.setBytes(3,hashed) }
            }
            records+=1
          }
        }
        segment()
      }
      keys.flush()
    }
    // Self-check of the stored state: the head's midstate continued over the delta reproduces the validated digest.
    Check(hex(digest.digest)==snapshot.digest,"internal","stored raw digest state does not reproduce the request digest")
    Using.resource(new Batch(c,"INSERT INTO ch_epoch_fragments(epoch,position,part,value) VALUES(?,?,?,?)")) { fragments =>
      Using.resource(c.prepareStatement("SELECT position,lower(value->>'text' COLLATE pg_unicode_fast) FROM ch_epoch_messages WHERE epoch=? AND position>=? ORDER BY position")) { statement =>
        statement.setObject(1,epoch); statement.setInt(2,firstPosition); statement.setFetchSize(messageFetchSize)
        Using.resource(statement.executeQuery()) { rows => while(rows.next()) {
          val position=rows.getInt(1)
          ArchiveProjection.fragments(rows.getString(2)).zipWithIndex.foreach { case (text,part) =>
            fragments.add { s => s.setObject(1,epoch); s.setInt(2,position); s.setInt(3,part); s.setString(4,text) }
          }
        }}
      }
      fragments.flush()
    }
    val messageTime=(delta.iterator.flatMap(message => ArchiveProjection.parsedTime(message.timestamp))++head.flatMap(_.messageTime)).maxOption
    val envelope=Wire.encode(IngestRequest.codecJson,snapshot.copy(messages=Nil,files=Nil)).mapObject(_.remove("messages").remove("files")).noSpaces
    Using.resource(c.prepareStatement("INSERT INTO ch_revisions(session_id,revision,epoch,envelope,message_count,record_count,raw_bytes,message_bytes,fragment_count,raw_state,message_chain,message_time) VALUES(?,?,?,?::jsonb,?,?,?,?,?,?,?,?)")) { s =>
      s.setObject(1,id); s.setInt(2,next); s.setObject(3,epoch); s.setString(4,envelope)
      s.setInt(5,snapshot.messages.size); s.setInt(6,records); s.setLong(7,digest.length); s.setLong(8,messageBytes); s.setLong(9,fragmentCount)
      s.setBytes(10,digest.state); s.setBytes(11,MessageChain.extend(head.fold(MessageChain.initial)(_.chain),delta))
      messageTime.fold(s.setNull(12,Types.VARCHAR))(time => s.setString(12,time.toString))
      s.executeUpdate()
    }
    ArchiveProjection.persistEpoch(c,id,next,snapshot,messageTime)
  }
  /** Inserts of one statement, executed every `batchSize` rows and by `flush`. */
  private final class Batch(c: Connection,sql: String) extends AutoCloseable {
    private val statement=c.prepareStatement(sql)
    private var pending=0
    def add(bind: PreparedStatement => Unit): Unit = {
      bind(statement); statement.addBatch(); pending+=1
      if(pending==batchSize) flush()
    }
    def flush(): Unit = if(pending>0) { statement.executeBatch(); pending=0 }
    def close(): Unit = statement.close()
  }
}
