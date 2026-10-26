package chronicle
import chronicle.api.*
import java.time.{Clock,Instant}

trait CollectorProgressStore {
  def update(owner: String,report: CollectorProgressUpdate,receivedAt: Instant): CollectorProgressAck
  def status(owner: String): List[(CollectorProgressUpdate,Instant)]
}
final class PostgresCollectorProgressStore(db: Database) extends CollectorProgressStore {
  def update(owner: String,r: CollectorProgressUpdate,receivedAt: Instant): CollectorProgressAck = db.transaction { c =>
    Sql.lock(c,s"collector-progress:$owner")
    Check(Sql.one(c,"SELECT 1 FROM ch_users WHERE id=? AND enabled",owner)(_ => true).contains(true),"unauthorized","owner disabled")
    val old=Sql.one(c,"SELECT sequence FROM ch_collector_progress WHERE owner=? AND collector_id=?",owner,r.collectorId)(_.getLong(1))
    Check(old.nonEmpty || Sql.one(c,"SELECT count(*) FROM ch_collector_progress WHERE owner=?",owner)(_.getInt(1)).get<CollectorProgress.maxCollectors,"invalid","collector identity limit")
    if(old.exists(_>=r.sequence)) CollectorProgressAck(old.get,false)
    else {
      Sql.exec(c,"INSERT INTO ch_collector_progress(owner,collector_id,sequence,report,received_at) VALUES(?,?,?,?::jsonb,?::timestamptz) ON CONFLICT(owner,collector_id) DO UPDATE SET sequence=excluded.sequence,report=excluded.report,received_at=excluded.received_at",owner,r.collectorId,r.sequence,Wire.encode(CollectorProgressUpdate.codecJson,r).noSpaces,receivedAt.toString)
      CollectorProgressAck(r.sequence,true)
    }
  }
  def status(owner: String): List[(CollectorProgressUpdate,Instant)] = db.transaction { c =>
    Sql.rows(c,"SELECT report,received_at FROM ch_collector_progress WHERE owner=? ORDER BY collector_id LIMIT 100",owner)(r => (Wire.decode(CollectorProgressUpdate.codecJson,Sql.json(r,"report")),r.getTimestamp("received_at").toInstant))
  }
}
final class CollectorProgress(store: CollectorProgressStore,clock: Clock) {
  def update(i: Identity,r: CollectorProgressUpdate): CollectorProgressAck = {
    i.requireScope(Scope.Ingest); Check(!i.browser,"forbidden","bearer transport required")
    CollectorProgress.validate(r)
    store.update(i.user.id,r,clock.instant())
  }
  def status(i: Identity): CollectorStatusResult = {
    i.requireScope(Scope.Read)
    val now=clock.instant()
    CollectorStatusResult(store.status(i.user.id).map { case (r,at) => CollectorStatus(r,at.toString,now.isAfter(at.plusSeconds(CollectorProgress.staleSeconds))) })
  }
}
object CollectorProgress {
  val maxCollectors=100
  val maxBodyBytes=64*1024
  val staleSeconds=120L
  private def identifier(value: String,max: Int): Boolean = value.nonEmpty && value.length<=max && value.matches("[A-Za-z0-9][A-Za-z0-9_.:-]*")
  def validate(r: CollectorProgressUpdate): Unit = {
    Check(identifier(r.collectorId,128) && r.error.forall(e => e.length<=64 && e.matches("[a-z][a-z0-9-]*")),"invalid","invalid collector identifier or error code")
    Check(r.sequence>0 && scala.util.Try(Instant.parse(r.startedAt)).isSuccess,"invalid","invalid collector sequence or timestamp")
    val c=r.counters
    Check(List(c.discovered,c.scanned,c.waiting,c.excluded,c.unchanged,c.enqueued,c.uploaded,c.uploadFailures,c.quarantined,c.pending,c.stopped,c.conflicts).forall(_>=0) && c.scannedBytes>=0,"invalid","invalid collector counters")
    Check(r.totalUploadBytes>=0 && r.uploadedBytes>=0 && r.uploadedBytes<=r.totalUploadBytes && r.currentUploadTotalBytes.forall(_>=0),"invalid","invalid collector byte counters")
  }
}
