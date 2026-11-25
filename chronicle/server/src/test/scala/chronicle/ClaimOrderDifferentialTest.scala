package chronicle

import ponygirls.auth.IndexingPreferenceSql
import java.util.UUID
import scala.collection.mutable

/** (a) (claim-order DESIGN §9): with `claimOrder` "source-id" (flag off) the claim is today's (fe4f69f7) claim. An independent
  * model of that rule — owners in id order; within an owner the first source by id whose head job is claimable, has no
  * older revision Running and, without the large-job permit, no head job above LargeJobs.windows or sized; a held job lock
  * passes to the next owner; the first transaction's supersession of ended older runs and the lease-exhausted cleanup —
  * is compared with the production claim over generated queues: identical claim sequences. Each clause decides some claim:
  * the model with that clause alone replaced by its counterfactual takes another job there. */
final class ClaimOrderDifferentialTest extends munit.FunSuite {
  import ClaimOrderFixtures.*
  /** The clauses of the rule; a clause decides a claim when the model without it (its counterfactual below) takes another job. */
  private enum Clause { case OwnerOrder,SourceOrder,Permit,OlderRunning,JobLock,NotClaimable }
  /** fe4f69f7's claim over the stored rows (`locked`: jobs whose row lock another transaction holds), with the clauses
    * `without` replaced by their counterfactuals: owners and sources in descending id order, the permit always held, older
    * Running revisions and held job locks ignored, any Queued or Running head taken whether claimable or not. */
  private def legacy(s: Snapshot,large: Boolean,locked: Set[UUID],without: Set[Clause] = Set.empty): Option[UUID] = {
    def active(o: Owner): Boolean = o.enabled && o.allowed
    def eligibleHead(r: Row,owner: Owner): Boolean = Set("Queued","Running").contains(r.state) && (without(Clause.NotClaimable) || claimable(r,owner.indexingEpoch))
    // The first transaction ends older-revision Running jobs whose lease ended or whose indexing epoch is behind.
    val ended=s.rows.filter(r => s.owners.get(r.owner).exists(o => active(o) && o.profile==r.profile) && r.revision<r.head && r.state=="Running" &&
      (r.leaseNull || r.leaseAtOrPast || r.indexingEpoch<s.owners(r.owner).indexingEpoch)).map(_.job).toSet
    val ownerOrder=s.owners.values.filter(active).toList.sortBy(_.id)
    val owners=if(without(Clause.OwnerOrder)) ownerOrder.reverse else ownerOrder
    owners.iterator.map { owner =>
      val rows=s.rows.filter(r => r.owner==owner.id && !r.tombstone && !ended.contains(r.job))
      // The lease-exhausted cleanup: a head Running on its last attempt, lease ended, of the owner's epoch, ends Failed.
      val exhausted=rows.filter(r => r.revision==r.head && r.profile==owner.profile && r.state=="Running" && r.indexingEpoch==owner.indexingEpoch && r.leasePast && r.attempts>=5).map(_.job).toSet
      val live=rows.filterNot(r => exhausted.contains(r.job))
      val sourceOrder=live.map(_.source).distinct.sortBy(_.toString)
      val sources=if(without(Clause.SourceOrder)) sourceOrder.reverse else sourceOrder
      sources.find { source =>
        val head=live.filter(r => r.source==source && r.revision==r.head && r.profile==owner.profile)
        val older=live.exists(r => r.source==source && r.revision<r.head && r.profile==owner.profile && r.state=="Running")
        val permit=large || without(Clause.Permit) || !head.exists(r => r.total.exists(_>LargeJobs.windows) || sized(r))
        head.exists(eligibleHead(_,owner)) && (!older || without(Clause.OlderRunning)) && permit
      }.flatMap { source =>
        val job=live.find(r => r.source==source && r.revision==r.head && r.profile==owner.profile && eligibleHead(r,owner)).get.job
        Option.when(!locked.contains(job) || without(Clause.JobLock))(job)
      }
    }.collectFirst { case Some(job) => job }
  }
  private def decisive(s: Snapshot,large: Boolean,locked: Set[UUID]): Set[Clause] = {
    val taken=legacy(s,large,locked)
    Clause.values.filter(clause => legacy(s,large,locked,Set(clause))!=taken).toSet
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
        val locked=if(plain.nonEmpty && random.nextInt(4)==0) plain.toSet else Set.empty[UUID]
        val model=legacy(before,large,locked)
        val actual=holder.transaction { h =>
          locked.foreach(id => Sql.one(h,"SELECT id FROM ch_jobs WHERE id=? FOR UPDATE",id)(_ => ()).get)
          a.claim(a.knownProfiles,ClaimScope.AllOwners,300,if(large) LargeJobs.Admitted else LargeJobs.Skipped).map(_.jobId)
        }
        assertEquals(actual,model,s"queue $seed claim $step (permit $large, locked $locked)")
        covered++=decisive(before,large,locked); compared+=1; step+=1
        more=legacy(snapshot(db),true,Set.empty).nonEmpty && step<200
      }
    } finally holder.close()
    assertEquals(covered.toSet,Clause.values.toSet,s"every clause decided a claim: without it the model takes another job ($compared compared)")
  }}
}
