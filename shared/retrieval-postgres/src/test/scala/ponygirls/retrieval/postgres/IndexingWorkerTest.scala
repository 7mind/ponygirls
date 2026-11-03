package ponygirls.retrieval.postgres

import ponygirls.retrieval.*
import cats.effect.{Deferred,IO}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import java.sql.Connection
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.*

class IndexingWorkerTest extends munit.FunSuite {
  import ControlledFixtures.*
  private def transactions(f: PgFixture,active: AtomicInteger): RetrievalTransactions = new RetrievalTransactions {
    def transaction[A](run: Connection => A): IO[A] = IO.uncancelable(_ => IO.blocking {
      active.incrementAndGet()
      try f.tx(run) finally active.decrementAndGet()
    })
  }
  test("Blackbox-GoodCommunication: retry reuses accepted batch and model calls never hold a transaction") {
    val f=new PgFixture(Some(profile)); val active=new AtomicInteger(); val calls=new AtomicInteger()
    f.store.put(source("one","alpha",Set("reader")).copy(chunks=List(InputChunk("a","alpha first",provenance),InputChunk("b","alpha second",provenance))))
    val embedder=new EmbeddingClient {
      def documents(text: List[String]): IO[List[List[Double]]] = IO {
        assertEquals(active.get(),0)
        val n=calls.incrementAndGet()
        if(n==2) throw RetrievalError("model-http","controlled fixture outage")
        List(List(1.0,0.0,0.0))
      }
      def query(text: String): IO[List[Double]] = IO.raiseError(new AssertionError("worker must not embed queries"))
    }
    val worker=new IndexingWorker(f.index,transactions(f,active),embedder,1,30,100.millis)
    assert(worker.once.attempt.unsafeRunSync().isLeft)
    assertEquals(calls.get(),2)
    assertEquals(worker.once.unsafeRunSync(),true)
    assertEquals(calls.get(),3) // NOT four: the first accepted provider response was reused.
    assertEquals(worker.once.unsafeRunSync(),false)
    assertEquals(f.store.search(query(RetrievalMode.Semantic)).total,1L)
  }
  test("Blackbox-GoodCommunication: cancellation requeues work without losing accepted batches") {
    val f=new PgFixture(Some(profile)); val active=new AtomicInteger(); val calls=new AtomicInteger()
    f.store.put(source("one","alpha",Set("reader")).copy(chunks=List(InputChunk("a","alpha first",provenance),InputChunk("b","alpha second",provenance))))
    (for {
      second <- Deferred[IO,Unit]
      embedder = new EmbeddingClient {
        def documents(text: List[String]): IO[List[List[Double]]] = IO(assertEquals(active.get(),0)) *> IO(calls.incrementAndGet()).flatMap {
          case 2 => second.complete(()).void *> IO.never
          case _ => IO.pure(List(List(1.0,0.0,0.0)))
        }
        def query(text: String): IO[List[Double]] = IO.raiseError(new AssertionError("not a query"))
      }
      worker = new IndexingWorker(f.index,transactions(f,active),embedder,1,30,100.millis)
      fiber <- worker.once.start
      _ <- second.get
      _ <- fiber.cancel
      _ <- worker.once
      _ <- IO { assertEquals(calls.get(),3); assertEquals(f.store.search(query(RetrievalMode.Semantic)).total,1L) }
    } yield ()).timeout(10.seconds).unsafeRunSync()
  }
  test("Blackbox-GoodCommunication: heartbeat keeps a finite lease alive across a slow controlled model call") {
    val f=new PgFixture(Some(profile)); val active=new AtomicInteger()
    f.store.put(source("one","alpha",Set("reader")))
    val embedder=new EmbeddingClient {
      def documents(text: List[String]): IO[List[List[Double]]] = IO(assertEquals(active.get(),0)) *> IO.sleep(4.seconds).as(List(List(1.0,0.0,0.0)))
      def query(text: String): IO[List[Double]] = IO.raiseError(new AssertionError("not a query"))
    }
    val worker=new IndexingWorker(f.index,transactions(f,active),embedder,1,3,100.millis)
    assertEquals(worker.once.timeout(10.seconds).unsafeRunSync(),true)
    assertEquals(f.store.search(query(RetrievalMode.Semantic)).total,1L)
  }
}
