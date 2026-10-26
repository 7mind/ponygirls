package chronicle
import chronicle.api.*
import java.nio.file.{Files,Path}
import java.nio.file.attribute.PosixFilePermissions
import java.util.UUID
import java.time.Instant

class TokenVisibilityTest extends munit.FunSuite {
  def configured(id: UUID): StaticTokenConfig = {
    val file=Files.createTempFile("chronicle-token-visibility-",".secret")
    Files.setPosixFilePermissions(file,PosixFilePermissions.fromString("rw-------"))
    Files.writeString(file,Wire.secret())
    StaticTokenConfig(id,"a","managed",List(Scope.Ingest),file.toString)
  }
  def database(f: (Config,Database,Auth,Identity) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped") }
    val c=Fixtures.config(); val db=new Database(c); db.initialize()
    db.transaction(x => { Sql.exec(x,"TRUNCATE ch_tokens,ch_mutations,ch_sessions CASCADE"); () })
    val auth=new Auth(db,c); val (_,cookie)=auth.login(LoginRequest("a","synthetic"))
    f(c,db,auth,auth.browser(cookie))
  }
  def issued(db: Database,n: Int,revoked: Boolean): Unit = db.transaction { c =>
    val info=TokenInfo(new UUID(0,n.toLong),s"issued-$n",List(Scope.Read),Instant.now().toString,revoked)
    Sql.exec(c,"INSERT INTO ch_tokens(id,owner,hash,info,revoked) VALUES(?,?,?,?::jsonb,?)",info.id,"a",Wire.hash(s"synthetic-issued-$n"),Wire.encode(TokenInfo.codecJson,info).noSpaces,revoked)
    ()
  }
  test("regression: revoked history must not hide active issued or configured token metadata") { database { (c,db,auth,owner) =>
    (1 to 100).foreach(n => issued(db,n,true))
    val static=configured(UUID.fromString("7fffffff-ffff-4fff-bfff-ffffffffffff"))
    new Database(c.copy(staticTokens=List(static))).initialize()
    val active=TokenInfo(UUID.fromString("7fffffff-ffff-4fff-bfff-fffffffffffe"),"active",List(Scope.Read),Instant.now().toString,false)
    db.transaction(x => Sql.exec(x,"INSERT INTO ch_tokens(id,owner,hash,info) VALUES(?,?,?,?::jsonb)",active.id,"a",Wire.hash("synthetic-active"),Wire.encode(TokenInfo.codecJson,active).noSpaces))
    val listed=auth.tokens(owner).tokens
    assert(listed.exists(t => t.info.id==static.id && t.source==TokenSource.StaticConfig),"actual Auth.tokens omitted configured token behind revoked history")
    assert(listed.exists(t => t.info.id==active.id && !t.info.revoked),"actual Auth.tokens omitted active issued token behind revoked history")
    assertEquals(listed.size,100)
    assertEquals(listed.count(_.info.revoked),98)
  }}
  test("specified: configuration rejects more than 100 static tokens per owner") {
    val c=Fixtures.config(); val t=configured(UUID.randomUUID())
    val tokens=(1 to 101).map(n => t.copy(id=new UUID(0,n.toLong))).toList
    assertEquals(intercept[DomainError](c.copy(staticTokens=tokens).validate()).code,"config")
    c.copy(staticTokens=tokens.take(100)).validate()
  }
  test("specified: reconciliation rejects configured plus active issued token overflow transactionally") { database { (c,db,auth,owner) =>
    (1 to 99).foreach(n => issued(db,n,false))
    val first=configured(UUID.randomUUID()); val second=configured(UUID.randomUUID())
    assertEquals(intercept[DomainError](new Database(c.copy(staticTokens=List(first,second))).initialize()).code,"config")
    assertEquals(auth.tokens(owner).tokens.size,99)
    new Database(c.copy(staticTokens=List(first))).initialize()
    assertEquals(auth.tokens(owner).tokens.count(t => !t.info.revoked),100)
    assertEquals(intercept[DomainError](auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.MintToken("overflow",List(Scope.Read))))).code,"invalid")
  }}
}
