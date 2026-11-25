package chronicle

import ponygirls.auth.IndexingPreferenceSql
import java.util.UUID
import scala.collection.mutable

/** (a) (claim-order DESIGN §9): with `claimOrder` "source-id" (flag off) the claim is today's (fe4f69f7) claim. An independent
  * model of that rule — owners in id order; within an owner the first source by id whose head job is claimable, has no
  * older revision Running and, without the large-job permit, no head job above LargeJobs.windows or sized; a held job lock
  * passes to the next owner; the first transaction's supersession of ended older runs and the lease-exhausted cleanup —
  * is compared with the production claim over generated queues where each clause decides some claim: identical claim
  * sequences. */
final class ClaimOrderDifferentialTest extends munit.FunSuite {
  import ClaimOrderFixtures.*
  /** Why the model's claim went past a candidate: each must decide some claim of the generated queues. */
  private enum Clause { case OwnerOrder,SourceOrder,Permit,OlderRunning,JobLock,NotClaimable }
  private final case class Decision(job: Option[UUID],clauses: Set[Clause])
  /** fe4f69f7's claim over the stored rows (`locked`: jobs whose row lock another transaction holds). */
  private def legacy(s: Snapshot,large: Boolean,locked: Set[UUID]): Decision = {
    val seen=mutable.Set.empty[Clause]
    def active(o: Owner): Boolean = o.enabled && o.allowed
    // The first transaction ends older-revision Running jobs whose lease ended or whose indexing epoch is behind.
    val ended=s.rows.filter(r => s.owners.get(r.owner).exists(o => active(o) && o.profile==r.profile) && r.revision<r.head && r.state=="Running" &&
      (r.leaseNull || r.leaseAtOrPast || r.indexingEpoch<s.owners(r.owner).indexingEpoch)).map(_.job).toSet
    val owners=s.owners.values.filter(active).toList.sortBy(_.id)
    val found=owners.iterator.map { owner =>
      val rows=s.rows.filter(r => r.owner==owner.id && !r.tombstone && !ended.contains(r.job))
      // The lease-exhausted cleanup: a head Running on its last attempt, lease ended, of the owner's epoch, ends Failed.
      val exhausted=rows.filter(r => r.revision==r.head && r.profile==owner.profile && r.state=="Running" && r.indexingEpoch==owner.indexingEpoch && r.leasePast && r.attempts>=5).map(_.job).toSet
      val live=rows.filterNot(r => exhausted.contains(r.job))
      val sources=live.map(_.source).distinct.sortBy(_.toString)
      val candidates=sources.filter { source =>
        val head=live.filter(r => r.source==source && r.revision==r.head && r.profile==owner.profile)
        val claimableHead=head.exists(r => Set("Queued","Running").contains(r.state) && claimable(r,owner.indexingEpoch))
        val older=live.exists(r => r.source==source && r.revision<r.head && r.profile==owner.profile && r.state=="Running")
        val permit=large || !head.exists(r => r.total.exists(_>LargeJobs.windows) || sized(r))
        if(!claimableHead) seen+=Clause.NotClaimable
        if(claimableHead && older) seen+=Clause.OlderRunning
        if(claimableHead && !older && !permit) seen+=Clause.Permit
        claimableHead && !older && permit
      }
      candidates.headOption.flatMap { source =>
        if(candidates.size>1) seen+=Clause.SourceOrder
        val job=live.find(r => r.source==source && r.revision==r.head && r.profile==owner.profile && Set("Queued","Running").contains(r.state) && claimable(r,owner.indexingEpoch)).get.job
        if(locked.contains(job)) { seen+=Clause.JobLock; None } else Some(job)
      }
    }.zipWithIndex.collectFirst { case (Some(job),index) => if(index>0) seen+=Clause.OwnerOrder; job }
    Decision(found,seen.toSet)
  }

  test("(a) flag off: the production claim equals the independent model of today's rule over generated queues, claim by claim, with and without the permit and with held job locks; owner order, source order, the permit clause, the older-Running wait and the held job lock each decide claims") { database(ClaimOrderPostgres.config()) { (c,db,a) =>
    assertEquals(ClaimOrderMode.of(c),ClaimOrderMode.SourceId)
    val covered=mutable.Set.empty[Clause]; var compared=0
    val holder=other(c)
    try for(seed <- 1 to 4) {
      val random=new scala.util.Random(seed.toLong)
      db.transaction { x =>
        Sql.exec(x,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs CASCADE")
        Sql.exec(x,"DELETE FROM ponygirls_indexing_preferences WHERE service='chronicle'")
        // Owner b on indexing epoch 3; in one queue owner c opted out.
        Sql.exec(x,"INSERT INTO ponygirls_indexing_preferences(service,owner_key,user_choice,admin_override,epoch) VALUES('chronicle',?,true,NULL,3)",IndexingPreferenceSql.ownerKey("b"))
        if(seed==2) Sql.exec(x,"INSERT INTO ponygirls_indexing_preferences(service,owner_key,user_choice,admin_override,epoch) VALUES('chronicle',?,false,NULL,1)",IndexingPreferenceSql.ownerKey("c"))
      }
      for(i <- 0 until 18) {
        val owner=owners(random.nextInt(3)); val epoch=if(owner=="b") 3 else 0
        val request=Fixtures.snapshot(); val first=a.ingest(owner,request)
        val head=random.nextInt(4) match {
          case 0 =>
            // An older revision Running, lease valid or ended, behind the head.
            set(db,first.jobId,(if(random.nextBoolean()) leased else leaseEnded)+s",indexing_epoch=$epoch")
            a.ingest(owner,request.copy(requestId=UUID.randomUUID(),expectedRevision=1)).jobId
          case _ => first.jobId
        }
        random.nextInt(9) match {
          case 0 => set(db,head,held)
          case 1 => set(db,head,leased+s",indexing_epoch=$epoch")
          case 2 => set(db,head,leaseEnded+s",indexing_epoch=$epoch,total_windows=${if(random.nextBoolean()) 150 else 20}")
          case 3 => set(db,head,s"state='Running',attempts=5,fence=fence+1,lease_until=clock_timestamp()-interval '1 hour',indexing_epoch=$epoch")
          case 4 => set(db,head,"total_windows=150")
          case 5 => set(db,head,"attempts=5")
          case 6 => set(db,head,s"state='Running',attempts=2,fence=fence+1,lease_until=clock_timestamp()+interval '1 hour',indexing_epoch=${epoch+1}")
          case _ => ()
        }
      }
      var more=true; var step=0
      while(more) {
        val large=random.nextInt(3)==0
        val before=snapshot(db)
        val plain=legacy(before,large,Set.empty)
        // Now and then another transaction holds the job row the claim would take.
        val locked=if(plain.job.nonEmpty && random.nextInt(4)==0) plain.job.toSet else Set.empty[UUID]
        val model=legacy(before,large,locked)
        val actual=holder.transaction { h =>
          locked.foreach(id => Sql.one(h,"SELECT id FROM ch_jobs WHERE id=? FOR UPDATE",id)(_ => ()).get)
          a.claim(a.knownProfiles,ClaimScope.AllOwners,300,if(large) LargeJobs.Admitted else LargeJobs.Skipped).map(_.jobId)
        }
        assertEquals(actual,model.job,s"queue $seed claim $step (permit $large, locked $locked)")
        covered++=model.clauses; compared+=1; step+=1
        more=legacy(snapshot(db),true,Set.empty).job.nonEmpty && step<200
      }
    } finally holder.close()
    assertEquals(covered.toSet,Clause.values.toSet,s"every clause decided a claim ($compared compared)")
  }}
}
