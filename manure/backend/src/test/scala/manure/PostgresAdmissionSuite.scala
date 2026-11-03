package manure

import cats.effect.{IO,Resource}
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import java.sql.{Connection,DriverManager}
import java.nio.file.Files
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
    Vector(ManifestEntry("file",false,size,SecretCodec.sha256(Array.fill[Byte](size)(0)))),None)
  private def successes[A](results: Vector[Either[Throwable,A]],count: Int,code: String): Unit =
    assertEquals(results.count(_.isRight),count)
    assertEquals(results.collect { case Left(e: DomainError) => e.code },Vector.fill(results.size-count)(code))
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
      Exact.displayTime(time),time,None,None,UploadState.Uploading,0,0,0,None,time,"[]")
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
        api.CatalogueQuery("i\u0307\u0000straße𐀀",true,None,None,api.CatalogueSort.Name,api.SortDirection.Asc,1,None))
      _ <- IO(assertEquals(result._1,Vector(a)))
    yield ()
  }}
  test("trusted catalogue SQL has one keyset LIMIT and literal bytea parameters, never user SQL") { run { f =>
    val q=api.CatalogueQuery("%_'\\\u0000 OR true --",true,None,None,api.CatalogueSort.Name,api.SortDirection.Desc,2,None)
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
