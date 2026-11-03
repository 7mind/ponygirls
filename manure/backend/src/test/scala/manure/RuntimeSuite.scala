package manure

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import java.nio.file.Files
import manure.storage.{ConfinedDirectory,PosixNative}
import ponygirls.runtime.JdbcDatabase
import munit.FunSuite

/** Actual production distage graph/lifecycle plus owned PG and real physical root. */
final class RuntimeSuite extends FunSuite:
  test("production plugin graph acquires, migrates, reopens same physical root and releases claim") {
    BackendFixture.configuration.use { (config,token,_) =>
      def initialize = Main.resources(config).use { services => for
        _ <- IO(assert(services != null))
        versions <- services.database.transaction(c => Jdbc.rows(c,"SELECT version FROM ponygirls_runtime_migrations WHERE namespace='manure' ORDER BY version")(_.getInt(1)))
        _ <- IO(assertEquals(versions,Vector(1,2,3)))
      yield () }
      initialize *> initialize *> IO.blocking {
        val root = ConfinedDirectory.open(config.dataDir,PosixNative.shared(sys.env("MANURE_POSIX_LIBRARY")))
        root.close()
      }
    }.unsafeRunSync()
  }
  test("production startup backfills ROOT-lower projection before the real bounded SQL catalogue query") {
    BackendFixture.configuration.use { (config,token,_) =>
      val identity = new Auth(config.users).authenticate(token).get
      for
        id <- Main.resources(config).use { services =>
          services.artifacts.init(identity,InitUpload("Straße\u0000馬",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None)).map(_.artifact.id)
        }
        _ <- JdbcDatabase.resource(config.database).use(_.transaction(c => Jdbc.exec(c,"UPDATE manure.artifacts SET name_match=NULL")))
        _ <- Main.resources(config).use { services =>
          val catalogue = new Catalogue(services.artifacts,config.limits,SystemDomainClock)
          val query = manure.api.CatalogueQuery("straße\u0000",true,None,None,manure.api.CatalogueSort.Name,manure.api.SortDirection.Asc,2,None)
          catalogue.list(identity,query).flatMap { (rows,cursor) => IO {
            assertEquals(rows.map(_.id),Vector(id));assertEquals(cursor,None)
          }}
        }
      yield ()
    }.unsafeRunSync()
  }
  test("already-bound empty metadata reopens after last-row deletion and recovers its orphan staging") {
    BackendFixture.configuration.use { (config,token,_) =>
      val identity = new Auth(config.users).authenticate(token).get
      for
        id <- Main.resources(config).use { services => for
          initialized <- services.artifacts.init(identity,InitUpload("last session",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None))
          _ <- services.database.transaction { c =>
            // Exact crash/cancel window: authoritative deletion committed, next
            // filesystem cleanup has not run. Existing root_owner is untouched.
            new PostgresTxn(c,services.projection).delete(initialized.artifact.id)
          }
        yield initialized.artifact.id }
        _ <- IO.blocking(assert(Files.exists(config.dataDir.resolve("staging/"+id))))
        _ <- Main.resources(config).use(_ => IO.unit)
        _ <- IO.blocking {
          assert(!Files.exists(config.dataDir.resolve("staging/"+id)))
          assert(!Files.exists(config.dataDir.resolve("staging/"+id+".json")))
        }
      yield ()
    }.unsafeRunSync()
  }
  test("legacy SQLite physical root with empty PG fails migration-required before any metadata mutation") {
    BackendFixture.configuration.use { (config,_,_) => for
      _ <- IO.blocking {
        Files.writeString(config.dataDir.resolve("manure.db"),"legacy SQLite preserved bytes")
        Files.createDirectories(config.dataDir.resolve("live/acknowledged"))
        Files.writeString(config.dataDir.resolve("live/acknowledged/file"),"acknowledged payload")
      }
      result <- Main.resources(config).use(_ => IO.unit).attempt
      _ <- IO { assertEquals(result.left.toOption.collect { case e: DomainError => e.code },Some("migration-required")) }
      _ <- JdbcDatabase.resource(config.database).use(_.transaction { c =>
        assert(!Jdbc.rows(c,"SELECT to_regclass('manure.artifacts') IS NOT NULL")(_.getBoolean(1)).head)
      })
      _ <- IO.blocking {
        assertEquals(Files.readString(config.dataDir.resolve("manure.db")),"legacy SQLite preserved bytes")
        assertEquals(Files.readString(config.dataDir.resolve("live/acknowledged/file")),"acknowledged payload")
        ConfinedDirectory.open(config.dataDir,PosixNative.shared(sys.env("MANURE_POSIX_LIBRARY"))).close()
      }
    yield () }.unsafeRunSync()
  }
  test("nonempty payload root with no import/metadata fails closed, no orphan sweep adoption") {
    BackendFixture.configuration.use { (config,_,_) => for
      _ <- IO.blocking { Files.createDirectories(config.dataDir.resolve("staging/owned/tree")); Files.writeString(config.dataDir.resolve("staging/owned/tree/file"),"preserve") }
      result <- Main.resources(config).use(_ => IO.unit).attempt
      _ <- IO(assertEquals(result.left.toOption.collect { case e: DomainError => e.code },Some("migration-required")))
      _ <- IO.blocking(assertEquals(Files.readString(config.dataDir.resolve("staging/owned/tree/file")),"preserve"))
    yield () }.unsafeRunSync()
  }
  test("wrong payload root cannot silently attach existing PG metadata") {
    BackendFixture.configuration.use { (config,_,_) => for
      _ <- Main.resources(config).use(_ => IO.unit)
      replacement <- IO.blocking(Files.createDirectory(config.dataDir.getParent.resolve("replacement")))
      result <- Main.resources(config.copy(dataDir=replacement)).use(_ => IO.unit).attempt
      _ <- IO(assertEquals(result.left.toOption.collect { case e: DomainError => e.code },Some("migration-required")))
    yield () }.unsafeRunSync()
  }
