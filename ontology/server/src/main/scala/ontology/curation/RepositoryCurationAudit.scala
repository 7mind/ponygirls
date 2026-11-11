package ontology.curation

import cats.effect.{IO, Ref as IORef}
import cats.effect.std.Semaphore
import cats.effect.kernel.Outcome
import cats.syntax.all.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import ontology.*
import ontology.api.*
import ontology.domain.{CurationJournal, Fault, Require}

final class RepositoryCurationAudit private (writer: CurationAuditWriter, frozen: CurationFrozenView,
  state: IORef[IO, RepositoryCurationAudit.Local], serial: Semaphore[IO]) extends CurationAudit {
  import RepositoryCurationAudit.*
  private def payload(value: Json): CurationAuditPayload = {
    val content = value.noSpaces
    Require(UTF_8.newEncoder().canEncode(content), "curator-audit", "invalid audit text")
    val bytes = content.getBytes(UTF_8)
    CurationAuditPayload(CurationJournal.JsonEncoding, content, Digests.bytes(bytes), bytes.length.toLong)
  }
  private def append(ordinal: Int, stage: CurationAuditStage, digest: String, body: Option[CurationAuditPayload]): IO[Unit] =
    writer.appendAudit(frozen.claim.fence, frozen.claim.scope, frozen.claim.attemptId, ordinal, stage, digest, body).flatMap {
      case CurationWriteResult.Advanced(attempt, false) => IO {
        Require(attempt.claim == frozen.claim && attempt.state == CurationAttemptState.Running && attempt.inputManifest.contains(frozen.material.manifest),
          "curator-audit", "audit acknowledgment differs from attempt")
      }
      case CurationWriteResult.Advanced(_, true) => IO.raiseError(Fault("curator-audit-replay", "retained audit is not permission to repeat model work"))
      case CurationWriteResult.Terminal(_) => IO.raiseError(Fault("curator-terminal", "curation attempt is already terminal"))
      case _: CurationWriteResult.Published => IO.raiseError(Fault("curator-audit", "unexpected publication acknowledgment"))
    }
  private def running: IO[Unit] = state.get.flatMap(value => IO(Require(!value.stopped, "curator-audit", "audit invocation has stopped")))
  private def stop: IO[Unit] = state.update(_.copy(stopped = true))
  private def guarded(action: IO[Unit]): IO[Unit] = serial.permit.use { _ =>
    // Record failure before releasing the permit; a cancelled waiter can also stop an in-flight hook.
    (running *> action *> running).guaranteeCase {
      case Outcome.Succeeded(_) => IO.unit
      case _ => stop
    }
  }.onCancel(stop)
  def request(ordinal: Int, value: Json): IO[Unit] = guarded { for {
    previous <- state.get.map(_.confirmed)
    _ <- IO(Require(previous.fold(ordinal == FirstOrdinal)(p => p.stage == CurationAuditStage.ResponseObserved && ordinal.toLong == p.ordinal.toLong + 1L),
      "curator-audit", "request audit is out of sequence"))
    _ <- IO(CuratorRequest.verifyInput(value, frozen.material.manifest))
    body <- IO(payload(value))
    _ <- append(ordinal, CurationAuditStage.RequestPrepared, body.digest, Some(body))
    _ <- state.update(_.copy(confirmed = Some(Confirmed(ordinal, body.digest, CurationAuditStage.RequestPrepared))))
  } yield () }
  private def next(ordinal: Int, expected: CurationAuditStage, stage: CurationAuditStage, body: Option[CurationAuditPayload]): IO[Unit] = for {
    previous <- state.get.map(_.confirmed)
    confirmed <- IO(previous.getOrElse(throw Fault("curator-audit", "prepared request acknowledgment missing")))
    _ <- IO(Require(confirmed.ordinal == ordinal && confirmed.stage == expected, "curator-audit", "audit callback is out of sequence"))
    _ <- append(ordinal, stage, confirmed.digest, body)
    _ <- state.update(_.copy(confirmed = Some(confirmed.copy(stage = stage))))
  } yield ()
  def dispatchPossible(ordinal: Int): IO[Unit] = guarded(next(ordinal, CurationAuditStage.RequestPrepared, CurationAuditStage.DispatchPossible, None))
  def response(ordinal: Int, value: Json): IO[Unit] = guarded {
    IO(payload(value)).flatMap(body => next(ordinal, CurationAuditStage.DispatchPossible, CurationAuditStage.ResponseObserved, Some(body)))
  }
}
object RepositoryCurationAudit {
  private val FirstOrdinal = 1
  private final case class Confirmed(ordinal: Int, digest: String, stage: CurationAuditStage)
  private final case class Local(confirmed: Option[Confirmed], stopped: Boolean)
  def create(writer: CurationAuditWriter, frozen: CurationFrozenView): IO[RepositoryCurationAudit] = for {
    state <- IORef.of[IO, Local](Local(None, false))
    serial <- Semaphore[IO](1)
  } yield new RepositoryCurationAudit(writer, frozen, state, serial)
}
