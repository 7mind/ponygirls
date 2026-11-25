package haystack.storage

import cats.effect.IO
import cats.syntax.all.*
import haystack.domain.{Principal, QualifiedId}
import haystack.query.SearchInput
import haystack.retrieval.{HaystackRetrieval, ProjectionPolicy}
import ponygirls.auth.{IndexingChoice, IndexingPolicy, IndexingPreferenceSql, IndexingService}
import ponygirls.retrieval.*
import ponygirls.retrieval.postgres.PostgresRetrieval
import ponygirls.runtime.JdbcDatabase
import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*
import TestSupport.*

/** Real owned PostgreSQL with the production projection and worker, synthetic content and embeddings only. */
class IndexingPreferencesTest extends ContractSuite {
  private val projection = ProjectionPolicy("indexing-preferences-test", true, Vector.empty, 4096)
  private val profile = Some(RetrievalProfile(EmbeddingSpace("synthetic-fixture", "v1", 3, false, "", "", "cosine"), projection.id))
  private val policy = IndexingPolicy(defaultEnabled = true, allowOptIn = true, allowOptOut = true)
  private val vector = List(1.0, 0.0, 0.0)
  private val creator = Principal("Créator/雪", "human", "creator-token")
  private val editor = Principal("Editör/雪", "human", "editor-token")

  private def retrieval(db: JdbcDatabase, inputs: ConcurrentLinkedQueue[String], scoped: Boolean = true): HaystackRetrieval = {
    val store = if (scoped) new PostgresRetrieval("haystack", profile, IndexingService.Haystack, policy)
      else new PostgresRetrieval("haystack", profile)
    val embedding = new EmbeddingClient {
      def documents(text: List[String]): IO[List[List[Double]]] = IO { text.foreach(inputs.add); text.map(_ => vector) }
      def query(text: String): IO[List[Double]] = IO.pure(vector)
    }
    new HaystackRetrieval(db, projection, store, Some(embedding), 4)
  }

  private def choose(db: JdbcDatabase, principal: Principal, choice: IndexingChoice): IO[Unit] = db.transaction { c =>
    IndexingPreferenceSql.store(c, IndexingService.Haystack, policy).setChoice(principal.userId, choice)
    ()
  }

  private def once(retrieval: HaystackRetrieval): IO[Boolean] =
    retrieval.worker(event => IO.raiseError(new AssertionError(event.line))).get.once

  private def page(retrieval: HaystackRetrieval, mode: RetrievalMode, ids: List[String], pending: Long): IO[RetrievalPage] =
    retrieval.search("witness", mode, Some("p"), false, 0, 10).map { result =>
      assertEquals((result.hits.map(_.id), result.total, result.pending), (ids, ids.size.toLong, pending))
      result
    }

  test("creator and current editor each veto content search, pending and document embedding, but not exact filters or writes") {
    run(emptyDatabase.use { db => for {
      _ <- Migrations.initialize(db, Activity)
      inputs = new ConcurrentLinkedQueue[String]()
      shared = retrieval(db, inputs)
      repo = new PostgresItemRepository(db, Some(shared), Some(policy))
      _ <- repo.initializeProjection()
      _ <- choose(db, creator, IndexingChoice.Disable)
      _ <- repo.commit(op("p:creator", document = doc("witness creator")), creator, Now)
      _ <- repo.commit(op("p:creator", 1L, doc("witness creator edited")), Alice, Later)
      _ <- repo.commit(op("p:editor", document = doc("witness editor original")), Alice, Now)
      _ <- repo.commit(op("p:editor", 1L, doc("witness editor", """{"body":"exact-only phrase"}""")), editor, Later)
      _ <- choose(db, editor, IndexingChoice.Disable)
      // The genuine authors are enabled. These document fields are only data, not authoritative ownership.
      _ <- repo.commit(op("p:allowed", document = doc("witness allowed", s"""{"createdBy":"${creator.userId}","modifiedBy":"${editor.userId}"}""")), Alice, Now)
      _ <- page(shared, RetrievalMode.Semantic, Nil, 1L)
      processed <- once(shared); _ = assert(processed)
      more <- once(shared); _ = assert(!more)
      _ = assertEquals(inputs.asScala.toList.sorted, List("d", "witness allowed"))
      _ <- List(RetrievalMode.Lexical, RetrievalMode.Semantic, RetrievalMode.Hybrid).traverse_(mode => page(shared, mode, List("p:allowed"), 0L))
      text <- repo.search(SearchInput("witness"))
      _ = assertEquals(text.items.map(_.item), Vector("allowed"))
      browse <- repo.search(SearchInput("""field["/body"] = "exact-only phrase""""))
      _ = assertEquals(browse.items.map(i => (i.item, i.revision)), Vector("editor" -> 2L))
      history <- repo.history(QualifiedId.decodeKey("p:editor"))
      _ = assertEquals(history.map(_.modifiedBy), Vector(editor.userId, Alice.userId))
    } yield () })
  }

  test("startup attributes an older publication to its exact revision author, retains it hidden, and rechecks pinned hits") {
    run(emptyDatabase.use { db => for {
      _ <- Migrations.initialize(db, Activity)
      key = QualifiedId.decodeKey("p:caf%C3%A9%3Anote")
      inputs = new ConcurrentLinkedQueue[String]()
      legacy = retrieval(db, inputs, scoped = false)
      items = new PostgresItemRepository(db)
      _ <- legacy.initialize(Vector.empty)
      _ <- items.commit(op(key.qualified, document = doc("witness first")), creator, Now)
      _ <- items.commit(op(key.qualified, 1L, doc("witness prior")), editor, Later)
      prior <- items.current(key).map(_.get)
      _ <- db.transaction(c => legacy.store.put(c, legacy.project(prior).copy(owners = Set.empty)))
      processed <- once(legacy); _ = assert(processed)
      old <- page(legacy, RetrievalMode.Semantic, List(key.qualified), 0L).map(_.hits.head)
      _ <- items.commit(op(key.qualified, 2L, doc("witness current")), Alice, Later)
      current <- items.current(key).map(_.get)
      _ <- db.transaction(c => legacy.store.put(c, legacy.project(current).copy(owners = Set.empty)))
      _ <- choose(db, editor, IndexingChoice.Disable)
      shared = retrieval(db, inputs)
      repo = new PostgresItemRepository(db, Some(shared))
      _ <- repo.initializeProjection()
      _ <- page(shared, RetrievalMode.Lexical, List(key.qualified), 0L)
      _ <- page(shared, RetrievalMode.Semantic, Nil, 1L)
      _ <- page(shared, RetrievalMode.Hybrid, Nil, 1L)
      _ <- choose(db, editor, IndexingChoice.Inherit)
      restored <- page(shared, RetrievalMode.Semantic, List(key.qualified), 1L).map(_.hits.head)
      _ = assertEquals((restored.version, restored.generation, restored.chunk), (s"2/${projection.id}", old.generation, old.chunk))
      republished <- once(shared); _ = assert(republished)
      query = RetrievalQuery("authenticated", "witness", RetrievalMode.Semantic, Vector.empty, false, 0, 10, EpochSeconds.fromInstant(Now))
      _ <- choose(db, editor, IndexingChoice.Disable)
      pinned <- db.transaction(c => shared.store.visible(c, query, restored))
      _ = assert(!pinned)
      fresh <- page(shared, RetrievalMode.Semantic, List(key.qualified), 0L).map(_.hits.head)
      _ = assertEquals(fresh.version, s"3/${projection.id}")
    } yield () })
  }

  test("startup never substitutes the latest author when a legacy publication has no matching history") {
    run(emptyDatabase.use { db => for {
      _ <- Migrations.initialize(db, Activity)
      key = QualifiedId.decodeKey("p:a")
      inputs = new ConcurrentLinkedQueue[String]()
      legacy = retrieval(db, inputs, scoped = false)
      items = new PostgresItemRepository(db)
      _ <- legacy.initialize(Vector.empty)
      _ <- items.commit(op(key.qualified, document = doc("witness prior")), creator, Now)
      prior <- items.current(key).map(_.get)
      _ <- db.transaction(c => legacy.store.put(c, legacy.project(prior).copy(owners = Set.empty)))
      processed <- once(legacy); _ = assert(processed)
      _ <- items.commit(op(key.qualified, 1L, doc("witness current")), Alice, Later)
      // Model an incomplete legacy history while leaving the retained generation and authoritative head intact.
      _ <- db.transaction(c => Sql.update(c, "DELETE FROM item_revisions WHERE project_id = ? AND item_id = ? AND revision = 1", key.project, key.item))
      shared = retrieval(db, inputs)
      _ <- new PostgresItemRepository(db, Some(shared)).initializeProjection()
      _ <- page(shared, RetrievalMode.Lexical, List(key.qualified), 0L)
      _ <- page(shared, RetrievalMode.Semantic, Nil, 1L)
      refreshed <- once(shared); _ = assert(refreshed)
      fresh <- page(shared, RetrievalMode.Semantic, List(key.qualified), 0L).map(_.hits.head)
      _ = assertEquals(fresh.version, s"2/${projection.id}")
    } yield () })
  }
}
