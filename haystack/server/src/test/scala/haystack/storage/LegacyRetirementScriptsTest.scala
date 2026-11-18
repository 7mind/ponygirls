package haystack.storage

import cats.effect.IO
import haystack.domain.*
import ponygirls.runtime.{CredentialFile, JdbcDatabase}
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files, Path}
import java.sql.DriverManager
import java.util.Properties
import scala.jdk.CollectionConverters.*
import TestSupport.*

/** One-off: exercises scripts/one-off/legacy-retirement against a database holding the Node-era shapes, seeded the
  * way MigrationsTest and HistoricalStoredReadTest seed them. Deleted together with the legacy code once production
  * is migrated (see that directory's README).
  */
class LegacyRetirementScriptsTest extends ContractSuite {
  private final case class Ran(exit: Int, out: String, err: String) {
    def value(key: String): String = out.linesIterator.collectFirst { case line if line.startsWith(key + "|") => line.drop(key.length + 1) }.getOrElse(fail(s"no $key in script output:\n$out\n$err"))
    def count(key: String): Long = value(key).toLong
    def steps(key: String): Long = out.linesIterator.collect { case line if line.startsWith(s"LR.step.$key|") => line.drop(key.length + 9).toLong }.sum
  }
  private def database(db: JdbcDatabase): IO[String] = db.transaction(c => Sql.rows(c, "SELECT current_database()")(_.getString(1)).head)
  private def script(database: String, arguments: String*): IO[Ran] = IO.blocking {
    val config = databaseConfig
    val address = config.jdbcUrl.stripPrefix("jdbc:postgresql://").takeWhile(_ != '/')
    // The forked test JVM's working directory is the repository root or the project directory, depending on the build settings.
    val relative = Path.of("scripts", "one-off", "legacy-retirement", "run.sh")
    val located = Iterator.iterate(Path.of("").toAbsolutePath)(_.getParent).takeWhile(_ != null).map(_.resolve(relative)).find(Files.isRegularFile(_)).getOrElse(fail("legacy retirement driver is absent"))
    val builder = new ProcessBuilder((List("sh", located.toString, "haystack") ++ arguments).asJava)
    val env = builder.environment()
    List("PGSERVICE", "PGOPTIONS", "PGSSLMODE").foreach(env.remove)
    env.put("PGHOST", address.takeWhile(_ != ':')); env.put("PGPORT", address.dropWhile(_ != ':').drop(1)); env.put("PGUSER", config.user)
    env.put("PGPASSWORD", CredentialFile.read(config.passwordFile)); env.put("PGDATABASE", database)
    env.put("PSQL", Path.of(sys.env.getOrElse("POSTGRES_HOME", throw new IllegalStateException("POSTGRES_HOME required (nix develop .#chronicle)")), "bin", "psql").toString)
    val out = Files.createTempFile("legacy-retirement-", ".out"); val err = Files.createTempFile("legacy-retirement-", ".err")
    builder.redirectOutput(out.toFile).redirectError(err.toFile)
    val exit = builder.start().waitFor()
    try Ran(exit, Files.readString(out, UTF_8), Files.readString(err, UTF_8)) finally { Files.delete(out); Files.delete(err) }
  }
  private def everything(db: JdbcDatabase): IO[Vector[String]] = db.transaction { c =>
    Vector("items", "item_revisions", "item_links", "item_search", "item_tag_values", "write_requests", "store_metadata", "schema_migrations", "haystack_contract_cutovers").flatMap { table =>
      Sql.rows(c, s"SELECT '$table '||md5(row_to_json(t)::text) FROM $table t ORDER BY 1")(_.getString(1))
    }
  }
  private def held[A](database: String)(body: IO[A]): IO[A] = IO.blocking {
    val config = databaseConfig; val properties = new Properties
    properties.setProperty("user", config.user); properties.setProperty("password", CredentialFile.read(config.passwordFile))
    DriverManager.getConnection(config.jdbcUrl.take(config.jdbcUrl.lastIndexOf('/') + 1) + database, properties)
  }.bracket(_ => body)(connection => IO.blocking(connection.close()))

  // Opt-in (scripts/one-off/legacy-retirement/test.sh sets the variable): the Nix-filtered sources of the permanent
  // full-suite checks do not contain scripts/one-off, and this one-off is not meant to join them.
  if (sys.env.get("LEGACY_RETIREMENT_SCRIPTS").contains("1")) test("legacy retirement: Node-era replay rows are counted, refused on failed preconditions, deleted once, and the current service keeps every acknowledged document") {
    val oldId = requestId(); val oldFailureId = requestId()
    val original = doc("original", "{\"n\":9007199254740993,\"decimal\":0.10}")
    val latest = doc("latest", "{\"unicode\":\"café 🐎\",\"decimal\":1.00e2}").replace("\"links\":[]", "\"links\":[[\"origin\",\"else:missing\"]]")
    val wide = HistoricalFixtures.values.find(_.name == "unicode-bmp-over-new-byte-envelope").get.text
    run(emptyDatabase.use { db => for {
      _ <- Migrations.initialize(db, Activity)
      name <- database(db)
      // Node-era rows exactly as MigrationsTest's cut-over case seeds them; TestSupport.Now precedes the cut-over marker.
      _ <- db.transaction { c =>
        Sql.update(c, "INSERT INTO items(project_id,item_id,revision,document,document_text,created_at,created_by,modified_at,modified_by) VALUES('p','legacy',2,?::jsonb,?,?,?,?,'bot')", latest, latest, Now, "alice", Later)
        Sql.update(c, "INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id) VALUES('p','legacy',1,?::jsonb,?,?,'alice','old-human-token')", original, original, Now)
        Sql.update(c, "INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id) VALUES('p','legacy',2,?::jsonb,?,?,'bot','old-agent-token')", latest, latest, Later)
        Sql.update(c, "INSERT INTO item_links VALUES('p','legacy',0,'origin','else','missing')")
        Sql.update(c, "INSERT INTO write_requests(principal_user,token_id,request_id,digest_format,digest,outcome,created_at) VALUES(?,?,?::uuid,'haystack-op-v1',?,?::jsonb,?)", Alice.userId, Alice.tokenId, oldId, "f" * 64, "{\"kind\":\"committed\",\"revision\":1,\"legacy\":\"retained\"}", Now)
        // No explicit format: the 0001 column default still stamps the Node format.
        Sql.update(c, "INSERT INTO write_requests(principal_user,token_id,request_id,digest,outcome,created_at) VALUES(?,?,?::uuid,?,?::jsonb,?)", Alice.userId, Alice.tokenId, oldFailureId, "e" * 64, "{\"kind\":\"invalid-document\",\"detail\":\"legacy terminal\"}", Now)
      }
      repo = new PostgresItemRepository(db)
      current <- repo.commit(op(key = "p:current", document = doc("scala")), Bot, Later)
      _ = assertEquals(current.revision, 1L)
      _ <- expectFault(repo.commit(op(key = "p:legacy", revision = 2L, id = oldId), Alice, Later), "replay-conflict")

      preflight <- script(name, "preflight")
      _ = assertEquals(preflight.exit, 0, preflight.err)
      _ = assertEquals(preflight.count("LR.replay.node_format"), 2L); _ = assertEquals(preflight.count("LR.info.replay.current_format"), 1L)
      _ = assertEquals(preflight.count("LR.stored.revisions_over_1mib"), 0L)
      token = preflight.value("LR.plan")
      unverified <- script(name, "verify"); _ = assertEquals(unverified.exit, 3); _ = assertEquals(unverified.value("LR.result"), "verify-nonzero")

      before <- everything(db)
      dry <- script(name, "dry-run", "--allow-active-connections", "--batch-size", "1")
      _ = assertEquals(dry.exit, 0, dry.err); _ = assertEquals(dry.value("LR.result"), "dry-run-rolled-back"); _ = assertEquals(dry.steps("node_replay_rows_deleted"), 2L)
      unchanged <- everything(db); _ = assertEquals(unchanged, before)

      // Refusals: acknowledgement, database name, stale plan, a foreign connection, a Node-format row newer than the cut-over.
      unacknowledged <- script(name, "apply", "--confirm-database", name, "--expect-plan", token); _ = assertEquals(unacknowledged.exit, 2)
      wrongName <- script(name, "apply", "--apply-irreversible", "--confirm-database", "haystack", "--expect-plan", token, "--allow-active-connections")
      _ = assertEquals(wrongName.exit, 3); _ = assert(wrongName.err.contains("--confirm-database does not name the connected database"), wrongName.err)
      stale <- script(name, "apply", "--apply-irreversible", "--confirm-database", name, "--expect-plan", "9.9.9", "--allow-active-connections")
      _ = assertEquals(stale.exit, 3); _ = assert(stale.err.contains("differ from the preflight plan token"), stale.err)
      connected <- held(name)(script(name, "apply", "--apply-irreversible", "--confirm-database", name, "--expect-plan", token))
      _ = assertEquals(connected.exit, 3); _ = assert(connected.err.contains("other client connection"), connected.err)
      lateId = requestId()
      _ <- db.transaction(c => Sql.update(c, "INSERT INTO write_requests(principal_user,token_id,request_id,digest,outcome) VALUES(?,?,?::uuid,?,'{}'::jsonb)", Alice.userId, Alice.tokenId, lateId, "d" * 64))
      late <- script(name, "dry-run", "--allow-active-connections")
      _ = assertEquals(late.exit, 3); _ = assert(late.err.contains("created after the Scala cut-over"), late.err)
      _ <- db.transaction(c => Sql.update(c, "DELETE FROM write_requests WHERE request_id=?::uuid", lateId))
      stillUnchanged <- everything(db); _ = assertEquals(stillUnchanged, before)

      applied <- script(name, "apply", "--apply-irreversible", "--confirm-database", name, "--expect-plan", token, "--allow-active-connections", "--batch-size", "1")
      _ = assertEquals(applied.exit, 0, applied.err + applied.out); _ = assertEquals(applied.value("LR.result"), "applied"); _ = assertEquals(applied.steps("node_replay_rows_deleted"), 2L)
      verified <- script(name, "verify"); _ = assertEquals(verified.exit, 0, verified.out + verified.err); _ = assertEquals(verified.value("LR.result"), "verify-zero")
      after <- everything(db)
      // Only replay rows changed: the two Node-era rows are gone, the current-format row is the one that was there.
      _ = assertEquals(after.filterNot(_.startsWith("write_requests ")), before.filterNot(_.startsWith("write_requests ")))
      _ = assertEquals(after.count(_.startsWith("write_requests ")), 1); _ = assert(after.filter(_.startsWith("write_requests ")).forall(before.contains))
      again <- script(name, "preflight").flatMap(p => script(name, "apply", "--apply-irreversible", "--confirm-database", name, "--expect-plan", p.value("LR.plan"), "--allow-active-connections"))
      _ = assertEquals(again.exit, 0, again.err); _ = assertEquals(again.steps("node_replay_rows_deleted"), 0L)
      idempotent <- everything(db); _ = assertEquals(idempotent, after)

      // The current service on the migrated database: startup, every acknowledged Node-era document and its history.
      _ <- Migrations.initialize(db, Activity)
      head <- repo.current(ItemKey("p", "legacy")); first <- repo.revision(ItemKey("p", "legacy"), 1L); history <- repo.history(ItemKey("p", "legacy"))
      _ = assertEquals(head.get.documentCanonical, latest); _ = assertEquals(first.get.documentCanonical, original)
      _ = assertEquals(history.map(h => (h.revision, h.modifiedBy, h.tokenId)), Vector((2L, "bot", "old-agent-token"), (1L, "alice", "old-human-token")))
      // The stated consequence: a Node-era request id is an unknown identity now. Optimistic concurrency still
      // refuses a stale expected revision; an operation that names the current revision is a new write.
      _ <- expectFault(repo.commit(op(key = "p:legacy", revision = 1L, id = oldId), Alice, Later), "conflict", Some(2L))
      fresh <- repo.commit(op(key = "p:legacy", revision = 2L, document = doc("after-retirement"), id = oldFailureId), Alice, Later.plusSeconds(1))
      _ = assertEquals((fresh.revision, fresh.replayed), (3L, false))
      preserved <- repo.revision(ItemKey("p", "legacy"), 2L); _ = assertEquals(preserved.get.documentCanonical, latest)
      // Current-format replay identities are untouched.
      scalaOperation = op(key = "p:replayed", document = doc("replayed"))
      once <- repo.commit(scalaOperation, Bot, Later); twice <- repo.commit(scalaOperation, Bot, Later.plusSeconds(5))
      _ = assertEquals((once.replayed, twice.replayed, twice.revision), (false, true, 1L))
      settled <- script(name, "verify"); _ = assertEquals(settled.exit, 0, settled.out + settled.err)

      // The wide stored-read predicates guard the later code deletion: a Node-only oversize document fails verify,
      // and no script shrinks it (the document is authoritative content).
      _ <- db.transaction { c =>
        Sql.update(c, "INSERT INTO items(project_id,item_id,revision,document,document_text,created_at,created_by,modified_at,modified_by) VALUES('historical','wide',1,?::jsonb,?,?,'historical-author',?,'historical-author')", wide, wide, Now, Now)
        Sql.update(c, "INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id) VALUES('historical','wide',1,?::jsonb,?,?,'historical-author','old-human-token')", wide, wide, Now)
      }
      oversize <- script(name, "verify")
      _ = assertEquals(oversize.exit, 3); _ = assertEquals(oversize.count("LR.stored.revisions_over_1mib"), 1L); _ = assertEquals(oversize.count("LR.stored.items_over_1mib"), 1L)
      keptWide <- script(name, "dry-run", "--allow-active-connections"); _ = assertEquals(keptWide.exit, 0, keptWide.err)
      stored <- repo.current(ItemKey("historical", "wide")); _ = assertEquals(stored.get.documentCanonical, wide)
    } yield () })
  }
}
