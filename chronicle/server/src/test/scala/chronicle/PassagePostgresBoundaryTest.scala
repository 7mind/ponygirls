package chronicle

import chronicle.api.*
import java.util.UUID
import java.util.concurrent.{Callable,Executors,Future,TimeUnit}

class PassagePostgresBoundaryTest extends munit.FunSuite {
  import ProblemPublicationFixtures.*
  private def transition(db: Database): Unit = {
    val service=new PostgresOwnerReindex(db); val plan=service.preview("a")
    service("a",UUID.randomUUID(),plan.targetProfile,plan.selectionHash,true); ()
  }
  private def claim(archive: SessionArchive,catalog: IndexProfileCatalog,lease: Int): Claim = archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),lease).get
  /** What a reader can reach: every row but those of a staged generation (migration 026), which only its job's run
    * continues or the maintenance pass deletes. */
  private def census(db: Database,id: UUID): List[String] = db.transaction { c =>
    val visible="NOT EXISTS(SELECT 1 FROM ch_staged_generations st WHERE st.generation=g.id)"
    Sql.rows(c,"SELECT to_jsonb(s)::text FROM ch_sources s WHERE id=?",id)(_.getString(1))++
      Sql.rows(c,"SELECT to_jsonb(j)::text FROM ch_jobs j WHERE session_id=? ORDER BY id",id)(_.getString(1))++
      Sql.rows(c,s"SELECT to_jsonb(g)::text FROM ch_generations g WHERE session_id=? AND $visible ORDER BY id",id)(_.getString(1))++
      List("ch_chunks","ch_generation_tags","ch_problem_passages","ch_problem_spans","ch_problem_pieces").flatMap(table =>
        Sql.rows(c,s"SELECT to_jsonb(item)::text FROM $table item JOIN ch_generations g ON g.id=item.generation WHERE g.session_id=? AND $visible ORDER BY to_jsonb(item)::text",id)(_.getString(1)))++
      Sql.rows(c,s"SELECT to_jsonb(s)::text FROM ch_search_chunks s JOIN ch_generations g ON g.id=s.generation WHERE s.session_id=? AND $visible ORDER BY s.id",id)(_.getString(1))++
      Sql.rows(c,"SELECT to_jsonb(m)::text FROM ch_reindex_members m WHERE session_id=? ORDER BY request_id",id)(_.getString(1))
  }
  List("ch_problem_passages","ch_problem_spans","ch_problem_pieces").foreach { table =>
    test(s"Effectual GoodCommunication: lease expiry during $table persistence leaves no artifact a reader reaches and preserves prior publication") { OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
      val receipt=archive.ingest("a",request(List("A original"))); val prior=claim(archive,catalog,300)
      val old=Chunk(UUID.randomUUID(),receipt.sessionId,"prior publication","old",List("old-tag"),Nil,0.0)
      TestPublications.stored(db,prior,List(IndexedChunk(old,vector)))
      val previous=archive.session("a",receipt.sessionId).view
      transition(db)
      db.transaction { c =>
        Sql.exec(c,"CREATE FUNCTION ch_test_slow_problem() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END$$")
        Sql.exec(c,s"CREATE TRIGGER ch_test_slow_problem BEFORE INSERT ON $table FOR EACH ROW EXECUTE FUNCTION ch_test_slow_problem()")
      }
      try {
        val current=claim(archive,catalog,1); val publication=oneProblem(current); val before=census(db,receipt.sessionId)
        assert(!archive.publishProblems(current,publication))
        assertEquals(census(db,receipt.sessionId),before)
        assertEquals(archive.session("a",receipt.sessionId).view,previous)
        assertEquals(archive.pageChunks("a",receipt.sessionId,0,100,Some(previous)).chunks,List(old))
        assertEquals(archive.passages("a",receipt.sessionId,0,100,Some(previous)).format,PassageFormat.ContextAwareProblems)
      } finally db.transaction { c => Sql.exec(c,s"DROP TRIGGER ch_test_slow_problem ON $table"); Sql.exec(c,"DROP FUNCTION ch_test_slow_problem()") }
    }}
  }
  test("Effectual GoodCommunication: SQL failure after passage metadata insertion leaves no artifact a reader reaches and permits the same valid claim to retry") { OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
    transition(db); val receipt=archive.ingest("a",request(List("A🙂"))); val current=claim(archive,catalog,300); val publication=oneProblem(current)
    db.transaction { c =>
      Sql.exec(c,"CREATE FUNCTION ch_test_reject_span() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic span rejection'; END$$")
      Sql.exec(c,"CREATE TRIGGER ch_test_reject_span BEFORE INSERT ON ch_problem_spans FOR EACH ROW EXECUTE FUNCTION ch_test_reject_span()")
    }
    try {
      val before=census(db,receipt.sessionId)
      intercept[java.sql.SQLException](archive.publishProblems(current,publication))
      assertEquals(census(db,receipt.sessionId),before)
    } finally db.transaction { c => Sql.exec(c,"DROP TRIGGER ch_test_reject_span ON ch_problem_spans"); Sql.exec(c,"DROP FUNCTION ch_test_reject_span()") }
    assert(archive.publishProblems(current,publication)); assertEquals(archive.passages("a",receipt.sessionId,0,100,None).total,1L)
  }}
  test("BG GoodCommunication: passage pages use metadata only and require no privilege to fetch snapshot or message payload columns") { OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
    transition(db); val receipt=archive.ingest("a",request(List.fill(160)("A🙂"))); val current=claim(archive,catalog,300)
    assert(archive.publishProblems(current,oneProblem(current)))
    val view=archive.session("a",receipt.sessionId).view; val expected=archive.passages("a",receipt.sessionId,0,100,Some(view))
    val role="passage_reader_"+UUID.randomUUID().toString.replace("-","")
    db.transaction { c =>
      Sql.exec(c,s"CREATE ROLE $role LOGIN PASSWORD '${Fixtures.databasePassword}'")
      Sql.exec(c,s"GRANT USAGE ON SCHEMA public TO $role")
      Sql.exec(c,s"GRANT SELECT ON ch_sources,ch_users,ch_members,ch_generations,ch_staged_generations,ch_problem_passages,ch_problem_spans TO $role")
      Sql.exec(c,s"GRANT SELECT(session_id,revision) ON ch_revisions TO $role")
    }
    try {
      val reader=new PostgresArchive(new Database(config.copy(databaseUser=role),catalog),config)
      assertEquals(reader.passages("a",receipt.sessionId,0,100,Some(view)),expected)
      val spans=reader.passageSpans("a",receipt.sessionId,expected.passages.head.id,100,100,Some(view))
      assertEquals(spans.spans.size,60); assertEquals(spans.total,160L)
      assertEquals(reader.passageSpans("a",receipt.sessionId,expected.passages.head.id,Int.MaxValue,100,Some(view)).spans,Nil)
      intercept[java.sql.SQLException](reader.headSnapshot("a",receipt.sessionId))
    } finally db.transaction { c => Sql.exec(c,s"DROP OWNED BY $role"); Sql.exec(c,s"DROP ROLE $role") }
  }}
  test("Effectual GoodCommunication: purge cascades problem metadata/spans/links together with generations and chunks") { OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
    transition(db); val receipt=archive.ingest("a",request(List("A🙂BαA"))); val current=claim(archive,catalog,300)
    assert(archive.publishProblems(current,topics(current)))
    val auth=new Auth(db,config); val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.Purge(receipt.sessionId)))
    db.transaction { c =>
      List("ch_generations","ch_chunks","ch_search_chunks","ch_problem_passages","ch_problem_spans","ch_problem_pieces").foreach(table =>
        assertEquals(Sql.one(c,s"SELECT count(*) FROM $table")(_.getLong(1)).get,0L))
    }
  }}
  test("BG GoodCommunication: one repeatable-read metadata page keeps authorization and data on the same snapshot, while the next page rechecks revocation") { OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
    transition(db); val receipt=archive.ingest("a",request(List("A🙂"))); val current=claim(archive,catalog,300)
    assert(archive.publishProblems(current,oneProblem(current)))
    val view=archive.session("a",receipt.sessionId).view; val group=UUID.randomUUID()
    db.transaction { c => Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','synthetic')",group); Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",group,group) }
    val executor=Executors.newSingleThreadExecutor(); var pending: Future[PassagesResult]=null
    try {
      db.transaction { held =>
        Sql.exec(held,"LOCK TABLE ch_problem_passages IN ACCESS EXCLUSIVE MODE")
        pending=executor.submit(new Callable[PassagesResult] { def call(): PassagesResult=archive.passages("b",receipt.sessionId,0,100,Some(view)) })
        val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5)
        def blocked: Boolean=db.transaction(c => Sql.one(c,"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT value FROM ch_problem_passages%')")(_.getBoolean(1)).get)
        while(!blocked && System.nanoTime()<deadline) Thread.sleep(5)
        assert(blocked,"metadata read must be observed after snapshot authorization, waiting on the passage table")
        db.transaction { c => Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group) }
      }
      assertEquals(pending.get(5,TimeUnit.SECONDS).total,1L)
      assertEquals(intercept[DomainError](archive.passages("b",receipt.sessionId,0,100,Some(view))).code,"not-found")
    } finally { executor.shutdownNow(); assert(executor.awaitTermination(6,TimeUnit.SECONDS)) }
  }}
}
