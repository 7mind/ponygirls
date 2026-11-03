package haystack.storage

import cats.effect.IO
import cats.syntax.all.*
import haystack.domain.*
import haystack.query.*
import TestSupport.*

abstract class SearchRepositoryContractTest(adapter:RepositoryAdapter) extends ContractSuite {
  private val fixtures=Vector(
    "p:a"->"""{"title":"Alpha 🐎","description":"first exact phrase","fields":{"x":null,"n":9007199254740993,"str":"red blue","ary":[1,2],"obj":{"01":"zero","-1":7},"a/b":{"~x":0.10}},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[["rel","q:z"],["rel","p:a"]],"tags":["one","two","one"]}""",
    "p:b"->"""{"title":"Beta","description":"d","fields":{"n":-0,"x":false,"str":"red","ary":[],"obj":{"01":"zero"}},"type":"todo","status":"archived","importance":"high","human-attention":"required","links":[],"tags":["red"]}""",
    "p:c"->"""{"title":"","description":"blue","fields":{"n":-1e-16383,"str":"red"},"type":"fact","status":"actual","importance":"medium","human-attention":"cleared","links":[],"tags":["red","blue"]}""",
    "q:z"->"""{"title":"😀","description":"ＥＸＡＣＴ café","fields":{"n":1e131071,"str":"blue red","__proto__":{"constructor":true}},"type":"note","status":"actual","importance":"high","human-attention":"required","links":[["rel","p:c"]],"tags":[]}"""
  )
  private def seeded[A](body:(ItemRepository,Vector[StoredItem])=>IO[A]):A=run(adapter.resource.use { repo=>
    fixtures.zipWithIndex.traverse_ { case((key,doc),i)=>repo.commit(op(key,document=doc),if(i%2==0)Alice else Bot,Now.plusSeconds(i.toLong)).void } *>
    repo.commit(op("p:a",1,fixtures.head._2),Bot,Later).void *> repo.allCurrent().flatMap(items=>body(repo,items))
  })
  private val queries=Vector("","archived:all","status:archived","NOT archived:true","archived:false OR status:archived",
    "project:p type:fact","id:\"q:z\"","created-by:alice","modified-by:bot","human-attention:required","importance:high OR type:fact",
    "alpha OR beta AND red","NOT (alpha OR beta)","exact","\"exact phrase\"","\"red blue\"","\"blue red\"","ＣＡＦÉ",
    "tag:one","NOT tags:one","tag:red tag:blue","exists[\"/x\"]","NOT exists[\"/x\"]","field[\"/x\"] = null","field[\"/missing\"] != null",
    "field[\"/n\"] = 9007199254740993","field[\"/n\"] > 9007199254740992","field[\"/n\"] != 0","field[\"/str\"] != 0",
    "field[\"/str\"] != false","field[\"/x\"] != null","field[\"/ary/0\"] = 1","NOT exists[\"/ary/-1\"]","NOT exists[\"/ary/01\"]",
    "field[\"/obj/01\"] = \"zero\"","field[\"/obj/-1\"] = 7","field[\"/a~1b/~0x\"] = 0.1","exists[\"/__proto__/constructor\"]",
    "link:[\"rel\",\"q:z\"]","linked-to:\"p:c\"","linked-from:\"q:z\"","project:p linked-from:\"q:z\"",
    "archived:all field[\"/n\"] < 1e999999","archived:all field[\"/n\"] > -1e999999","archived:all field[\"/n\"] = -0",
    "archived:all field[\"/n\"] < 1e-999999","archived:all field[\"/n\"] > -1e-999999","field[\"/n\"] >= 1.0e131071",
    "created-at >= \"2026-10-07T18:00:01Z\"","modified-at < \"2026-10-07T19:00:00Z\"",
    "project:\"x' OR 1=1 --\"","link:[\"x' OR 1=1 --\",\"p:a\"]")
  queries.foreach { query=>test(s"${adapter.label}: complete grammar agrees with pure reference: $query") {
    seeded((repo,items)=>repo.search(SearchInput(query,limit=100)).map(actual=>assertEquals(actual,Search.search(items,SearchInput(query,limit=100)))))
  }}
  Search.SortFields.foreach { field=>Vector("asc","desc").foreach { direction=>test(s"${adapter.label}: full global $field $direction bounded cursor traversal") {
    seeded { (repo,items)=>
      val sort=SearchSort(field,direction)
      def loop(cursor:Option[String],out:Vector[SearchSummary]):IO[Vector[SearchSummary]]=repo.search(SearchInput("archived:all",limit=1,cursor=cursor,sort=sort)).flatMap { page=>
        if(page.cursor.nonEmpty)loop(page.cursor,out++page.items)else IO.pure(out++page.items)
      }
      loop(None,Vector.empty).map(result=>assertEquals(result,Search.search(items,SearchInput("archived:all",limit=100,sort=sort)).items))
    }
  }}}
  test(s"${adapter.label}: mismatched cursor and invalid grammar fail before search") {
    seeded { (repo,_)=>for{
      first<-repo.search(SearchInput("archived:all",limit=1))
      bad<-repo.search(SearchInput("archived:all",limit=2,cursor=first.cursor)).attempt
      _=assert(bad.left.exists(_.isInstanceOf[InvalidCursor]))
      query<-repo.search(SearchInput("unknown:x")).attempt
      _=assert(query.left.exists(_.isInstanceOf[InvalidQuery]))
    }yield()}
  }
}
final class MemorySearchRepositoryTest extends SearchRepositoryContractTest(MemoryAdapter)
final class PostgresSearchRepositoryTest extends SearchRepositoryContractTest(PostgresAdapter)
