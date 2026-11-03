package manure

import cats.effect.{IO, Resource}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import manure.storage.{ConfinedDirectory, ConfinedFile, RootLease}
import java.io.IOException

trait DomainClock:
  def now: Double
object SystemDomainClock extends DomainClock:
  def now: Double = System.currentTimeMillis().toDouble / 1000.0
trait Faults:
  def apply(window: String): Unit
object NoFaults extends Faults:
  def apply(window: String): Unit = ()

/** One physical-root owner, one serialized process exclusion. PostgreSQL locks
  * additionally serialize reservation/receipt/auth transactions, not a claim of
  * multi-host payload support. The process gate spans multi-transaction publish
  * windows; its resource and the validated root lease outlive every DB worker.
  */
final class Artifacts(metadata: Metadata, payloads: Payloads, limits: Limits,
  clock: DomainClock, auth: Auth, root: RootLease, gate: Semaphore[IO], faults: Faults):
  private def serialized[A](work: IO[A]): IO[A] = gate.permit.use(_ => work)
  private def blocking[A](work: => A): IO[A] = IO.blocking(root.run(work))
  private def get(tx: MetadataTxn, id: String): Artifact =
    Require(id.matches("[0-9a-f]{32}"), "not-found")
    tx.artifact(id).getOrElse(throw DomainError("not-found"))
  private def live(tx: MetadataTxn, id: String): Artifact =
    val a = get(tx,id); a.requireLive(clock.now); a
  private def owned(tx: MetadataTxn, user: String, id: String): Artifact =
    val a = live(tx,id); a.requireOwner(user); a
  def initialize(): IO[Unit] = blocking(payloads.initialize()) *> reconcile()
  def init(identity: Identity, request: InitUpload): IO[Initialized] = serialized {
    IO {
      UploadRules.name(request.name); UploadRules.ttl(request.expiresInSeconds)
      Manifest.validate(request.files,request.kind,limits)
    }.flatMap { total =>
      val password = if request.visibility == Visibility.External then Some(SecretCodec.token()) else None
      val now = clock.now
      val expiry = request.expiresInSeconds.map(now + _.toDouble)
      val a = Artifact(SecretCodec.artifactId(),request.name,request.kind,request.visibility,
        identity.userId,identity.tokenId,Exact.displayTime(math.floor(now)),math.floor(now),
        expiry.map(Exact.displayTime),expiry,UploadState.Uploading,total,request.files.size,total,
        password.map(SecretCodec.sha256),now,Manifest.encode(request.files))
      metadata.transaction { tx =>
        Require(auth.live(identity), "unauthorized")
        Require(total <= limits.storageQuotaBytes - tx.reservation, "quota-exceeded")
        Require(tx.sessions(None) < limits.maxSessionsGlobal && tx.sessions(Some(identity.userId)) < limits.maxSessionsPerUser, "session-limit")
        payloads.stage(a); payloads.sidecar(a); faults("before_init_commit"); tx.put(a)
      }.as(Initialized(a,password))
      // Do not unlink on an uncertain PG commit response: committed state may own
      // these bytes. Startup/sweep cleans only freshly revalidated orphan trees.
    }
  }
  def info(identity: Identity,id: String, includeExpired: Boolean = false): IO[Artifact] = serialized {
    metadata.transaction { tx =>
      Require(auth.live(identity), "unauthorized")
      val a = get(tx,id); if !includeExpired then a.requireLive(clock.now); a.requireOwner(identity.userId); a
    }
  }
  def snapshot(identity: Identity, after: Option[String], limit: Int): IO[Vector[Artifact]] = metadata.transaction { tx =>
    Require(auth.live(identity), "unauthorized"); tx.artifacts(after,limit)
  }
  def patch(identity: Identity,id: String, patch: ArtifactPatch): IO[Initialized] = serialized {
    metadata.transaction { tx =>
      Require(auth.live(identity), "unauthorized")
      val a = owned(tx,identity.userId,id)
      Require(a.state == UploadState.Ready, "state-conflict")
      patch.name.foreach(UploadRules.name)
      val expiry = patch.ttl match
        case TtlPatch.Unchanged => a.expiresAtSeconds
        case TtlPatch.Never => None
        case TtlPatch.After(seconds) => UploadRules.ttl(Some(seconds)); Some(clock.now + seconds)
      val visibility = patch.visibility.getOrElse(a.visibility)
      val password = if visibility == Visibility.External && a.visibility != Visibility.External then Some(SecretCodec.token()) else None
      val hash = if visibility != Visibility.External then None else password.map(SecretCodec.sha256).orElse(a.externalPasswordHash)
      val updated = a.copy(name=patch.name.getOrElse(a.name),visibility=visibility,
        expiresAt=expiry.map(Exact.displayTime),expiresAtSeconds=expiry,externalPasswordHash=hash)
      if visibility != a.visibility then tx.revokeArtifact(id)
      tx.put(updated); Initialized(updated,password)
    }
  }
  def rotate(identity: Identity,id: String): IO[String] = serialized {
    metadata.transaction { tx =>
      Require(auth.live(identity), "unauthorized")
      val a = owned(tx,identity.userId,id)
      Require(a.state == UploadState.Ready, "state-conflict")
      Require(a.visibility == Visibility.External, "invalid-visibility")
      val password = SecretCodec.token()
      tx.put(a.copy(externalPasswordHash=Some(SecretCodec.sha256(password)))); tx.revokeArtifact(id); password
    }
  }
  def delete(identity: Identity,id: String): IO[Unit] = serialized {
    metadata.transaction { tx =>
      Require(auth.live(identity), "unauthorized")
      val a = get(tx,id); a.requireOwner(identity.userId); tx.delete(id); a
    }.flatMap(a => blocking(payloads.cleanup(a)))
  }
  def status(identity: Identity,id: String): IO[UploadProgress] = serialized {
    metadata.transaction { tx =>
      Require(auth.live(identity), "unauthorized")
      val a = owned(tx,identity.userId,id)
      UploadProgress(id,a.state,a.manifest.filterNot(_.directory).map { e =>
        val ranges = UploadRules.ranges(tx.receipts(id,e.path),e.size)
        FileProgress(e.path,e.size,ranges.map((s,e) => e-s).sum,ranges)
      })
    }
  }
  def putChunk(identity: Identity,id: String,path: String,offset: Long,bytes: Array[Byte],sha: String): IO[Long] = serialized {
    IO {
      Manifest.path(path)
      Require(sha.matches("[a-fA-F0-9]{64}") && SecretCodec.sha256(bytes) == sha.toLowerCase(java.util.Locale.ROOT), "invalid-range")
    } *> metadata.transaction { tx =>
      Require(auth.live(identity), "unauthorized")
      val a = owned(tx,identity.userId,id)
      Require(a.state == UploadState.Uploading, "state-conflict")
      val e = a.manifest.find(e => !e.directory && e.path == path).getOrElse(throw DomainError("not-found"))
      UploadRules.chunk(e.size,offset,bytes.length,limits)
      val receipt = Receipt(id,path,offset,bytes.length,SecretCodec.sha256(bytes))
      val existing = tx.receipts(id,path).find(_.offset == offset)
      existing.foreach(r => Require(r.length == receipt.length && r.sha256 == receipt.sha256, "chunk-conflict"))
      if !existing.exists(payloads.receiptValid(a,_)) then
        payloads.write(a,path,offset,bytes)
        faults("after_chunk_fsync")
      if existing.isEmpty then tx.putReceipt(receipt)
      tx.put(a.copy(lastActivityAt=clock.now)); faults("before_receipt_commit")
      UploadRules.ranges(tx.receipts(id,path),e.size).map((s,e) => e-s).sum
    } // IO result exists only after durable transaction COMMIT.
  }
  private def repair(tx: MetadataTxn,a: Artifact): Unit =
    payloads.stage(a)
    a.manifest.filterNot(_.directory).foreach { e =>
      tx.receipts(a.id,e.path).foreach { r =>
        val inFile = r.offset >= 0 && r.length > 0 && r.offset <= e.size && r.length <= e.size-r.offset
        if !inFile || !payloads.receiptValid(a,r) then tx.deleteReceipt(a.id,e.path,r.offset)
      }
      val end = tx.receipts(a.id,e.path).map(r => r.offset+r.length).maxOption.getOrElse(0L)
      payloads.truncateTo(a,e.path,math.min(e.size,end))
    }
  private def ready(a: Artifact): IO[Artifact] = metadata.transaction { tx =>
    val current = get(tx,a.id)
    Require(current.state != UploadState.Ready || payloads.complete(current,true), "unavailable")
    val out = current.copy(state=UploadState.Ready)
    tx.put(out); tx.clearReceipts(a.id); faults("ready_commit"); out
  }.flatTap(a => blocking(payloads.cleanupStage(a)))
  private def recover(a: Artifact): IO[Artifact] =
    blocking(payloads.complete(a,true)).flatMap { completeLive =>
      if completeLive then blocking(payloads.forceLive(a,faults.apply)) *> ready(a)
      else blocking(payloads.complete(a,false)).flatMap { completeStage =>
        if completeStage then blocking(payloads.publish(a,faults.apply)) *> ready(a)
        else metadata.transaction { tx =>
          val current = get(tx,a.id)
          repair(tx,current)
          val out = current.copy(state=UploadState.Uploading); tx.put(out); out
        }
      }
    }
  def finish(identity: Identity,id: String): IO[Artifact] = serialized {
    metadata.transaction { tx =>
      Require(auth.live(identity), "unauthorized"); owned(tx,identity.userId,id)
    }.flatMap { a =>
      a.state match
        case UploadState.Ready => IO.pure(a)
        case UploadState.Publishing => recover(a).attempt *> IO.raiseError(DomainError("state-conflict"))
        case UploadState.Uploading =>
          metadata.transaction { tx =>
            val current = owned(tx,identity.userId,id)
            if !payloads.complete(current,false) then
              // Repair commits before reporting failure, not rolled back by it.
              val code = if payloads.structureComplete(current,false) then "hash-mismatch" else "incomplete-upload"
              repair(tx,current); Left(DomainError(code))
            else
              val publishing = current.copy(state=UploadState.Publishing)
              tx.put(publishing); faults("publishing_commit"); Right(publishing)
          }.flatMap {
            case Left(error) => IO.raiseError(error)
            case Right(publishing) =>
              blocking(faults("after_publishing_commit")) *>
                blocking(payloads.publish(publishing,faults.apply)) *>
                blocking(faults("before_ready_commit")) *> ready(publishing)
          }
    }
  }
  /** Startup walks bounded keyset batches. A corrupt row/tree is left unserved
    * or resumable; no single bad payload causes a partial ready transition.
    */
  def reconcile(): IO[Unit] =
    def batch(after: Option[String]): IO[Unit] = metadata.transaction(_.artifacts(after,limits.sweepBatch)).flatMap { rows =>
      rows.traverse_ { a => serialized {
        (a.state match
          case UploadState.Publishing => recover(a).void
          case UploadState.Uploading =>
            blocking(payloads.complete(a,true)).flatMap { completeLive =>
              if completeLive then blocking(payloads.forceLive(a,faults.apply)) *> ready(a).void
              else metadata.transaction { tx => repair(tx,get(tx,a.id)) }
            }
          case UploadState.Ready => blocking(payloads.cleanupStage(a))
        ).handleErrorWith {
          case _: IOException | _: DomainError => IO.unit
          case error => IO.raiseError(error)
        }
      }} *> (if rows.size == limits.sweepBatch then batch(Some(rows.last.id)) else IO.unit)
    }
    batch(None)
  def sweep(): IO[Int] =
    def batch(after: Option[String],removed: Int): IO[Int] = metadata.transaction(_.artifacts(after,limits.sweepBatch)).flatMap { rows =>
      rows.traverse { a => serialized {
        metadata.transaction { tx =>
          tx.artifact(a.id).filter { current =>
            current.expired(clock.now) || current.state == UploadState.Uploading && clock.now-current.lastActivityAt > limits.incompleteSessionTtl
          }.map { current => tx.delete(current.id); current }
        }.flatMap {
          case Some(current) => blocking(payloads.cleanup(current)).as(1)
          case None => IO.pure(0)
        }
      }}.flatMap { counts =>
        val total = removed+counts.sum
        if rows.size == limits.sweepBatch then batch(Some(rows.last.id),total) else IO.pure(total)
      }
    }
    batch(None,0).flatTap(_ => metadata.transaction(_.sweepGrants(clock.now)))
  private def issue(tx: MetadataTxn,a: Artifact,identity: Option[Identity],passwordHash: Option[String]): (String,Double) =
    val value = SecretCodec.token()
    val expiry = math.min(clock.now+limits.grantTtl,a.expiresAtSeconds.getOrElse(Double.PositiveInfinity))
    tx.putContent(ContentGrant(SecretCodec.sha256(value),a.id,expiry,clock.now,identity.map(_.userId),identity.map(_.tokenId),identity.map(_.tokenDigest),passwordHash))
    tx.trimContent(a.id,limits.maxGrantsPerArtifact); (value,expiry)
  def createGrant(identity: Identity,id: String): IO[String] = serialized {
    metadata.transaction { tx =>
      Require(auth.live(identity), "unauthorized")
      val a = live(tx,id)
      Require(a.state == UploadState.Ready, "state-conflict")
      Require(a.visibility == Visibility.Internal, "invalid-visibility")
      val value = SecretCodec.token()
      tx.putOneTime(OneTimeGrant(SecretCodec.sha256(value),id,identity.userId,clock.now+limits.oneTimeGrantTtl,false,
        Some(identity.userId),Some(identity.tokenId),Some(identity.tokenDigest))); value
    }
  }
  def redeem(id: String,value: String): IO[(String,Double)] = serialized {
    metadata.transaction { tx =>
      val a = live(tx,id)
      Require(a.state == UploadState.Ready && a.visibility == Visibility.Internal, "invalid-visibility")
      Require(SecretCodec.canonical(value), "grant-invalid")
      val g = tx.oneTime(SecretCodec.sha256(value)).getOrElse(throw DomainError("grant-invalid"))
      Require(g.artifactId == id && !g.used, "grant-invalid")
      Require(clock.now < g.expiresAt, "grant-expired")
      val user = g.userId.getOrElse(""); val token = g.tokenId.getOrElse(""); val digest = g.tokenDigest.getOrElse("")
      Require(auth.credentialLive(user,token,digest), "grant-invalid")
      tx.putOneTime(g.copy(used=true)); issue(tx,a,Some(Identity(user,"",token,digest)),None)
    }
  }
  def unlock(id: String,password: String): IO[(String,Double)] = serialized {
    metadata.transaction { tx =>
      val a = get(tx,id)
      Require(a.state == UploadState.Ready && a.visibility == Visibility.External && !a.expired(clock.now) &&
        password.nonEmpty && a.externalPasswordHash.exists(SecretCodec.verify(password,_)), "password-invalid")
      issue(tx,a,None,a.externalPasswordHash)
    }
  }
  def logout(identity: Identity): IO[Unit] = serialized(metadata.transaction(_.revokeCredential(identity.userId,identity.tokenId)))
  def logoutContent(value: String): IO[Unit] = serialized(metadata.transaction(_.deleteContent(SecretCodec.sha256(value))))
  private def authorized(tx: MetadataTxn,id: String,grant: Option[String],password: Option[String],identity: Option[Identity]): Artifact =
    val a = get(tx,id)
    // External callers cannot distinguish absent/expired/incomplete private IDs.
    Require(a.state == UploadState.Ready && !a.expired(clock.now), "not-found")
    val bound = grant.filter(SecretCodec.canonical).flatMap(v => tx.content(SecretCodec.sha256(v))).exists { g =>
      g.artifactId == id && clock.now < g.expiresAt && (
        (a.visibility == Visibility.Internal && g.userId.exists(u => auth.credentialLive(u,g.tokenId.getOrElse(""),g.tokenDigest.getOrElse("")))) ||
        (a.visibility == Visibility.External && g.passwordHash.nonEmpty && g.passwordHash == a.externalPasswordHash))
    }
    val management = identity.exists(auth.live)
    val allowed = a.visibility match
      case Visibility.Public => true
      case Visibility.Internal => management || bound
      case Visibility.External => management || bound || password.exists(p => a.externalPasswordHash.exists(SecretCodec.verify(p,_)))
    Require(allowed, if a.visibility == Visibility.External then "password-required" else "grant-required")
    a
  def contentInfo(id: String,grant: Option[String],password: Option[String],identity: Option[Identity]): IO[Artifact] =
    serialized(metadata.transaction(tx => authorized(tx,id,grant,password,identity)))
  def openContent(id: String,path: String,grant: Option[String],password: Option[String],identity: Option[Identity]): Resource[IO,(Artifact,ConfinedFile)] =
    // The pinned file keeps ownership after the process gate is released for
    // streaming. The enclosing service lease outlives HTTP resource drainage.
    // Authorization is checked at each new open.
    Resource.make(serialized(metadata.transaction { tx =>
      val a = authorized(tx,id,grant,password,identity); (a,payloads.open(a,path))
    })) { (_,file) => IO.blocking(file.close()) }
