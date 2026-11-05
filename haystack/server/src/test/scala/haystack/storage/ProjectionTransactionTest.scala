package haystack.storage

import cats.effect.IO
import cats.syntax.all.*
import haystack.domain.*
import haystack.retrieval.{HaystackRetrieval, ProjectionPolicy}
import ponygirls.retrieval.{EmbeddingSpace, RetrievalMode, RetrievalProfile}
import ponygirls.retrieval.postgres.PostgresRetrieval
import ponygirls.runtime.{JdbcDatabase, JdbcFailure}
import java.nio.charset.StandardCharsets.UTF_8
import TestSupport.*

/** Effectual-GoodCommunication: the production composition's shared retrieval
  * source/outbox and authoritative item are committed by the SAME connection.
  * Synthetic embedding identity only; no client/network/model is configured.
  */
class ProjectionTransactionTest extends ContractSuite {
  private def projection(db: JdbcDatabase): HaystackRetrieval = {
    val policy = ProjectionPolicy("synthetic-test-approved-fields", true, Vector("/public"), 4096)
    val space = EmbeddingSpace("synthetic-fixture", "v1", 3, true, "", "", "cosine")
    new HaystackRetrieval(db, policy, new PostgresRetrieval("haystack", Some(RetrievalProfile(space, policy.id))), None, 16)
  }
  private def withProjection(body: (JdbcDatabase, PostgresItemRepository, HaystackRetrieval) => IO[Unit]): Unit =
    run(emptyDatabase.use { db => for {
      _ <- Migrations.initialize(db, Activity)
      retrieval = projection(db)
      _ <- retrieval.initialize(Vector.empty)
      _ <- body(db, new PostgresItemRepository(db, Some(retrieval)), retrieval)
    } yield () })
  private def snapshot(db: JdbcDatabase): IO[Map[String, Vector[String]]] = db.transaction { c =>
    Vector("items", "item_revisions", "item_links", "item_search", "write_requests", "pony_retrieval_sources", "pony_retrieval_head_chunks",
      "pony_retrieval_attributes", "pony_retrieval_audience", "pony_retrieval_jobs").map { table =>
      table -> Sql.rows(c, s"SELECT row_to_json(t)::text FROM $table t ORDER BY row_to_json(t)::text")(_.getString(1))
    }.toMap
  }

  test("committed source/outbox is exactly-once under replay; approved corpus and archive flags remain live") { withProjection { (db, repo, retrieval) => for {
    operation <- IO(op(document = doc("visible title", "{\"public\":{\"note\":\"approved searchable words\"},\"private\":\"not-for-retrieval\",\"n\":9007199254740993}")))
    first <- repo.commit(operation, Alice, Now)
    before <- snapshot(db)
    _ = assertEquals(before("items").size, 1); _ = assertEquals(before("item_revisions").size, 1)
    _ = assertEquals(before("pony_retrieval_sources").size, 1); _ = assertEquals(before("pony_retrieval_jobs").size, 1)
    bodies <- db.transaction(c => Sql.rows(c, "SELECT body FROM pony_retrieval_head_chunks ORDER BY ordinal")(r => new String(r.getBytes(1), UTF_8)))
    _ = assert(bodies.contains("approved searchable words")); _ = assert(bodies.contains("visible title"))
    _ = assert(!bodies.exists(_.contains("not-for-retrieval"))); _ = assert(!bodies.exists(_.contains("9007199254740993")))
    replay <- repo.commit(operation, Alice, Later); _ = assertEquals(replay, first.copy(replayed = true))
    after <- snapshot(db); _ = assertEquals(after, before)
    page <- retrieval.search("searchable", RetrievalMode.Lexical, Some("p"), false, 0, 20)
    _ = assertEquals(page.hits.map(_.id), List("p:a")); _ = assertEquals(page.hits.head.version, s"1/${retrieval.policy.id}")
    archived <- IO(op(revision = 1L, document = operation.documentCanonical.replace("\"actual\"", "\"archived\"")))
    _ <- repo.commit(archived, Bot, Later)
    hidden <- retrieval.search("searchable", RetrievalMode.Lexical, Some("p"), false, 0, 20)
    _ = assertEquals(hidden.hits, Nil)
    explicit <- retrieval.search("searchable", RetrievalMode.Lexical, Some("p"), true, 0, 20)
    _ = assertEquals(explicit.hits.map(_.id), List("p:a")); _ = assertEquals(explicit.hits.head.version, s"2/${retrieval.policy.id}")
    jobs <- db.transaction(c => Sql.rows(c, "SELECT state FROM pony_retrieval_jobs ORDER BY epoch")(_.getString(1)))
    _ = assertEquals(jobs, Vector("Superseded", "Queued"))
  } yield () } }

  Vector("pony_retrieval_jobs", "write_requests").foreach { failingTable =>
    test("failure inserting " + failingTable + " rolls back authoritative history, shared source and durable outbox together") { withProjection { (db, repo, _) => for {
      _ <- repo.commit(op(document = doc("original", "{\"public\":\"original searchable\"}")), Alice, Now)
      before <- snapshot(db)
      operation <- IO(op(revision = 1L, document = doc("changed", "{\"public\":\"replacement searchable\"}")))
      _ <- db.transaction { c =>
        Sql.update(c, "CREATE FUNCTION reject_test_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic projection transaction failure'; END $$")
        Sql.update(c, "CREATE TRIGGER reject_test_projection BEFORE INSERT ON " + failingTable + " FOR EACH ROW EXECUTE FUNCTION reject_test_projection()")
      }
      _ <- (for {
        failure <- repo.commit(operation, Bot, Later).attempt
        _ = assert(failure.left.toOption.exists(_.isInstanceOf[JdbcFailure]))
        after <- snapshot(db); _ = assertEquals(after, before)
      } yield ()).guarantee(db.transaction { c =>
        Sql.update(c, "DROP TRIGGER reject_test_projection ON " + failingTable)
        Sql.update(c, "DROP FUNCTION reject_test_projection()")
        ()
      })
      retry <- repo.commit(operation, Bot, Later); _ = assertEquals(retry.revision, 2L); _ = assert(!retry.replayed)
      afterRetry <- snapshot(db); _ = assertEquals(afterRetry("item_revisions").size, 2); _ = assertEquals(afterRetry("pony_retrieval_jobs").size, 2)
      replay <- repo.commit(operation, Bot, Later); _ = assert(replay.replayed)
      afterReplay <- snapshot(db); _ = assertEquals(afterReplay, afterRetry)
    } yield () } }
  }
}
