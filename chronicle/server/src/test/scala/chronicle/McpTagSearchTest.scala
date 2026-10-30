package chronicle

import chronicle.api.*
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.util.concurrent.atomic.{AtomicBoolean,AtomicLong}

class McpTagSearchTest extends munit.FunSuite {
  private val maximumBytes=64L*1024
  private val maximumArgumentLength=2048
  private def string(value: String): Json=Json.fromString(value)
  private def arguments(query: String,afterTag: Option[String],limit: Int): Json =
    Json.obj((List("query"->string(query),"limit"->Json.fromInt(limit))++afterTag.map(value => "afterTag"->string(value)))* )
  private def fixture(body: ReadSourceFixture => Unit): Unit =
    ReadSourceFixture.withFixture(_ => IO.raiseError(new AssertionError("tag discovery must not call an embedding provider")))(body)
  private def admitted(f: ReadSourceFixture,bytes: Long): ReadAdmission =
    f.probe.admission(ReadAdmission.limited(bytes).unsafeRunSync(),_ => ())
  private def live(f: ReadSourceFixture,args: Json): Json =
    f.tools.invoke(f.access,"search_tags",args,admitted(f,maximumBytes)).unsafeRunSync()
  private def rpc(f: ReadSourceFixture,args: Json,identity: Identity): Json =
    f.mcp.handle(identity,Json.obj("jsonrpc"->string("2.0"),"id"->Json.fromInt(1),"method"->string("tools/call"),
      "params"->Json.obj("name"->string("search_tags"),"arguments"->args))).unsafeRunSync().get
  private def page(response: Json): List[Facet] = {
    assertEquals(response.hcursor.get[Boolean]("isError").toOption,Some(false))
    val text=response.hcursor.downField("content").downN(0).get[String]("text").toOption.get
    val result=Wire.decode(Result.codecJson,Wire.parse(text)).asInstanceOf[Result.Facets].result
    assertEquals(result.projects,Nil); assertEquals(result.branches,Nil)
    result.tags
  }
  private def publish(f: ReadSourceFixture,tags: List[String]): Unit = {
    val request=Fixtures.snapshot()
    f.publish(request.copy(metadata=request.metadata.copy(tags=tags)),"archive","archive",Nil,Nil)
    ()
  }

  test("Blackbox-GoodCommunication: agents discover a dedicated searchable tag catalog") {
    fixture { f =>
      assert(f.tools.definitions.exists(_.name=="search_tags"),"the MCP catalog must expose search_tags, not only capped list_facets")
      val names=f.tools.definitions.map(_.name)
      assertEquals(names.distinct.size,10)
      assertEquals(names.toSet,Set("read_message_context","search_sessions","get_session","get_chunks","get_messages","related_sessions","list_facets","search_tags","ingest_status","whoami"))
      val tool=f.mcp.tools.asArray.get.find(_.hcursor.get[String]("name").contains("search_tags")).get
      assertEquals(tool.hcursor.downField("annotations").get[Boolean]("readOnlyHint").toOption,Some(true))
      assertEquals(tool.hcursor.downField("inputSchema").get[Boolean]("additionalProperties").toOption,Some(false))
      assertEquals(tool.hcursor.downField("inputSchema").get[List[String]]("required").toOption,Some(List("query")))
      val fields=tool.hcursor.downField("inputSchema").downField("properties").focus.get.asObject.get.keys.toSet
      assertEquals(fields,Set("query","afterTag","limit","project","gitBranch","after","before","tags"))
      assertEquals(tool.hcursor.downField("inputSchema").downField("properties").downField("query").get[Int]("maxLength").toOption,Some(maximumArgumentLength))
      assertEquals(tool.hcursor.downField("inputSchema").downField("properties").downField("afterTag").downField("maxLength").focus,None)
      val description=tool.hcursor.get[String]("description").toOption.get
      assert(description.contains("only nonempty values up to 128 UTF-16 units"))
      assert(description.contains("cannot be passed to that older filter"))
      assertEquals(page(live(f,arguments("",None,100))),Nil)
    }
  }

  test("Blackbox-GoodCommunication: public and admitted MCP traverse beyond the popular facet cap using generated tag-only pages") { fixture { f =>
    val values=(0 until 129).map(index => f"tag-$index%03d").toList
    values.grouped(32).foreach(group => publish(f,group))
    val defaultPageSize=20
    assertEquals(page(live(f,Json.obj("query"->string("")))),values.take(defaultPageSize).map(Facet(_,1)))
    val pageSize=37
    val expectedPages=(values.size+pageSize-1)/pageSize
    var afterTag=Option.empty[String]
    var collected=List.empty[String]
    (0 to expectedPages).foreach { index =>
      val args=arguments("",afterTag,pageSize)
      val actual=live(f,args)
      assertEquals(rpc(f,args,f.identity).hcursor.downField("result").focus,Some(actual))
      val tags=page(actual)
      assertEquals(tags,values.slice(index*pageSize,(index+1)*pageSize).map(Facet(_,1)))
      collected=collected++tags.map(_.value)
      afterTag=tags.lastOption.map(_.value)
    }
    assertEquals(collected,values)
    assertEquals(page(live(f,arguments("",Some("tag-126z"),100))),List(Facet("tag-127",1),Facet("tag-128",1)))
  }}

  test("Blackbox-GoodCommunication: an empty stored tag is a valid keyset position, not the absence of a cursor") { fixture { f =>
    publish(f,List("","a"))
    assertEquals(page(live(f,arguments("",None,1))),List(Facet("",1)))
    assertEquals(page(live(f,arguments("",Some(""),1))),List(Facet("a",1)))
    assertEquals(page(live(f,arguments("",Some("a"),1))),Nil)
  }}

  test("Blackbox-GoodCommunication: historical tag values remain reusable as positions beyond the query length bound") { fixture { f =>
    val longTag="a"*(maximumArgumentLength+1)
    val request=Fixtures.snapshot()
    f.publish(request.copy(metadata=request.metadata.copy(tags=Nil)),"archive","archive",List(longTag,"z"),Nil)
    assertEquals(page(live(f,arguments("",None,1))),List(Facet(longTag,1)))
    assertEquals(page(live(f,arguments("",Some(longTag),1))),List(Facet("z",1)))
    assertEquals(page(live(f,arguments("",Some("z"),1))),Nil)
  }}

  test("Blackbox-GoodCommunication: tag matching is literal Unicode-lower substring while exact tag identity remains distinct") { fixture { f =>
    val values=List("100%","a_b","back\\slash","quote\"tag","two words","Camel","camel","Äpfel","Straße","é","e\u0301","🙂tag")
    publish(f,values)
    val cases=List("%"->List("100%"),"_"->List("a_b"),"\\"->List("back\\slash"),"\""->List("quote\"tag")," "->List("two words"),
      "CAM"->List("Camel","camel"),"äP"->List("Äpfel"),"STRASSE"->Nil,"É"->List("é"),"e\u0301"->List("e\u0301"),"🙂"->List("🙂tag"),"missing"->Nil)
    cases.foreach { (query,expected) => assertEquals(page(live(f,arguments(query,None,100))),expected.map(Facet(_,1)),query) }
  }}

  test("Blackbox-GoodCommunication: strict tag arguments reject malformed fields and Unicode without fetching source payload") { fixture { f =>
    val valid=arguments("",None,20)
    val malformed=List(Json.obj(),Json.Null,Json.arr(),valid.mapObject(_.add("query",Json.Null)),valid.mapObject(_.add("query",Json.fromInt(1))),
      valid.mapObject(_.add("limit",Json.fromInt(0))),valid.mapObject(_.add("limit",Json.fromInt(101))),valid.mapObject(_.add("limit",string("20"))),
      valid.mapObject(_.add("limit",Json.fromDoubleOrNull(1.5))),valid.mapObject(_.add("offset",Json.fromInt(0))),valid.mapObject(_.add("afterTag",Json.Null)),
      valid.mapObject(_.add("tags",Json.arr(Json.Null))),valid.mapObject(_.add("project",Json.fromInt(1))),
      arguments("\u0000",None,20),arguments("\ud800",None,20),arguments("x"*(maximumArgumentLength+1),None,20),
      arguments("",Some("\u0000"),20),arguments("",Some("\udfff"),20))
    malformed.foreach { args =>
      val failure=scala.util.Try(live(f,args)).failed.toOption
      assert(failure.exists { case error: DomainError => error.code=="invalid"; case _ => false },s"expected invalid arguments, received $failure for ${args.noSpaces}")
      val response=rpc(f,args,f.identity)
      assert(response.hcursor.downField("error").focus.nonEmpty || response.hcursor.downField("result").get[Boolean]("isError").contains(true),args.noSpaces)
    }
    assertEquals(f.probe.observations.collect { case event: SourceEvent.Payload => event },Nil)
  }}

  test("Blackbox-GoodCommunication: tag discovery needs Read but neither Raw nor browser authentication") { fixture { f =>
    publish(f,List("only-readable"))
    val bearer=f.identity.copy(browser=false)
    assertEquals(page(rpc(f,arguments("",None,100),bearer).hcursor.downField("result").focus.get),List(Facet("only-readable",1)))
    val denied=bearer.copy(user=bearer.user.copy(scopes=Nil))
    val before=f.probe.observations.size
    val access=new McpRunAccess { def fresh: IO[Identity]=IO.pure(denied) }
    assertEquals(intercept[DomainError](f.tools.invoke(access,"search_tags",arguments("",None,100),admitted(f,maximumBytes)).unsafeRunSync()).code,"forbidden")
    assertEquals(rpc(f,arguments("",None,100),denied).hcursor.downField("result").get[Boolean]("isError").toOption,Some(true))
    assertEquals(f.probe.observations.drop(before),Nil)
  }}

  test("Blackbox-GoodCommunication: tag pages admit selected bytes before payload and enforce the exact cumulative bound") { fixture { f =>
    publish(f,List("escaped\"\\🙂","second"))
    val total=new AtomicLong()
    val recording=f.probe.admission(new ReadAdmission { def consume(bytes: Long): Unit={ total.addAndGet(bytes); () } },_ => ())
    val args=arguments("",None,100)
    val expected=f.tools.invoke(f.access,"search_tags",args,recording).unsafeRunSync()
    assert(total.get()>0 && total.get()<maximumBytes)
    assertEquals(f.tools.invoke(f.access,"search_tags",args,admitted(f,total.get())).unsafeRunSync(),expected)
    val before=f.probe.observations.size
    assertEquals(intercept[DomainError](f.tools.invoke(f.access,"search_tags",args,admitted(f,total.get()-1)).unsafeRunSync()).code,"read-budget")
    assertEquals(f.probe.observations.drop(before).collect { case event: SourceEvent.Payload => event },Nil)
  }}

  test("Blackbox-GoodCommunication: logout during tag admission prevents disclosure of the already selected page") { fixture { f =>
    publish(f,List("private-tag"))
    val auth=new Auth(f.db,f.config)
    val identity=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    val authorization=new PostgresRunAuthorization(f.db,auth)
    val stamp=authorization.capture(identity).unsafeRunSync()
    val access=new McpRunAccess { def fresh: IO[Identity]=authorization.verify(stamp) }
    val fired=new AtomicBoolean()
    val admission=f.probe.admission(ReadAdmission.limited(maximumBytes).unsafeRunSync(),bytes => if(bytes>0 && fired.compareAndSet(false,true)) auth.logout(identity))
    val result=f.tools.invoke(access,"search_tags",arguments("",None,100),admission).attempt.unsafeRunSync()
    assert(fired.get())
    assert(result.swap.toOption.exists { case error: DomainError => Set("unauthorized","authorization-changed")(error.code); case _ => false })
  }}
}
