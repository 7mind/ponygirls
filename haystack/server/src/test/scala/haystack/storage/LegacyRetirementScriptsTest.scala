package haystack.storage

import cats.effect.IO
import haystack.domain.*
import ponygirls.runtime.{CredentialFile, JdbcDatabase}
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files, Path}
import java.sql.DriverManager
import java.util.Properties
import java.util.concurrent.{TimeUnit, TimeoutException}
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*
import TestSupport.*
import LegacyStoredDocumentCheck.Verdict

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
  /** The schema of a started Haystack: its migrations and the shared retrieval registry (created by the service at serve). */
  private def serviceSchema(db: JdbcDatabase): IO[Unit] =
    Migrations.initialize(db, Activity) *> db.transaction(c => new ponygirls.retrieval.postgres.PostgresRetrieval("haystack", None).initialize(c))
  /** The LR./LP. lines a mode printed, without the per-invocation application name. */
  private def lines(ran: Ran): List[String] = ran.out.linesIterator.filter(l => (l.startsWith("LR.") || l.startsWith("LP.")) && !l.startsWith("LR.application_name|")).toList
  private def database(db: JdbcDatabase): IO[String] = db.transaction(c => Sql.rows(c, "SELECT current_database()")(_.getString(1)).head)
  private def connection(database: String): Map[String, String] = {
    val config = databaseConfig
    val address = config.jdbcUrl.stripPrefix("jdbc:postgresql://").takeWhile(_ != '/')
    Map("PGHOST" -> address.takeWhile(_ != ':'), "PGPORT" -> address.dropWhile(_ != ':').drop(1), "PGUSER" -> config.user,
      "PGPASSWORD" -> CredentialFile.read(config.passwordFile), "PGDATABASE" -> database)
  }
  // IO.interruptible: a cancelled or timed-out test interrupts the wait, and the helper kills the child.
  private def script(database: String, arguments: String*): IO[Ran] = scriptWith(Map.empty, database, arguments*)
  private def scriptWith(session: Map[String, String], database: String, arguments: String*): IO[Ran] = IO.interruptible {
    // The forked test JVM's working directory is the repository root or the project directory, depending on the build settings.
    val relative = Path.of("scripts", "one-off", "legacy-retirement", "run.sh")
    val located = Iterator.iterate(Path.of("").toAbsolutePath)(_.getParent).takeWhile(_ != null).map(_.resolve(relative)).find(Files.isRegularFile(_)).getOrElse(fail("legacy retirement driver is absent"))
    val psql = Path.of(sys.env.getOrElse("POSTGRES_HOME", throw new IllegalStateException("POSTGRES_HOME required (nix develop .#chronicle)")), "bin", "psql").toString
    val ran = LegacyRetirementChild.run(List("sh", located.toString, "haystack") ++ arguments, sys.env, connection(database) ++ session + ("PSQL" -> psql), LegacyRetirementChild.timeout)
    Ran(ran.exit, ran.out, ran.err)
  }
  private def psqlFile(database: String, file: Path): IO[Ran] = psqlFileWith(Map.empty, database, file)
  private def psqlFileWith(session: Map[String, String], database: String, file: Path): IO[Ran] = IO.interruptible {
    val located = Iterator.iterate(Path.of("").toAbsolutePath)(_.getParent).takeWhile(_ != null).map(_.resolve(file)).find(Files.isRegularFile(_)).getOrElse(fail(s"missing SQL file $file"))
    val ran = LegacyRetirementChild.run(List(Path.of(sys.env("POSTGRES_HOME"), "bin", "psql").toString, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", located.toString),
      sys.env, connection(database) ++ session, LegacyRetirementChild.timeout)
    Ran(ran.exit, ran.out, ran.err)
  }
  /** The codec check exactly as check-stored-documents.sh performs it: psql export, then the real decoder. */
  private def codecCheck(database: String, mutate: String => String = identity): IO[LegacyStoredDocumentCheck.Report] =
    script(database, "export-stored-documents").flatMap { exported => IO.blocking {
      assertEquals(exported.exit, 0, exported.err)
      val file = Files.createTempFile("legacy-retirement-", ".export")
      try { Files.writeString(file, mutate(exported.out), UTF_8); LegacyStoredDocumentCheck.check(file) } finally Files.delete(file)
    } }
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

  /** Node-era rows exactly as MigrationsTest's cut-over case seeds them; TestSupport.Now precedes the cut-over marker. */
  private def seedNodeEra(db: JdbcDatabase, original: String, latest: String, oldId: String, oldFailureId: String): IO[Unit] = db.transaction { c =>
    Sql.update(c, "INSERT INTO items(project_id,item_id,revision,document,document_text,created_at,created_by,modified_at,modified_by) VALUES('p','legacy',2,?::jsonb,?,?,?,?,'bot')", latest, latest, Now, "alice", Later)
    Sql.update(c, "INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id) VALUES('p','legacy',1,?::jsonb,?,?,'alice','old-human-token')", original, original, Now)
    Sql.update(c, "INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id) VALUES('p','legacy',2,?::jsonb,?,?,'bot','old-agent-token')", latest, latest, Later)
    Sql.update(c, "INSERT INTO item_links VALUES('p','legacy',0,'origin','else','missing')")
    Sql.update(c, "INSERT INTO write_requests(principal_user,token_id,request_id,digest_format,digest,outcome,created_at) VALUES(?,?,?::uuid,'haystack-op-v1',?,?::jsonb,?)", Alice.userId, Alice.tokenId, oldId, "f" * 64, "{\"kind\":\"committed\",\"revision\":1,\"legacy\":\"retained\"}", Now)
    // No explicit format: the 0001 column default still stamps the Node format.
    Sql.update(c, "INSERT INTO write_requests(principal_user,token_id,request_id,digest,outcome,created_at) VALUES(?,?,?::uuid,?,?::jsonb,?)", Alice.userId, Alice.tokenId, oldFailureId, "e" * 64, "{\"kind\":\"invalid-document\",\"detail\":\"legacy terminal\"}", Now)
    ()
  }

  // Part of the service's full suite (the suite check's source includes scripts/one-off/legacy-retirement and the
  // retained check-legacy-free.sql); deleted together with the one-off scripts (that directory's README).
  test("legacy retirement child: only allow-listed variables and the fixture's connection reach the scripts") {
    val parent = Map("PATH" -> "/run/bin", "LANG" -> "C.UTF-8", "PGHOSTADDR" -> "203.0.113.7", "PGHOST" -> "production", "PGSERVICE" -> "prod",
      "PGPASSFILE" -> "/p", "PSQL" -> "kubectl exec core-0 -- psql", "LR_CONTEXT" -> "tavily-lne", "KUBECONFIG" -> "/k", "HOME" -> "/home/operator")
    assertEquals(LegacyRetirementChild.environment(parent, Map("PGHOST" -> "127.0.0.1", "PSQL" -> "/fixture/psql")),
      Map("PATH" -> "/run/bin", "LANG" -> "C.UTF-8", "PGHOST" -> "127.0.0.1", "PSQL" -> "/fixture/psql"))
  }
  test("legacy retirement child: a child that outlives its bound is killed with its descendants") {
    val pidFile = Files.createTempFile("legacy-retirement-", ".pid")
    try {
      val started = System.nanoTime()
      intercept[TimeoutException](LegacyRetirementChild.run(List("sh", "-c", s"sleep 60 & echo $$! > $pidFile; wait"), sys.env, Map.empty, 1.second))
      assert((System.nanoTime() - started).nanos < 30.seconds, "the bounded wait did not return")
      assert(!LegacyRetirementChild.running(Files.readString(pidFile).trim.toLong), "the descendant still runs")
    } finally Files.delete(pidFile)
  }
  test("legacy retirement: Node-era replay rows are counted, refused on failed preconditions, deleted once, and the current service keeps every acknowledged document") {
    val oldId = requestId(); val oldFailureId = requestId()
    val original = doc("original", "{\"n\":9007199254740993,\"decimal\":0.10}")
    val latest = doc("latest", "{\"unicode\":\"café 🐎\",\"decimal\":1.00e2}").replace("\"links\":[]", "\"links\":[[\"origin\",\"else:missing\"]]")
    run(emptyDatabase.use { db => for {
      _ <- serviceSchema(db)
      name <- database(db)
      _ <- seedNodeEra(db, original, latest, oldId, oldFailureId)
      repo = new PostgresItemRepository(db)
      current <- repo.commit(op(key = "p:current", document = doc("scala")), Bot, Later)
      _ = assertEquals(current.revision, 1L)
      _ <- expectFault(repo.commit(op(key = "p:legacy", revision = 2L, id = oldId), Alice, Later), "replay-conflict")

      preflight <- script(name, "preflight")
      _ = assertEquals(preflight.exit, 0, preflight.err)
      _ = assertEquals(preflight.count("LR.replay.node_format"), 2L); _ = assertEquals(preflight.count("LR.info.replay.current_format"), 1L)
      _ = assertEquals(preflight.count("LR.info.item_revisions"), 3L); _ = assert(preflight.count("LR.size.database_bytes") > 0L)
      token = preflight.value("LR.plan")
      unverified <- script(name, "verify"); _ = assertEquals(unverified.exit, 3); _ = assertEquals(unverified.value("LR.result"), "verify-nonzero")

      before <- everything(db)
      dry <- script(name, "dry-run", "--allow-active-connections", "--batch-size", "1")
      _ = assertEquals(dry.exit, 0, dry.err); _ = assertEquals(dry.value("LR.result"), "dry-run-rolled-back"); _ = assertEquals(dry.steps("node_replay_rows_deleted"), 2L)
      unchanged <- everything(db); _ = assertEquals(unchanged, before)

      // Refusals: acknowledgement, database name, stale plan, a foreign connection, a Node-format row newer than the cut-over.
      unacknowledged <- script(name, "apply", "--confirm-database", name, "--expect-plan", token, "--backup-reference", "x"); _ = assertEquals(unacknowledged.exit, 2)
      noBackup <- script(name, "apply", "--apply-irreversible", "--confirm-database", name, "--expect-plan", token).map(_.exit)
      _ = assertEquals(noBackup, 2)
      wrongName <- script(name, "apply", "--apply-irreversible", "--backup-reference", "fixture-backup", "--confirm-database", "haystack", "--expect-plan", token, "--allow-active-connections")
      _ = assertEquals(wrongName.exit, 3); _ = assert(wrongName.err.contains("--confirm-database does not name the connected database"), wrongName.err)
      stale <- script(name, "apply", "--apply-irreversible", "--backup-reference", "fixture-backup", "--confirm-database", name, "--expect-plan", "9.9.9", "--allow-active-connections")
      _ = assertEquals(stale.exit, 3); _ = assert(stale.err.contains("differ from the preflight plan token"), stale.err)
      connected <- held(name)(script(name, "apply", "--apply-irreversible", "--backup-reference", "fixture-backup", "--confirm-database", name, "--expect-plan", token))
      _ = assertEquals(connected.exit, 3); _ = assert(connected.err.contains("other client connection"), connected.err)
      lateId = requestId()
      _ <- db.transaction(c => Sql.update(c, "INSERT INTO write_requests(principal_user,token_id,request_id,digest,outcome) VALUES(?,?,?::uuid,?,'{}'::jsonb)", Alice.userId, Alice.tokenId, lateId, "d" * 64))
      late <- script(name, "dry-run", "--allow-active-connections")
      _ = assertEquals(late.exit, 3); _ = assert(late.err.contains("created after the Scala cut-over"), late.err)
      _ <- db.transaction(c => Sql.update(c, "DELETE FROM write_requests WHERE request_id=?::uuid", lateId))
      stillUnchanged <- everything(db); _ = assertEquals(stillUnchanged, before)

      applied <- script(name, "apply", "--apply-irreversible", "--backup-reference", "fixture-backup", "--confirm-database", name, "--expect-plan", token, "--allow-active-connections", "--batch-size", "1")
      _ = assertEquals(applied.exit, 0, applied.err + applied.out); _ = assertEquals(applied.value("LR.result"), "applied"); _ = assertEquals(applied.steps("node_replay_rows_deleted"), 2L)
      verified <- script(name, "verify"); _ = assertEquals(verified.exit, 0, verified.out + verified.err); _ = assertEquals(verified.value("LR.result"), "verify-zero")
      after <- everything(db)
      // Only replay rows changed: the two Node-era rows are gone, the current-format row is the one that was there.
      _ = assertEquals(after.filterNot(_.startsWith("write_requests ")), before.filterNot(_.startsWith("write_requests ")))
      _ = assertEquals(after.count(_.startsWith("write_requests ")), 1); _ = assert(after.filter(_.startsWith("write_requests ")).forall(before.contains))
      again <- script(name, "preflight").flatMap(p => script(name, "apply", "--apply-irreversible", "--backup-reference", "fixture-backup", "--confirm-database", name, "--expect-plan", p.value("LR.plan"), "--allow-active-connections"))
      _ = assertEquals(again.exit, 0, again.err); _ = assertEquals(again.steps("node_replay_rows_deleted"), 0L)
      idempotent <- everything(db); _ = assertEquals(idempotent, after)

      // The current service on the migrated database: startup, every acknowledged Node-era document and its history.
      _ <- serviceSchema(db)
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

    } yield () })
  }

  test("legacy retirement: the stored-document tolerance is decided by the real codec; invalid historical link targets and oversize documents block, omitted links pass") {
    val oldId = requestId(); val oldFailureId = requestId()
    val original = doc("original", "{\"n\":9007199254740993,\"decimal\":0.10}")
    val latest = doc("latest", "{\"unicode\":\"café 🐎\",\"decimal\":1.00e2}").replace("\"links\":[]", "\"links\":[[\"origin\",\"else:missing\"]]")
    val wide = HistoricalFixtures.values.find(_.name == "unicode-bmp-over-new-byte-envelope").get.text
    run(emptyDatabase.use { db => for {
      _ <- serviceSchema(db)
      name <- database(db)
      _ <- seedNodeEra(db, original, latest, oldId, oldFailureId)
      repo = new PostgresItemRepository(db)
      _ <- repo.commit(op(key = "p:current", document = doc("scala")), Bot, Later)
      // Stored-document tolerance: decided by the real codec over every stored text, never by SQL.
      clean <- codecCheck(name)
      _ = assert(clean.strict, clean.toString); _ = assertEquals((clean.items, clean.revisions), (2L, 3L))
      // A document that omits `links` is valid for the current codec and must pass.
      omitted = doc("no-link-key").replace(",\"links\":[]", "")
      _ = assert(!omitted.contains("\"links\""))
      _ <- db.transaction { c =>
        Sql.update(c, "INSERT INTO items(project_id,item_id,revision,document,document_text,created_at,created_by,modified_at,modified_by) VALUES('historical','omitted',1,?::jsonb,?,?,'historical-author',?,'historical-author')", omitted, omitted, Now, Now)
        Sql.update(c, "INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id) VALUES('historical','omitted',1,?::jsonb,?,?,'historical-author','old-human-token')", omitted, omitted, Now)
      }
      withOmitted <- codecCheck(name); _ = assert(withOmitted.strict, withOmitted.toString)
      // A truncated export never passes.
      truncated <- codecCheck(name, _.linesIterator.filterNot(_.startsWith("LR.export.complete")).mkString("\n"))
      _ = assert(!truncated.strict && !truncated.complete)
      // Historical percent-encoded link targets that only the relaxed read accepts: invalid UTF-8 and a decoded NUL.
      // An approximate SQL pattern accepts both; the codec rejects both, so they block the removal of the tolerance.
      _ = List("p:%FF", "p:%00").foreach(target => assert(scala.util.Try(QualifiedId.decodeKey(target)).isFailure, target))
      badLinks = doc("bad-links").replace("\"links\":[]", "\"links\":[[\"origin\",\"p:%FF\"],[\"origin\",\"p:%00\"]]")
      _ <- db.transaction { c =>
        Sql.update(c, "INSERT INTO items(project_id,item_id,revision,document,document_text,created_at,created_by,modified_at,modified_by) VALUES('historical','bad-links',1,?::jsonb,?,?,'historical-author',?,'historical-author')", badLinks, badLinks, Now, Now)
        Sql.update(c, "INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id) VALUES('historical','bad-links',1,?::jsonb,?,?,'historical-author','old-human-token')", badLinks, badLinks, Now)
      }
      readable <- repo.current(ItemKey("historical", "bad-links")); _ = assertEquals(readable.get.documentCanonical, badLinks)
      blocked <- codecCheck(name)
      _ = assert(!blocked.strict); _ = assertEquals(blocked.of(Verdict.NeedsRelaxedLinks), 2L); _ = assertEquals(blocked.of(Verdict.NeedsWideEnvelope), 0L)
      // A Node-only oversize document needs the wide envelope; no script shrinks it (it is authoritative content).
      _ <- db.transaction { c =>
        Sql.update(c, "INSERT INTO items(project_id,item_id,revision,document,document_text,created_at,created_by,modified_at,modified_by) VALUES('historical','wide',1,?::jsonb,?,?,'historical-author',?,'historical-author')", wide, wide, Now, Now)
        Sql.update(c, "INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id) VALUES('historical','wide',1,?::jsonb,?,?,'historical-author','old-human-token')", wide, wide, Now)
      }
      oversize <- codecCheck(name)
      _ = assertEquals((oversize.of(Verdict.NeedsWideEnvelope), oversize.of(Verdict.NeedsRelaxedLinks), oversize.of(Verdict.Unreadable)), (2L, 2L, 0L))
      stored <- repo.current(ItemKey("historical", "wide")); _ = assertEquals(stored.get.documentCanonical, wide)
      // The replay verify is not the authority for these documents and says so.
      replayOnly <- script(name, "verify"); _ = assert(replayOnly.out.contains("LR.note|stored-document tolerance is decided by check-stored-documents.sh"), replayOnly.out)
      _ <- db.transaction { c => Sql.update(c, "DELETE FROM item_revisions WHERE project_id='historical' AND item_id IN ('wide','bad-links')"); Sql.update(c, "DELETE FROM items WHERE project_id='historical' AND item_id IN ('wide','bad-links')") }
      restored <- codecCheck(name); _ = assert(restored.strict, restored.toString)

    } yield () })
  }

  // F1: production runs the scripts as postgres. Haystack's tables are in public (its schema); here the session's
  // search_path does not reach public at all, so every statement must resolve its tables itself.
  test("legacy retirement F1: the scripts and the retained check resolve their tables in Haystack's schema whatever the session's search_path; a table that does not resolve refuses, never counts zero") {
    val elsewhere = Map("PGOPTIONS" -> "-c search_path=lr_nowhere")
    run(emptyDatabase.use { db => for {
      _ <- serviceSchema(db)
      name <- database(db)
      _ <- seedNodeEra(db, doc("original", "{}"), doc("latest", "{}"), requestId(), requestId())
      normal <- script(name, "verify")
      moved <- scriptWith(elsewhere, name, "verify")
      _ = assertEquals(moved.exit, 3, moved.out + moved.err); _ = assertEquals(moved.value("LR.result"), "verify-nonzero")
      _ = assertEquals(moved.count("LP.replay.other_digest_format"), 2L); _ = assertEquals(lines(moved), lines(normal))
      checked <- psqlFileWith(elsewhere, name, Path.of("haystack", "scripts", "check-legacy-free.sql"))
      _ = assertEquals(checked.exit, 3); _ = assertEquals(checked.count("LP.replay.other_digest_format"), 2L); _ = assertEquals(checked.count("LF.replay.column_default_present"), 1L)
      _ <- db.transaction(c => Sql.update(c, "DROP TABLE pony_retrieval_profiles CASCADE"))
      refused <- script(name, "preflight")
      _ = assertEquals(refused.exit, 3); _ = assertEquals(refused.value("LR.result"), "refused-missing-objects"); _ = assertEquals(refused.value("LR.missing"), "public.pony_retrieval_profiles")
      refusedCheck <- psqlFile(name, Path.of("haystack", "scripts", "check-legacy-free.sql"))
      _ = assertEquals(refusedCheck.exit, 3); _ = assertEquals(refusedCheck.value("LF.result"), "refused-missing-objects")
    } yield () })
  }
  test("legacy retirement: the proposed clean-up schema (0007) passes the retained check; the one-off refuses afterwards; the current binary cannot start on it") {
    run(emptyDatabase.use { db => for {
      _ <- serviceSchema(db)
      name <- database(db)
      repo = new PostgresItemRepository(db)
      _ <- repo.commit(op(key = "p:current", document = doc("scala")), Bot, Later)
      verified <- script(name, "verify"); _ = assertEquals(verified.exit, 0, verified.out + verified.err)
      // Runbook steps 14-16 against the proposed clean-up schema (migration 0007).
      before0007 <- psqlFile(name, Path.of("haystack", "scripts", "check-legacy-free.sql")); _ = assertEquals(before0007.exit, 3)
      cleaned <- psqlFile(name, Path.of("scripts", "one-off", "legacy-retirement", "sql", "haystack", "proposed-cleanup.sql")); _ = assertEquals(cleaned.exit, 0, cleaned.err)
      legacyFree <- psqlFile(name, Path.of("haystack", "scripts", "check-legacy-free.sql"))
      _ = assertEquals(legacyFree.exit, 0, legacyFree.out + legacyFree.err); _ = assertEquals(legacyFree.value("LF.result"), "legacy-free")
      // The one-off is bound to schema 0001..0006 and refuses afterwards; its read-only verify still answers.
      boundSchema <- script(name, "dry-run", "--allow-active-connections"); _ = assertEquals(boundSchema.exit, 3); _ = assert(boundSchema.err.contains("unexpected schema_migrations"), boundSchema.err)
      // The default is gone: an insert that omits the format is refused instead of being stamped as a Node row.
      defaulted <- db.transaction(c => Sql.update(c, "INSERT INTO write_requests(principal_user,token_id,request_id,digest,outcome) VALUES(?,?,?::uuid,?,'{}'::jsonb)", Alice.userId, Alice.tokenId, requestId(), "c" * 64)).attempt
      _ = assert(defaulted.isLeft)
      // The current repository code works on the cleaned schema ...
      written <- repo.commit(op(key = "p:after-0007", document = doc("after-0007")), Bot, Later.plusSeconds(9)); _ = assertEquals(written.revision, 1L)
      // ... but the current binary's start-up refuses a ledger it does not know: after 0007 there is no rollback to it.
      startup <- Migrations.initialize(db, Activity).attempt
      _ = assert(startup.left.exists { case fault: Fault => fault.code == "config"; case _ => false }, startup.toString)
    } yield () })
  }
}

/** The child processes of the one-off scripts. Environment: an allow-list of tool locations and locale plus the
  * fixture's connection, so no inherited PGHOSTADDR, PGSERVICE, PSQL, LR_* or KUBE* setting can redirect them (the
  * shell suites' test-guard.sh is not involved here). Wait: bounded; on timeout or interruption the child and its
  * descendants are killed and reaped.
  */
private[storage] object LegacyRetirementChild {
  val inherited: Set[String] = Set("PATH", "LANG", "LC_ALL", "TMPDIR")
  /** Longest legitimate run.sh session in the fixture (seconds); below ContractSuite's munitTimeout. */
  val timeout: FiniteDuration = 45.seconds
  final case class Result(exit: Int, out: String, err: String)
  def environment(parent: Map[String, String], fixture: Map[String, String]): Map[String, String] =
    parent.filter(entry => inherited.contains(entry._1)) ++ fixture
  def run(command: List[String], parent: Map[String, String], fixture: Map[String, String], limit: FiniteDuration): Result = {
    val builder = new ProcessBuilder(command.asJava)
    val env = builder.environment(); env.clear(); env.putAll(environment(parent, fixture).asJava)
    val out = Files.createTempFile("legacy-retirement-", ".out"); val err = Files.createTempFile("legacy-retirement-", ".err")
    builder.redirectOutput(out.toFile).redirectError(err.toFile)
    try {
      val process = builder.start()
      try {
        if (!process.waitFor(limit.toMillis, TimeUnit.MILLISECONDS)) throw new TimeoutException(s"${command.head} did not finish within $limit")
        Result(process.exitValue(), Files.readString(out, UTF_8), Files.readString(err, UTF_8))
      } finally if (process.isAlive) { // timeout or interruption: the child's descendants (psql) first, then the child
        process.descendants().forEach(child => { child.destroyForcibly(); () })
        process.destroyForcibly(); process.waitFor()
      }
    } finally { Files.delete(out); Files.delete(err) }
  }
  /** Linux: a process that is gone or a zombie no longer runs. */
  def running(pid: Long): Boolean = {
    val stat = Path.of("/proc", pid.toString, "stat")
    try !Files.readString(stat).split("\\) ").lift(1).exists(_.startsWith("Z")) catch { case _: java.nio.file.NoSuchFileException => false }
  }
}
