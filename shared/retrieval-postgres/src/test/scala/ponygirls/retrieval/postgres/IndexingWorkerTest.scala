package ponygirls.retrieval.postgres

import ponygirls.retrieval.*
import cats.effect.{Deferred,IO}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import java.sql.Connection
import java.time.Instant
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.{AtomicInteger,AtomicReference}
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

/** Retry clock advanced by the test; nothing sleeps for a back-off. */
private[postgres] final class ManualClock(start: Instant) {
  private val current=new AtomicReference(start)
  val now: IO[Instant] = IO(current.get)
  def advance(by: FiniteDuration): Unit = current.updateAndGet(_.plusNanos(by.toNanos))
}

class IndexingWorkerTest extends munit.FunSuite {
  import ControlledFixtures.*
  private val start=Instant.parse("2030-01-01T00:00:00Z")
  private def transactions(f: PgFixture,active: AtomicInteger): RetrievalTransactions = new RetrievalTransactions {
    def transaction[A](run: Connection => A): IO[A] = IO.uncancelable(_ => IO.blocking {
      active.incrementAndGet()
      try f.tx(run) finally active.decrementAndGet()
    })
  }
  private def recorded(events: ConcurrentLinkedQueue[IndexingEvent]): IndexingEvent => IO[Unit] = event => IO(events.add(event)).void
  test("Blackbox-GoodCommunication: retry reuses accepted batch and model calls never hold a transaction") {
    val f=new PgFixture(Some(profile)); val active=new AtomicInteger(); val calls=new AtomicInteger()
    val clock=new ManualClock(start); val events=new ConcurrentLinkedQueue[IndexingEvent]()
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
    val worker=new IndexingWorker(f.index,transactions(f,active),embedder,1,30,100.millis,clock.now,recorded(events))
    assert(worker.once.attempt.unsafeRunSync().isLeft)
    assertEquals(calls.get(),2)
    assertEquals(events.asScala.toList,List(IndexingEvent.AttemptFailed(f.index.namespace,"one",1,Some(start.plusSeconds(2)),"model-http")))
    clock.advance(PostgresRetrieval.RetryBase)
    assertEquals(worker.once.unsafeRunSync(),true)
    assertEquals(calls.get(),3) // NOT four: the first accepted provider response was reused.
    assertEquals(worker.once.unsafeRunSync(),false)
    assertEquals(f.store.search(query(RetrievalMode.Semantic)).total,1L)
  }
  test("Blackbox-GoodCommunication: cancellation requeues work without losing accepted batches") {
    val f=new PgFixture(Some(profile)); val active=new AtomicInteger(); val calls=new AtomicInteger()
    val clock=new ManualClock(start); val events=new ConcurrentLinkedQueue[IndexingEvent]()
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
      worker = new IndexingWorker(f.index,transactions(f,active),embedder,1,30,100.millis,clock.now,recorded(events))
      fiber <- worker.once.start
      _ <- second.get
      _ <- fiber.cancel
      _ <- IO(clock.advance(PostgresRetrieval.RetryBase))
      _ <- worker.once
      _ <- IO { assertEquals(calls.get(),3); assertEquals(f.store.search(query(RetrievalMode.Semantic)).total,1L) }
    } yield ()).timeout(10.seconds).unsafeRunSync()
    assertEquals(events.asScala.toList.collect { case e: IndexingEvent.AttemptFailed => e.code },List("cancelled"))
  }
  test("Blackbox-GoodCommunication: heartbeat keeps a finite lease alive across a slow controlled model call") {
    val f=new PgFixture(Some(profile)); val active=new AtomicInteger()
    f.store.put(source("one","alpha",Set("reader")))
    val embedder=new EmbeddingClient {
      def documents(text: List[String]): IO[List[List[Double]]] = IO(assertEquals(active.get(),0)) *> IO.sleep(4.seconds).as(List(List(1.0,0.0,0.0)))
      def query(text: String): IO[List[Double]] = IO.raiseError(new AssertionError("not a query"))
    }
    val worker=new IndexingWorker(f.index,transactions(f,active),embedder,1,3,100.millis,IO.realTimeInstant,_ => IO.unit)
    assertEquals(worker.once.timeout(10.seconds).unsafeRunSync(),true)
    assertEquals(f.store.search(query(RetrievalMode.Semantic)).total,1L)
  }
  test("R1: five failed embeddings, then a recovered embedder: the job backs off, is never terminal, and publishes") {
    val f=new PgFixture(Some(profile)); val calls=new AtomicInteger()
    val clock=new ManualClock(start); val events=new ConcurrentLinkedQueue[IndexingEvent]()
    f.store.put(source("one","alpha",Set("reader")))
    val embedder=new EmbeddingClient {
      def documents(text: List[String]): IO[List[List[Double]]] = IO(calls.incrementAndGet()).flatMap { n =>
        if(n<=5) IO.raiseError(RetrievalError("model-http","controlled fixture outage")) else IO.pure(List(List(1.0,0.0,0.0)))
      }
      def query(text: String): IO[List[Double]] = IO.raiseError(new AssertionError("not a query"))
    }
    val worker=new IndexingWorker(f.index,transactions(f,new AtomicInteger()),embedder,1,30,100.millis,clock.now,recorded(events))
    (1 to 5).foreach { attempt =>
      assert(worker.once.attempt.unsafeRunSync().isLeft)
      assertEquals(worker.once.unsafeRunSync(),false) // not due before its back-off
      clock.advance(PostgresRetrieval.retryDelay(attempt))
    }
    assertEquals(worker.once.unsafeRunSync(),true)
    val page=f.store.search(query(RetrievalMode.Semantic))
    assertEquals((page.hits.map(_.id),page.pending),(List("one"),0L))
    assertEquals(events.asScala.toList.collect { case IndexingEvent.AttemptFailed(_,source,attempt,Some(_),code) => (source,attempt,code) },(1 to 5).toList.map(n => ("one",n,"model-http")))
  }
  test("K1: the worker processes queued sources back to back; pollInterval only applies when idle or after a failure") {
    val f=new PgFixture(Some(profile)); val calls=new AtomicInteger()
    f.store.put(source("one","alpha",Set("reader"))); f.store.put(source("two","alpha",Set("reader")))
    (for {
      second <- Deferred[IO,Unit]
      embedder = new EmbeddingClient {
        def documents(text: List[String]): IO[List[List[Double]]] = IO(calls.incrementAndGet()).flatMap {
          case 1 => IO.pure(List(List(1.0,0.0,0.0)))
          case _ => second.complete(()) *> IO.never
        }
        def query(text: String): IO[List[Double]] = IO.raiseError(new AssertionError("not a query"))
      }
      worker = new IndexingWorker(f.index,transactions(f,new AtomicInteger()),embedder,1,30,1.hour,IO.realTimeInstant,_ => IO.unit)
      _ <- IO.race(worker.run,second.get).timeout(20.seconds)
    } yield ()).unsafeRunSync()
    val page=f.store.search(query(RetrievalMode.Semantic))
    assertEquals((page.hits.map(_.id),page.pending),(List("one"),1L))
  }
}
