package chronicle

import chronicle.api.*
import io.circe.Json
import java.util.{Base64,UUID}
import java.nio.charset.StandardCharsets.UTF_8

class ArchiveIndexTest extends munit.FunSuite {
  private def database(f: (Config,Database,PostgresArchive,PostgresArchiveIndex) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); val db=new Database(config); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile)
    }
    val archive=new PostgresArchive(db,config)
    f(config,db,archive,new PostgresArchiveIndex(db,archive,config))
  }
  private def snapshot(texts: List[String]): IngestRequest = {
    val original=Fixtures.snapshot()
    val messages=texts.zipWithIndex.map { case (text,index) => Message(s"m$index",None,"user",text,None,index) }
    val raw=messages.map(message => Json.obj("id"->Json.fromString(message.id),"text"->Json.fromString(message.text)).noSpaces).mkString("","\n","\n")
    original.copy(metadata=original.metadata.copy(title="archive row",tags=Nil),messages=messages,files=List(RawFile("source.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  private def query(expression: String,sort: ArchiveSort,direction: SortDirection,cursor: Option[String],limit: Int): ArchiveQuery = ArchiveQuery(expression,sort,direction,cursor,limit)
  private def browse(index: ArchiveIndex,reader: String,q: ArchiveQuery): ArchiveResult = {
    val parsed=ArchiveExpression.parse(q.expression)
    val vectors=if(parsed.mode==SearchMode.Lexical) Nil else parsed.textOperands.map(text => ArchiveVector(text,List(1.0,0.0,0.0)))
    index.browse(reader,q,parsed,vectors)
  }
  private def all(index: ArchiveIndex,expression: String,sort: ArchiveSort,direction: SortDirection,limit: Int): List[ArchiveRow] = {
    var cursor=Option.empty[String]
    val values=List.newBuilder[ArchiveRow]
    var more=true
    while(more) {
      val page=browse(index,"a",query(expression,sort,direction,cursor,limit))
      values++=page.rows; cursor=page.nextCursor; more=cursor.nonEmpty
    }
    values.result()
  }
  test("BG GoodCommunication specified: all raw HEAD rows browse by actual message time without publication/profile availability") { database { (config,db,archive,index) =>
    val first=snapshot(List("older conversation")); val older=first.copy(messages=first.messages.map(_.copy(timestamp=Some("2026-01-01T00:00:00Z"))),metadata=first.metadata.copy(endedAt=Some("2026-10-26T00:00:00Z")))
    val newer=snapshot(List("newer conversation")).copy(messages=List(Message("m0",None,"user","newer conversation",Some("2026-02-01T00:00:00Z"),0)))
    val newest=archive.ingest("a",newer,config.profile); val oldest=archive.ingest("a",older,config.profile)
    db.transaction(c => Sql.exec(c,"UPDATE ch_profile SET maintenance=true,active='unavailable'"))
    val page=browse(index,"a",query("",ArchiveSort.LastTimestamp,SortDirection.Desc,None,100))
    assertEquals(page.total,2L); assertEquals(page.rows.map(_.head.id),List(newest.sessionId,oldest.sessionId))
    assertEquals(page.rows.map(_.publishedView),List(None,None)); assert(page.rows.forall(_.head.view.generationId.isEmpty))
    assertEquals(page.textScope,ArchiveTextScope.ExactLexical); assertEquals(page.annChunkLimitPerOperand,None)
    assertEquals(page.rows.last.lastTimestamp,Some("2026-01-01T00:00:00Z"))
  }}
  test("BG GoodCommunication specified: exact literals preserve phrase/message boundaries, long words, wildcard characters and Unicode overlap") { database { (config,db,archive,index) =>
    val request=snapshot(List("alpha","beta","x"*4090+"Needle Boundary"+"z"*5000,"j"*20000+"longwordneedle"+"j"*1000,"literal %_\\.*","x"*3500+"K"*512+"z"*4000))
    val out=archive.ingest("a",request,config.profile)
    def matches(expression: String): Long = browse(index,"a",query("mode:lexical "+expression,ArchiveSort.LastTimestamp,SortDirection.Desc,None,100)).total
    assertEquals(matches("alpha AND beta"),1L)
    assertEquals(matches("\"alpha beta\""),0L)
    assertEquals(matches("\"needle boundary\""),1L)
    assertEquals(matches("longwordneedle"),1L)
    assertEquals(matches(Json.fromString("%_\\.*").noSpaces),1L)
    assertEquals(matches(Json.fromString("k"*512).noSpaces),1L)
    val literal=matches("%_")
    assertEquals(literal,1L)
    assertEquals(browse(index,"b",query("mode:lexical (alpha OR NOT alpha)",ArchiveSort.Title,SortDirection.Asc,None,100)).total,0L)
    assertEquals(archive.locateMessage("a",out.sessionId,ContentView(1,None),"m5").position,5)
  }}
  test("BG GoodCommunication specified: full Boolean metadata predicates and user filters never broaden live ACL") { database { (config,db,archive,index) =>
    val first=snapshot(List("needlealpha")).copy(metadata=snapshot(List("unused")).metadata.copy(project=Some("ProjectA"),gitBranch=Some("Main"),model=Some("ModelA"),tags=List("work")))
    val visible=archive.ingest("a",first,config.profile)
    archive.ingest("b",snapshot(List("needlebeta")),config.profile)
    def count(expression: String): Long = browse(index,"a",query(expression,ArchiveSort.Title,SortDirection.Asc,None,100)).total
    assertEquals(count("mode:lexical (user:b OR user:a) project:projecta branch:main model:modela tag:WORK"),1L)
    assertEquals(count("mode:lexical (user:b OR needlebeta)"),0L)
    assertEquals(count("mode:lexical NOT (project:other AND needlealpha)"),1L)
    assertEquals(count("mode:lexical NOT project:ProjectA"),0L)
    assertEquals(count("mode:lexical (needlealpha OR NOT needlealpha)"),1L)
    assertEquals(count("mode:lexical needlealpha AND NOT needlealpha"),0L)
    val shared=UUID.randomUUID()
    db.transaction { c => Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','shared')",shared); Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",shared,shared) }
    assertEquals(count("mode:lexical (user:b OR needlealpha)"),2L)
    db.transaction(c => Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id='b'"))
    assertEquals(count("mode:lexical (user:b OR needlealpha)"),1L)
    assertEquals(browse(index,"a",query("user:a",ArchiveSort.Title,SortDirection.Asc,None,100)).rows.head.head.id,visible.sessionId)
  }}
  test("BG GoodCommunication specified: every global header sort pages with stable UUID ties and nulls last") { database { (config,db,archive,index) =>
    (0 until 7).foreach { number =>
      val base=snapshot(List.fill(number+1)("message"))
      archive.ingest("a",base.copy(metadata=base.metadata.copy(title=if(number<3) "tie" else s"title-$number",project=if(number%2==0) Some(s"project-$number") else None,gitBranch=Some(s"branch-${7-number}"),model=if(number%3==0) None else Some(s"model-$number"),tags=if(number%3==0) Nil else List(s"tag-$number"))),config.profile)
    }
    ArchiveSort.all.foreach { sort => List(SortDirection.Asc,SortDirection.Desc).foreach { direction =>
      val complete=browse(index,"a",query("",sort,direction,None,100)).rows
      val pages=all(index,"",sort,direction,2)
      assertEquals(pages.map(_.head.id),complete.map(_.head.id),s"sort=$sort direction=$direction")
      assertEquals(pages.map(_.head.id).distinct.size,7)
    }}
    val first=browse(index,"a",query("",ArchiveSort.Title,SortDirection.Asc,None,2))
    assertEquals(intercept[DomainError](browse(index,"a",query("project:p",ArchiveSort.Title,SortDirection.Asc,first.nextCursor,2))).code,"invalid")
  }}
  List(ArchiveSort.Title,ArchiveSort.Project,ArchiveSort.Branch,ArchiveSort.Producer,ArchiveSort.Model).foreach { sort =>
    test(s"BG GoodCommunication regression: admitted unbounded $sort keys page in transport-sized envelopes in both directions") { database { (config,db,archive,index) =>
      val longKey="X"*50000
      def metadata(base: Metadata,value: String): Metadata = sort match {
        case ArchiveSort.Title => base.copy(title=value)
        case ArchiveSort.Project => base.copy(project=Some(value))
        case ArchiveSort.Branch => base.copy(gitBranch=Some(value))
        case ArchiveSort.Producer => base.copy(producer=value)
        case ArchiveSort.Model => base.copy(model=Some(value))
        case _ => throw new AssertionError("unbounded metadata sort required")
      }
      (0 until 2).foreach { _ =>
        val request=snapshot(List("small message"))
        archive.ingest("a",request.copy(metadata=metadata(request.metadata,longKey)),config.profile)
      }
      List(SortDirection.Asc,SortDirection.Desc).foreach { direction =>
        val first=query("",sort,direction,None,1)
        val page=browse(index,"a",first)
        assert(page.nextCursor.nonEmpty)
        val next=first.copy(cursor=page.nextCursor)
        val envelope=Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(UUID.randomUUID(),Operation.Archive(next))).noSpaces.getBytes(UTF_8)
        assert(envelope.length<=Http.socketFrameBytes,s"sort=$sort direction=$direction envelope=${envelope.length} frame=${Http.socketFrameBytes}")
        assertEquals(all(index,"",sort,direction,1).map(_.head.id),browse(index,"a",first.copy(limit=100)).rows.map(_.head.id))
      }
    }}
  }
  private def changeCursor(cursor: String)(f: Json => Json): String =
    Base64.getUrlEncoder.withoutPadding.encodeToString(f(Wire.parse(new String(Base64.getUrlDecoder.decode(cursor),UTF_8))).noSpaces.getBytes(UTF_8))

  test("BG GoodCommunication specified: referenced archive keys retain their original revision and reject drift, missing anchors and foreign rows") { database { (config,db,archive,index) =>
    val original=snapshot(List("first")).copy(metadata=Fixtures.snapshot().metadata.copy(title="a"))
    val first=archive.ingest("a",original,config.profile)
    val secondRequest=snapshot(List("second")); val second=archive.ingest("a",secondRequest.copy(metadata=secondRequest.metadata.copy(title="b")),config.profile)
    val q=query("",ArchiveSort.Title,SortDirection.Asc,None,1)
    val cursor=browse(index,"a",q).nextCursor.get
    archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1,metadata=original.metadata.copy(title="z")),config.profile)
    assertEquals(browse(index,"a",q.copy(cursor=Some(cursor))).rows.head.head.id,second.sessionId)
    def altered(revision: Int,hash: String): String = changeCursor(cursor)(_.mapObject(_.add("last",Json.arr(Json.fromInt(revision),Json.fromString(hash)))))
    val hash=Wire.parse(new String(Base64.getUrlDecoder.decode(cursor),UTF_8)).hcursor.downField("last").as[List[Json]].toOption.get(1).asString.get
    assertEquals(intercept[DomainError](browse(index,"a",q.copy(cursor=Some(altered(2,hash))))).code,"conflict")
    assertEquals(intercept[DomainError](browse(index,"a",q.copy(cursor=Some(altered(99,hash))))).code,"conflict")
    assertEquals(intercept[DomainError](browse(index,"a",q.copy(cursor=Some(altered(1,"0"*64))))).code,"conflict")
    val foreign=archive.ingest("b",original.copy(requestId=UUID.randomUUID()),config.profile)
    val forged=changeCursor(cursor)(_.mapObject(_.add("id",Json.fromString(foreign.sessionId.toString))))
    assertEquals(intercept[DomainError](browse(index,"a",q.copy(cursor=Some(forged)))).code,"conflict")
    db.transaction(c => Sql.exec(c,"UPDATE ch_sources SET tombstone=true WHERE id=?",first.sessionId))
    assertEquals(intercept[DomainError](browse(index,"a",q.copy(cursor=Some(cursor)))).code,"conflict")
  }}
  test("BG GoodCommunication specified: referenced cursor resolution rechecks live group visibility") { database { (config,db,archive,index) =>
    val request=snapshot(List("shared"))
    archive.ingest("b",request.copy(metadata=request.metadata.copy(title="a")),config.profile)
    archive.ingest("a",snapshot(List("owned")).copy(metadata=request.metadata.copy(title="b")),config.profile)
    val group=UUID.randomUUID()
    db.transaction { c =>
      Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','shared')",group)
      Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",group,group)
    }
    val q=query("",ArchiveSort.Title,SortDirection.Asc,None,1)
    val cursor=browse(index,"a",q).nextCursor.get
    db.transaction(c => Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group))
    assertEquals(intercept[DomainError](browse(index,"a",q.copy(cursor=Some(cursor)))).code,"conflict")
  }}
  test("BG GoodCommunication regression: oversized numeric cursor positions are rejected before SQL execution") { database { (config,db,archive,index) =>
    (1 to 2).foreach { _ =>
      val request=snapshot(List("timestamp"))
      archive.ingest("a",request.copy(metadata=request.metadata.copy(startedAt=Some("2026-01-01T00:00:00Z"))),config.profile)
    }
    val q=query("",ArchiveSort.LastTimestamp,SortDirection.Asc,None,1)
    val cursor=browse(index,"a",q).nextCursor.get
    val oversized=changeCursor(cursor)(_.mapObject(_.add("last",Json.fromString("1e1000000"))))
    assertEquals(intercept[DomainError](browse(index,"a",q.copy(cursor=Some(oversized)))).code,"invalid")
  }}
  private def seed(config: Config,db: Database,size: Int,published: Boolean): Unit = {
    val request=snapshot(List("needlealpha")); val snapshotJson=Wire.encode(IngestRequest.codecJson,request).noSpaces
    val messageJson=Wire.encode(Message.codecJson,request.messages.head).noSpaces
    val chunk=Wire.encode(Chunk.codecJson,Fragments.split(request.messages).head).noSpaces
    db.transaction { c =>
      Sql.exec(c,s"CREATE TEMP TABLE fixture AS SELECT i,md5('archive-source'||i)::uuid AS sid,md5('archive-generation'||i)::uuid AS gid,md5('archive-chunk'||i)::uuid AS cid FROM generate_series(1,$size)i")
      Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key,revision) SELECT sid,'a',i::text,1 FROM fixture")
      Sql.exec(c,"INSERT INTO ch_revisions SELECT sid,1,?::jsonb FROM fixture",snapshotJson)
      Sql.exec(c,"INSERT INTO ch_revision_info SELECT sid,1,?::jsonb,?::jsonb,'Quiescent',false,'2026-01-01T00:00:00Z',1767225600,1,1 FROM fixture",Wire.encode(Metadata.codecJson,request.metadata).noSpaces,Wire.encode(SourceIdentity.codecJson,request.source).noSpaces)
      Sql.exec(c,"INSERT INTO ch_messages SELECT sid,1,0,'m0',?::jsonb FROM fixture",messageJson)
      Sql.exec(c,"INSERT INTO ch_archive_fragments SELECT sid,1,0,'needlealpha' FROM fixture")
      if(published) {
        Sql.exec(c,"INSERT INTO ch_generations SELECT gid,sid,1,? FROM fixture",config.profile)
        Sql.exec(c,"INSERT INTO ch_chunks SELECT cid,gid,?::jsonb || jsonb_build_object('id',cid,'sessionId',sid),to_tsvector('english','needlealpha'),'[1,0,0]'::vector,0 FROM fixture",chunk)
        Sql.exec(c,"INSERT INTO ch_search_chunks SELECT cid,gid,sid,1,?,to_tsvector('english','needlealpha'),'[1,0,0]'::vector FROM fixture",config.profile)
        Sql.exec(c,"UPDATE ch_sources s SET published=f.gid FROM fixture f WHERE s.id=f.sid")
      }
    }
  }
  test("BG GoodCommunication specified: raw browsing and Hybrid literal membership remain unbounded beyond ANN1000") { database { (config,db,archive,index) =>
    seed(config,db,1105,false)
    val rows=all(index,"",ArchiveSort.LastTimestamp,SortDirection.Desc,100)
    assertEquals(rows.size,1105); assertEquals(rows.map(_.head.id).distinct.size,1105)
    val hybrid=browse(index,"a",query("needlealpha",ArchiveSort.LastTimestamp,SortDirection.Desc,None,100))
    assertEquals(hybrid.total,1105L); assertEquals(hybrid.annChunkLimitPerOperand,Some(1000)); assertEquals(hybrid.textScope,ArchiveTextScope.BoundedCandidateSets)
    val complement=browse(index,"a",query("mode:semantic NOT absent",ArchiveSort.LastTimestamp,SortDirection.Desc,None,100))
    assertEquals(complement.total,1105L); assert(complement.rows.forall(_.matchedView.isEmpty))
  }}
  test("BG GoodCommunication specified: stale published ANN and current literal provenance stay separate and immutable") { database { (config,db,archive,index) =>
    val original=snapshot(List("antecedent")); val out=archive.ingest("a",original,config.profile)
    val claim=archive.claim(config.profile,300).get
    val chunk=Fragments.split(original.messages).head.copy(sessionId=out.sessionId,tags=List("annotation-work"))
    assert(archive.publish(claim,List(IndexedChunk(chunk,List(1.0,0.0,0.0)))))
    val published=archive.session("a",out.sessionId).view
    val next=snapshot(List("successor")).copy(source=original.source,expectedRevision=1)
    archive.ingest("a",next,config.profile)
    val semantic=browse(index,"a",query("mode:semantic unrelated",ArchiveSort.LastTimestamp,SortDirection.Desc,None,100)).rows.head
    assertEquals(semantic.head.revision,2); assertEquals(semantic.head.metadata,next.metadata)
    assertEquals(semantic.head.view,ContentView(2,None)); assertEquals(semantic.publishedView,Some(published)); assertEquals(semantic.matchedView,Some(published))
    assert(semantic.tags.contains("annotation-work"))
    val hybrid=browse(index,"a",query("successor",ArchiveSort.LastTimestamp,SortDirection.Desc,None,100)).rows.head
    assertEquals(hybrid.matchedView,Some(ContentView(2,None)))
    assertEquals(archive.messages("a",out.sessionId,0,100,semantic.matchedView).messages.head.text,"antecedent")
    assertEquals(archive.messages("a",out.sessionId,0,100,hybrid.matchedView).messages.head.text,"successor")
  }}
  test("BG GoodCommunication specified: required metadata-only subtrees restrict candidate SQL before limit under exact scan control; mixed Boolean syntax does not") { database { (config,db,archive,index) =>
    seed(config,db,1100,true)
    val target=snapshot(List("far candidate")).copy(metadata=snapshot(List("unused")).metadata.copy(project=Some("target"),tags=List("keep")))
    val out=archive.ingest("a",target,config.profile); val claim=archive.claim(config.profile,300).get
    assert(archive.publish(claim,List(IndexedChunk(Fragments.split(target.messages).head.copy(sessionId=out.sessionId),List(0.0,1.0,0.0)))))
    val separator=if(config.jdbcUrl.contains("?")) "&" else "?"
    val options=java.net.URLEncoder.encode("-c enable_indexscan=off -c enable_bitmapscan=off",java.nio.charset.StandardCharsets.UTF_8)
    val exactConfig=config.copy(jdbcUrl=config.jdbcUrl+separator+"options="+options)
    val exactDb=new Database(exactConfig)
    val exactIndex=new PostgresArchiveIndex(exactDb,new PostgresArchive(exactDb,exactConfig),exactConfig)
    def count(body: String): Long = browse(exactIndex,"a",query("mode:semantic ("+body+")",ArchiveSort.LastTimestamp,SortDirection.Desc,None,100)).total
    assertEquals(count("project:target (foo OR bar)"),1L)
    assertEquals(count("(project:target AND foo) OR (project:target AND bar)"),0L)
    assertEquals(count("(project:target OR project:missing) NOT tag:spam foo"),1L)
    assertEquals(count("NOT (project:target AND foo)"),1101L)
    assertEquals(count("foo OR NOT foo"),1101L)
    assertEquals(count("foo AND NOT foo"),0L)
  }}
  test("Perf GoodCommunication: empty metadata projection does not touch100MiB raw snapshot or message payloads") { database { (config,db,archive,index) =>
    val out=archive.ingest("a",snapshot(List("tiny visible message")),config.profile)
    db.transaction(c => Sql.exec(c,"UPDATE ch_revisions SET snapshot=jsonb_set(snapshot,'{files,0,content}',to_jsonb(repeat('r',100*1024*1024))) WHERE session_id=?",out.sessionId))
    val q=query("",ArchiveSort.LastTimestamp,SortDirection.Desc,None,100)
    val statement=index.statement("a",q,ArchiveExpression.parse(""),Nil,None)
    val plan=db.transaction(c => Sql.rows(c,"EXPLAIN (ANALYZE,BUFFERS) "+statement.text,statement.args*)(_.getString(1)).mkString("\n"))
    println("ARCHIVE100MiB PROJECTION PLAN\n"+plan)
    assert(!plan.contains("ch_revisions"),plan); assert(!plan.contains("ch_messages"),plan); assert(!plan.contains("ch_archive_fragments"),plan)
    assertEquals(browse(index,"a",q).rows.head.head.id,out.sessionId)
  }}
}
