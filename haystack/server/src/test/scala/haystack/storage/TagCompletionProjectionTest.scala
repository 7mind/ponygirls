package haystack.storage

import cats.effect.IO
import cats.syntax.all.*
import haystack.domain.*
import haystack.retrieval.{HaystackRetrieval, ProjectionPolicy}
import io.circe.Json
import ponygirls.retrieval.postgres.PostgresRetrieval
import ponygirls.runtime.{JdbcDatabase, JdbcFailure}
import TestSupport.*

/** GoodCommunication regressions: real tag prefix acquisition, atomic derived
  * projection writes and startup repair, with synthetic rows only.
  */
class TagCompletionProjectionTest extends ContractSuite {
  private def tagged(tags: Vector[String]): String = doc(extra = ",\"tags\":" + Json.arr(tags.map(Json.fromString)*).noSpaces)
  private def tags(db: JdbcDatabase): IO[Vector[(String, Int, String, String)]] = db.transaction(c =>
    Sql.rows(c, "SELECT item_id,position,tag,tag_folded FROM item_tag_values ORDER BY item_id COLLATE \"C\",position") { r =>
      (r.getString(1), r.getInt(2), r.getString(3), r.getString(4))
    })
  private def snapshot(db: JdbcDatabase): IO[Map[String, Vector[String]]] = db.transaction { c =>
    Vector("items", "item_revisions", "item_search", "item_tag_values", "write_requests").map { table =>
      table -> Sql.rows(c, s"SELECT row_to_json(t)::text FROM $table t ORDER BY row_to_json(t)::text")(_.getString(1))
    }.toMap
  }
  private def startupRepository(db: JdbcDatabase): PostgresItemRepository = {
    val policy = ProjectionPolicy("reviewed-tag-startup", true, Vector.empty, 4096)
    val shared = new HaystackRetrieval(db, policy, new PostgresRetrieval("haystack", None), None, 16)
    new PostgresItemRepository(db, Some(shared))
  }

  test("tag slots preserve repetition/order and exact ROOT fold; replay and replacement do not leave stale suggestions") { run(initializedDatabase.use { db =>
    val repo = new PostgresItemRepository(db)
    val original = Vector("zzneedle", "İzmir", "ΟΣ", "ΟΣΑ", "ＺＺwide", "ﬁxture", "𐐀name", "zzneedle")
    val operation = op(document = tagged(original))
    for {
      _ <- repo.commit(operation, Alice, Now)
      first <- tags(db)
      _ = assertEquals(first.map(r => (r._2, r._3, r._4)), Vector(
        (0, "zzneedle", "zzneedle"), (1, "İzmir", "i\u0307zmir"), (2, "ΟΣ", "ος"), (3, "ΟΣΑ", "οσα"),
        (4, "ＺＺwide", "ｚｚwide"), (5, "ﬁxture", "ﬁxture"), (6, "𐐀name", "𐐨name"), (7, "zzneedle", "zzneedle")))
      beforeReplay <- snapshot(db)
      replay <- repo.commit(operation, Alice, Later); _ = assert(replay.replayed)
      afterReplay <- snapshot(db); _ = assertEquals(afterReplay, beforeReplay)
      _ <- repo.commit(op(revision = 1L, document = tagged(Vector("zznew", "zznew"))), Bot, Later)
      updated <- tags(db); _ = assertEquals(updated, Vector(("a", 0, "zznew", "zznew"), ("a", 1, "zznew", "zznew")))
      suggestions <- repo.complete("tag:zz"); _ = assertEquals(suggestions, Vector("tag:zznew"))
      old <- repo.revision(operation.key, 1L); _ = assertEquals(old.get.document.tags, original)
      _ <- repo.commit(op(revision = 2L), Alice, Later)
      empty <- tags(db); _ = assertEquals(empty, Vector.empty)
      none <- repo.complete("tags:zz"); _ = assertEquals(none, Vector.empty)
    } yield ()
  }) }

  test("late replay-ledger failure rolls tag replacement back with item/history/search and preserves retry identity") { run(initializedDatabase.use { db =>
    val repo = new PostgresItemRepository(db)
    val replacement = op(revision = 1L, document = tagged(Vector("zznew", "İnew")))
    for {
      _ <- repo.commit(op(document = tagged(Vector("zzold", "ΟΣ", "zzold"))), Alice, Now)
      before <- snapshot(db)
      _ <- db.transaction { c =>
        Sql.update(c, "CREATE FUNCTION reject_test_tag_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic tag ledger failure'; END $$")
        Sql.update(c, "CREATE TRIGGER reject_test_tag_ledger BEFORE INSERT ON write_requests FOR EACH ROW EXECUTE FUNCTION reject_test_tag_ledger()")
      }
      _ <- (for {
        failure <- repo.commit(replacement, Bot, Later).attempt
        _ = assert(failure.left.toOption.exists(_.isInstanceOf[JdbcFailure]))
        after <- snapshot(db); _ = assertEquals(after, before)
        suggestions <- repo.complete("tag:zz"); _ = assertEquals(suggestions, Vector("tag:zzold"))
      } yield ()).guarantee(db.transaction { c =>
        Sql.update(c, "DROP TRIGGER reject_test_tag_ledger ON write_requests")
        Sql.update(c, "DROP FUNCTION reject_test_tag_ledger()")
        ()
      })
      retried <- repo.commit(replacement, Bot, Later); _ = assertEquals(retried.revision, 2L); _ = assert(!retried.replayed)
      suggestions <- repo.complete("tag:zz"); _ = assertEquals(suggestions, Vector("tag:zznew"))
    } yield ()
  }) }

  test("dense prefix completion does not hydrate authoritative document text or fall back to full documents") { run(initializedDatabase.use { db =>
    val repo = new PostgresItemRepository(db)
    val corpus = Vector.tabulate(140)(i => f"aa$i%03d") ++ Vector("zzneedle", "zz%literal", "zz_literal")
    for {
      _ <- corpus.grouped(64).toVector.zipWithIndex.traverse_ { case (values, i) => repo.commit(op(key = s"p:dense-$i", document = tagged(values)), Alice, Now).void }
      _ <- db.transaction(c => Sql.update(c, "UPDATE items SET document_text='deliberately unreadable synthetic current body'"))
      needle <- repo.complete("tag:zzn"); _ = assertEquals(needle, Vector("tag:zzneedle"))
      literalPercent <- repo.complete("tag:zz%"); _ = assertEquals(literalPercent, Vector("tag:\"zz%literal\""))
      literalUnderscore <- repo.complete("tags:zz_"); _ = assertEquals(literalUnderscore, Vector("tags:zz_literal"))
      injection <- repo.complete("tag:zz' OR 1=1 --"); _ = assertEquals(injection, Vector.empty)
    } yield ()
  }) }

  test("startup projection rebuild repairs missing/stale ROOT tags without rewriting authoritative rows") { run(emptyDatabase.evalTap(Migrations.initialize(_, Activity)).use { db =>
    val repo = new PostgresItemRepository(db)
    for {
      _ <- repo.commit(op(document = tagged(Vector("zzneedle", "İzmir", "zzneedle"))), Alice, Now)
      before <- snapshot(db)
      _ <- db.transaction { c =>
        Sql.update(c, "TRUNCATE item_tag_values")
        Sql.update(c, "INSERT INTO item_tag_values VALUES('p','a',0,'stale','stale')")
        Sql.update(c, "UPDATE item_search SET words=ARRAY['stale'],segments=ARRAY['stale']")
      }
      _ <- startupRepository(db).initializeProjection()
      repaired <- tags(db)
      _ = assertEquals(repaired, Vector(("a", 0, "zzneedle", "zzneedle"), ("a", 1, "İzmir", "i\u0307zmir"), ("a", 2, "zzneedle", "zzneedle")))
      suggestions <- repo.complete("tag:zz"); _ = assertEquals(suggestions, Vector("tag:zzneedle"))
      after <- snapshot(db)
      _ = assertEquals(after("items"), before("items")); _ = assertEquals(after("item_revisions"), before("item_revisions")); _ = assertEquals(after("write_requests"), before("write_requests"))
      _ <- startupRepository(db).initializeProjection()
      afterAgain <- snapshot(db); _ = assertEquals(afterAgain, after)
    } yield ()
  }) }

  test("startup tag insertion failure rolls back the item's search/tag repair on the same JDBC transaction") { run(emptyDatabase.evalTap(Migrations.initialize(_, Activity)).use { db =>
    val repo = new PostgresItemRepository(db)
    for {
      _ <- repo.commit(op(document = tagged(Vector("zznew"))), Alice, Now)
      _ <- db.transaction { c =>
        Sql.update(c, "UPDATE item_tag_values SET tag='stale',tag_folded='stale'")
        Sql.update(c, "UPDATE item_search SET words=ARRAY['stale'],segments=ARRAY['stale']")
        Sql.update(c, "CREATE FUNCTION reject_test_startup_tag() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic startup tag failure'; END $$")
        Sql.update(c, "CREATE TRIGGER reject_test_startup_tag BEFORE INSERT ON item_tag_values FOR EACH ROW WHEN (NEW.tag='zznew') EXECUTE FUNCTION reject_test_startup_tag()")
      }
      before <- snapshot(db)
      _ <- (for {
        failure <- startupRepository(db).initializeProjection().attempt
        _ = assert(failure.left.toOption.exists(_.isInstanceOf[JdbcFailure]))
        after <- snapshot(db); _ = assertEquals(after, before)
      } yield ()).guarantee(db.transaction { c =>
        Sql.update(c, "DROP TRIGGER reject_test_startup_tag ON item_tag_values")
        Sql.update(c, "DROP FUNCTION reject_test_startup_tag()")
        ()
      })
      _ <- startupRepository(db).initializeProjection()
      suggestions <- repo.complete("tag:zz"); _ = assertEquals(suggestions, Vector("tag:zznew"))
    } yield ()
  }) }
}
