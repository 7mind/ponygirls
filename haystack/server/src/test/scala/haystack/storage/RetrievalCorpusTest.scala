package haystack.storage

import cats.effect.IO
import haystack.retrieval.{HaystackRetrieval, ProjectionPolicy}
import ponygirls.retrieval.*
import ponygirls.retrieval.postgres.PostgresRetrieval
import ponygirls.runtime.JdbcDatabase
import java.util.concurrent.ConcurrentLinkedQueue
import scala.jdk.CollectionConverters.*
import TestSupport.*

/** Blackbox-GoodCommunication: the production corpus policy through the actual shared worker, and the typed query-time
  * unavailable reasons of `HaystackRetrieval.search`. Controlled embedding client; no model or network. */
class RetrievalCorpusTest extends ContractSuite {
  private val space = EmbeddingSpace("synthetic-fixture", "v1", 3, false, "", "", "cosine")
  // The production values: includeMetadata true, no approved field prefixes.
  private val production = ProjectionPolicy("operator-approved-metadata-v1", true, Vector.empty, 8192)
  private val vector = List(1.0, 0.0, 0.0)
  private def retrieval(db: JdbcDatabase, embedding: Option[EmbeddingClient]): HaystackRetrieval =
    new HaystackRetrieval(db, production, new PostgresRetrieval("haystack", embedding.map(_ => RetrievalProfile(space, production.id))), embedding, 4)

  test("H1: with the production policy the worker embeds title, description and tags only, never fields") {
    val inputs = new ConcurrentLinkedQueue[String]()
    val capturing = new EmbeddingClient {
      def documents(text: List[String]): IO[List[List[Double]]] = IO { text.foreach(inputs.add); text.map(_ => vector) }
      def query(text: String): IO[List[Double]] = IO.pure(vector)
    }
    run(emptyDatabase.use { db => for {
      _ <- Migrations.initialize(db, Activity)
      shared = retrieval(db, Some(capturing))
      _ <- shared.initialize(Vector.empty)
      fields = """{"top":"FIELD-CANARY-TOP","nested":{"deep":["FIELD-CANARY-NESTED"]}}"""
      _ <- new PostgresItemRepository(db, Some(shared)).commit(op(document = doc("corpus title", fields, ""","tags":["first tag","second tag"]""")), Alice, Now)
      worker = shared.worker(_ => IO.unit).get
      _ <- worker.once.iterateWhile(identity)
      page <- shared.search("corpus", RetrievalMode.Semantic, Some("p"), false, 0, 10)
    } yield {
      assertEquals(inputs.asScala.toList.sorted, List("corpus title", "d", "first tag", "second tag"))
      assertEquals((page.hits.map(_.id), page.pending), (List("p:a"), 0L))
    } })
  }

  test("U1: a failed query embedding is embedding-failed and an absent embedding is not-configured, never provider text") {
    val failing = new EmbeddingClient {
      def documents(text: List[String]): IO[List[List[Double]]] = IO.pure(text.map(_ => vector))
      def query(text: String): IO[List[Double]] = IO.raiseError(RetrievalError("model-http", "model returned HTTP 503"))
    }
    def reason(result: Either[Throwable, RetrievalPage]): Option[UnavailableReason] = result match {
      case Left(e: RetrievalError) if e.code == "unavailable" => e.reason
      case other => fail("expected typed unavailable, got " + other)
    }
    run(emptyDatabase.use { db => for {
      _ <- Migrations.initialize(db, Activity)
      failed <- retrieval(db, Some(failing)).search("anything", RetrievalMode.Hybrid, None, false, 0, 10).attempt
      absent <- retrieval(db, None).search("anything", RetrievalMode.Semantic, None, false, 0, 10).attempt
    } yield assertEquals((reason(failed), reason(absent)), (Some(UnavailableReason.EmbeddingFailed), Some(UnavailableReason.NotConfigured))) })
  }
}
