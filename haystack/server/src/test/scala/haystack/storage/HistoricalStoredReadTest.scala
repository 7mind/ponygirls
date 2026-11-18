package haystack.storage

import cats.effect.IO
import cats.syntax.all.*
import haystack.domain.*
import haystack.retrieval.{HaystackRetrieval, ProjectionPolicy}
import ponygirls.retrieval.postgres.PostgresRetrieval
import ponygirls.runtime.JdbcDatabase
import TestSupport.*

/** Real PostgreSQL synthetic legacy rows. Payload bytes were acknowledged by
  * the actual old TS production validator/service (see fixture manifest), then
  * admitted by real JSONB here. No live reads, migrations or history rewrites.
  */
class HistoricalStoredReadTest extends ContractSuite {
  private def seed(db: JdbcDatabase, key: ItemKey, text: String): IO[Unit] = db.transaction { c =>
    Sql.update(c, """INSERT INTO items(project_id,item_id,revision,document,document_text,created_at,created_by,modified_at,modified_by)
      VALUES(?,?,2,?::jsonb,?,?,'historical-author',?,'historical-agent')""", key.project, key.item, text, text, Now, Later)
    Sql.update(c, """INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id)
      VALUES(?,?,1,?::jsonb,?,?,'historical-author','old-human-token')""", key.project, key.item, text, text, Now)
    Sql.update(c, """INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id)
      VALUES(?,?,2,?::jsonb,?,?,'historical-agent','old-agent-token')""", key.project, key.item, text, text, Later)
    ()
  }
  private def bytes(db: JdbcDatabase): IO[(Vector[String], Vector[String])] = db.transaction { c =>
    (Sql.rows(c, "SELECT row_to_json(i)::text FROM items i ORDER BY project_id,item_id")(_.getString(1)),
      Sql.rows(c, "SELECT row_to_json(r)::text FROM item_revisions r ORDER BY project_id,item_id,revision")(_.getString(1)))
  }
  HistoricalFixtures.values.filter(_.accepted).foreach { fixture =>
    test("acknowledged old JSONB/current/history round-trip without re-admission or byte changes: " + fixture.name) {
      run(initializedDatabase.use { db =>
        val repo = new PostgresItemRepository(db)
        val key = ItemKey("historical", fixture.name)
        val text = fixture.text
        for {
          _ <- seed(db, key, text)
          before <- bytes(db)
          current <- repo.current(key); first <- repo.revision(key, 1L); second <- repo.revision(key, 2L)
          _ = assertEquals(current.get.documentCanonical, text)
          _ = assertEquals(first.get.documentCanonical, text); _ = assertEquals(second.get.documentCanonical, text)
          _ = assertEquals(current.get.metadata, ItemMetadata(Now, "historical-author", Later, "historical-agent"))
          _ = assertEquals(first.get.metadata, ItemMetadata(Now, "historical-author", Now, "historical-author"))
          _ = assertEquals(current.get.document.title, "historical synthetic")
          _ = assertEquals(ponygirls.losslessjson.LosslessJson.encode(current.get.document.fields), ponygirls.losslessjson.LosslessJson.encode(first.get.document.fields))
          all <- repo.allCurrent(); _ = assertEquals(all.map(_.documentCanonical), Vector(text))
          history <- repo.history(key)
          _ = assertEquals(history, Vector(RevisionMeta(2L, Later, "historical-agent", "old-agent-token"), RevisionMeta(1L, Now, "historical-author", "old-human-token")))
          jsonb <- db.transaction { c =>
            (Sql.rows(c, "SELECT document=?::jsonb FROM items", Seq(text))(_.getBoolean(1)),
              Sql.rows(c, "SELECT document=?::jsonb FROM item_revisions ORDER BY revision", Seq(text))(_.getBoolean(1)))
          }
          _ = assertEquals(jsonb, (Vector(true), Vector(true, true)))
          afterReads <- bytes(db); _ = assertEquals(afterReads, before)
          // Replacing an old large document with a bounded new document creates
          // only a fresh revision. The old exact text and author labels survive.
          fresh <- repo.commit(op(key = key.qualified, revision = 2L, document = doc("new-after-historical")), Alice, Later.plusSeconds(1))
          _ = assertEquals(fresh.revision, 3L)
          preservedFirst <- repo.revision(key, 1L); preservedSecond <- repo.revision(key, 2L)
          _ = assertEquals(preservedFirst.get.documentCanonical, text); _ = assertEquals(preservedSecond.get.documentCanonical, text)
          _ = assertEquals(preservedFirst.get.metadata, first.get.metadata); _ = assertEquals(preservedSecond.get.metadata, second.get.metadata)
          persisted <- db.transaction(c => Sql.rows(c, "SELECT row_to_json(r)::text FROM item_revisions r WHERE revision<3 ORDER BY project_id,item_id,revision")(_.getString(1)))
          _ = assertEquals(persisted, before._2)
          newCurrent <- repo.current(key); _ = assertEquals(newCurrent.get.document.title, "new-after-historical")
        } yield ()
      })
    }
  }
  test("100000-digit coefficient is also admitted as a fresh real PostgreSQL write, never rounded/stringified") {
    val fixture = HistoricalFixtures.values.find(_.name == "coefficient-100000").get
    run(initializedDatabase.use { db =>
      val repo = new PostgresItemRepository(db)
      val operation = op(key = "historical:fresh-coefficient", document = fixture.text)
      for {
        first <- repo.commit(operation, Alice, Now); _ = assertEquals(first.revision, 1L)
        replay <- repo.commit(operation, Alice, Later); _ = assert(replay.replayed)
        current <- repo.current(operation.key); saved <- repo.revision(operation.key, 1L)
        _ = assertEquals(current.get.documentCanonical, fixture.text); _ = assertEquals(saved.get.documentCanonical, fixture.text)
        logical <- db.transaction(c => Sql.rows(c, "SELECT length((document->'fields'->'n')::text) FROM items")(_.getInt(1)).head)
        _ = assertEquals(logical, 100000)
      } yield ()
    })
  }
  test("leftover stored text outside the current codec is refused, bytes unchanged: over the envelope unavailable (as a write: bad-envelope), non-canonical link target invalid-document") {
    // The deleted wide read's shape: within the old validator's UTF-16 bound, over today's 1 MiB UTF-8 envelope.
    val wide = doc("wide", "{\"a\":\"" + "\u20ac" * 200000 + "\",\"b\":\"" + "\u20ac" * 200000 + "\"}")
    val badLink = doc("bad-link").replace("\"links\":[]", "\"links\":[[\"ref\",\"p:%FF\"]]")
    val wideKey = ItemKey("historical", "wide"); val badLinkKey = ItemKey("historical", "bad-link")
    run(emptyDatabase.use { db =>
      val repo = new PostgresItemRepository(db, Some(new HaystackRetrieval(db, ProjectionPolicy("leftover-test", true, Vector.empty, 4096), new PostgresRetrieval("haystack", None), None, 4)))
      for {
        _ <- Migrations.initialize(db, Activity)
        _ <- seed(db, wideKey, wide)
        before <- bytes(db)
        rejected <- IO(OperationEnvelope.accept(wideKey.qualified, wide, 2L, requestId())).attempt
        _ = assertEquals(rejected.left.toOption.collect { case f: Fault => f.code }, Some("bad-envelope"))
        _ <- expectFault(repo.current(wideKey), "unavailable")
        _ <- expectFault(repo.revision(wideKey, 1L), "unavailable")
        _ <- expectFault(repo.commit(op(key = wideKey.qualified, revision = 2L, document = doc("replacement")), Alice, Later), "unavailable")
        _ <- expectFault(repo.initializeProjection(), "unavailable")
        after <- bytes(db); _ = assertEquals(after, before)
        replayCount <- db.transaction(c => Sql.rows(c, "SELECT count(*) FROM write_requests")(_.getLong(1)).head)
        _ = assertEquals(replayCount, 0L)
        _ <- seed(db, badLinkKey, badLink)
        _ <- expectFault(repo.current(badLinkKey), "invalid-document")
        _ <- expectFault(repo.revision(badLinkKey, 2L), "invalid-document")
      } yield ()
    })
  }
}
