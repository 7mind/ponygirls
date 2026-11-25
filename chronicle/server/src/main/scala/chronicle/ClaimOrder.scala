package chronicle

import java.sql.{Connection,ResultSet}
import java.time.{Instant,OffsetDateTime}
import java.util.UUID

/** A worker lane of the waiting claim order (indexing-claim-order spec §5.3, `indexing.claimOrder` "waiting"): lane 0 owns
  * the large-job permit and takes sized jobs first; lanes 1..`bulkLanes` prefer bulk work, the others fresh work. */
final case class ClaimLane(index: Int,kind: ClaimLane.Kind) {
  def large: LargeJobs = if(kind==ClaimLane.Kind.Large) LargeJobs.Admitted else LargeJobs.Skipped
}
object ClaimLane {
  enum Kind { case Large,Bulk,Fresh }
  def of(index: Int,bulkLanes: Int): ClaimLane =
    ClaimLane(index,if(index==0) Kind.Large else if(index<=bulkLanes) Kind.Bulk else Kind.Fresh)
}
/** A claim of the waiting order: a claimed job, no candidate, or candidates that kept changing under the claim's probes
  * (ClaimOrder.maxProbes); the lane waits after the last two alike. */
enum ClaimOutcome {
  case Claimed(claim: Claim)
  case Idle
  case Contended
}
object ClaimOutcome {
  def of(claim: Option[Claim]): ClaimOutcome = claim.fold(ClaimOutcome.Idle)(ClaimOutcome.Claimed(_))
}

/** The waiting claim order's selection (claim-order DESIGN §2), run by PostgresArchive.claimInLane after
  * `supersedeEndedLeases`. One transaction:
  *  - P1: the owners of today's claim (its statement), then EVERY one's `OwnerTargets.eligible` and
  *    `ChronicleIndexing.locked`, in owner order, before any source is locked: the eligible (owner, target profile) pairs,
  *    each with its target epoch and its indexing epoch;
  *  - P2: per pair, today's `lease-exhausted` cleanup (the statements of claimHead);
  *  - P3: the lane's steps in order, each a loop of probes. A probe, inside a savepoint, locks the source of the first
  *    candidate of the step in (`waiting_since`, `session_id`) order (FOR UPDATE OF s SKIP LOCKED), then its job
  *    (FOR UPDATE SKIP LOCKED): a job whose lock is held is passed (its source excluded, the next candidate of the same
  *    step); a job whose key or predicates changed since the candidate statement (revalidated on the locked row), or
  *    whose fenced UPDATE (claimHead's text) changes no row, restarts the same step on a fresh statement. A step's next
  *    step runs only when it has no candidate; `maxProbes` probes that did not claim end the claim `Contended`. */
private[chronicle] object ClaimOrder {
  /** The server's line of its effective claim order, logged once it serves: `claim order mode=source-id lanes=L` or
    * `claim order mode=waiting bulkLanes=B lanes=L` (L = indexing.annotationSessions). */
  def startLine(config: Config): String = ClaimOrderMode.of(config) match {
    case ClaimOrderMode.SourceId => s"claim order mode=${ClaimOrderSetting.SourceId.key} lanes=${config.indexing.annotationSessions}"
    case ClaimOrderMode.Waiting(bulkLanes) => s"claim order mode=${ClaimOrderSetting.Waiting.key} bulkLanes=$bulkLanes lanes=${config.indexing.annotationSessions}"
  }
  /** Probes of one claim that may fail before it gives up (`Contended`). */
  val maxProbes = 8
  final case class Pair(owner: String,profile: String,targetEpoch: Long,indexingEpoch: Long)
  /** A point between a probe's candidate statement and its job lock, where tests let another transaction change the
    * candidate. */
  trait Race { def afterCandidate(job: UUID): Unit }
  object Race { val none: Race = new Race { def afterCandidate(job: UUID): Unit = () } }
  final case class Step(predicate: String,kind: ClaimStep)
  /** The steps of `lane`: lane 0 sized jobs, then any; a class lane its class, then the other one, never a sized job (it
    * defers one it sizes above LargeJobs.windows, as today). The bulk predicates are equalities so that ch_jobs_class
    * serves them in order. */
  def steps(lane: ClaimLane): List[Step] = {
    val unsized=s"NOT ${Jobs.sized("j")}"
    lane.kind match {
      case ClaimLane.Kind.Large => List(Step(Jobs.sized("j"),ClaimStep.Preferred),Step("true",ClaimStep.Borrowed))
      case ClaimLane.Kind.Bulk => List(Step(s"j.bulk=true AND $unsized",ClaimStep.Preferred),Step(s"j.bulk=false AND $unsized",ClaimStep.Borrowed))
      case ClaimLane.Kind.Fresh => List(Step(s"j.bulk=false AND $unsized",ClaimStep.Preferred),Step(s"j.bulk=true AND $unsized",ClaimStep.Borrowed))
    }
  }
  /** No older-revision job of the candidate's source and profile Running. OFFSET 0 keeps it a per-candidate probe of
    * ch_jobs_running: pulled up into an anti-join, the planner may read every Running row instead. */
  private val olderRunning = "NOT EXISTS(SELECT 1 FROM ch_jobs o WHERE o.session_id=j.session_id AND o.profile=j.profile AND o.state='Running' AND o.revision<j.revision OFFSET 0)"
  /** The candidate statement of `step` over `pairs` (claim-order DESIGN §2), passing the sources in `excluded`. */
  def candidateSql(step: Step,pairs: Int,excluded: Int): String = {
    val values=List.fill(pairs)("(?::text,?::text,?::bigint,?::bigint)").mkString(",")
    val passed=if(excluded==0) "" else s" AND s.id NOT IN(${List.fill(excluded)("?").mkString(",")})"
    s"""SELECT j.id,j.waiting_since,j.bulk,s.id AS source,s.revision,e.owner,e.profile,e.target_epoch,e.indexing_epoch
      FROM ch_jobs j JOIN ch_sources s ON s.id=j.session_id AND j.revision=s.revision AND NOT s.tombstone
      JOIN (VALUES $values) e(owner,profile,target_epoch,indexing_epoch) ON e.owner=s.owner AND e.profile=j.profile
      WHERE j.state IN('Queued','Running') AND (${step.predicate}) AND ${Jobs.claimable("j","e.indexing_epoch")} AND $olderRunning$passed
      ORDER BY j.waiting_since,j.session_id FOR UPDATE OF s SKIP LOCKED LIMIT 1"""
  }
  /** The candidate's job locked, with what the claim records of it (ClaimFacts) and whether it still is a candidate of
    * the step: its predicates evaluated on the locked row (the claimability against `?`, the pair's indexing epoch). */
  private def lockedSql(step: Step): String =
    s"""SELECT j.session_id,j.revision,j.profile,j.state,j.lease_until,j.waiting_since,j.bulk,${Jobs.invalidated("j","?")} AS invalidated,
      ((${step.predicate}) AND ${Jobs.claimable("j","?")} AND $olderRunning) AS candidate
      FROM ch_jobs j WHERE j.id=? FOR UPDATE SKIP LOCKED"""
  private final case class Candidate(job: UUID,waitingSince: Option[Instant],bulk: Option[Boolean],source: UUID,revision: Int,pair: Pair)
  private def instant(r: ResultSet,column: String): Option[Instant] = Option(r.getObject(column,classOf[OffsetDateTime])).map(_.toInstant)
  private def flag(r: ResultSet,column: String): Option[Boolean] = Option(r.getObject(column,classOf[java.lang.Boolean])).map(_.booleanValue)
  private enum Probe {
    case Claimed(claim: Claim)
    /** The step has no candidate left. */
    case Empty
    /** The candidate's job lock is held: pass its source. */
    case Passed(source: UUID)
    /** The candidate changed between the statement and its locks: the same step again. */
    case Changed
  }

  def claim(archive: PostgresArchive,profiles: Set[String],scope: ClaimScope,leaseSeconds: Int,lane: ClaimLane,race: Race = Race.none): ClaimOutcome = archive.db.transaction { c =>
    val pairs=eligible(archive,c,profiles,scope)
    if(pairs.isEmpty) ClaimOutcome.Idle else {
      pairs.foreach(pair => leaseExhausted(c,pair))
      select(archive,c,pairs,leaseSeconds,lane,race)
    }
  }
  /** P1: the statement and the locks of claimHead, for every owner before any source lock. */
  private def eligible(archive: PostgresArchive,c: Connection,profiles: Set[String],scope: ClaimScope): List[Pair] = {
    val db=archive.db
    profiles.foreach(IndexProfiles.registered(c,_))
    val scoped=scope match {
      case ClaimScope.AllOwners => ("",List.empty[Sql.Param])
      case ClaimScope.Owner(owner) => (" AND t.owner=?",List[Sql.Param](owner))
    }
    val placeholders=profiles.toList.sorted.map(_ => "?").mkString(",")
    val allowed=ChronicleIndexing.allowsOwnerSql(db.indexingDefaultEnabled,"t.owner")
    val owners=Sql.rows(c,s"SELECT t.owner FROM ch_owner_targets t JOIN ch_users u ON u.id=t.owner AND u.enabled WHERE t.profile IN($placeholders)${scoped._1} AND $allowed ORDER BY t.owner",(profiles.toList.sorted++scoped._2)*)(_.getString(1))
    owners.flatMap { owner =>
      OwnerTargets.eligible(c,owner).filter(target => profiles.contains(target.profile)).flatMap { target =>
        val eligibility=ChronicleIndexing.locked(c,db.indexingDefaultEnabled,owner)
        Option.when(eligibility.enabled)(Pair(owner,target.profile,target.epoch,eligibility.epoch))
      }
    }
  }
  /** P2: claimHead's `lease-exhausted` cleanup of the pair (its statements). */
  private def leaseExhausted(c: Connection,pair: Pair): Unit = {
    val exhausted=Sql.rows(c,s"""SELECT s.id FROM ch_sources s WHERE s.owner=? AND NOT s.tombstone AND EXISTS(
      SELECT 1 FROM ch_jobs j WHERE j.session_id=s.id AND j.revision=s.revision AND j.profile=? AND j.state='Running' AND j.indexing_epoch=? AND j.lease_until<clock_timestamp() AND j.attempts>=${Jobs.attemptLimit})
      ORDER BY s.id FOR UPDATE OF s SKIP LOCKED""",pair.owner,pair.profile,pair.indexingEpoch)(_.getObject(1,classOf[UUID]))
    exhausted.foreach { id =>
      Sql.exec(c,s"UPDATE ch_jobs SET state='Failed',error='lease-exhausted',failure_stage=NULL,lease_until=NULL,fence=fence+1 WHERE session_id=? AND profile=? AND state='Running' AND indexing_epoch=? AND lease_until<clock_timestamp() AND attempts>=${Jobs.attemptLimit}",id,pair.profile,pair.indexingEpoch)
    }
  }
  /** P3: the steps of the lane in order with one budget of failed probes. */
  private def select(archive: PostgresArchive,c: Connection,pairs: List[Pair],leaseSeconds: Int,lane: ClaimLane,race: Race): ClaimOutcome = {
    var failed=0
    var excluded=Vector.empty[UUID]
    def step(remaining: List[Step]): ClaimOutcome = remaining match {
      case Nil => ClaimOutcome.Idle
      case current::rest =>
        if(failed>=maxProbes) ClaimOutcome.Contended
        else probe(archive,c,pairs,current,excluded,leaseSeconds,lane,race) match {
          case Probe.Claimed(claim) => ClaimOutcome.Claimed(claim)
          case Probe.Empty => step(rest)
          case Probe.Passed(source) => failed+=1; excluded:+=source; step(remaining)
          case Probe.Changed => failed+=1; step(remaining)
        }
    }
    step(steps(lane))
  }
  private def probe(archive: PostgresArchive,c: Connection,pairs: List[Pair],step: Step,excluded: Vector[UUID],leaseSeconds: Int,lane: ClaimLane,race: Race): Probe = {
    val savepoint=c.setSavepoint()
    def undo(result: Probe): Probe = { c.rollback(savepoint); c.releaseSavepoint(savepoint); result }
    val args=pairs.flatMap(pair => List[Sql.Param](pair.owner,pair.profile,pair.targetEpoch,pair.indexingEpoch))++excluded
    // Each step's partial index delivers its order: with few candidates the planner would rather sort a bitmap scan's rows
    // under LockRows, so a sort is ruled out for this statement only.
    Sql.exec(c,"SET LOCAL enable_sort=off")
    val candidate=Sql.one(c,candidateSql(step,pairs.size,excluded.size),args*) { r =>
      Candidate(r.getObject("id",classOf[UUID]),instant(r,"waiting_since"),flag(r,"bulk"),r.getObject("source",classOf[UUID]),r.getInt("revision"),
        Pair(r.getString("owner"),r.getString("profile"),r.getLong("target_epoch"),r.getLong("indexing_epoch")))
    }
    Sql.exec(c,"SET LOCAL enable_sort TO DEFAULT")
    candidate match {
      case None => c.releaseSavepoint(savepoint); Probe.Empty
      case Some(found) =>
        val epoch=found.pair.indexingEpoch
        race.afterCandidate(found.job)
        Sql.one(c,lockedSql(step),epoch,epoch,found.job) { r =>
          val same=r.getObject("session_id",classOf[UUID])==found.source && r.getInt("revision")==found.revision && r.getString("profile")==found.pair.profile &&
            instant(r,"waiting_since")==found.waitingSince && flag(r,"bulk")==found.bulk && r.getBoolean("candidate")
          Option.when(same)(ClaimFacts(lane.index,step.kind,r.getString("state"),instant(r,"lease_until"),found.waitingSince,found.bulk,r.getBoolean("invalidated")))
        } match {
          case None => undo(Probe.Passed(found.source))
          case Some(None) => undo(Probe.Changed)
          case Some(Some(facts)) => claimed(archive,c,found,facts,leaseSeconds) match {
            case None => undo(Probe.Changed)
            case Some(claim) => c.releaseSavepoint(savepoint); Probe.Claimed(claim)
          }
        }
    }
  }
  /** The fenced transition of claimHead (its UPDATE), with the pair's indexing epoch. */
  private def claimed(archive: PostgresArchive,c: Connection,found: Candidate,facts: ClaimFacts,leaseSeconds: Int): Option[Claim] = {
    val epoch=found.pair.indexingEpoch
    Sql.one(c,s"""UPDATE ch_jobs SET state='Running',attempts=attempts+CASE WHEN ${Jobs.invalidated("ch_jobs",epoch.toString)} THEN 0 ELSE 1 END,
      indexing_epoch=?,fence=fence+1,lease_until=clock_timestamp()+make_interval(secs=>?),completed_windows=0,total_windows=NULL
      WHERE id=(SELECT id FROM ch_jobs WHERE session_id=? AND revision=? AND profile=? AND ${Jobs.claimable("ch_jobs",epoch)} FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id,fence,run_id,transient_range""",epoch,leaseSeconds,found.source,found.revision,found.pair.profile) { row =>
      (row.getObject("id",classOf[UUID]),row.getLong("fence"),row.getObject("run_id",classOf[UUID]),Option(row.getObject("transient_range",classOf[java.lang.Integer])).map(_.intValue))
    }.map { (id,fence,run,range) =>
      Check(id==found.job,"internal","claimed job is not the locked candidate")
      val (snap,binding,messages)=archive.claimedSnapshot(c,found.source,found.revision)
      Claim(id,found.source,found.revision,fence,found.pair.profile,snap,found.pair.owner,found.pair.targetEpoch,run,binding,messages,new ClaimAttempt(range),epoch,Some(facts))
    }
  }
}
