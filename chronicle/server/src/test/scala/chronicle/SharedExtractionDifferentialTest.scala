package chronicle

import chronicle.api.*
import java.util.UUID

/** Controlled synthetic vectors establish unchanged algorithms, not provider quality. */
class SharedExtractionDifferentialTest extends munit.FunSuite {
  private def fixture(run: (Config,Database,PostgresArchive) => Unit): Unit = {
    Check(sys.env.contains("CHRONICLE_TEST_JDBC"),"test","real PostgreSQL required for extraction differential")
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.current(config)); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile)
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    val archive=new PostgresArchive(db,config)
    List("a","b","c").zipWithIndex.foreach { (owner,i) =>
      val original=Fixtures.snapshot(); val texts=List(s"alpha record $owner",s"west second $owner",s"blocked alpha third $owner")
      val messages=texts.zipWithIndex.map((text,j) => Message(s"m$j",None,"user",text,Some(s"2026-01-0${i+1}T00:00:00Z"),j))
      val raw=messages.map(m => Wire.encode(Message.codecJson,m).noSpaces).mkString("","\n","\n")
      val request=original.copy(messages=messages,files=List(RawFile("controlled.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw),metadata=original.metadata.copy(title=s"fixture $owner",project=Some(if(i==0) "narrow" else "wide"),tags=List("controlled")))
      val receipt=archive.ingest(owner,request)
      val claim=archive.claim(Set(config.profile),ClaimScope.Owner(owner),300).get
      val vectors=List(List(1.0,i.toDouble/10,0.0),List(0.0,1.0,0.0),List(1.0,1.0,0.0))
      assert(archive.publishProblems(claim,TestPublications.from(claim,messages.zip(vectors).map { (message,vector) => IndexedChunk(Fragments.split(List(message)).head.copy(sessionId=receipt.sessionId),vector) })))
    }
    val group=UUID.randomUUID()
    db.transaction { c => Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','controlled')",group); Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",group,group) }
    run(config,db,archive)
  }
  test("Blackbox-GoodCommunication: published-passage extraction is differential equal on actual corpus, filters/counts/ties/live ACL") { fixture { (config,db,archive) =>
    val baseline=new ExtractionBaselinePostgresSearch(db,archive,config); val candidate=new PostgresSearch(db,archive,config)
    def compare(): Unit = for {
      reader <- List("a","b","c")
      mode <- List(SearchMode.Lexical,SearchMode.Semantic,SearchMode.Hybrid)
      text <- List("alpha","alpha -blocked","")
      filter <- List(SearchFilter(None,None,None,None,Nil),SearchFilter(Some("narrow"),None,None,None,List("controlled")))
    } {
      val q=SearchQuery(text,mode,filter,2,0); val vector=if(mode==SearchMode.Lexical) None else Some(List(1.0,0.0,0.0))
      assertEquals(candidate.statement(reader,q,vector),baseline.statement(reader,q,vector))
      assertEquals(candidate.search(reader,q,vector),baseline.search(reader,q,vector))
    }
    compare(); db.transaction(c => Sql.exec(c,"DELETE FROM ch_members WHERE user_id='b'")); compare()
  } }
  test("Blackbox-GoodCommunication: Boolean archive extraction preserves literal HEAD, semantic membership, provenance and pins") { fixture { (config,db,archive) =>
    val baseline=new ExtractionBaselinePostgresArchiveIndex(db,archive,config); val candidate=new PostgresArchiveIndex(db,archive,config)
    // Move HEAD without publication: literal and semantic evidence must keep distinct pinned revisions.
    val first=db.transaction(c => Sql.one(c,"SELECT id FROM ch_sources WHERE owner='a'")(_.getObject(1,classOf[UUID])).get)
    val old=archive.headSnapshot("a",first)
    archive.ingest("a",old.copy(requestId=UUID.randomUUID(),expectedRevision=1,metadata=old.metadata.copy(title="new mutable HEAD")))
    def compare(): Unit = for {
      reader <- List("a","b","c")
      expression <- List("mode:lexical alpha","mode:semantic alpha","mode:hybrid (alpha OR NOT west)","mode:hybrid alpha project:narrow","mode:lexical alpha AND NOT west")
    } {
      val parsed=ArchiveExpression.parse(expression)
      val vectors=if(parsed.mode==SearchMode.Lexical) Nil else parsed.textOperands.map(text => ArchiveVector(text,if(text=="west") List(0.0,1.0,0.0) else List(1.0,0.0,0.0)))
      val q=ArchiveQuery(expression,ArchiveSort.LastTimestamp,SortDirection.Desc,None,2,true)
      assertEquals(candidate.statement(reader,q,parsed,vectors,None),baseline.statement(reader,q,parsed,vectors,None))
      val oldPage=baseline.browse(reader,q,parsed,vectors); val newPage=candidate.browse(reader,q,parsed,vectors)
      assertEquals(newPage,oldPage)
      assertEquals(candidate.sourceSearch(reader,q,parsed,vectors,ReadMaterialization.unrestricted),baseline.sourceSearch(reader,q,parsed,vectors,ReadMaterialization.unrestricted))
      oldPage.nextCursor.foreach { cursor => assertEquals(candidate.browse(reader,q.copy(cursor=Some(cursor)),parsed,vectors),baseline.browse(reader,q.copy(cursor=Some(cursor)),parsed,vectors)) }
    }
    compare(); db.transaction(c => Sql.exec(c,"DELETE FROM ch_members WHERE user_id='b'")); compare()
  } }
}
