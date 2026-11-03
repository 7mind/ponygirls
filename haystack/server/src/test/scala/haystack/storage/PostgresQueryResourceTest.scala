package haystack.storage

import cats.effect.IO
import cats.syntax.all.*
import haystack.domain.*
import haystack.query.*
import haystack.retrieval.{HaystackRetrieval,ProjectionPolicy}
import ponygirls.retrieval.postgres.PostgresRetrieval
import TestSupport.*

class PostgresQueryResourceTest extends ContractSuite {
  test("dense filtering and global keyset limiting happen in SQL without document_text hydration") { run(initializedDatabase.use { db=>
    val repo=new PostgresItemRepository(db)
    for{
      _<-db.transaction { c=>
        Sql.update(c,"""INSERT INTO items(project_id,item_id,revision,document,document_text,created_at,created_by,modified_at,modified_by)
          SELECT 'dense',n::text,1,payload,payload::text,now(),'alice',now(),'alice' FROM generate_series(1,1200) n CROSS JOIN LATERAL (
            SELECT jsonb_build_object('title',lpad(n::text,5,'0'),'description','d','fields',jsonb_build_object('large',repeat('x',100000)),
            'type',CASE WHEN n%100=0 THEN 'selected' ELSE 'other' END,'status','actual','importance','low','human-attention','cleared','links','[]'::jsonb,'tags','[]'::jsonb) AS payload) doc""")
        ()
      }
      input=SearchInput("type:selected",Some("dense"),3,sort=SearchSort("title","desc"))
      plan=PostgresSearch.compile(input)
      _=assert(!plan.sql.contains("document_text"));_=assertEquals(plan.params.last,4)
      explain<-db.transaction(c=>Sql.rows(c,"EXPLAIN (ANALYZE,VERBOSE,FORMAT JSON) "+plan.sql,plan.params)(_.getString(1)).head)
      tree=io.circe.parser.parse(explain).toOption.get.asArray.get.head.hcursor.downField("Plan")
      _=assertEquals(tree.get[String]("Node Type").toOption,Some("Limit"));_=assertEquals(tree.get[Int]("Actual Rows").toOption,Some(4))
      _=assert(!explain.contains("document_text"))
      page<-repo.search(input)
      _=assertEquals(page.items.map(_.title),Vector("01200","01100","01000"));_=assert(page.cursor.nonEmpty)
      next<-repo.search(input.copy(cursor=page.cursor))
      _=assertEquals(next.items.map(_.title),Vector("00900","00800","00700"))
      values<-repo.observedValues("type");_=assertEquals(values,Vector("other","selected"))
    }yield()
  }) }
  test("SQL bind plans never interpolate query, pointer or link data and use bounded metadata acquisition") { run(initializedDatabase.use { db=>
    val repo=new PostgresItemRepository(db)
    val injection="x'); DROP TABLE items; --"
    val query="project:"+io.circe.Json.fromString(injection).noSpaces
    val plan=PostgresSearch.compile(SearchInput(query))
    assert(!plan.sql.contains(injection));assert(plan.params.contains(injection))
    for{
      _<-repo.commit(op("a%3Ab:i%25d",document=doc().replace("\"fact\"","\"fact:with space\"")),Alice,Now)
      _<-repo.commit(op("a:b",document=doc()),Alice,Now)
      actual<-db.transaction(c=>Sql.rows(c,"SELECT haystack_encode_component(?)",Seq("a:b%😀"))(_.getString(1)).head)
      _=assertEquals(actual,QualifiedId.encodeComponent("a:b%😀"))
      completion<-repo.complete("type:")
      _=assert(completion.contains("type:\"fact:with space\""))
      _=completion.filter(value=>value.startsWith("type:") && value!="type:").foreach(value=>assert(Search.analyze(value).isEmpty))
      ids<-repo.complete("a:");_=assert(ids.forall(s=>Search.analyze(s).isEmpty));_=assert(ids.size<=20)
      missing<-repo.search(SearchInput(query));_=assertEquals(missing.items,Vector.empty)
    }yield()
  }) }
  test("streamed startup projection rebuild preserves acknowledged bytes/history and fresh current generation") { run(emptyDatabase.use { db=>for{
    _<-Migrations.initialize(db,Activity)
    policy=ProjectionPolicy("bounded-backfill-test",true,Vector("/public"),4096)
    retrieval=new HaystackRetrieval(db,policy,new PostgresRetrieval("haystack",None),None,4)
    legacy=new PostgresItemRepository(db)
    _<-legacy.commit(op("p:one",document=doc("old","{\"public\":\"old content\"}")),Alice,Now)
    _<-legacy.commit(op("p:one",1,doc("new","{\"public\":\"current content\"}")),Bot,Later)
    before<-legacy.current(ItemKey("p","one"))
    _<-db.transaction(c=>Sql.update(c,"DELETE FROM item_search"))
    repo=new PostgresItemRepository(db,Some(retrieval))
    _<-repo.initializeProjection()
    after<-repo.current(ItemKey("p","one"));_=assertEquals(after.map(_.documentCanonical),before.map(_.documentCanonical));_=assertEquals(after.map(_.metadata),before.map(_.metadata));_=assertEquals(after.map(_.revision),before.map(_.revision));_=assertEquals(after.map(_.key),before.map(_.key))
    history<-repo.history(ItemKey("p","one"));_=assertEquals(history.size,2)
    page<-repo.search(SearchInput("current"));_=assertEquals(page.items.map(_.revision),Vector(2L))
    source<-retrieval.search("current",ponygirls.retrieval.RetrievalMode.Lexical,Some("p"),false,0,20)
    _=assertEquals(source.hits.map(_.version),List(s"2/${policy.id}"))
  }yield()}) }
}
