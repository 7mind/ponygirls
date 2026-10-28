package chronicle

import chronicle.api.*
import cats.effect.{IO,Resource}
import cats.effect.unsafe.implicits.global
import io.circe.Json
import org.http4s.client.Client
import java.util.UUID
import scala.collection.mutable.ListBuffer

class McpSearchGuidanceTest extends munit.FunSuite {
  private val vector=ProblemPublicationFixtures.vector
  private def string(value: String): Json=Json.fromString(value)
  private def rpc(f: ReadSourceFixture,method: String,params: Json): Json =
    f.mcp.handle(f.identity,Json.obj("jsonrpc"->string("2.0"),"id"->Json.fromInt(1),"method"->string(method),"params"->params)).unsafeRunSync().get.hcursor.downField("result").focus.get
  private def invoke(f: ReadSourceFixture,name: String,args: Json): Result = {
    val response=f.tools.invoke(f.access,name,args,ReadAdmission.limited(64L*1024).unsafeRunSync()).unsafeRunSync()
    assertEquals(response.hcursor.get[Boolean]("isError").toOption,Some(false))
    Wire.decode(Result.codecJson,Wire.parse(response.hcursor.downField("content").downN(0).get[String]("text").toOption.get))
  }
  private def search(f: ReadSourceFixture,query: String,mode: String,filters: Json): SearchResult =
    invoke(f,"search_sessions",filters.deepMerge(Json.obj("query"->string(query),"mode"->string(mode)))).asInstanceOf[Result.Search].result
  private def facets(f: ReadSourceFixture,filters: Json): FacetsResult =
    invoke(f,"list_facets",filters).asInstanceOf[Result.Facets].result
  private def tags(values: String*): Json=Json.obj("tags"->Json.arr(values.map(string)*))
  private def includes(text: String,clauses: String*): Unit=clauses.foreach(clause => assert(text.contains(clause),s"Missing guidance: $clause\n$text"))

  // Specified: public discovery and the model request must teach the same supported search contract.
  test("Blackbox-GoodCommunication: MCP discovery and model catalog expose search syntax, structured filters and bounded tag popularity") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val listed=rpc(f,"tools/list",Json.obj()).hcursor.get[List[Json]]("tools").toOption.get
    val definitions=f.tools.definitions
    assertEquals(definitions.size,8)
    val noProvider=Client[IO](_ => Resource.eval(IO.raiseError(new AssertionError("catalog discovery must not call a provider"))))
    val model=new OpenAIMcpTestModel(ModelFixtures.http(noProvider,f.config),McpTestFixtures.config)
    val request=model.request(Vector.empty,definitions)
    val functions=request.hcursor.get[List[Json]]("tools").toOption.get.map(_.hcursor.downField("function").focus.get)
    definitions.foreach { definition =>
      val publicTool=listed.find(_.hcursor.get[String]("name").contains(definition.name)).get
      val function=functions.find(_.hcursor.get[String]("name").contains(definition.name)).get
      assertEquals(publicTool.hcursor.get[String]("description").toOption,Some(definition.description))
      assertEquals(function.hcursor.get[String]("description").toOption,Some(definition.description))
      assertEquals(publicTool.hcursor.downField("inputSchema").focus,Some(definition.inputSchemaJson))
      assertEquals(function.hcursor.downField("parameters").focus,Some(definition.inputSchemaJson))
    }
    def tool(name: String): Json=listed.find(_.hcursor.get[String]("name").contains(name)).get
    def description(name: String): String=tool(name).hcursor.get[String]("description").toOption.get
    def field(name: String,key: String): String=tool(name).hcursor.downField("inputSchema").downField("properties").downField(key).get[String]("description").toOption.getOrElse("")
    includes(field("search_sessions","query"),"websearch_to_tsquery('english'", "implicit AND", "quoted phrases", "uppercase OR", "leading minus", "parentheses", "NOT", "field:colon", "natural language", "lexical leg only", "not a hard semantic filter")
    includes(field("search_sessions","mode"),"lexical", "semantic", "hybrid")
    includes(field("search_sessions","query"),"yolo-profile:", "not supported here", "get_session", "recorded root claim", "not host or launch attestation")
    includes(description("get_session"),"source.discoveryRootId", "recorded named yolo profile", "native", "unrecognized")
    assert(!tool("search_sessions").hcursor.downField("inputSchema").downField("properties").focus.get.asObject.get.contains("yolo-profile"))
    List("search_sessions","list_facets").foreach { name =>
      includes(field(name,"project"),"Exact", "project")
      includes(field(name,"gitBranch"),"Exact", "branch")
      includes(field(name,"after"),"startedAt", "inclusive", "ISO-8601")
      includes(field(name,"before"),"startedAt", "inclusive", "ISO-8601")
      includes(field(name,"tags"),"AND", "exact", "source", "current published generation", "OR")
    }
    includes(description("search_sessions"),"list_facets", "project", "gitBranch", "tags", "after", "before", "structured")
    includes(description("list_facets"),"distinct", "live-authorized", "current-published", "100", "count descending", "value ascending", "source", "generation", "deduplicated per session", "not a complete tag catalog", "not usage", "request", "occurrence")
    includes(rpc(f,"initialize",Json.obj("protocolVersion"->string("2025-11-25"))).hcursor.get[String]("instructions").toOption.get,
      "list_facets", "structured", "query", "untrusted", "CandidateWindow")
  }}

  test("Blackbox-GoodCommunication: lexical ordinary terms, phrase, OR and minus match PostgreSQL websearch behavior") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    def publish(text: String): UUID=f.publish(Fixtures.snapshot(),text,"archive",Nil,Nil).sessionId
    val phrase=publish("copper bridge"); val separated=publish("copper narrow bridge"); val tunnel=publish("copper tunnel"); val bridge=publish("bridge")
    List(
      "copper bridge" -> Set(phrase,separated),
      "\"copper bridge\"" -> Set(phrase),
      "copper OR bridge" -> Set(phrase,separated,tunnel,bridge),
      "copper -bridge" -> Set(tunnel)
    ).foreach { (query,expected) =>
      val result=search(f,query,"lexical",Json.obj())
      assertEquals(result.hits.map(_.session.id).toSet,expected,query)
      assertEquals(result.total,expected.size)
    }
  }}

  test("Blackbox-GoodCommunication: semantic and hybrid embed the literal query; hybrid exclusion is not a hard filter") {
    val embedded=ListBuffer.empty[String]
    ReadSourceFixture.withFixture(query => IO { embedded += query; vector }) { f =>
      val included=f.publish(Fixtures.snapshot(),"copper bridge","archive",Nil,Nil).sessionId
      val excludedLexically=f.publish(Fixtures.snapshot(),"copper tunnel","archive",Nil,Nil).sessionId
      val query="copper -tunnel"
      assertEquals(search(f,query,"lexical",Json.obj()).hits.map(_.session.id).toSet,Set(included))
      assertEquals(embedded.toList,Nil)
      List("semantic","hybrid").foreach { mode =>
        assertEquals(search(f,query,mode,Json.obj()).hits.map(_.session.id).toSet,Set(included,excludedLexically))
      }
      assertEquals(embedded.toList,List(query,query))
    }
  }

  test("Blackbox-GoodCommunication: tags are exact AND filters across source OR current-generation tags; facets count sessions, not occurrences") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val original=Fixtures.snapshot(); val request=original.copy(metadata=original.metadata.copy(tags=List("shared","source")))
    val first=f.publish(request,"archive","archive",List("shared","generated","retired"),Nil)
    f.publish(request.copy(requestId=UUID.randomUUID(),expectedRevision=1),"archive","archive",List("shared","generated"),Nil)
    val second=f.publish(Fixtures.snapshot().copy(metadata=original.metadata.copy(tags=List("shared"))),"archive","archive",List("generated"),Nil)
    f.publish(Fixtures.snapshot().copy(metadata=original.metadata.copy(tags=List("shared"))),"archive","archive",Nil,Nil)
    f.archive.ingest("a",Fixtures.snapshot().copy(metadata=original.metadata.copy(tags=List("unpublished"))))
    val privateRequest=Fixtures.snapshot().copy(metadata=original.metadata.copy(tags=List("private")))
    val privateReceipt=f.archive.ingest("b",privateRequest)
    val claim=f.archive.claim(f.catalog.knownProfiles,ClaimScope.Owner("b"),300).get
    assert(f.archive.publish(claim,List(IndexedChunk(Fragments.split(privateRequest.messages).head.copy(sessionId=privateReceipt.sessionId),vector))))
    assertEquals(search(f,"archive","lexical",tags("source","generated")).hits.map(_.session.id),List(first.sessionId))
    assertEquals(search(f,"archive","lexical",tags("shared","generated")).hits.map(_.session.id).toSet,Set(first.sessionId,second.sessionId))
    assertEquals(search(f,"archive","lexical",tags("Generated")).total,0)
    assertEquals(facets(f,Json.obj()).tags,List(Facet("shared",3),Facet("generated",2),Facet("source",1)))
    assertEquals(facets(f,tags("source","generated")).tags,List(Facet("generated",1),Facet("shared",1),Facet("source",1)))
    val group=UUID.randomUUID()
    f.db.transaction { c =>
      Sql.exec(c,"INSERT INTO ch_groups VALUES(?,'a','synthetic')",group)
      Sql.exec(c,"INSERT INTO ch_members VALUES(?,'a'),(?,'b')",group,group)
    }
    assert(facets(f,Json.obj()).tags.contains(Facet("private",1)))
    f.db.transaction(c => Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id='b'",group))
    assert(!facets(f,Json.obj()).tags.exists(_.value=="private"))
  }}

  test("Blackbox-GoodCommunication: facets expose top 100 values, not an exhaustive searchable tag catalog") { ReadSourceFixture.withFixture(_ => IO.pure(vector)) { f =>
    val original=Fixtures.snapshot()
    val values=(0 until 128).map(i => f"tag-$i%03d").toList
    values.grouped(32).foreach { group =>
      f.publish(Fixtures.snapshot().copy(metadata=original.metadata.copy(tags=group)),"archive","archive",Nil,Nil)
    }
    assertEquals(facets(f,Json.obj()).tags,values.take(100).map(Facet(_,1)))
    assertEquals(search(f,"archive","lexical",tags(values.last)).total,1)
  }}
}
