package chronicle

import cats.effect.{Deferred,IO,Ref}
import cats.effect.unsafe.implicits.global
import ponygirls.auth.{IndexingChoice,IndexingPreferenceSql,IndexingService}
import java.util.UUID
import scala.concurrent.duration.*

/** T1 and T2 (claim-order DESIGN §9; spec R1, R2, D-a): each lane kind claims the minimum of its order, ties by session_id,
  * across owners with their own epochs; no eligible owner → no claim; an older Running revision blocks its head; flag off →
  * today's order through the worker. Orders come from stored `waiting_since`/`bulk` values; the expected job of every claim
  * comes from the independent model of ClaimOrderFixtures. */
final class ClaimOrderTest extends munit.FunSuite {
  import ClaimOrderFixtures.*
  private def preference(db: Database,owner: String,allowed: Boolean,epoch: Long): Unit = db.transaction { c =>
    Sql.exec(c,"INSERT INTO ponygirls_indexing_preferences(service,owner_key,user_choice,admin_override,epoch) VALUES('chronicle',?,?,NULL,?) ON CONFLICT(service,owner_key) DO UPDATE SET user_choice=excluded.user_choice,epoch=excluded.epoch",
      IndexingPreferenceSql.ownerKey(owner),allowed,epoch); ()
  }
  /** The step the model says `lane` takes `job` by: Preferred when the lane's first step has a candidate. */
  private def step(lane: ClaimLane,s: Snapshot,job: UUID): ClaimStep = {
    val first: Row => Boolean=lane.kind match {
      case ClaimLane.Kind.Large => sized
      case ClaimLane.Kind.Bulk => r => r.bulk.contains(true) && !sized(r)
      case ClaimLane.Kind.Fresh => r => r.bulk.contains(false) && !sized(r)
    }
    if(eligible(s).filter(first).minOption.exists(_.job==job)) ClaimStep.Preferred else ClaimStep.Borrowed
  }

  test("T1: over a generated queue (three owners, tied ages, both classes, sized, held, leased, lease-ended, exhausted, blocked heads) every claim of every lane kind takes the minimum of its lane's order, by the preferred step first") { database { (c,db,a) =>
    val random=new scala.util.Random(20261125L)
    for(i <- 0 until 42) {
      val owner=owners(i%3); val second=random.nextInt(7)*10; val bulk=random.nextInt(10)<3
      random.nextInt(10) match {
        case 0 => job(db,a,owner,second,bulk,Some(150+i))
        case 1 => set(db,job(db,a,owner,second,bulk),held)
        case 2 => set(db,job(db,a,owner,second,bulk),leased)
        case 3 => val id=job(db,a,owner,second,bulk); set(db,id,leaseEnded+s",total_windows=${if(i%2==0) 150 else 40}")
        case 4 => set(db,job(db,a,owner,second,bulk),"attempts=5")
        case kind @ (5 | 6) =>
          // A head whose older revision is Running: with a valid lease it blocks the head, with an ended one the claim's
          // first transaction supersedes it and the head is a candidate.
          val request=Fixtures.snapshot(); val first=a.ingest(owner,request)
          set(db,first.jobId,if(kind==5) leased else leaseEnded)
          val next=a.ingest(owner,request.copy(requestId=UUID.randomUUID(),expectedRevision=1))
          order(db,next.jobId,second,bulk)
        case _ => job(db,a,owner,second,bulk)
      }
    }
    val lanes=Vector(lane0,bulkLane,freshLane,freshLane2)
    var idle=Set.empty[ClaimLane]; var claims=0; var borrowed=0
    while(idle.size<lanes.size) {
      val lane=lanes(random.nextInt(lanes.size))
      val before=snapshot(db)
      val wanted=expected(lane,before)
      claim(a,lane) match {
        case ClaimOutcome.Claimed(taken) =>
          assertEquals(Some(taken.jobId),wanted,s"claim $claims of lane ${lane.index}")
          assertEquals(taken.facts.map(f => (f.lane,f.step)),Some((lane.index,step(lane,before,taken.jobId))))
          if(step(lane,before,taken.jobId)==ClaimStep.Borrowed) borrowed+=1
          claims+=1; idle=Set.empty
        case ClaimOutcome.Idle => assertEquals(wanted,None,s"lane ${lane.index} idle with a candidate"); idle+=lane
        case ClaimOutcome.Contended => fail("a claim without a concurrent claim was contended")
      }
    }
    assert(claims>=20 && borrowed>0,s"the generated queue exercised the lanes: $claims claims, $borrowed borrowed")
    assertEquals(eligible(snapshot(db)),Nil,"no candidate is left that no lane takes")
  }}

  test("T1: jobs of one age are claimed in session_id order whatever their owners") { database { (c,db,a) =>
    val jobs=(0 until 12).map(i => job(db,a,owners(i%3),5,false))
    val bySource=jobs.sortBy(id => source(db,id).toString)
    assertEquals((0 until 12).map(i => taken(a,if(i%2==0) freshLane else freshLane2)).toList,bySource.toList)
  }}

  test("T1: each owner's distinct nonzero target and indexing epochs go with its claims; a Running attempt of an older indexing epoch is reclaimed without an attempt charge") { database { (c,db,a) =>
    val epochs=Map("a" -> (3L,2L),"b" -> (7L,5L),"c" -> (11L,13L))
    epochs.foreach { case (owner,(target,indexing)) =>
      db.transaction(x => Sql.exec(x,"UPDATE ch_owner_targets SET epoch=? WHERE owner=?",target,owner)); preference(db,owner,true,indexing)
    }
    val ja=job(db,a,"a",1,false); val jb=job(db,a,"b",2,true); val jc=job(db,a,"c",3,false,Some(150))
    // b's Running attempt was claimed under indexing epoch 4: invalidated, claimable at once.
    set(db,jb,"state='Running',attempts=2,fence=fence+1,indexing_epoch=4,lease_until=clock_timestamp()+interval '1 hour'")
    val claims=List(lane0 -> jc,bulkLane -> jb,freshLane -> ja).map { (lane,id) =>
      val value=claimed(claim(a,lane)); assertEquals(value.jobId,id); value
    }
    for(value <- claims) {
      val (target,indexing)=epochs(value.owner)
      assertEquals((value.targetEpoch,value.indexingEpoch,row(db,value.jobId).indexingEpoch),(target,indexing,indexing),value.owner)
      assert(a.renew(value,300),s"${value.owner}'s claim holds its job under its epochs")
    }
    assertEquals(claims.find(_.jobId==jb).flatMap(_.facts).map(_.invalidated),Some(true))
    assertEquals(row(db,jb).attempts,2,"a policy-invalidated attempt is replaced without a charge")
    assertEquals(List(ja,jc).map(row(db,_).attempts),List(1,1))
    assert(a.publish(claims.head,Nil))
  }}

  test("T1: with every owner opted out (or disabled) no lane claims and no claim fails; the jobs stay as they were") { database { (c,db,a) =>
    val jobs=List(job(db,a,"a",1,false),job(db,a,"b",2,true),job(db,a,"c",3,false,Some(150)))
    db.transaction { x =>
      val store=IndexingPreferenceSql.store(x,IndexingService.Chronicle,c.indexingPolicy)
      List("a","b").foreach(owner => store.setChoice(owner,IndexingChoice.Disable))
      Sql.exec(x,"UPDATE ch_users SET enabled=false WHERE id='c'")
    }
    try {
      for(lane <- List(lane0,bulkLane,freshLane); scope <- ClaimScope.AllOwners::owners.map(ClaimScope.Owner(_))) assertEquals(claim(a,lane,scope),ClaimOutcome.Idle)
      assertEquals(jobs.map(id => (row(db,id).state,row(db,id).attempts,row(db,id).fence)),List.fill(3)(("Queued",0,0L)))
    } finally db.transaction(x => Sql.exec(x,"UPDATE ch_users SET enabled=true WHERE id='c'"))
  }}

  test("T1: a head whose older revision is Running with a valid lease is passed by every lane until that run ends; then it is the oldest candidate again") { database { (c,db,a) =>
    val request=Fixtures.snapshot(); val first=a.ingest("a",request)
    set(db,first.jobId,leased)
    val head=a.ingest("a",request.copy(requestId=UUID.randomUUID(),expectedRevision=1)).jobId
    order(db,head,0,false,Some(150))
    val others=List(job(db,a,"b",5,false,Some(150)),job(db,a,"b",6,true),job(db,a,"c",7,false))
    assertEquals(List(lane0,bulkLane,freshLane).map(taken(a,_)),others)
    assertEquals(List(lane0,bulkLane,freshLane).map(claim(a,_)),List.fill(3)(ClaimOutcome.Idle))
    // The older run's lease ends: the claim's first transaction supersedes it, and the sized head goes to lane 0.
    set(db,first.jobId,"lease_until=clock_timestamp()-interval '1 hour'")
    assertEquals(List(bulkLane,freshLane).map(claim(a,_)),List.fill(2)(ClaimOutcome.Idle))
    assertEquals(row(db,first.jobId).state,"Failed")
    assertEquals(taken(a,lane0),head)
  }}

  test("T1: flag off (claimOrder source-id, the default) the worker claims in today's order, owner then source id, whatever the stored ages, and never through the waiting order") { database(ClaimOrderPostgres.config().copy(indexing=IndexingCapacity.defaults.copy(annotationSessions=1))) { (c,db,a) =>
    assertEquals(ClaimOrderMode.of(c),ClaimOrderMode.SourceId)
    val jobs=(0 until 6).map(i => job(db,a,owners(2-i%3),100-i,i%2==0))
    def owner(id: UUID): String = db.transaction(x => Sql.one(x,"SELECT s.owner FROM ch_sources s JOIN ch_jobs j ON j.session_id=s.id WHERE j.id=?",id)(_.getString(1)).get)
    val legacy=jobs.sortBy(id => (owner(id),source(db,id).toString))
    val log=new WorkerLog; val admission=ModelAdmission.make(c.indexing).unsafeRunSync()
    (for {
      published <- Ref.of[IO,List[UUID]](Nil)
      done <- Deferred[IO,Unit]
      inLane <- Ref.of[IO,Int](0)
      archive=new ForwardingArchive(a) {
        override def claimInLane(profiles: Set[String],scope: ClaimScope,lease: Int,lane: ClaimLane): ClaimOutcome = { inLane.update(_+1).unsafeRunSync(); super.claimInLane(profiles,scope,lease,lane) }
        override def publishProblems(claim: Claim,rows: ProblemRows): Boolean = {
          val result=super.publishProblems(claim,rows)
          if(published.updateAndGet(_:+claim.jobId).unsafeRunSync().size==jobs.size) done.complete(()).unsafeRunSync()
          result
        }
      }
      fiber <- worker(archive,c,admission,log).run.start
      _ <- done.get.timeout(60.seconds)
      _ <- fiber.cancel
      order <- published.get
      lanes <- inLane.get
    } yield (order,lanes)).unsafeRunSync() match { case (order,lanes) =>
      assertEquals(order,legacy.toList)
      assertEquals(lanes,0)
    }
    assert(!log.lines.exists(_.startsWith("job claimed")),"today's order logs no waiting-order claim")
  }}

  test("T2: four owners, four lanes: owner d's oldest fresh job behind three other owners' Running fresh jobs is taken at the next fresh-lane claim, before every younger fresh job") { database(withUsers(waiting(ClaimOrderPostgres.config()),"d")) { (c,db,a) =>
    val running=List(job(db,a,"a",1,false),job(db,a,"b",2,false),job(db,a,"c",3,false))
    assertEquals(List(lane0,bulkLane,freshLane).map(taken(a,_)),running)
    val j=job(db,a,"d",10,false)
    val younger=List(job(db,a,"a",11,false),job(db,a,"b",12,false),job(db,a,"c",13,false),job(db,a,"d",14,false))
    val next=claimed(claim(a,freshLane2))
    assertEquals((next.jobId,next.owner,next.facts.map(_.step)),(j,"d",Some(ClaimStep.Preferred)))
    // The three lanes finish their jobs and claim again: the younger fresh jobs follow in age order, whatever the owner.
    running.zip(List(lane0,bulkLane,freshLane)).foreach { (id,_) => set(db,id,"state='Complete',lease_until=NULL") }
    assertEquals(List(freshLane,lane0,bulkLane,freshLane).map(taken(a,_)),younger)
  }}
}
