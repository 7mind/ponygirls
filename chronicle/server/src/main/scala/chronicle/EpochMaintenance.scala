package chronicle

import cats.effect.{IO,Resource}
import cats.effect.std.Supervisor
import cats.syntax.all.*
import izumi.distage.model.definition.Lifecycle
import java.util.UUID
import scala.concurrent.duration.*

/** Background upkeep of the epoch layout (append-only ingest spec §3, §4.6): clears the head-candidate mask of superseded
  * epochs' fragments, then marks them pruned, deletes the epochs of purged sources, sweeps part uploads (expires
  * passed leases, deletes the staging of attempts that ended, deletes old terminal attempts), and merges the fragment
  * trigram index's pending list. Reads and search never depend on it (they join on the head's epoch and count). Each
  * statement touches at most `rowsPerStatement` rows, the merge the pending list, in a transaction of its own; a failed
  * pass is logged and the next one runs an interval later, so a failure never ends the server. */
final class EpochMaintenance private (db: Database,logger: logstage.IzLogger,val interval: FiniteDuration) {
  import EpochMaintenance.rowsPerStatement
  private def pass: IO[Unit] = prune *> deletePurged *> sweepUploads *> mergeFragmentIndex
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

  /** Writers leave up to `EpochWriter.fragmentIndexMergeBytes` of the fragment trigram index unmerged, and every search
    * through the index scans that pending list: the pass merges it (with `maintenance_work_mem`) so that the cost ends one
    * interval after the last write. It merges until the list is empty, what writers append meanwhile included; a writer
    * whose insert crosses the limit meanwhile leaves its own merge to it. */
  private def mergeFragmentIndex: IO[Unit] =
    transaction(c => Sql.one(c,"SELECT gin_clean_pending_list('ch_epoch_fragments_lower_trgm')")(_.getLong(1))).void

  private def deletePurged: IO[Unit] =
    transaction(c => Sql.rows(c,"SELECT e.id,s.owner,s.source_key FROM ch_epochs e JOIN ch_sources s ON s.id=e.session_id WHERE s.tombstone ORDER BY e.id")(r => (r.getObject(1,classOf[UUID]),r.getString(2),r.getString(3))))
      .flatMap(_.traverse_(deleteEpoch))
  /** Purge deleted the source's revisions, so the delete guard allows every row. Each statement runs under the source's
    * ingest lock, and the epoch is skipped for this pass while an ingest holds it (one that started before the purge and
    * still writes into the epoch fails at its switch). */
  private def deleteEpoch(epoch: UUID,owner: String,key: String): IO[Unit] = repeatWhile(transaction { c =>
    EpochMaintenance.ingestLock(c,owner,key) && {
      val deleted=EpochMaintenance.deleteRows(c,epoch,EpochMaintenance.Floors.all)
      if(!deleted) Sql.exec(c,"DELETE FROM ch_epochs WHERE id=?",epoch)
      deleted
    }
  })

  private def sweepUploads: IO[Unit] =
    transaction(c => Sql.rows(c,"SELECT id,owner,source_key FROM ch_uploads WHERE (phase='Open' AND expires_at<=clock_timestamp()) OR (phase<>'Open' AND NOT cleaned) ORDER BY id")(r => (r.getObject(1,classOf[UUID]),r.getString(2),r.getString(3))))
      .flatMap(_.traverse_ { case (id,owner,key) => repeatWhile(transaction(c => EpochMaintenance.ingestLock(c,owner,key) && Uploads.sweep(c,id))) }) *>
      deleteRetired
  /** Ended attempts past the retention: their part receipts and pending parents first, then the attempts that have none
    * left, each statement bounded (one attempt may have thousands of receipts). Committed attempts are never retired. */
  private def deleteRetired: IO[Unit] = {
    val retired=s"u.cleaned AND u.phase IN('Aborted','Expired','Failed') AND u.terminal_at<clock_timestamp()-?::bigint*interval '1 second'"
    val seconds=Uploads.retention.toSeconds
    def drain(table: String,key: String): IO[Unit] = repeatWhile(transaction(c =>
      Sql.exec(c,s"DELETE FROM $table t USING (SELECT r.upload,r.$key FROM $table r JOIN ch_uploads u ON u.id=r.upload WHERE $retired LIMIT $rowsPerStatement) x WHERE t.upload=x.upload AND t.$key=x.$key",seconds)==rowsPerStatement))
    drain("ch_upload_parts","ordinal") *> drain("ch_upload_parents","parent_key") *> repeatWhile(transaction(c =>
      Sql.exec(c,s"""DELETE FROM ch_uploads WHERE id IN(SELECT u.id FROM ch_uploads u WHERE $retired AND NOT EXISTS(SELECT 1 FROM ch_upload_parts p WHERE p.upload=u.id)
        AND NOT EXISTS(SELECT 1 FROM ch_upload_parents p WHERE p.upload=u.id) LIMIT $rowsPerStatement)""",seconds)==rowsPerStatement))
  }
}
object EpochMaintenance {
  val interval: FiniteDuration = 60.seconds
  /** Rows per statement: 10,000 fragment candidates take ≈ 114 ms and 45 MB of WAL on the archive copy. */
  val rowsPerStatement = 10000
  /** The epoch row tables with their keys besides the epoch, the first key being the one ordered along the epoch. */
  private val rowTables = List("ch_epoch_fragments"->List("position","part"),"ch_epoch_records"->List("record_index","record_key"),"ch_epoch_raw"->List("byte_offset"),"ch_epoch_messages"->List("position"))
  /** The first message position, raw byte offset and record index of rows to delete: rows below them stay. */
  final case class Floors(messages: Int,rawBytes: Long,records: Int)
  object Floors {
    val all: Floors = Floors(0,0L,0)
    /** Every row beyond the counts of the epoch's committed revisions (all rows of an epoch without one). */
    def staged(c: java.sql.Connection,epoch: UUID): Floors =
      Sql.one(c,"SELECT coalesce(max(message_count),0),coalesce(max(raw_bytes),0),coalesce(max(record_count),0) FROM ch_revisions WHERE epoch=?",epoch)(r => Floors(r.getInt(1),r.getLong(2),r.getInt(3))).get
  }
  /** Deletes at most `rowsPerStatement` rows of `epoch` at or beyond `floors` from the first row table that has any;
    * false when none was left. */
  private[chronicle] def deleteRows(c: java.sql.Connection,epoch: UUID,floors: Floors): Boolean =
    rowTables.iterator.map { case (table,keys) =>
      val on=keys.map(k => s"t.$k=x.$k").mkString(" AND ")
      val floor: Sql.Param=table match { case "ch_epoch_raw" => floors.rawBytes; case "ch_epoch_records" => floors.records; case _ => floors.messages }
      Sql.exec(c,s"DELETE FROM $table t USING (SELECT ${keys.mkString(",")} FROM $table WHERE epoch=? AND ${keys.head}>=? LIMIT $rowsPerStatement) x WHERE t.epoch=? AND $on",epoch,floor,epoch)
    }.exists(_>0)
  /** The ingest lock of a source if no writer holds it (this transaction's, until it ends). */
  private[chronicle] def ingestLock(c: java.sql.Connection,owner: String,key: String): Boolean =
    Sql.one(c,"SELECT pg_try_advisory_xact_lock(hashtextextended(?,0))",s"ingest:$owner:$key")(_.getBoolean(1)).contains(true)
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
