package haystack.storage

import cats.effect.IO
import cats.syntax.all.*
import haystack.domain.*
import ponygirls.runtime.{JdbcDatabase, JdbcFailure}
import java.nio.charset.StandardCharsets
import TestSupport.*

/** Effectual-GoodCommunication: actual legacy schema fixtures and production
  * migration transactions, not rewritten golden expectations or a fake upgrader.
  */
class MigrationsTest extends ContractSuite {
  private def legacy(database: JdbcDatabase): IO[Unit] = database.transaction { c =>
    Vector("0001-initial", "0002-search", "0003-tags").foreach { version =>
      val stream = Option(getClass.getResourceAsStream("/" + version + ".sql")).getOrElse(fail("missing production migration " + version))
      val text = try new String(stream.readAllBytes(), StandardCharsets.UTF_8) finally stream.close()
      val statement = c.createStatement()
      try statement.execute(text) finally statement.close()
      Sql.update(c, "INSERT INTO schema_migrations(version) VALUES(?)", version)
    }
    Sql.update(c, "INSERT INTO store_metadata(id,activity_project_id) VALUES(1,?)", Activity)
    ()
  }
  private def snapshot(db: JdbcDatabase): IO[Map[String, Vector[String]]] = db.transaction { c =>
    Vector("items", "item_revisions", "item_links", "item_search", "write_requests", "store_metadata").map { table =>
      table -> Sql.rows(c, s"SELECT row_to_json(t)::text FROM $table t ORDER BY row_to_json(t)::text")(_.getString(1))
    }.toMap
  }
  test("eight concurrent startup migrations on an empty database converge once") { run(emptyDatabase.use { db => for {
    _ <- Vector.fill(8)(Migrations.initialize(db, Activity)).parSequence_
    versions <- db.transaction(c => Sql.rows(c, "SELECT version FROM schema_migrations ORDER BY version")(_.getString(1)))
    _ = assertEquals(versions, Vector("0001-initial", "0002-search", "0003-tags", "0004-scala-current"))
    metadata <- db.transaction(c => Sql.rows(c, "SELECT activity_project_id FROM store_metadata")(_.getString(1)))
    _ = assertEquals(metadata, Vector(Activity))
    cutovers <- db.transaction(c => Sql.rows(c, "SELECT contract FROM haystack_contract_cutovers")(_.getString(1)))
    _ = assertEquals(cutovers, Vector("haystack.api/1.0.0"))
  } yield () }) }

  test("activity namespace mismatch fails closed without changing existing metadata or history") { run(initializedDatabase.use { db => for {
    _ <- new PostgresItemRepository(db).commit(op(), Alice, Now)
    before <- snapshot(db)
    fault <- expectFault(Migrations.initialize(db, "other-namespace"), "config")
    _ = assert(fault.message.contains("namespace"))
    after <- snapshot(db); _ = assertEquals(after, before)
    _ <- Migrations.initialize(db, Activity)
  } yield () }) }

  test("unknown migration version is rejected and never erased/reinterpreted") { run(emptyDatabase.use { db => for {
    _ <- legacy(db)
    _ <- db.transaction(c => Sql.update(c, "INSERT INTO schema_migrations(version) VALUES('9999-future')"))
    before <- snapshot(db)
    _ <- expectFault(Migrations.initialize(db, Activity), "config")
    after <- snapshot(db); _ = assertEquals(after, before)
    versions <- db.transaction(c => Sql.rows(c, "SELECT version FROM schema_migrations ORDER BY version")(_.getString(1)))
    _ = assertEquals(versions, Vector("0001-initial", "0002-search", "0003-tags", "9999-future"))
    missing <- db.transaction(c => Sql.rows(c, "SELECT to_regclass('haystack_contract_cutovers') IS NULL")(_.getBoolean(1)).head)
    _ = assert(missing)
  } yield () }) }

  test("injected cutover ledger failure rolls back schema changes and successful retry installs once") { run(emptyDatabase.use { db => for {
    _ <- legacy(db)
    _ <- db.transaction { c =>
      Sql.update(c, "CREATE FUNCTION reject_test_migration() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic migration failure'; END $$")
      Sql.update(c, "CREATE TRIGGER reject_test_migration BEFORE INSERT ON schema_migrations FOR EACH ROW WHEN (NEW.version = '0004-scala-current') EXECUTE FUNCTION reject_test_migration()")
    }
    _ <- (for {
      failure <- Migrations.initialize(db, Activity).attempt
      _ = assert(failure.left.toOption.exists(_.isInstanceOf[JdbcFailure]))
      state <- db.transaction { c =>
        (Sql.rows(c, "SELECT version FROM schema_migrations ORDER BY version")(_.getString(1)),
          Sql.rows(c, "SELECT to_regclass('haystack_contract_cutovers') IS NULL")(_.getBoolean(1)).head)
      }
      _ = assertEquals(state._1, Vector("0001-initial", "0002-search", "0003-tags")); _ = assert(state._2)
    } yield ()).guarantee(db.transaction { c => Sql.update(c, "DROP TRIGGER reject_test_migration ON schema_migrations"); Sql.update(c, "DROP FUNCTION reject_test_migration()"); () })
    _ <- Migrations.initialize(db, Activity)
    _ <- Migrations.initialize(db, Activity)
    count <- db.transaction(c => Sql.rows(c, "SELECT count(*) FROM haystack_contract_cutovers")(_.getLong(1)).head)
    _ = assertEquals(count, 1L)
  } yield () }) }

  test("coordinated current-contract cutover preserves all acknowledged documents, authors, history, links and old replay bytes") {
    val oldId = requestId(); val oldFailureId = requestId()
    val original = doc("original", "{\"n\":9007199254740993,\"decimal\":0.10}")
    val latest = doc("latest", "{\"unicode\":\"café 🐎\",\"decimal\":1.00e2}").replace("\"links\":[]", "\"links\":[[\"origin\",\"else:missing\"]]")
    run(emptyDatabase.use { db => for {
      _ <- legacy(db)
      _ <- db.transaction { c =>
        Sql.update(c, "INSERT INTO items(project_id,item_id,revision,document,document_text,created_at,created_by,modified_at,modified_by) VALUES('p','legacy',2,?::jsonb,?,?,?,?,'bot')", latest, latest, Now, "alice", Later)
        Sql.update(c, "INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id) VALUES('p','legacy',1,?::jsonb,?,?,'alice','old-human-token')", original, original, Now)
        Sql.update(c, "INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id) VALUES('p','legacy',2,?::jsonb,?,?,'bot','old-agent-token')", latest, latest, Later)
        Sql.update(c, "INSERT INTO item_links VALUES('p','legacy',0,'origin','else','missing')")
        Sql.update(c, "INSERT INTO item_search VALUES('p','legacy',ARRAY['legacy'],ARRAY['legacy text'])")
        Sql.update(c, "INSERT INTO write_requests(principal_user,token_id,request_id,digest_format,digest,outcome,created_at) VALUES(?,?,?::uuid,'haystack-op-v1',?,?::jsonb,?)", Alice.userId, Alice.tokenId, oldId, "f" * 64, "{\"kind\":\"committed\",\"revision\":1,\"legacy\":\"retained\"}", Now)
        Sql.update(c, "INSERT INTO write_requests(principal_user,token_id,request_id,digest_format,digest,outcome,created_at) VALUES(?,?,?::uuid,'haystack-op-v1',?,?::jsonb,?)", Alice.userId, Alice.tokenId, oldFailureId, "e" * 64, "{\"kind\":\"invalid-document\",\"detail\":\"legacy terminal\"}", Now)
      }
      before <- snapshot(db)
      _ <- Migrations.initialize(db, Activity)
      after <- snapshot(db); _ = assertEquals(after, before)
      repo = new PostgresItemRepository(db)
      current <- repo.current(ItemKey("p", "legacy")); old <- repo.revision(ItemKey("p", "legacy"), 1L); history <- repo.history(ItemKey("p", "legacy"))
      _ = assertEquals(current.get.documentCanonical, latest); _ = assertEquals(old.get.documentCanonical, original)
      _ = assertEquals(current.get.metadata, ItemMetadata(Now, "alice", Later, "bot"))
      _ = assertEquals(history.map(h => (h.revision, h.modifiedBy, h.tokenId)), Vector((2L, "bot", "old-agent-token"), (1L, "alice", "old-human-token")))
      _ <- expectFault(repo.commit(op(key = "p:legacy", revision = 2L, id = oldId), Alice, Later), "replay-conflict")
      _ <- expectFault(repo.commit(op(key = "p:invalid", document = "{}", id = oldFailureId), Alice, Later), "replay-conflict")
      postReplay <- snapshot(db); _ = assertEquals(postReplay, before)
      fresh <- repo.commit(op(key = "p:legacy", revision = 2L, document = doc("new-current-format")), Alice, Later.plusSeconds(1))
      _ = assertEquals(fresh.revision, 3L)
      preserved <- repo.revision(ItemKey("p", "legacy"), 2L); _ = assertEquals(preserved.get.documentCanonical, latest)
      oldLedger <- db.transaction(c => Sql.rows(c, "SELECT digest_format,digest FROM write_requests WHERE request_id=?::uuid", Seq(oldId))(r => (r.getString(1), r.getString(2))).head)
      _ = assertEquals(oldLedger, "haystack-op-v1" -> ("f" * 64))
    } yield () })
  }
}
