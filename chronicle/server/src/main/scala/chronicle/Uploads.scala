package chronicle

import chronicle.api.*
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.sql.{Connection,SQLException,Types}
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.*
import scala.util.Using

/** The lease and owner bound of part uploads (append-only ingest spec §4.4); `production` is the deployment's. */
final case class UploadPolicy(ttl: FiniteDuration,liveAttemptsPerOwner: Int)
object UploadPolicy {
  val production: UploadPolicy = UploadPolicy(3600.seconds,8)
  /** The body of an open: the declaration. */
  val maxOpenBytes: Int = 64*1024
  /** An ordinary part, never admitted through the large-snapshot permit. */
  val maxPartBytes: Int = SnapshotAdmission.largeBodyBytes
  /** Each metadata string and the raw path of a declaration, in UTF-8 bytes. */
  val maxDeclarationFieldBytes: Int = 4096
  private val mebibyte = 1024L*1024
  /** The raw size an upload may declare: the per-file bound of `/api/ingest`. */
  def maxRawBytes(c: Config): Long = c.maxFileBytes.toLong
  /** A part of one record: its line JSON-escaped (at most twice its bytes) and its messages, whose text derives from the
    * line (at most twice more), and 1 MiB of envelope. */
  def maxLargePartBytes(c: Config): Long = 4*c.maxRecordBytes+mebibyte
  /** Bounds the rows of tiny parts; collectors pack parts of about `maxPartBytes`. Part ordinals and counts are 32-bit. */
  def maxParts(c: Config): Long = math.min((maxRawBytes(c)-1)/mebibyte+1+1024,Int.MaxValue)
  /** The records of a revision, its base included: record counts and indexes are 32-bit (`recordIndex`, `record_count`).
    * Unreachable below 4 GiB of raw: a record takes at least two bytes. */
  val maxRecords: Long = Int.MaxValue
  def limits(c: Config): UploadLimits = UploadLimits(maxPartBytes.toLong,maxLargePartBytes(c),c.maxRecordBytes,maxRawBytes(c),c.maxMessages)
}

/** Part uploads (append-only ingest spec §4): an open binds a request intent to the complete declaration of the revision
  * and starts an attempt; parts are validated one at a time and written straight into epoch rows past every committed
  * count, which only the attempt reaches (`ch_epochs.tail_upload`); the commit checks the computed digest, counts and
  * chain against the declaration and makes the revision visible in O(metadata). Every operation is one transaction under
  * the source's ingest lock, then the attempt row, then the source row: the lock order of `/api/ingest` and purge. An
  * open adds its attempt, and a part renews its attempt's lease, under the owner's upload lock, taken last. */
final class Uploads(db: Database,config: Config,policy: UploadPolicy) {
  import Uploads.*
  def limits: UploadLimits = UploadPolicy.limits(config)

  def open(owner: String,open: UploadOpen): UploadState = {
    declared(open)
    val key=sourceKey(open.source)
    val digest=Wire.hash(Wire.canonical(Wire.encode(UploadOpen.codecJson,open)))
    db.transaction { c =>
      OwnerTargets.enabled(c,owner,true)
      Sql.lock(c,s"ingest:$owner:$key")
      Sql.one(c,"SELECT digest FROM ch_ingest_receipts WHERE owner=? AND source_key=? AND request_id=?",owner,key,open.requestId)(_.getString(1)) match {
        case Some(committed) =>
          Check(committed==digest,"conflict","request ID bound to a different payload")
          state(Sql.one(c,s"$selectAttempt WHERE u.owner=? AND u.source_key=? AND u.request_id=? AND u.phase='Committed'",owner,key,open.requestId)(attempt)
            .getOrElse(throw DomainError("conflict","request ID committed without an upload attempt")))
        case None =>
          Sql.one(c,"SELECT declaration_digest FROM ch_uploads WHERE owner=? AND source_key=? AND request_id=? LIMIT 1",owner,key,open.requestId)(_.getString(1))
            .foreach(bound => Check(bound==digest,"conflict","request ID bound to a different declaration"))
          live(c,owner,key) match {
            case Some(attempt) if attempt.requestId==open.requestId => state(attempt)
            case Some(_) => throw DomainError("upload-busy","another upload of this source is in progress")
            case None =>
              db.profiles.resolve(OwnerTargets.read(c,owner,true).profile)
              start(c,owner,key,open,digest)
          }
      }
    }
  }
  def status(owner: String,id: UUID): UploadState = settled(c => Right(state(current(c,owner,id))))
  def part(owner: String,id: UUID,part: UploadPart,bodyBytes: Long): UploadState = {
    val content=received(part,bodyBytes)
    settled { c =>
      val attempt=current(c,owner,id)
      writable(attempt).toLeft {
        unpurged(c,owner,attempt)
        if(part.ordinal<attempt.parts) {
          val accepted=Sql.one(c,"SELECT sha256 FROM ch_upload_parts WHERE upload=? AND ordinal=?",id,part.ordinal)(_.getString(1)).get
          Check(accepted==part.sha256,"conflict",s"part ${part.ordinal} was accepted with another sha256")
          state(attempt)
        } else {
          Check(part.ordinal==attempt.parts,"conflict",s"part ${part.ordinal} is ahead of the next expected part ${attempt.parts}")
          Check(attempt.parts<UploadPolicy.maxParts(config),"too-large",s"an upload has at most ${UploadPolicy.maxParts(config)} parts")
          Check(content.rawBytes<=UploadPolicy.maxRawBytes(config)-attempt.rawEnd && attempt.messageEnd.toLong+content.messages.size<=config.maxMessages,
            "too-large",s"an upload stays within ${UploadPolicy.maxRawBytes(config)} raw bytes and ${config.maxMessages} messages")
          Check(attempt.recordEnd+content.records<=UploadPolicy.maxRecords,"too-large",
            s"a revision has at most ${UploadPolicy.maxRecords} records, its base included; part ${part.ordinal} would take it to ${attempt.recordEnd+content.records}")
          write(c,owner,attempt,part,content)
          state(reread(c,id))
        }
      }
    }
  }
  def commit(owner: String,id: UUID): IngestReceipt = settled { c =>
    val attempt=current(c,owner,id)
    attempt.receipt.fold(writable(attempt).toLeft(()).flatMap(_ => commit(c,owner,attempt)))(Right(_))
  }
  def abort(owner: String,id: UUID): UploadState = settled { c =>
    val attempt=current(c,owner,id)
    if(attempt.phase==UploadPhase.Open) Sql.exec(c,"UPDATE ch_uploads SET phase='Aborted',terminal_at=clock_timestamp() WHERE id=?",id)
    Right(state(reread(c,id)))
  }

  /** A transaction whose refusal keeps what it wrote (an expired lease, a failed commit): it commits, then fails. */
  private def settled[A](f: Connection => Either[DomainError,A]): A = db.transaction(f).fold(error => throw error,identity)
  /** The attempt under its source's ingest lock and its row lock; an Open one whose lease passed ends Expired. */
  private def current(c: Connection,owner: String,id: UUID): Attempt = {
    OwnerTargets.enabled(c,owner,true)
    val key=Sql.one(c,"SELECT source_key FROM ch_uploads WHERE id=? AND owner=?",id,owner)(_.getString(1)).getOrElse(throw DomainError("not-found","upload not found"))
    Sql.lock(c,s"ingest:$owner:$key")
    // Retention deletes ended attempts without the source's lock: one may be gone once the lock is ours.
    expired(c,Sql.one(c,s"$selectAttempt WHERE u.id=? FOR UPDATE OF u",id)(attempt).getOrElse(throw DomainError("not-found","upload not found")))
  }
  private def state(a: Attempt): UploadState =
    UploadState(a.id,a.requestId,a.phase,a.declaration.base.isDefined,a.parts,a.rawBytes,a.messages,a.lastPart,if(a.phase==UploadPhase.Open) a.expiresIn else 0,limits,a.receipt,a.failure)

  private def declared(open: UploadOpen): Unit = {
    def bounded(value: String): Unit = Check(value.getBytes(UTF_8).length<=UploadPolicy.maxDeclarationFieldBytes,"invalid",s"declaration strings have at most ${UploadPolicy.maxDeclarationFieldBytes} bytes")
    def sha256(value: String): Unit = Check(value.length==64 && value.forall(c => (c>='0' && c<='9') || (c>='a' && c<='f')),"invalid","digests and chains are lowercase hex SHA-256")
    Check(open.expectedRevision>=0 && open.rawBytes>=0 && open.messageCount>=0,"invalid","invalid declaration")
    UploadValidation.source(open.source)
    UploadValidation.path(open.rawPath); bounded(open.rawPath)
    UploadValidation.metadata(open.metadata)
    val m=open.metadata
    (List(m.title,m.producer)++m.project++m.workdir++m.gitRemote++m.gitBranch++m.gitCommit++m.model++m.startedAt++m.endedAt).foreach(bounded)
    sha256(open.digest); sha256(open.messageChain)
    open.base.foreach { base =>
      sha256(base.digest); sha256(base.messageChain)
      Check(open.expectedRevision>0 && base.rawBytes>=0 && base.messageCount>=0 && base.rawBytes<=open.rawBytes && base.messageCount<=open.messageCount,"invalid","the base is not a prefix of the declaration")
    }
    Check(open.rawBytes<=UploadPolicy.maxRawBytes(config),"too-large",s"declared raw bytes ${open.rawBytes} above the limit of ${UploadPolicy.maxRawBytes(config)} bytes")
    Check(open.messageCount<=config.maxMessages,"too-large",s"declared ${open.messageCount} messages above the limit of ${config.maxMessages}")
  }
  /** A new attempt of the intent, after the source's CAS: an append owns the head epoch's tail, a replacement a new epoch. */
  private def start(c: Connection,owner: String,key: String,open: UploadOpen,digest: String): UploadState = {
    val source=Sql.one(c,"SELECT id,revision,tombstone FROM ch_sources WHERE owner=? AND source_key=?",owner,key)(r => (r.getObject(1,classOf[UUID]),r.getInt(2),r.getBoolean(3)))
    def unpurged(): Unit = Check(!Sql.one(c,"SELECT tombstone FROM ch_sources WHERE owner=? AND source_key=?",owner,key)(_.getBoolean(1)).contains(true),"gone",purgedSource)
    unpurged()
    val revision=source.fold(0)(_._2)
    Check(revision==open.expectedRevision,"conflict",s"expected revision mismatch; current=$revision")
    Check(revision<PostgresArchive.maxRevision,"too-large",PostgresArchive.revisionLimit)
    val session=source.fold(UUID.randomUUID())(_._1)
    val id=UUID.randomUUID()
    val base=open.base.map { declared =>
      val head=(if(revision==0) None else EpochWriter.head(c,session,revision,unpurged)).filter(h => h.rawPath==open.rawPath && h.digest==declared.digest && h.rawBytes==declared.rawBytes
        && h.messages==declared.messageCount && EpochWriter.hex(h.chain)==declared.messageChain).getOrElse(throw DomainError("base-mismatch","the declared base is not the head revision"))
      releaseTail(c,head.epoch)
      head
    }
    // The owner's live attempts are counted and the new one is added under the owner's upload lock. Only opens take it,
    // always after their source's lock, so opens of the owner's other sources cannot both take the last slot.
    Sql.lock(c,s"uploads:$owner")
    Check(Sql.one(c,"SELECT count(*) FROM ch_uploads WHERE owner=? AND phase='Open' AND expires_at>clock_timestamp()",owner)(_.getInt(1)).get<policy.liveAttemptsPerOwner,
      "upload-busy",s"at most ${policy.liveAttemptsPerOwner} uploads of an owner are in progress")
    base.foreach(head => Sql.exec(c,"UPDATE ch_epochs SET tail_upload=? WHERE id=?",id,head.epoch))
    val epoch=base.fold {
      val epoch=UUID.randomUUID()
      Sql.exec(c,"INSERT INTO ch_epochs(id,session_id,raw_path,tail_upload) VALUES(?,?,?,?)",epoch,session,open.rawPath,id)
      epoch
    }(_.epoch)
    Using.resource(c.prepareStatement(s"""INSERT INTO ch_uploads(id,owner,source_key,request_id,attempt,session_id,declaration,declaration_digest,epoch,append,
        base_count,base_raw_bytes,base_records,base_message_bytes,base_fragment_count,raw_state,message_chain,message_time,phase,expires_at)
      VALUES(?,?,?,?,(SELECT coalesce(max(attempt),0)+1 FROM ch_uploads WHERE owner=? AND source_key=? AND request_id=?),?,?::jsonb,?,?,?,?,?,?,?,?,?,?,?,'Open',clock_timestamp()+?::bigint*interval '1 millisecond')""")) { s =>
      Sql.bind(s,List(id,owner,key,open.requestId,owner,key,open.requestId,session,Wire.encode(UploadOpen.codecJson,open).noSpaces,digest,epoch,base.isDefined,
        base.fold(0)(_.messages),base.fold(0L)(_.rawBytes),base.fold(0)(_.records),base.fold(0L)(_.messageBytes),base.fold(0L)(_.fragments)))
      s.setBytes(18,base.fold(ResumableSha256().state)(_.rawState)); s.setBytes(19,base.fold(MessageChain.initial)(_.chain))
      base.flatMap(_.messageTime).fold(s.setNull(20,Types.VARCHAR))(time => s.setString(20,time.toString))
      s.setLong(21,policy.ttl.toMillis)
      s.executeUpdate()
    }
    state(reread(c,id))
  }
  /** A part on its own (outside the transaction): the record cap first, then its digest, whole lines of JSON records,
    * scalar Unicode and every message's own fields; ids are checked against the epoch when it is written. */
  private def received(part: UploadPart,bodyBytes: Long): Received = {
    Check(part.ordinal>=0,"invalid","invalid part ordinal")
    UploadValidation.scalar(part.raw)
    Check(part.raw.isEmpty || part.raw.endsWith("\n"),"invalid","a part carries whole lines")
    var lines=0
    UploadValidation.recordLines(part.raw).foreach { record =>
      val bytes=utf8Length(record)
      if(bytes>config.maxRecordBytes) throw DomainError("record-too-large",s"record $lines of part ${part.ordinal} is $bytes bytes, above the record limit of ${config.maxRecordBytes} bytes (maxRecordBytes)")
      lines+=1
    }
    Check(bodyBytes<=UploadPolicy.maxPartBytes || lines==1,"too-large",s"a part above ${UploadPolicy.maxPartBytes} bytes carries exactly one record")
    val raw=part.raw.getBytes(UTF_8)
    Check(UploadValidation.partDigest(raw,part.messages)==part.sha256,"invalid","part sha256 mismatch")
    val recordIds=List.newBuilder[String]
    val records=UploadValidation.records(part.raw)(recordIds ++= _)
    val ids=part.messages.map(_.id)
    Check(ids.distinct.size==ids.size,"invalid","duplicate message IDs")
    part.messages.foreach(UploadValidation.message)
    val introduced=(ids++UploadValidation.parentKeys(recordIds.result())).distinct
    val local=introduced.toSet
    Received(part.messages.map(m => m.copy(text=SnapshotProjection.text(m.text))),raw.length.toLong,records,introduced.map(key),
      part.messages.flatMap(_.parentId).distinct.filterNot(local.contains).map(parent => parent -> key(parent)),
      part.messages.map(_.recordIndex).maxOption,part.messages.iterator.flatMap(m => ArchiveProjection.parsedTime(m.timestamp)).maxOption)
  }
  /** Writes the part's rows past the attempt's, resolves parentIds against the epoch (pending ones wait for a later part)
    * and records the part's receipt and the attempt's new state, renewing its lease. */
  private def write(c: Connection,owner: String,a: Attempt,part: UploadPart,content: Received): Unit = {
    val digest=ResumableSha256.resume(a.rawState)
    val appended=try EpochWriter.append(c,a.epoch,a.messageEnd,content.messages,part.raw,0,a.rawEnd,Math.toIntExact(a.recordEnd),digest) catch {
      case error: SQLException if uniqueViolation(error) => throw DomainError("invalid","duplicate message IDs")
    }
    Check(appended.records==content.records,"internal","written records differ from the validated part")
    Using.resource(c.prepareStatement("DELETE FROM ch_upload_parents WHERE upload=? AND parent_key IN(SELECT decode(k,'hex') FROM unnest(?::text[]) k)")) { s =>
      s.setObject(1,a.id); s.setArray(2,c.createArrayOf("text",content.keys.toArray)); s.executeUpdate()
    }
    Using.resource(c.prepareStatement("""INSERT INTO ch_upload_parents(upload,parent_key) SELECT ?,decode(p.key,'hex') FROM unnest(?::text[],?::text[]) p(id,key)
        WHERE NOT EXISTS(SELECT 1 FROM ch_epoch_messages m WHERE m.epoch=? AND m.message_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM ch_epoch_records r WHERE r.epoch=? AND r.record_key=decode(p.key,'hex')) ON CONFLICT DO NOTHING""")) { s =>
      s.setObject(1,a.id); s.setArray(2,c.createArrayOf("text",content.parents.map(_._1).toArray)); s.setArray(3,c.createArrayOf("text",content.parents.map(_._2).toArray))
      s.setObject(4,a.epoch); s.setObject(5,a.epoch); s.executeUpdate()
    }
    val messages=a.messages+content.messages.size
    val rawBytes=a.rawBytes+content.rawBytes
    val records=Math.addExact(a.records,content.records)
    Sql.exec(c,"INSERT INTO ch_upload_parts(upload,ordinal,sha256,messages_end,raw_end,records_end) VALUES(?,?,?,?,?,?)",a.id,part.ordinal,part.sha256,messages,rawBytes,records)
    val messageTime=(content.messageTime++a.messageTime.map(Instant.parse)).maxOption
    // The lease passed since the attempt was read once an open, counting under the owner's upload lock, could see it
    // ended and give its slot away: the renewal holds that lock and happens only while the lease still runs. Otherwise
    // the part is refused, its rows roll back, and the attempt's earlier staging stays its own for the sweep.
    Sql.lock(c,s"uploads:$owner")
    val renewed=Using.resource(c.prepareStatement(s"""UPDATE ch_uploads SET parts=parts+1,messages=?,raw_bytes=?,records=?,message_bytes=message_bytes+?,fragment_count=fragment_count+?,
        raw_state=?,message_chain=?,max_record_index=greatest(max_record_index,?),message_time=?,expires_at=clock_timestamp()+?::bigint*interval '1 millisecond'
        WHERE id=? AND expires_at>clock_timestamp()""")) { s =>
      s.setInt(1,messages); s.setLong(2,rawBytes); s.setInt(3,records); s.setLong(4,appended.messageBytes); s.setLong(5,appended.fragments)
      s.setBytes(6,digest.state); s.setBytes(7,MessageChain.extend(a.chain,content.messages)); s.setInt(8,content.maxRecordIndex.getOrElse(-1))
      messageTime.fold(s.setNull(9,Types.VARCHAR))(time => s.setString(9,time.toString)); s.setLong(10,policy.ttl.toMillis); s.setObject(11,a.id)
      s.executeUpdate()
    }
    Check(renewed==1,"upload-expired",leaseEnded)
  }
  /** The only visibility point: the staged rows below the declared counts become the next revision of the source. */
  private def commit(c: Connection,owner: String,a: Attempt): Either[DomainError,IngestReceipt] = {
    val open=a.declaration
    val pending=Sql.one(c,"SELECT count(*) FROM ch_upload_parents WHERE upload=?",a.id)(_.getLong(1)).get
    val mismatches=List(
      "raw digest"->(EpochWriter.hex(ResumableSha256.resume(a.rawState).digest)==open.digest),
      "raw bytes"->(a.rawEnd==open.rawBytes),
      "message count"->(a.messageEnd==open.messageCount),
      "message chain"->(EpochWriter.hex(a.chain)==open.messageChain),
      "every parentId resolved"->(pending==0),
      "every recordIndex below the record count"->(a.maxRecordIndex<a.recordEnd),
      // Only an attempt an earlier server staged can hold more.
      s"at most ${UploadPolicy.maxRecords} records"->(a.recordEnd<=UploadPolicy.maxRecords)).collect { case (name,false) => name }
    def failed(code: String,detail: String): Either[DomainError,IngestReceipt] = {
      Sql.exec(c,"UPDATE ch_uploads SET phase='Failed',failure=?,terminal_at=clock_timestamp() WHERE id=?",code,a.id)
      Left(DomainError(code,detail))
    }
    if(mismatches.nonEmpty) failed(contentMismatch,s"the uploaded content differs from the declaration: ${mismatches.mkString(", ")}")
    // An open refuses a source at the largest revision: only an attempt an earlier server opened can declare it.
    else if(open.expectedRevision>=PostgresArchive.maxRevision) failed("too-large",PostgresArchive.revisionLimit)
    else {
      val target=OwnerTargets.read(c,owner,true)
      db.profiles.resolve(target.profile)
      Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key) VALUES(?,?,?) ON CONFLICT(owner,source_key) DO NOTHING",a.sessionId,owner,a.key)
      def source(lock: String): Int = Sql.one(c,s"SELECT id,revision,tombstone FROM ch_sources WHERE owner=? AND source_key=?$lock",owner,a.key) { r =>
        Check(!r.getBoolean("tombstone"),"gone",purgedSource)
        val revision=r.getInt("revision")
        Check(revision==open.expectedRevision && r.getObject("id",classOf[UUID])==a.sessionId,"conflict",s"expected revision mismatch; current=$revision")
        revision
      }.get
      val head=source("")
      val next=head+1
      val previous=if(head==0) None else EpochWriter.head(c,a.sessionId,head,() => source("")).map(_.epoch)
      val envelope=SnapshotProjection(IngestRequest(open.requestId,open.source,open.expectedRevision,open.digest,open.completion,open.redacted,open.metadata,Nil,Nil))
      val messageTime=a.messageTime.map(Instant.parse)
      Using.resource(c.prepareStatement("INSERT INTO ch_revisions(session_id,revision,epoch,envelope,message_count,record_count,raw_bytes,message_bytes,fragment_count,raw_state,message_chain,message_time) VALUES(?,?,?,?::jsonb,?,?,?,?,?,?,?,?)")) { s =>
        s.setObject(1,a.sessionId); s.setInt(2,next); s.setObject(3,a.epoch); s.setString(4,EpochWriter.envelope(envelope))
        s.setInt(5,a.messageEnd); s.setInt(6,Math.toIntExact(a.recordEnd)); s.setLong(7,a.rawEnd); s.setLong(8,a.baseMessageBytes+a.messageBytes); s.setLong(9,a.baseFragments+a.fragments)
        s.setBytes(10,a.rawState); s.setBytes(11,a.chain)
        messageTime.fold(s.setNull(12,Types.VARCHAR))(time => s.setString(12,time.toString))
        s.executeUpdate()
      }
      ArchiveProjection.persistEpoch(c,a.sessionId,next,envelope,a.messageEnd,messageTime)
      Sql.exec(c,"UPDATE ch_epochs SET tail_upload=NULL WHERE id=? AND tail_upload=?",a.epoch,a.id)
      source(" FOR NO KEY UPDATE")
      Sql.exec(c,"UPDATE ch_sources SET revision=? WHERE id=?",next,a.sessionId)
      EpochWriter.switched(c,EpochWriter.Written(previous,Some(a.epoch)))
      val receipt=IngestReceipt(open.requestId,a.sessionId,next,Jobs.switched(c,a.sessionId,next,target.profile))
      val stored=Wire.encode(IngestReceipt.codecJson,receipt).noSpaces
      Sql.exec(c,"INSERT INTO ch_ingest_receipts VALUES(?,?,?,?,?::jsonb)",owner,a.key,open.requestId,a.digest,stored)
      Sql.exec(c,"UPDATE ch_uploads SET phase='Committed',receipt=?::jsonb,terminal_at=clock_timestamp(),cleaned=true WHERE id=?",stored,a.id)
      Right(receipt)
    }
  }
}
object Uploads {
  /** Terminal attempts that never committed are deleted this long after they ended; committed ones stay, like receipts. */
  val retention: FiniteDuration = 7.days
  /** The failure of an attempt that purge aborted. */
  val purged = "purged"
  private val contentMismatch = "content-mismatch"
  private val purgedSource = "source purged; use a new collector namespace to restore"
  private val leaseEnded = "the upload attempt expired; open it again"
  def sourceKey(source: SourceIdentity): String = Wire.hash(Wire.canonical(Wire.encode(SourceIdentity.codecJson,source)))

  private final case class Attempt(id: UUID,key: String,requestId: UUID,sessionId: UUID,declaration: UploadOpen,digest: String,epoch: UUID,
    baseCount: Int,baseRawBytes: Long,baseRecords: Int,baseMessageBytes: Long,baseFragments: Long,parts: Int,messages: Int,rawBytes: Long,records: Int,
    messageBytes: Long,fragments: Long,rawState: Array[Byte],chain: Array[Byte],maxRecordIndex: Int,messageTime: Option[String],phase: UploadPhase,cleaned: Boolean,
    receipt: Option[IngestReceipt],failure: Option[String],lastPart: Option[String],expiresIn: Int,expired: Boolean) {
    def messageEnd: Int = baseCount+messages
    def rawEnd: Long = baseRawBytes+rawBytes
    def recordEnd: Long = baseRecords.toLong+records
  }
  /** A validated part: its stored messages, raw bytes and records, the SHA-256 keys (hex) of the ids it introduces, its
    * parentIds that are not its own (with their keys), its largest recordIndex and latest message time. */
  private final case class Received(messages: List[Message],rawBytes: Long,records: Int,keys: List[String],parents: List[(String,String)],maxRecordIndex: Option[Int],messageTime: Option[Instant])
  private val selectAttempt = """SELECT u.*,(SELECT p.sha256 FROM ch_upload_parts p WHERE p.upload=u.id AND p.ordinal=u.parts-1) AS last_part,
    greatest(0,ceil(extract(epoch FROM u.expires_at-clock_timestamp())))::integer AS expires_in,u.expires_at<=clock_timestamp() AS expired FROM ch_uploads u"""
  private def attempt(r: java.sql.ResultSet): Attempt =
    Attempt(r.getObject("id",classOf[UUID]),r.getString("source_key"),r.getObject("request_id",classOf[UUID]),r.getObject("session_id",classOf[UUID]),
      Wire.decode(UploadOpen.codecJson,Sql.json(r,"declaration")),r.getString("declaration_digest"),r.getObject("epoch",classOf[UUID]),
      r.getInt("base_count"),r.getLong("base_raw_bytes"),r.getInt("base_records"),r.getLong("base_message_bytes"),r.getLong("base_fragment_count"),
      r.getInt("parts"),r.getInt("messages"),r.getLong("raw_bytes"),r.getInt("records"),r.getLong("message_bytes"),r.getLong("fragment_count"),
      r.getBytes("raw_state"),r.getBytes("message_chain"),r.getInt("max_record_index"),Option(r.getString("message_time")),
      UploadPhase.parse(r.getString("phase")).get,r.getBoolean("cleaned"),Option(r.getString("receipt")).map(receipt => Wire.decode(IngestReceipt.codecJson,Wire.parse(receipt))),
      Option(r.getString("failure")),Option(r.getString("last_part")),r.getInt("expires_in"),r.getBoolean("expired"))
  private def reread(c: Connection,id: UUID): Attempt = Sql.one(c,s"$selectAttempt WHERE u.id=?",id)(attempt).get
  private def expired(c: Connection,a: Attempt): Attempt =
    if(a.phase==UploadPhase.Open && a.expired) {
      Sql.exec(c,"UPDATE ch_uploads SET phase='Expired',terminal_at=clock_timestamp() WHERE id=?",a.id)
      a.copy(phase=UploadPhase.Expired)
    } else a
  /** The source's live attempt, row-locked; one whose lease passed ends Expired and is not live. */
  private def live(c: Connection,owner: String,key: String): Option[Attempt] =
    Sql.one(c,s"$selectAttempt WHERE u.owner=? AND u.source_key=? AND u.phase='Open' FOR UPDATE OF u",owner,key)(attempt).map(expired(c,_)).filter(_.phase==UploadPhase.Open)
  /** Why parts and the commit are refused by an attempt that is not Open (Committed is answered by the commit itself). */
  private def writable(a: Attempt): Option[DomainError] = a.phase match {
    case UploadPhase.Open => None
    case UploadPhase.Expired => Some(DomainError("upload-expired",leaseEnded))
    case UploadPhase.Aborted if a.failure.contains(purged) => Some(DomainError("gone",purgedSource))
    case phase => Some(DomainError("conflict",s"the upload attempt is $phase"))
  }
  /** A part's source has not been purged since its attempt started (a purge aborts the attempt first, so this is the
    * attempt of a source purged while no part held it). */
  private def unpurged(c: Connection,owner: String,a: Attempt): Unit =
    Check(!Sql.one(c,"SELECT tombstone FROM ch_sources WHERE owner=? AND source_key=?",owner,a.key)(_.getBoolean(1)).contains(true),"gone",purgedSource)
  /** The rows of `epoch` beyond its committed counts belong to `tail_upload`: a live owner keeps them (upload-busy); a
    * terminal one loses them now, once, and is marked cleaned. Runs under the source's ingest lock. */
  private def releaseTail(c: Connection,epoch: UUID): Unit =
    Sql.one(c,"SELECT e.tail_upload,u.phase FROM ch_epochs e LEFT JOIN ch_uploads u ON u.id=e.tail_upload WHERE e.id=? AND e.tail_upload IS NOT NULL",epoch)(r => (r.getObject(1,classOf[UUID]),Option(r.getString(2)))).foreach { case (owner,phase) =>
      Check(!phase.contains("Open"),"upload-busy","another upload of this source is in progress")
      val floors=EpochMaintenance.Floors.staged(c,epoch)
      while(EpochMaintenance.deleteRows(c,epoch,floors)) ()
      Sql.exec(c,"UPDATE ch_epochs SET tail_upload=NULL WHERE id=?",epoch)
      Sql.exec(c,"UPDATE ch_uploads SET cleaned=true WHERE id=?",owner)
    }
  /** `/api/ingest` on a source (spec §4.6), under its ingest lock: refused while an upload attempt is live; the staging
    * that an ended attempt left in the head's epoch is deleted before the append. */
  def admitIngest(c: Connection,owner: String,key: String): Unit = {
    Check(live(c,owner,key).isEmpty,"upload-busy","an upload of this source is in progress")
    // Only an ended attempt that was not cleaned can own staging: without one, no epoch is read.
    if(Sql.one(c,"SELECT 1 FROM ch_uploads WHERE owner=? AND source_key=? AND NOT cleaned LIMIT 1",owner,key)(_ => true).nonEmpty)
      Sql.one(c,"SELECT r.epoch FROM ch_sources s JOIN ch_revisions r ON r.session_id=s.id AND r.revision=s.revision WHERE s.owner=? AND s.source_key=? AND r.epoch IS NOT NULL",owner,key)(_.getObject(1,classOf[UUID]))
        .foreach(releaseTail(c,_))
  }
  /** One step of the sweep for attempt `id`, under its source's ingest lock: a passed lease ends Expired; the staging of
    * an attempt that ended is deleted, `EpochMaintenance.rowsPerStatement` rows per step, while the attempt still owns it,
    * then the tail is released (an epoch that no revision references goes with it) and the attempt is marked cleaned
    * (also when another attempt took its tail over). True while staging remains. */
  private[chronicle] def sweep(c: Connection,id: UUID): Boolean =
    Sql.one(c,s"$selectAttempt WHERE u.id=? FOR UPDATE OF u",id)(attempt).map(expired(c,_)).filter(a => a.phase!=UploadPhase.Open && !a.cleaned).exists { a =>
      val owned=Sql.one(c,"SELECT 1 FROM ch_epochs WHERE id=? AND tail_upload=?",a.epoch,id)(_ => true).nonEmpty
      val more=owned && EpochMaintenance.deleteRows(c,a.epoch,EpochMaintenance.Floors.staged(c,a.epoch))
      if(!more) {
        if(owned) {
          val referenced=Sql.one(c,"SELECT 1 FROM ch_revisions WHERE epoch=? LIMIT 1",a.epoch)(_ => true).nonEmpty
          if(referenced) Sql.exec(c,"UPDATE ch_epochs SET tail_upload=NULL WHERE id=?",a.epoch) else Sql.exec(c,"DELETE FROM ch_epochs WHERE id=?",a.epoch)
        }
        Sql.exec(c,"UPDATE ch_uploads SET cleaned=true WHERE id=?",id)
      }
      more
    }
  private def key(id: String): String = MessageDigest.getInstance("SHA-256").digest(id.getBytes(UTF_8)).map(b => f"${b & 255}%02x").mkString
  private def utf8Length(value: String): Long = {
    var bytes=0L; var index=0
    while(index<value.length) {
      val char=value.charAt(index)
      bytes+= (if(char<0x80) 1 else if(char<0x800) 2 else if(Character.isHighSurrogate(char)) { index+=1; 4 } else 3)
      index+=1
    }
    bytes
  }
  private def uniqueViolation(error: Throwable): Boolean = error match {
    case sql: SQLException => sql.getSQLState=="23505" || Option(sql.getNextException).exists(uniqueViolation) || Option(sql.getCause).exists(uniqueViolation)
    case other => Option(other.getCause).exists(uniqueViolation)
  }
}
