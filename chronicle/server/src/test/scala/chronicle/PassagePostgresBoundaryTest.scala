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
  private def census(db: Database,id: UUID): List[String] = db.transaction { c =>
    Sql.rows(c,"SELECT to_jsonb(s)::text FROM ch_sources s WHERE id=?",id)(_.getString(1))++
      Sql.rows(c,"SELECT to_jsonb(j)::text FROM ch_jobs j WHERE session_id=? ORDER BY id",id)(_.getString(1))++
      Sql.rows(c,"SELECT to_jsonb(g)::text FROM ch_generations g WHERE session_id=? ORDER BY id",id)(_.getString(1))++
      List("ch_chunks","ch_generation_tags","ch_problem_passages","ch_problem_spans","ch_problem_pieces").flatMap(table =>
        Sql.rows(c,s"SELECT to_jsonb(item)::text FROM $table item JOIN ch_generations g ON g.id=item.generation WHERE g.session_id=? ORDER BY to_jsonb(item)::text",id)(_.getString(1)))++
      Sql.rows(c,"SELECT to_jsonb(s)::text FROM ch_search_chunks s WHERE session_id=? ORDER BY id",id)(_.getString(1))++
      Sql.rows(c,"SELECT to_jsonb(m)::text FROM ch_reindex_members m WHERE session_id=? ORDER BY request_id",id)(_.getString(1))
  }
  List("ch_problem_passages","ch_problem_spans","ch_problem_pieces").foreach { table =>
    test(s"Effectual GoodCommunication: lease expiry during $table persistence rolls back every new artifact and preserves prior publication") { OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
      val receipt=archive.ingest("a",request(List("A original"))); val legacy=claim(archive,catalog,300)
      val old=Chunk(UUID.randomUUID(),receipt.sessionId,"retained legacy","old",List("old-tag"),Nil,0.0)
      StoredPublicationFixtures.publish(db,legacy,List(IndexedChunk(old,vector)))
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
        assertEquals(archive.passages("a",receipt.sessionId,0,100,Some(previous)).format,PassageFormat.LegacyAnnotations)
      } finally db.transaction { c => Sql.exec(c,s"DROP TRIGGER ch_test_slow_problem ON $table"); Sql.exec(c,"DROP FUNCTION ch_test_slow_problem()") }
    }}
  }
  test("Effectual GoodCommunication: SQL failure after passage metadata insertion rolls back chunks/spans/links and permits the same valid claim to retry") { OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
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
      Sql.exec(c,s"CREATE ROLE $role LOGIN")
      Sql.exec(c,s"GRANT USAGE ON SCHEMA public TO $role")
      Sql.exec(c,s"GRANT SELECT ON ch_sources,ch_users,ch_members,ch_generations,ch_problem_passages,ch_problem_spans TO $role")
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
  test("Effectual GoodCommunication: migration restores schema but never infers lost historical format or invents passage extents") { OwnerProfilePostgres.withDatabase { (config,db,archive,catalog) =>
    val receipt=archive.ingest("a",request(List("A source"))); val current=claim(archive,catalog,300)
    val chunk=Chunk(UUID.randomUUID(),receipt.sessionId,"manual legacy","retained",Nil,Nil,0.0)
    StoredPublicationFixtures.publish(db,current,List(IndexedChunk(chunk,vector)))
    val legacyView=archive.session("a",receipt.sessionId).view
    val opaque=UUID.randomUUID(); val p1=UUID.randomUUID()
    db.transaction { c =>
      Sql.exec(c,"INSERT INTO ch_generations(id,session_id,revision,profile) VALUES(?,?,1,?),(?,?,1,?)",opaque,receipt.sessionId,"opaque-pre007",p1,receipt.sessionId,catalog.preferred.profile)
      Sql.exec(c,"DROP TABLE ch_problem_pieces,ch_problem_spans,ch_problem_passages")
      Sql.exec(c,"ALTER TABLE ch_generations DROP COLUMN passage_format,DROP COLUMN passage_count")
      Sql.exec(c,"DROP TABLE ch_owner_targets,ch_index_profiles,ch_embedding_spaces")
      Sql.exec(c,"DELETE FROM ch_schema_migrations WHERE version=8")
    }
    db.initialize()
    assertEquals(intercept[DomainError](archive.passages("a",receipt.sessionId,0,100,Some(legacyView))).code,"unavailable")
    assertEquals(archive.pageChunks("a",receipt.sessionId,0,100,Some(legacyView)).chunks,List(chunk))
    List(opaque,p1).foreach { generation =>
      val view=ContentView(1,Some(generation))
      assertEquals(intercept[DomainError](archive.passages("a",receipt.sessionId,0,100,Some(view))).code,"unavailable")
      assertEquals(archive.pageChunks("a",receipt.sessionId,0,100,Some(view)).chunks,Nil)
    }
    val before=db.transaction(c => Sql.rows(c,"SELECT id,passage_format,passage_count FROM ch_generations ORDER BY id")(r => (r.getObject(1,classOf[UUID]),Option(r.getString(2)),r.getLong(3))))
    db.initialize()
    assertEquals(db.transaction(c => Sql.rows(c,"SELECT id,passage_format,passage_count FROM ch_generations ORDER BY id")(r => (r.getObject(1,classOf[UUID]),Option(r.getString(2)),r.getLong(3)))),before)
    db.transaction { c =>
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_problem_passages")(_.getLong(1)).get,0L)
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_problem_spans")(_.getLong(1)).get,0L)
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_problem_pieces")(_.getLong(1)).get,0L)
    }
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
