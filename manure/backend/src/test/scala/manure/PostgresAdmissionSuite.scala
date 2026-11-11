package manure

import cats.effect.{Deferred,FiberIO,IO,Resource}
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import java.sql.{Connection,DriverManager}
import java.nio.file.Files
import java.util.concurrent.{ConcurrentLinkedQueue,CountDownLatch,TimeUnit}
import java.util.concurrent.atomic.AtomicBoolean
import scala.jdk.CollectionConverters.*
import scala.concurrent.duration.*
import scala.util.Using
import munit.FunSuite

/** Real-adapter-only lock/isolation contracts. The raw JDBC lock holder and
  * observer use only THIS disposable fixture's least-privilege runtime role,
  * under its retained physical-root claim. They deliberately do NOT enter the
  * shared JVM root monitor: otherwise a Java FIFO could fake a PG lock proof.
  */
final class PostgresAdmissionSuite extends FunSuite:
  private def run(body: BackendFixture => IO[Unit]): Unit = BackendFixture.resource(true).use(body).unsafeRunSync()
  private def runtimeConnection(f: BackendFixture): Resource[IO,Connection] = Resource.make(IO.blocking {
    val cfg=f.config.database
    val password=Files.readString(cfg.passwordFile).stripSuffix("\n")
    DriverManager.getConnection(cfg.jdbcUrl,cfg.user,password)
  })(c => IO.blocking(c.close()))
  private def request(size: Int): InitUpload = InitUpload("reservation",ArtifactKind.File,Visibility.Internal,
    Vector(ManifestEntry("file",false,size,SecretCodec.sha256(Array.fill[Byte](size)(0)))),None,Vector.empty,None,None)
  private def successes[A](results: Vector[Either[Throwable,A]],count: Int,code: String): Unit =
    assertEquals(results.count(_.isRight),count)
    assertEquals(results.collect { case Left(e: DomainError) => e.code },Vector.fill(results.size-count)(code))
  private final class Window(label: String):
    private val entered = new CountDownLatch(1)
    private val released = new CountDownLatch(1)
    def hold(): Unit =
      entered.countDown()
      // Evaluate the blocking wait OUTSIDE munit's by-name assertion lock.
      val opened=released.await(5,TimeUnit.SECONDS)
      assert(opened,label+" release timed out")
    def await: IO[Unit] = IO.blocking {
      val observed=entered.await(5,TimeUnit.SECONDS)
      assert(observed,label+" window was not reached")
    }
    def release(): Unit = released.countDown()
  private def fiber[A](work: IO[A],windows: Window*): Resource[IO,FiberIO[A]] = Resource.make(work.start) { running =>
    IO.blocking(windows.foreach(_.release())) *> running.join.timeout(3.seconds).void.guarantee(running.cancel.timeout(3.seconds))
  }
  private case class Observation(kind: String,a: Artifact)
  /** Transparent real-adapter instrumentation. The only blocking page hook is
    * AFTER transaction completion, never while holding JDBC/root/process gate.
    */
  private final class SweepTrace(f: BackendFixture,page: Window):
    private val first = new AtomicBoolean(true)
    val events = new ConcurrentLinkedQueue[Observation]
    val metadata: Metadata = new Metadata:
      def transaction[A](body: MetadataTxn => A): IO[A] =
        var pauseAfterCommit = false
        f.metadata.transaction { tx =>
          val observed = new MetadataTxn:
            def artifact(id: String): Option[Artifact] =
              val result=tx.artifact(id);result.foreach(a => events.add(Observation("read",a)));result
            def artifacts(after: Option[String],limit: Int): Vector[Artifact] =
              val result=tx.artifacts(after,limit)
              result.foreach(a => events.add(Observation("page",a)))
              if first.compareAndSet(true,false) then pauseAfterCommit=true
              result
            def catalogue(s: CataloguePolicy.Selection): Vector[Artifact] = tx.catalogue(s)
            def put(a: Artifact): Unit = tx.put(a)
            def delete(id: String): Unit = tx.delete(id)
            def externalPassword(id: String): Option[ExternalPasswordSecret] = tx.externalPassword(id)
            def putExternalPassword(id: String,password: Option[ExternalPasswordSecret]): Unit = tx.putExternalPassword(id,password)
            def reservation: Long = tx.reservation
            def sessions(u: Option[String]): Long = tx.sessions(u)
            def receipts(id: String,path: String): Vector[Receipt] = tx.receipts(id,path)
            def putReceipt(r: Receipt): Unit = tx.putReceipt(r)
            def deleteReceipt(id: String,path: String,offset: Long): Unit = tx.deleteReceipt(id,path,offset)
            def clearReceipts(id: String): Unit = tx.clearReceipts(id)
            def oneTime(h: String): Option[OneTimeGrant] = tx.oneTime(h)
            def putOneTime(g: OneTimeGrant): Unit = tx.putOneTime(g)
            def content(h: String): Option[ContentGrant] = tx.content(h)
            def putContent(g: ContentGrant): Unit = tx.putContent(g)
            def deleteContent(h: String): Unit = tx.deleteContent(h)
            def trimContent(id: String,max: Int,newest: String): Unit = tx.trimContent(id,max,newest)
            def revokeArtifact(id: String): Unit = tx.revokeArtifact(id)
            def revokeCredential(user: String,token: String): Unit = tx.revokeCredential(user,token)
            def sweepGrants(now: Double): Unit = tx.sweepGrants(now)
          body(observed)
        }.flatTap(_ => if pauseAfterCommit then IO.blocking(page.hold()) else IO.unit)
  private def revalidated(trace: SweepTrace,id: String,old: Double,fresh: Double,state: UploadState): Unit =
    val events=trace.events.iterator().asScala.toVector.filter(_.a.id==id)
    val snapshot=events.indexWhere(e => e.kind=="page" && e.a.state==UploadState.Uploading && e.a.lastActivityAt==old)
    val reread=events.indexWhere(e => e.kind=="read" && e.a.state==state && e.a.lastActivityAt==fresh)
    assert(snapshot>=0,"sweep did not capture the actual stale page")
    assert(reread>snapshot,"sweep did not re-read fresh state/activity after the gate wait")

  test("real PG sweep revalidates stale idle page after durable receipt commit and actual advisory wait") { run { f =>
    val page=new Window("receipt-page");val receiptWindow=new Window("receipt-tx")
    val trace=new SweepTrace(f,page)
    runtimeConnection(f).use { observer => runtimeConnection(f).use { reader => for
      gate <- Semaphore[IO](1L)
      service = new Artifacts(trace.metadata,f.payloads,f.config.limits,f.clock,f.auth,f.lease,gate,f.faults)
      a <- service.init(f.identity,request(4))
      old=a.artifact.lastActivityAt
      _ <- IO { f.clock.now=old+f.config.limits.incompleteSessionTtl+1;f.faults.observe=w => if w=="before_receipt_commit" then receiptWindow.hold() }
      fresh=f.clock.now
      done <- Deferred[IO,Unit]
      _ <- fiber(service.sweep().guarantee(done.complete(()).void),page,receiptWindow).use { sweep => for
        _ <- page.await // Recorded stale source snapshot; its SQL transaction is CLOSED.
        _ <- fiber(service.putChunk(f.identity,a.artifact.id,"file",0,Array.fill[Byte](4)(0),SecretCodec.sha256(Array.fill[Byte](4)(0))),page,receiptWindow).use { receipt => for
          _ <- receiptWindow.await
          _ <- IO.blocking {
            val committed=Jdbc.rows(observer,"SELECT last_activity_at_value,(SELECT count(*) FROM manure.receipts) FROM manure.artifacts WHERE id=?",Exact.utf8(a.artifact.id))(r => (r.getDouble(1),r.getLong(2))).head
            assertEquals(committed,(old,0L)) // Bytes durable; activity+receipt still uncommitted.
            assertEquals(Files.readAllBytes(f.rootPath.resolve("staging").resolve(a.artifact.id).resolve("tree/file")).toVector,Vector.fill[Byte](4)(0))
            reader.setAutoCommit(false)
          }
          pid <- IO.blocking(Jdbc.rows(reader,"SELECT pg_backend_pid()")(_.getInt(1)).head)
          _ <- IO.blocking(page.release())
          _ <- fiber(IO.blocking {
            // Independent raw runtime callback under the retained physical-root
            // claim, bypassing ONLY the Java monitor. Its SQL lock wait is real;
            // the sweep itself is deliberately queued on the process gate.
            Jdbc.exec(reader,"SELECT pg_advisory_xact_lock(714159263)")
            val actual=new PostgresTxn(reader,f.projection.get).artifact(a.artifact.id).get
            reader.commit();actual
          },page,receiptWindow).use { raw => for
            _ <- {
              def waiting: IO[Unit] = IO.blocking(Jdbc.rows(observer,"SELECT wait_event_type='Lock' AND wait_event='advisory' FROM pg_stat_activity WHERE pid=?",pid)(_.getBoolean(1)).headOption.contains(true))
                .flatMap(found => if found then IO.unit else IO.sleep(10.millis) *> waiting)
              waiting.timeout(3.seconds)
            }
            _ <- done.tryGet.flatMap(value => IO(assertEquals(value,None)))
            _ <- IO.blocking(receiptWindow.release())
            acknowledged <- receipt.joinWithNever.timeout(3.seconds)
            observed <- raw.joinWithNever.timeout(3.seconds)
            _ <- IO { assertEquals(acknowledged,4L);assertEquals(observed.lastActivityAt,fresh) }
          yield () }
        yield () }
        removed <- sweep.joinWithNever.timeout(3.seconds)
        _ <- IO { assertEquals(removed,0);revalidated(trace,a.artifact.id,old,fresh,UploadState.Uploading) }
        stored <- f.metadata.transaction(tx => (tx.artifact(a.artifact.id).get,tx.receipts(a.artifact.id,"file"),tx.reservation))
        _ <- IO {
          assertEquals(stored._1.lastActivityAt,fresh);assertEquals(stored._2,Vector(Receipt(a.artifact.id,"file",0,4,SecretCodec.sha256(Array.fill[Byte](4)(0)))));assertEquals(stored._3,4L)
          assertEquals(Files.readAllBytes(f.rootPath.resolve("staging").resolve(a.artifact.id).resolve("tree/file")).toVector,Vector.fill[Byte](4)(0))
        }
      yield () }.guarantee(IO {page.release();receiptWindow.release();f.faults.observe=_ => ()})
    yield () }}
  }}

  test("real PG sweep revalidates stale idle page across P2-to-P5 process gate without a long SQL transaction") { run { f =>
    val page=new Window("publish-page");val publishWindow=new Window("publish-phase")
    val trace=new SweepTrace(f,page)
    runtimeConnection(f).use { observer => for
      gate <- Semaphore[IO](1L)
      service = new Artifacts(trace.metadata,f.payloads,f.config.limits,f.clock,f.auth,f.lease,gate,f.faults)
      a <- service.init(f.identity,request(4))
      _ <- service.putChunk(f.identity,a.artifact.id,"file",0,Array.fill[Byte](4)(0),SecretCodec.sha256(Array.fill[Byte](4)(0)))
      old=f.clock.now
      _ <- IO { f.clock.now=old+f.config.limits.incompleteSessionTtl+1;f.faults.observe=w => if w=="after_publishing_commit" then publishWindow.hold() }
      fresh=f.clock.now
      done <- Deferred[IO,Unit]
      _ <- fiber(service.sweep().guarantee(done.complete(()).void),page,publishWindow).use { sweep => for
        _ <- page.await
        _ <- fiber(service.finish(f.identity,a.artifact.id),page,publishWindow).use { publish => for
          _ <- publishWindow.await
          _ <- IO.blocking {
            val row=Jdbc.rows(observer,"SELECT state,last_activity_at_value FROM manure.artifacts WHERE id=?",Exact.utf8(a.artifact.id))(r => (Exact.string(r.getBytes(1)),r.getDouble(2))).head
            assertEquals(row,("publishing",old)) // P2 committed; NOT successful request activity.
            val open=Jdbc.rows(observer,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND pid<>pg_backend_pid() AND xact_start IS NOT NULL")(_.getLong(1)).head
            assertEquals(open,0L) // Paused page callback committed, publish SQL ended.
            observer.setAutoCommit(false)
            assert(Jdbc.rows(observer,"SELECT pg_try_advisory_xact_lock(714159263)")(_.getBoolean(1)).head)
            assertEquals(new PostgresTxn(observer,f.projection.get).artifact(a.artifact.id).get.state,UploadState.Publishing)
            observer.commit();observer.setAutoCommit(true)
          }
          _ <- IO.blocking(page.release())
          _ <- done.tryGet.flatMap(value => IO(assertEquals(value,None)))
          _ <- IO.blocking(publishWindow.release())
          ready <- publish.joinWithNever.timeout(3.seconds)
          _ <- IO {assertEquals(ready.state,UploadState.Ready);assertEquals(ready.lastActivityAt,fresh)}
        yield () }
        removed <- sweep.joinWithNever.timeout(3.seconds)
        _ <- IO {assertEquals(removed,0);revalidated(trace,a.artifact.id,old,fresh,UploadState.Ready)}
        stored <- f.metadata.transaction(tx => (tx.artifact(a.artifact.id).get,tx.receipts(a.artifact.id,"file"),tx.reservation))
        _ <- IO {
          assertEquals(stored._1.state,UploadState.Ready);assertEquals(stored._1.lastActivityAt,fresh);assertEquals(stored._2,Vector.empty);assertEquals(stored._3,4L)
          assertEquals(Files.readAllBytes(f.rootPath.resolve("live").resolve(a.artifact.id).resolve("file")).toVector,Vector.fill[Byte](4)(0))
        }
      yield () }.guarantee(IO {page.release();publishWindow.release();f.faults.observe=_ => ()})
    yield () }
  }}
  test("concurrent PostgreSQL admissions reserve exactly the quota-fitting subset") {
    BackendFixture.resource(true,quota=10).use { f => for
      results <- Vector.fill(16)(()).parTraverse(_ => f.artifacts.init(f.identity,request(4)).attempt)
      _ <- IO(successes(results,2,"quota-exceeded"))
      reserved <- f.metadata.transaction(_.reservation)
      sessions <- f.metadata.transaction(_.sessions(None))
      _ <- IO { assertEquals(reserved,8L); assertEquals(sessions,2L) }
      stored <- f.metadata.transaction(_.artifacts(None,100))
      _ <- IO { assertEquals(stored.map(_.reservedBytes).sum,8L); assertEquals(stored.size,2) }
    yield () }.unsafeRunSync()
  }
  private def sessionCase(perUser: Int,global: Int,expected: Int): Unit = run { f => for
    gate <- Semaphore[IO](1L)
    service = new Artifacts(f.metadata,f.payloads,f.config.limits.copy(maxSessionsPerUser=perUser,maxSessionsGlobal=global),f.clock,f.auth,f.lease,gate,NoFaults)
    identities=Vector.fill(8)(f.identity)++Vector.fill(8)(f.other)
    results <- identities.parTraverse(identity => service.init(identity,request(1)).attempt)
    _ <- IO(successes(results,expected,"session-limit"))
    counts <- f.metadata.transaction(tx => (tx.sessions(None),tx.sessions(Some(f.identity.userId)),tx.sessions(Some(f.other.userId))))
    _ <- IO { assertEquals(counts._1,expected.toLong); assert(counts._2<=perUser); assert(counts._3<=perUser) }
  yield () }
  test("concurrent PostgreSQL per-user session cap is exact across independent managers") { sessionCase(2,10,4) }
  test("concurrent PostgreSQL global session cap applies in the same admission transaction") { sessionCase(2,3,3) }
  test("runtime role is least privilege and actual MetadataTxn waits on the PG advisory lock") { run { f =>
    runtimeConnection(f).use { holder => runtimeConnection(f).use { observer => for
      _ <- IO.blocking {
        val privileges=Jdbc.rows(observer,"SELECT rolsuper,rolcreatedb,rolcreaterole,rolinherit,has_database_privilege(current_user,current_database(),'CREATE') FROM pg_roles WHERE rolname=current_user") { r =>
          (r.getBoolean(1),r.getBoolean(2),r.getBoolean(3),r.getBoolean(4),r.getBoolean(5))
        }.head
        assertEquals(privileges,(false,false,false,false,false))
        holder.setAutoCommit(false)
        Jdbc.exec(holder,"SELECT pg_advisory_xact_lock(714159263)")
      }
      fiber <- f.metadata.transaction(_ => 42).start
      // Observer is a separate real JDBC connection, not the root monitor or
      // process gate. A true pg_stat_activity advisory wait MUST be observed.
      _ <- {
        def waitForPg: IO[Unit] = IO.blocking {
          Jdbc.rows(observer,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event='advisory' AND query LIKE 'SELECT pg_advisory_xact_lock%'")(_.getInt(1)).head > 0
        }.flatMap(found => if found then IO.unit else IO.sleep(20.millis) *> waitForPg)
        waitForPg.timeout(3.seconds)
      }.guarantee(IO.blocking(holder.commit()))
      value <- fiber.joinWithNever.timeout(3.seconds)
      _ <- IO(assertEquals(value,42))
    yield () }}
  }}
  test("forward catalogue projection bootstrap/backfill preserves original bytea and timestamp bits") { run { f =>
    val time=Math.nextUp(f.clock.now)
    val a=Artifact("a"*32,"İ\u0000Straße𐀀",ArtifactKind.Directory,Visibility.Internal,f.identity.userId,"token",
      Exact.displayTime(time),time,None,None,UploadState.Uploading,0,0,0,None,time,"[]",Vector.empty,None,None)
    for
      _ <- f.metadata.transaction(_.put(a))
      _ <- f.database.get.transaction { c =>
        val before=Jdbc.rows(c,"SELECT name,created_at_s,last_activity_at FROM manure.artifacts WHERE id=?",Exact.utf8(a.id)) { r =>
          (r.getBytes(1).toVector,r.getBytes(2).toVector,r.getBytes(3).toVector)
        }.head
        Jdbc.exec(c,"UPDATE manure.artifacts SET name_match=NULL")
        CatalogueProjection.initialize(c)
        assertEquals(CatalogueProjection.migration.version,3)
        CatalogueProjection.backfill(c,a)
        val after=Jdbc.rows(c,"SELECT name,created_at_s,last_activity_at,name_match FROM manure.artifacts WHERE id=?",Exact.utf8(a.id)) { r =>
          ((r.getBytes(1).toVector,r.getBytes(2).toVector,r.getBytes(3).toVector),r.getBytes(4).toVector)
        }.head
        assertEquals(after._1,before)
        assertEquals(after._2,Exact.utf8(Exact.matching(a.name)).toVector)
      }
      result <- new Catalogue(f.artifacts,f.config.limits,f.clock).list(f.other,
        api.CatalogueQuery("i\u0307\u0000straße𐀀",true,None,None,api.CatalogueSort.Name,api.SortDirection.Asc,1,None,Nil,None,None))
      _ <- IO(assertEquals(result._1,Vector(a)))
    yield ()
  }}
  test("trusted catalogue SQL has one keyset LIMIT and literal bytea parameters, never user SQL") { run { f =>
    val q=api.CatalogueQuery("%_'\\\u0000 OR true --",true,None,None,api.CatalogueSort.Name,api.SortDirection.Desc,2,None,Nil,None,None)
    val selection=CataloguePolicy.prepare(q,f.config.limits,f.clock.now)
    val (sql,params)=CatalogueSql.page(selection)
    for
      _ <- IO {
        assert(sql.contains("LIMIT ?")); assert(sql.contains("ORDER BY a.name DESC NULLS LAST,a.id DESC"))
        assert(!sql.contains(q.query)); assert(!sql.contains("OFFSET")); assert(!sql.contains("lower("))
        assert(sql.contains("WITH page AS MATERIALIZED")); assert(sql.contains("SELECT a.id,a.name AS sort_value"))
        assertEquals(params.last,3)
      }
      result <- f.metadata.transaction(_.catalogue(selection))
      _ <- IO(assertEquals(result,Vector.empty))
      _ <- f.database.get.transaction { c =>
        Using.resource(c.prepareStatement("EXPLAIN (FORMAT JSON) " + sql)) { p =>
          Jdbc.bind(p,params)
          Using.resource(p.executeQuery()) { r =>
            assert(r.next())
            val plan=io.circe.parser.parse(r.getString(1)).toOption.get.asArray.get.head.hcursor.downField("Plan").focus.get
            def nodes(value: io.circe.Json): Vector[io.circe.Json] =
              Vector(value) ++ value.hcursor.get[Vector[io.circe.Json]]("Plans").getOrElse(Vector.empty).flatMap(nodes)
            val limits=nodes(plan).filter(_.hcursor.get[String]("Node Type").toOption.contains("Limit"))
            assertEquals(limits.size,1)
            assertEquals(limits.head.hcursor.get[String]("Subplan Name").toOption,Some("CTE page"))
            assert(limits.head.hcursor.get[Long]("Plan Rows").toOption.exists(_ <= selection.fetch))
          }
        }
      }
    yield ()
  }}
