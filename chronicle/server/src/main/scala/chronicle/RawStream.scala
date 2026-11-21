package chronicle

import chronicle.api.*
import cats.effect.IO
import fs2.{Chunk,Stream}
import org.http4s.{Header,Response,Status}
import org.typelevel.ci.CIString
import java.sql.Connection
import java.util.UUID
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicBoolean

/** Raw downloads over HTTP (ingest limits spec §1): the manifest of a revision's raw files and the bytes of one file, any
  * size, in windows. A download pins its revision and file in one transaction, then reads each window in a short
  * repeatable-read transaction of its own that checks the reader's browser session, the session's visibility and the
  * revision again (a purge, a removed sharing or a logout stops it at the next window), and reads the next window only once
  * the previous one was written (fs2 back-pressure). No transaction spans a window and the server holds one window per
  * download; at most `maxStreams` downloads run at once and the next one is refused before any byte. */
final class RawStream(db: Database,archive: PostgresArchive,auth: Auth,logger: logstage.IzLogger,policy: RawStream.Policy) {
  import RawStream.*
  private val permits=new Semaphore(policy.maxStreams)

  def manifest(reader: Identity,id: UUID,revision: Option[Int]): IO[RawManifest] = IO.blocking(authorized(reader,id) { c =>
    val selected=revision.getOrElse(Sql.one(c,"SELECT revision FROM ch_sources WHERE id=?",id)(_.getInt(1)).get)
    RawManifest(id,selected,RevisionContent.rawFiles(c,content(c,id,selected)))
  })

  /** The bytes of file `file`, all of them or the requested range (ignored unless `ifRange` is absent or the ETag). A
    * permit is taken before the revision is pinned and returned when the body ends, fails or is abandoned: Ember pulls
    * the body before it writes the response head (its encoder joins the head with the first body chunk), so a client gone
    * before the head still runs the body's finalizer. */
  def download(reader: Identity,id: UUID,revision: Int,file: Int,requested: Option[Range],ifRange: Option[String]): IO[Answer] =
    IO.uncancelable { poll =>
      IO(permits.tryAcquire()).flatMap { admitted =>
        Check(admitted,"unavailable","all raw downloads are taken; retry later")
        val returned=new AtomicBoolean(false)
        val release=IO(if(returned.compareAndSet(false,true)) permits.release())
        poll(IO.blocking(pin(reader,id,revision,file))).flatMap { pinned =>
          val total=pinned.file.bytes
          val applied=requested.filter(_ => ifRange.forall(_==etag(pinned.file.sha256)))
          applied.map(_.within(total)) match {
            case Some(None) => release.as(Answer.Unsatisfiable(total))
            case interval =>
              val (from,until)=interval.flatten.getOrElse((0L,total))
              IO.pure(Answer.Bytes(response(pinned,from,until,applied.nonEmpty,Stream.bracket(IO.unit)(_ => release) >> body(reader,pinned,from,until))))
          }
        }.onError(_ => release).onCancel(release)
      }
    }

  /** One short repeatable-read transaction in which the reader's browser session is live and the session visible to it. */
  private def authorized[A](reader: Identity,id: UUID)(f: Connection => A): A = db.transaction { c =>
    c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
    auth.currentBrowser(c,reader)
    archive.authorized(c,reader.user.id,id)
    f(c)
  }
  private def content(c: Connection,id: UUID,revision: Int): RevisionContent =
    RevisionContent.resolve(c,id,revision).getOrElse(throw DomainError("not-found","content view not found"))
  private def pin(reader: Identity,id: UUID,revision: Int,file: Int): Pinned = authorized(reader,id) { c =>
    val stored=content(c,id,revision)
    Pinned(stored,RevisionContent.rawFiles(c,stored).find(_.index==file).getOrElse(throw DomainError("not-found","raw file not found")))
  }
  private def body(reader: Identity,pinned: Pinned,from: Long,until: Long): Stream[IO,Byte] = {
    val windowBytes=pinned.content match { case _: RevisionContent.Epoch => policy.epochWindowBytes; case _: RevisionContent.Legacy => policy.legacyWindowBytes }
    Stream.unfoldChunkEval(from) { at =>
      if(at==until) IO.pure(None)
      else { val end=math.min(until,at+windowBytes); IO.blocking(window(reader,pinned,at,end)).map(bytes => Some(Chunk.array(bytes) -> end)) }
    }.handleErrorWith { failure =>
      val code=failure match { case d: DomainError => d.code; case other => other.getClass.getSimpleName }
      Stream.exec(IO(logger.warn(s"raw download stopped before its end ${pinned.content.id -> "sessionId"} $code"))) ++ Stream.raiseError[IO](failure)
    }
  }
  /** Each window holds exactly its bytes or fails: the response then ends short of its length, never with other bytes. */
  private def window(reader: Identity,pinned: Pinned,from: Long,until: Long): Array[Byte] = authorized(reader,pinned.content.id) { c =>
    Check(RevisionContent.resolve(c,pinned.content.id,pinned.content.revision).contains(pinned.content),"not-found","content view not found")
    pinned.content match {
      case epoch: RevisionContent.Epoch => RevisionContent.epochRawWindow(c,epoch,from,until)
      case legacy: RevisionContent.Legacy => RevisionContent.legacyRawWindow(c,legacy,pinned.file.index,from,until)
    }
  }
}

object RawStream {
  /** Bytes per window of an epoch revision: 2-12 ms of database time each (ingest limits spec §1 M1). */
  val windowBytes: Int = 4*1024*1024
  /** Bytes per window of a legacy revision: every window detoasts the whole snapshot (0.6 s for 210 MB, M2). */
  val legacyWindowBytes: Int = 16*1024*1024
  /** Concurrent downloads: each holds a window and its JDBC decoding (at most three times the window). */
  val maxStreams: Int = 4
  /** The `Retry-After` of a download refused because every permit is taken. */
  val retryAfterSeconds: Long = 5
  final case class Policy(epochWindowBytes: Int,legacyWindowBytes: Int,maxStreams: Int)
  object Policy {
    val production: Policy = Policy(windowBytes,legacyWindowBytes,maxStreams)
  }
  final case class Pinned(content: RevisionContent,file: RawFileInfo)
  enum Answer {
    case Bytes(response: Response[IO])
    /** No byte of the requested range lies within the file of `total` bytes. */
    case Unsatisfiable(total: Long)
  }
  /** One byte range (RFC 9110 §14.1.2): `bytes=first-last`, `bytes=first-` or `bytes=-suffix`. */
  enum Range {
    case From(first: Long,last: Option[Long])
    case Suffix(length: Long)
    /** The half-open byte interval of a file of `total` bytes, or None when no byte of the range lies within it. */
    def within(total: Long): Option[(Long,Long)] = this match {
      case From(first,last) => if(first>=total) None else Some((first,last.fold(total)(l => math.min(l,total-1)+1)))
      case Suffix(length) => if(length==0 || total==0) None else Some((math.max(0L,total-length),total))
    }
  }
  private val fromPattern="""(?i)bytes=([0-9]+)-([0-9]*)""".r
  private val suffixPattern="""(?i)bytes=-([0-9]+)""".r
  private def bounded(digits: String): Long = BigInt(digits).min(BigInt(Long.MaxValue)).toLong
  /** One range only: several ranges, other units or any other syntax are `invalid`. */
  def range(header: String): Range = header match {
    case fromPattern(firstDigits,lastDigits) =>
      val first=bounded(firstDigits); val last=Option(lastDigits).filter(_.nonEmpty).map(bounded)
      Check(last.forall(_>=first),"invalid","the last byte of the range precedes its first")
      Range.From(first,last)
    case suffixPattern(length) => Range.Suffix(bounded(length))
    case _ => throw DomainError("invalid","one byte range bytes=FIRST-LAST, bytes=FIRST- or bytes=-SUFFIX required")
  }
  def sessionId(segment: String): UUID =
    scala.util.Try(UUID.fromString(segment)).toOption.filter(_.toString.equalsIgnoreCase(segment)).getOrElse(throw DomainError("invalid","session id must be a UUID"))
  private def number(segment: String): Option[Int] = Option.when(segment.matches("0|[1-9][0-9]{0,9}"))(segment.toLong).filter(_<=Int.MaxValue).map(_.toInt)
  def revision(segment: String): Int = number(segment).filter(_>=1).getOrElse(throw DomainError("invalid","revision must be a positive integer"))
  def file(segment: String): Int = number(segment).getOrElse(throw DomainError("invalid","file must be a non-negative integer"))
  /** Strong: a session id and revision never name other bytes (revisions are immutable; a purged source takes none again). */
  def etag(sha256: String): String = "\"sha256:"+sha256+"\""
  /** RFC 9530: the digest of the whole file, also on a partial response. */
  def reprDigest(sha256: String): String = "sha-256=:"+java.util.Base64.getEncoder.encodeToString(java.util.HexFormat.of().parseHex(sha256))+":"
  private def response(pinned: Pinned,from: Long,until: Long,partial: Boolean,body: Stream[IO,Byte]): Response[IO] = {
    val file=pinned.file
    val response=Response[IO](if(partial) Status.PartialContent else Status.Ok).withBodyStream(body).putHeaders(
      org.http4s.headers.`Content-Length`.unsafeFromLong(until-from),
      Header.Raw(CIString("Content-Type"),"application/octet-stream"),
      Header.Raw(CIString("Content-Disposition"),s"""attachment; filename="chronicle-${pinned.content.id}-r${pinned.content.revision}-f${file.index}.jsonl""""),
      Header.Raw(CIString("ETag"),etag(file.sha256)),
      Header.Raw(CIString("Repr-Digest"),reprDigest(file.sha256)),
      Header.Raw(CIString("Accept-Ranges"),"bytes"),
      Header.Raw(CIString("Cache-Control"),"no-store"),
      Header.Raw(CIString("X-Content-Type-Options"),"nosniff")
    )
    if(partial) response.putHeaders(Header.Raw(CIString("Content-Range"),s"bytes $from-${until-1}/${file.bytes}")) else response
  }
}
