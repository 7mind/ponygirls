package chronicle
import chronicle.api.*
import java.nio.file.Files
import java.util.UUID

class StaticTokenTest extends munit.FunSuite {
  def token(owner: String,secret: String): StaticTokenConfig = {
    val file=Files.createTempFile("chronicle-static-",".secret")
    Files.setPosixFilePermissions(file,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"))
    Files.writeString(file,secret)
    StaticTokenConfig(UUID.randomUUID(),owner,"configured",List(Scope.Ingest),file.toString)
  }
  test("BA specified: static config rejects unknown owners, empty/duplicate scopes and duplicate IDs") {
    val c=Fixtures.config(); val t=token("a",Wire.secret())
    List(List(t.copy(userId="unknown")),List(t.copy(scopes=Nil)),List(t.copy(scopes=List(Scope.Read,Scope.Read))),List(t,t)).foreach { entries =>
      assertEquals(intercept[DomainError](c.copy(staticTokens=entries).validate()).code,"config")
    }
    c.copy(staticTokens=List(t)).validate()
  }
  test("BA specified: omitted external static token list stays compatible, explicit null is rejected") {
    val source=Wire.parse(Files.readString(java.nio.file.Path.of("config.example.json")))
    val old=source.mapObject(_.remove("staticTokens")).as[Config](using Config.given_Decoder_Config).toOption.get
    assertEquals(old.staticTokens,Nil)
    assert(source.mapObject(_.add("staticTokens",io.circe.Json.Null)).as[Config](using Config.given_Decoder_Config).isLeft)
  }
  test("BG GoodCommunication: reconciliation rotates without changing creation, forbids revoke, removes mappings and protects issued collisions") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped") }
    val c=Fixtures.config(); val db=new Database(c,IndexProfileCatalog.current(c)); db.initialize()
    db.transaction(x => { Sql.exec(x,"TRUNCATE ch_tokens,ch_mutations,ch_sessions CASCADE"); () })
    val old=Wire.secret(); val t=token("a",old); val managed=c.copy(staticTokens=List(t)); managed.validate()
    new Database(managed,IndexProfileCatalog.current(managed)).initialize(); val auth=new Auth(db,managed)
    assertEquals(auth.bearer(old).user.scopes,List(Scope.Ingest))
    val (_,cookie)=auth.login(LoginRequest("a","synthetic")); val owner=auth.browser(cookie)
    val duplicate=managed.copy(staticTokens=List(t,t.copy(id=UUID.randomUUID())))
    assertEquals(intercept[DomainError](new Database(duplicate,IndexProfileCatalog.current(duplicate)).initialize()).code,"config")
    val publicToken=token("a",Wire.secret())
    Files.setPosixFilePermissions(java.nio.file.Path.of(publicToken.tokenFile),java.nio.file.attribute.PosixFilePermissions.fromString("rw-r--r--"))
    assertEquals(intercept[DomainError](new Database(c.copy(staticTokens=List(publicToken)),IndexProfileCatalog.current(c.copy(staticTokens=List(publicToken)))).initialize()).code,"config")
    val weak=token("a","weak")
    assertEquals(intercept[DomainError](new Database(c.copy(staticTokens=List(weak)),IndexProfileCatalog.current(c.copy(staticTokens=List(weak)))).initialize()).code,"config")
    assert(!Wire.encode(TokensResult.codecJson,auth.tokens(owner)).noSpaces.contains(old))
    val before=auth.tokens(owner).tokens.find(_.info.id==t.id).get
    assertEquals(before.source,TokenSource.StaticConfig)
    assertEquals(intercept[DomainError](auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.RevokeToken(t.id)))).code,"forbidden")
    val next=Wire.secret(); Files.writeString(java.nio.file.Path.of(t.tokenFile),next)
    new Database(managed,IndexProfileCatalog.current(managed)).initialize()
    assertEquals(intercept[DomainError](auth.bearer(old)).code,"unauthorized")
    assertEquals(auth.bearer(next).user.id,"a")
    assertEquals(auth.tokens(owner).tokens.find(_.info.id==t.id).get.info.createdAt,before.info.createdAt)
    val disabled=managed.copy(users=managed.users.map(u => if(u.id=="a") u.copy(enabled=false) else u))
    new Database(disabled,IndexProfileCatalog.current(disabled)).initialize()
    assertEquals(intercept[DomainError](auth.bearer(next)).code,"unauthorized")
    new Database(managed,IndexProfileCatalog.current(managed)).initialize()
    val wrongOwner=managed.copy(staticTokens=List(t.copy(userId="b")))
    assertEquals(intercept[DomainError](new Database(wrongOwner,IndexProfileCatalog.current(wrongOwner)).initialize()).code,"config")
    new Database(c,IndexProfileCatalog.current(c)).initialize(); assertEquals(intercept[DomainError](auth.bearer(next)).code,"unauthorized")
    assertEquals(intercept[DomainError](auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.MintToken("stale",List(Scope.Read))))).code,"unauthorized")
    val freshOwner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    val issued=auth.mutate(freshOwner,ClientEnvelope(UUID.randomUUID(),Operation.MintToken("issued",List(Scope.Read)))).asInstanceOf[Result.Token].result
    val collision=c.copy(staticTokens=List(t.copy(id=issued.token.id)))
    assertEquals(intercept[DomainError](new Database(collision,IndexProfileCatalog.current(collision)).initialize()).code,"config")
    assertEquals(auth.bearer(issued.secret.get).user.id,"a")
    val valueCollision=token("a",issued.secret.get)
    assertEquals(intercept[DomainError](new Database(c.copy(staticTokens=List(valueCollision)),IndexProfileCatalog.current(c.copy(staticTokens=List(valueCollision)))).initialize()).code,"config")
    assertEquals(auth.bearer(issued.secret.get).user.id,"a")
  }
  test("R-f S10: configured OperateJobs passes one scope parser, and configuration alone grants and clears it") {
    def configured(scopes: String): Option[StaticTokenConfig] =
      Wire.parse(s"""{"id":"${UUID.randomUUID()}","userId":"a","name":"operator","scopes":$scopes,"tokenFile":"/run/token"}""").as[StaticTokenConfig](using Config.given_Decoder_StaticTokenConfig).toOption
    List("""["OperateJobs"]""","""["Read","OperateJobs","OperateJobs"]""","""["Read","Read","OperateJobs"]""").foreach(scopes => assertEquals(configured(scopes),None,scopes))
    val granted=configured("""["OperateJobs","Read"]""").get
    assertEquals(granted.scopes,List(Scope.Read))
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped") }
    val c=Fixtures.config(); val db=new Database(c,IndexProfileCatalog.current(c)); db.initialize()
    db.transaction(x => { Sql.exec(x,"TRUNCATE ch_tokens,ch_mutations,ch_sessions CASCADE"); () })
    val secret=Wire.secret(); val file=token("a",secret).tokenFile
    def start(t: StaticTokenConfig): (Boolean,String) = {
      val managed=c.copy(staticTokens=List(t)); val started=new Database(managed,IndexProfileCatalog.current(managed))
      try started.initialize() finally started.close()
      db.transaction(x => Sql.one(x,"SELECT operate_jobs,info->>'createdAt' FROM ch_tokens WHERE id=?",t.id)(r => (r.getBoolean(1),r.getString(2))).get)
    }
    val (operating,created)=start(granted.copy(tokenFile=file))
    assert(operating); new Auth(db,c).bearer(secret).requireJobOperator()
    assertEquals(start(configured("""["Read"]""").get.copy(id=granted.id,tokenFile=file)),(false,created))
    assertEquals(intercept[DomainError](new Auth(db,c).bearer(secret).requireJobOperator()),DomainError("forbidden","browser session required"))
    db.close()
  }
}
