package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import distage.*
import io.circe.Json
import java.nio.file.{Files, Path}
import munit.FunSuite
import ponygirls.runtime.{JdbcFailure, RuntimeFailure}
import scala.concurrent.duration.*
import scala.util.Using

final class ChronicleJdbcRuntimeTest extends FunSuite {
  private def requirePostgres(): Unit = {
    if (!sys.env.contains("CHRONICLE_TEST_JDBC")) {
      Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required")
      assume(false,"PostgreSQL explicitly skipped; use pinned owned fixture")
    }
  }
  test("all eight database policy fields are mandatory; no defaults or URL property override") {
    val sample = Wire.parse(Files.readString(Path.of("config.example.json")))
    sample.as[Config].fold(e => fail(e.toString),_.validate())
    assert(sample.mapObject(_.remove("databaseLimits")).as[Config].isLeft)
    sample.hcursor.downField("databaseLimits").focus.get.asObject.get.keys.foreach { field =>
      val missing = sample.mapObject(_.add("databaseLimits",sample.hcursor.downField("databaseLimits").focus.get.mapObject(_.remove(field))))
      assert(missing.as[Config].isLeft,s"required $field")
    }
    val c = Fixtures.config()
    intercept[DomainError](c.copy(databaseLimits=c.databaseLimits.copy(statementTimeout=Duration.Zero)).validate())
    intercept[DomainError](c.copy(jdbcUrl=c.jdbcUrl+"?socketTimeout=0").validate())
  }
  test("historical credential trimming and optional empty auth use bounded trusted file reader") {
    val dir = Files.createTempDirectory("chronicle-credential-")
    val secret = dir.resolve("secret"); val ref = dir.resolve("reference")
    try {
      Files.writeString(secret,""); Files.createSymbolicLink(ref,secret)
      assertEquals(Config.credential(ref.toString),"")
      Files.writeString(secret,"secret \n"); assertEquals(Config.credential(ref.toString),"secret")
      Files.writeString(secret,"x"*20000); intercept[RuntimeFailure](Config.credential(ref.toString))
    } finally { Files.deleteIfExists(ref); Files.deleteIfExists(secret); Files.delete(dir) }
  }
  test("Chronicle synchronous transaction uses real shared deadlines and sanitized SQLState") {
    requirePostgres()
    val c = Fixtures.config(); val timed = c.copy(databaseLimits=c.databaseLimits.copy(statementTimeout=100.millis))
    Using.resource(new Database(timed,IndexProfileCatalog.current(timed))) { db =>
      val error = intercept[JdbcFailure](db.transaction(c => Sql.exec(c,"SELECT pg_sleep(2)")))
      assertEquals(error.getSQLState,"57014"); assertEquals(error.getMessage,"database-unavailable"); assertEquals(error.getCause,null)
      assertEquals(db.transaction(c => Sql.one(c,"SELECT 1")(_.getInt(1))),Some(1))
    }
  }
  test("actual distage database resource closes admission after use without models or HTTP") {
    requirePostgres()
    val c = Fixtures.config()
    val module = new ModuleDef {
      make[Config].fromValue(c)
      make[IndexProfileCatalog].fromValue(IndexProfileCatalog.current(c))
      make[Database].fromResource[DatabaseResource]
    }
    val database = ChronicleInjector().produceGet[Database](module).use { db =>
      IO.blocking { assertEquals(db.transaction(c => Sql.one(c,"SELECT 1")(_.getInt(1))),Some(1)); db }
    }.unsafeRunSync()
    assertEquals(intercept[RuntimeFailure](database.transaction(_ => ())).code,"runtime-closed")
  }
  test("migrate CLI initializes idempotently without HTTP, model clients or workers") {
    requirePostgres()
    val c = Fixtures.config()
    val sample = Wire.parse(Files.readString(Path.of("config.example.json")))
    val json = sample.mapObject(_.add("jdbcUrl",Json.fromString(c.jdbcUrl)).add("databaseUser",Json.fromString(c.databaseUser))
      .add("databasePasswordFile",Json.fromString(c.databasePasswordFile))
      .add("users",Json.fromValues(c.users.map(u => Json.obj("id"->Json.fromString(u.id),"login"->Json.fromString(u.login),"passwordHashFile"->Json.fromString(u.passwordHashFile),"enabled"->Json.fromBoolean(u.enabled)))))
      .add("annotation",sample.hcursor.downField("annotation").focus.get.mapObject(_.add("endpoint",Json.fromString("http://127.0.0.1:1/forbidden-model"))))
      .add("embedding",sample.hcursor.downField("embedding").focus.get.mapObject(_.add("endpoint",Json.fromString("http://127.0.0.1:1/forbidden-model")).add("dimensions",Json.fromInt(3)))))
    val path = Files.createTempFile("chronicle-migrate-", ".json")
    try {
      Files.writeString(path,json.noSpaces)
      assertEquals(Main.run(List("migrate",path.toString)).unsafeRunSync(),cats.effect.ExitCode.Success)
      assertEquals(Main.run(List("migrate",path.toString)).unsafeRunSync(),cats.effect.ExitCode.Success)
      Using.resource(new Database(c,IndexProfileCatalog.current(c))) { db =>
        assertEquals(db.transaction(c => Sql.one(c,"SELECT count(*) FROM ch_schema_migrations WHERE version=17")(_.getInt(1))),Some(1))
        assertEquals(db.transaction(c => Sql.one(c,"SELECT to_regclass('ponygirls_runtime_migrations') IS NULL")(_.getBoolean(1))),Some(true),"Chronicle domain migrations must not be blindly re-ledgered")
      }
    } finally Files.deleteIfExists(path)
  }
}
