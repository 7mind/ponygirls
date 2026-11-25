package chronicle

import chronicle.api.*
import java.time.Clock
import java.util.UUID
import ponygirls.auth.{IndexingChoice,IndexingPreferenceSql,IndexingPreferences,IndexingService}

/** The SQL policy and each read policy boundary run against one owned PostgreSQL database. */
final class IndexingReadPolicyTest extends munit.FunSuite {
  private val vector=List(1.0,0.0,0.0)
  private val filter=SearchFilter(None,None,None,None,Nil)
  private def snapshot(label: String): IngestRequest = {
    val base=Fixtures.snapshot()
    val text=s"synthetic needle $label"
    val raw=base.files.head.content.replace(base.messages.head.text,text)
    base.copy(digest=Wire.hash(raw),files=List(base.files.head.copy(content=raw,sha256=Wire.hash(raw))),
      metadata=base.metadata.copy(title=label,tags=List("source-common",s"source-$label")),messages=List(base.messages.head.copy(text=text)))
  }
  private def publish(a: PostgresArchive,owner: String,r: IngestRequest): IngestReceipt = {
    val receipt=a.ingest(owner,r)
    val claim=a.claim(a.knownProfiles,ClaimScope.Owner(owner),300).get
    assertEquals(claim.sessionId,receipt.sessionId)
    val piece=Fragments.split(r.messages).head.copy(sessionId=receipt.sessionId,summary="synthetic needle summary",tags=List(s"generated-${r.metadata.title}"))
    assert(a.publish(claim,List(IndexedChunk(piece,vector))))
    receipt
  }
  private def share(db: Database): Unit = db.transaction { c =>
    val id=UUID.randomUUID()
    Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','synthetic indexing read sharing')",id)
    Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",id,id)
  }
  private def withPreference(db: Database,config: Config,owner: String)(run: ((IndexingPreferences => Unit) => Unit) => Unit): Unit = {
    def store(c: java.sql.Connection): IndexingPreferences = IndexingPreferenceSql.store(c,IndexingService.Chronicle,config.indexingPolicy)
    val before=db.transaction(c => store(c).get(owner))
    try run(change => db.transaction(c => change(store(c))))
    finally db.transaction { c => val preference=store(c); preference.setChoice(owner,before.choice); preference.setOverride(owner,before.overrideChoice); () }
  }
  private def archiveQuery(index: ArchiveIndex,expression: String,reader: String="a"): ArchiveSearchResult = {
    val q=ArchiveQuery(expression,ArchiveSort.LastTimestamp,SortDirection.Desc,None,10,true)
    val parsed=ArchiveExpression.parse(expression)
    val vectors=if(parsed.mode==SearchMode.Lexical) Nil else parsed.textOperands.map(ArchiveVector(_,vector))
    val result=index.sourceSearch(reader,q,parsed,vectors,ReadMaterialization.unrestricted)
    assertEquals(index.browse(reader,q,parsed,vectors),result.page)
    result
  }
  private def missing(read: => Any): Unit = assertEquals(intercept[DomainError](read).code,"not-found")

  test("Blackbox GoodCommunication: the source owner's indexing choice gates Search, facets, tags and semantic compatibility, not the reader's choice or sharing") {
    OwnerProfilePostgres.withDatabase { (config,db,a,_) =>
      val allowed=publish(a,"a",snapshot("allowed")).sessionId
      val shared=publish(a,"b",snapshot("shared")).sessionId
      val privateSource=publish(a,"c",snapshot("private")).sessionId
      share(db)
      val search=new PostgresSearch(db,a,config)
      val archiveIndex=new PostgresArchiveIndex(db,a,config)
      val q=SearchQuery("needle",SearchMode.Lexical,filter.copy(project=Some("project"),gitBranch=Some("main"),after=Some("2025-01-01T00:00:00Z"),tags=List("source-common")),20,0)
      def hits(reader: String,expected: Set[UUID]): Unit = SearchMode.all.foreach { mode =>
        val input=q.copy(mode=mode)
        val embedding=Option.when(mode!=SearchMode.Lexical)(vector)
        List(search.search(reader,input,embedding),search.searchLegacy(reader,input,embedding)).foreach { result =>
          assertEquals(result.hits.map(_.session.id).toSet,expected,s"$reader $mode")
          assertEquals(result.total,expected.size)
        }
      }
      hits("a",Set(allowed,shared))
      val old=a.session("a",shared).view
      withPreference(db,config,"b") { change =>
        change(_.setChoice("b",IndexingChoice.Disable))
        hits("a",Set(allowed)); hits("b",Set(allowed))
        val expected=Set(Facet("source-common",1),Facet("source-allowed",1),Facet("generated-allowed",1))
        assertEquals(search.facets("b",q.filter).tags.toSet,expected)
        assertEquals(search.tags("b",TagSearchQuery("",q.filter,None,10)).toSet,expected)
        change(_.setOverride("b",IndexingChoice.Enable))
        hits("a",Set(allowed,shared))
        assertEquals(a.session("a",shared).view,old,"re-enabling reuses the retained index")
        change { pref => pref.setChoice("b",IndexingChoice.Enable); pref.setOverride("b",IndexingChoice.Disable); () }
        hits("a",Set(allowed))
        missing(a.session("b",privateSource))
        // An ineligible owner's obsolete target or publication must not trip a semantic guard, even for that reader.
        db.transaction { c =>
          Sql.exec(c,"UPDATE ch_owner_targets SET profile='obsolete-target' WHERE owner='b'")
          Sql.exec(c,"UPDATE ch_generations SET profile='obsolete-publication' WHERE session_id=?",shared)
        }
        try {
          hits("b",Set(allowed))
          assertEquals(archiveQuery(archiveIndex,"mode:semantic needle","b").page.rows.map(_.head.id),List(allowed))
          change(_.setOverride("b",IndexingChoice.Enable))
          assertEquals(intercept[DomainError](search.search("a",q.copy(mode=SearchMode.Semantic),Some(vector))).code,"unavailable")
          assertEquals(intercept[DomainError](archiveQuery(archiveIndex,"mode:semantic needle")).code,"unavailable")
        } finally db.transaction { c =>
          Sql.exec(c,"UPDATE ch_owner_targets SET profile=? WHERE owner='b'",config.profile)
          Sql.exec(c,"UPDATE ch_generations SET profile=? WHERE session_id=?",config.profile,shared)
        }
      }
      val off=config.copy(indexingPolicy=config.indexingPolicy.copy(defaultEnabled=false))
      val offSearch=new PostgresSearch(db,new PostgresArchive(db,off),off)
      assertEquals(offSearch.search("a",q,None).total,0)
    }
  }

  test("Blackbox GoodCommunication: Archive preserves metadata membership but suppresses both lexical layouts, generated tags and source witnesses") {
    OwnerProfilePostgres.withDatabase { (config,db,a,_) =>
      val legacy=new PostgresArchive(db,config,RevisionLayoutPolicy.Legacy)
      val plain=publish(legacy,"b",snapshot("legacy")).sessionId
      val epoch=publish(a,"b",snapshot("epoch")).sessionId
      val eligible=publish(a,"a",snapshot("eligible")).sessionId
      share(db)
      val index=new PostgresArchiveIndex(db,a,config)
      val hintIndex=new PostgresExpressionHintIndex(db,a,Clock.systemUTC())
      def hints(expr: String): Set[String] = hintIndex.hints("a",ExpressionHintQuery(ExpressionHintTarget.Archive(),expr,expr.length,20)).hints.map(_.label).toSet
      def ids(result: ArchiveSearchResult): Set[UUID] = result.page.rows.map(_.head.id).toSet
      assertEquals(ids(archiveQuery(index,"mode:lexical needle")),Set(plain,epoch,eligible))
      assert(hints("tag:").contains("generated-epoch"))
      withPreference(db,config,"b") { change =>
        change(_.setChoice("b",IndexingChoice.Disable))
        List("mode:lexical needle","mode:lexical le","mode:semantic needle","mode:hybrid needle").foreach { expression =>
          assertEquals(ids(archiveQuery(index,expression)),Set(eligible),expression)
        }
        val mixed=archiveQuery(index,"mode:hybrid (user:b OR needle)")
        assertEquals(ids(mixed),Set(plain,epoch,eligible))
        for(row <- mixed.page.rows if row.head.ownerId=="b") {
          assertEquals(row.head.indexedRevision,None)
          assertEquals(row.publishedView,None); assertEquals(row.publishedFormat,None); assertEquals(row.matchedView,None)
          assert(!row.tags.exists(_.startsWith("generated-"))); assert(row.tags.contains("source-common"))
          assertEquals(mixed.evidence.find(_.sessionId==row.head.id).get.matches,Nil)
        }
        val negated=archiveQuery(index,"mode:lexical project:project AND NOT needle")
        assertEquals(ids(negated),Set(plain,epoch)); assert(negated.evidence.forall(_.matches.isEmpty))
        assertEquals(ids(archiveQuery(index,"tag:generated-epoch")),Set.empty[UUID])
        assertEquals(ids(archiveQuery(index,"tag:source-epoch")),Set(epoch))
        assertEquals(hints("tag:"),Set("source-legacy","source-common","source-eligible","source-epoch","generated-eligible"))
        assertEquals(hints("user:"),Set("a","b"))
      }
    }
  }

  test("Blackbox GoodCommunication: invalidated Running work reads as pending across Archive, Activity and status") {
    OwnerProfilePostgres.withDatabase { (config,db,a,_) =>
      val receipt=a.ingest("b",snapshot("in flight"))
      share(db)
      val claim=a.claim(a.knownProfiles,ClaimScope.Owner("b"),300).get
      assert(a.progress(claim,1,2))
      val index=new PostgresArchiveIndex(db,a,config)
      val activity=new PostgresActivity(db,Clock.systemUTC())
      val user=UserInfo("b","b",List(Scope.Read))
      val summary=ActivityQuery("",ActivityCollectorSort.CollectorId,SortDirection.Asc,None,10)
      def status(state: String): List[JobInfo] = archiveQuery(index,s"status:$state").page.rows.flatMap(_.headJob)
      def jobs(expr: String): List[ActivityJob] = activity.jobs("b",ActivityJobsQuery(None,ActivityJobScope.Current,expr,ActivityJobSort.JobId,SortDirection.Asc,None,10)).jobs
      val running=a.statuses("a",0,10).jobs.head
      assertEquals(running.state,JobState.Running); assertEquals(running.attempts,1); assertEquals(running.completedWindows,1)
      assertEquals(status("running"),List(running)); assertEquals(jobs("lease:active AND status:running").map(_.job),List(running))
      withPreference(db,config,"b") { change =>
        change(_.setChoice("b",IndexingChoice.Disable))
        val pending=running.copy(state=JobState.Queued,attempts=0,completedWindows=0,totalWindows=None)
        def parked(): Unit = {
          assertEquals(a.statuses("a",0,10).jobs,List(pending))
          val jobsRunning=jobs("status:running OR lease:active")
          val jobsQueued=jobs("status:queued")
          val counts=activity.summary(user,summary).current
          assertEquals((status("queued"),status("running"),jobsQueued.map(_.job),jobsRunning.map(_.job),counts.queued,counts.running),
            (List(pending),Nil,List(pending),Nil,1L,0L))
          assert(jobsQueued.forall(job => job.leaseExpiresAt.isEmpty && !job.leaseActive))
        }
        parked()
        change(_.setChoice("b",IndexingChoice.Enable))
        parked() // An enable does not revive a fence-invalidated lease; a new claim may take it.
        assertEquals(db.transaction(c => Sql.one(c,"SELECT state FROM ch_jobs WHERE id=?",receipt.jobId)(_.getString(1))),Some("Running"))
      }
    }
  }

  test("Blackbox GoodCommunication: a retained historical generation pin cannot open any view, while explicit raw access and default head reads still work") {
    OwnerProfilePostgres.withDatabase { (config,db,a,_) =>
      val original=snapshot("original")
      val first=publish(a,"b",original)
      val id=first.sessionId
      share(db)
      val pin=a.session("a",id).view
      val passage=a.passages("a",id,0,10,Some(pin)).passages.head.id
      publish(a,"b",snapshot("updated").copy(source=original.source,expectedRevision=1))
      val current=a.session("a",id).view
      val revision3=snapshot("head").copy(source=original.source,expectedRevision=2)
      a.ingest("b",revision3)
      assertNotEquals(pin,current)
      assertEquals(a.messages("a",id,0,10,Some(pin)).messages,original.messages)
      val anchor=Span(revision3.messages.head.id,0,9)
      withPreference(db,config,"b") { change =>
        change(_.setChoice("b",IndexingChoice.Disable))
        val head=ContentView(3,None)
        val session=a.readSession("a",id,None)
        assertEquals(session.session.view,head); assertEquals(session.session.indexedRevision,None); assertEquals(session.chunks,Nil)
        assertEquals(a.pageChunks("a",id,0,10,None).total,0)
        assertEquals(a.passages("a",id,0,10,None).total,0L)
        assertEquals(a.messages("a",id,0,10,None).messages,revision3.messages)
        assertEquals(a.readMessageContext("a",id,head,anchor,0,0).excerpts.head.text,"synthetic")
        assertEquals(a.searchSessionMessages("a",id,head,"needle",None,10).hits.size,1)
        assertEquals(a.locateMessage("a",id,head,anchor.messageId).position,0)
        assertEquals(a.messages("a",id,0,10,Some(ContentView(1,None))).messages,original.messages)
        assertEquals(a.raw("a",id,Some(1)).files,original.files)
        val jobs=ActivityJobsQuery(None,ActivityJobScope.All,"",ActivityJobSort.JobId,SortDirection.Asc,None,10)
        assert(new PostgresActivity(db,Clock.systemUTC()).jobs("b",jobs).jobs.forall(_.session.indexedRevision.isEmpty))
        def disabled(read: => Any): Unit = assertEquals(intercept[DomainError](read).code,"indexed-view-disabled")
        missing(a.readSession("c",id,Some(pin)))
        missing(a.readSession("a",id,Some(pin.copy(generationId=Some(UUID.randomUUID())))))
        missing(a.readSession("a",id,Some(pin.copy(revision=3))))
        List(pin,current).foreach { saved =>
          disabled(a.readSession("a",id,Some(saved)))
          disabled(a.messages("a",id,0,10,Some(saved)))
          disabled(a.pageChunks("a",id,0,10,Some(saved)))
          disabled(a.passages("a",id,0,10,Some(saved)))
          disabled(a.passageSpans("a",id,passage,0,10,Some(saved)))
          disabled(a.locateMessage("a",id,saved,anchor.messageId))
          disabled(a.readMessageContext("a",id,saved,anchor,0,0))
          disabled(a.searchSessionMessages("a",id,saved,"needle",None,10))
        }
      }
      assertEquals(a.messages("a",id,0,10,Some(pin)).messages,original.messages)
    }
  }
}
