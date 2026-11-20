package chronicle

import cats.effect.{IO,Resource}
import cats.effect.std.Supervisor
import cats.syntax.all.*
import izumi.distage.model.definition.Lifecycle
import java.util.UUID
import scala.concurrent.duration.*

/** Background upkeep of the epoch layout (append-only ingest spec §3): clears the head-candidate mask of superseded
  * epochs' fragments, then marks them pruned, and deletes the epochs of purged sources. Reads and search never depend on
  * it (they join on the head's epoch and count). Each statement touches at most `rowsPerStatement` rows in a transaction
  * of its own; a failed pass is logged and the next one runs an interval later, so a failure never ends the server. */
final class EpochMaintenance private (db: Database,logger: logstage.IzLogger,val interval: FiniteDuration) {
  import EpochMaintenance.rowsPerStatement
  private def pass: IO[Unit] = prune *> deletePurged
  /** A pass whose failure is logged: it ends only that pass. */
  private def attempt: IO[Unit] = pass.handleErrorWith(error => IO(logger.warn(s"epoch maintenance pass failed, next pass in $interval: $error")))
  private def transaction[A](f: java.sql.Connection => A): IO[A] = IO.blocking(db.transaction(f))
  private def repeatWhile(step: IO[Boolean]): IO[Unit] = step.flatMap(more => if(more) repeatWhile(step) else IO.unit)

  private def prune: IO[Unit] =
    transaction(c => Sql.rows(c,"SELECT id FROM ch_epochs WHERE candidates='prune' ORDER BY id")(_.getObject(1,classOf[UUID]))).flatMap(_.traverse_(pruneEpoch))
  /** Clears the candidates in key order from a cursor; a row locked elsewhere is skipped and left for a later pass. */
  private def pruneEpoch(epoch: UUID): IO[Unit] = {
    def from(position: Int,part: Int): IO[Unit] = transaction { c =>
      Sql.one(c,s"""WITH batch AS MATERIALIZED(SELECT position,part FROM ch_epoch_fragments WHERE epoch=? AND (position,part)>(?,?) AND head_candidate
          ORDER BY position,part LIMIT $rowsPerStatement FOR UPDATE SKIP LOCKED),
        cleared AS (UPDATE ch_epoch_fragments f SET head_candidate=false FROM batch b WHERE f.epoch=? AND f.position=b.position AND f.part=b.part)
        SELECT count(*) OVER (),position,part FROM batch ORDER BY position DESC,part DESC LIMIT 1""",epoch,position,part,epoch)(r => (r.getInt(1),r.getInt(2),r.getInt(3)))
    }.flatMap {
      case Some((cleared,last,lastPart)) if cleared==rowsPerStatement => from(last,lastPart)
      case _ => transaction(c => Sql.exec(c,"UPDATE ch_epochs SET candidates='pruned' WHERE id=? AND candidates='prune' AND NOT EXISTS(SELECT 1 FROM ch_epoch_fragments WHERE epoch=? AND head_candidate)",epoch,epoch)).void
    }
    from(-1,-1)
  }

  private def deletePurged: IO[Unit] =
    transaction(c => Sql.rows(c,"SELECT e.id,s.owner,s.source_key FROM ch_epochs e JOIN ch_sources s ON s.id=e.session_id WHERE s.tombstone ORDER BY e.id")(r => (r.getObject(1,classOf[UUID]),r.getString(2),r.getString(3))))
      .flatMap(_.traverse_(deleteEpoch))
  /** Purge deleted the source's revisions, so the delete guard allows every row. Each statement runs under the source's
    * ingest lock, and the epoch is skipped for this pass while an ingest holds it (one that started before the purge and
    * still writes into the epoch fails at its switch). */
  private def deleteEpoch(epoch: UUID,owner: String,key: String): IO[Unit] = repeatWhile(transaction { c =>
    Sql.one(c,"SELECT pg_try_advisory_xact_lock(hashtextextended(?,0))",s"ingest:$owner:$key")(_.getBoolean(1)).contains(true) && {
      val deleted=EpochMaintenance.rowTables.iterator.map { case (table,keys) =>
        val on=keys.map(k => s"t.$k=x.$k").mkString(" AND ")
        Sql.exec(c,s"DELETE FROM $table t USING (SELECT ${keys.mkString(",")} FROM $table WHERE epoch=? LIMIT $rowsPerStatement) x WHERE t.epoch=? AND $on",epoch,epoch)
      }.find(_>0)
      if(deleted.isEmpty) Sql.exec(c,"DELETE FROM ch_epochs WHERE id=?",epoch)
      deleted.nonEmpty
    }
  })
}
object EpochMaintenance {
  val interval: FiniteDuration = 60.seconds
  /** Rows per statement: 10,000 fragment candidates take ≈ 114 ms and 45 MB of WAL on the archive copy. */
  val rowsPerStatement = 10000
  /** The epoch row tables with their keys besides the epoch. */
  private val rowTables = List("ch_epoch_fragments"->List("position","part"),"ch_epoch_records"->List("record_index","record_key"),"ch_epoch_raw"->List("byte_offset"),"ch_epoch_messages"->List("position"))
  /** Runs a pass after every `interval` (waited by `sleep`) until released. */
  def resource(db: Database,logger: logstage.IzLogger,interval: FiniteDuration,sleep: FiniteDuration => IO[Unit]): Resource[IO,EpochMaintenance] = for {
    supervisor <- Supervisor[IO](await=false)
    maintenance = new EpochMaintenance(db,logger,interval)
    _ <- Resource.make(supervisor.supervise((sleep(interval) *> maintenance.attempt).foreverM))(_.cancel)
  } yield maintenance
}
final class EpochMaintenanceResource(db: Database,logger: logstage.IzLogger) extends Lifecycle.FromPair[IO,EpochMaintenance] {
  def acquire: IO[(EpochMaintenance,IO[Unit])] = EpochMaintenance.resource(db,logger,EpochMaintenance.interval,IO.sleep).allocated
}
