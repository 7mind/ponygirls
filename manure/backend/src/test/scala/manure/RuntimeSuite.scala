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
        _ <- IO(assertEquals(versions,Vector(1,2,3,4,5)))
      yield () }
      initialize *> initialize *> IO.blocking {
        val root = ConfinedDirectory.open(config.dataDir,PosixNative.shared(sys.env("MANURE_POSIX_LIBRARY")))
        root.close()
      }
    }.unsafeRunSync()
  }
  test("cold migration5 preserves frozen ledger/old metadata and upgrades old pinned search snapshots") {
    BackendFixture.configuration.use { (config,token,_) =>
      val identity = new Auth(config.users).authenticate(token).get
      def ledger(c: java.sql.Connection) = Jdbc.rows(c,"SELECT version,name,checksum FROM ponygirls_runtime_migrations WHERE namespace='manure' AND version<5 ORDER BY version")(r => (r.getInt(1),r.getString(2),r.getString(3)))
      for
        original <- Main.resources(config).use { services => for
          initialized <- services.artifacts.init(identity,InitUpload("legacy metadata\u0000馬",ArtifactKind.Directory,Visibility.Public,Vector.empty,None,Vector.empty,None,None))
          ready <- services.artifacts.finish(identity,initialized.artifact.id)
          version=services.projection.version(ready)
          frozen <- services.database.transaction { c =>
            val frozen=ledger(c)
            val old=CurrentWire.encode(api.Artifact.codecJson,services.projection.snapshot(ready)).mapObject(obj => obj.remove("tags").remove("hostname").remove("projectPath"))
            Jdbc.exec(c,"UPDATE manure.search_versions SET metadata=?",Exact.utf8(old.noSpaces))
            Jdbc.exec(c,"DROP TABLE manure.artifact_tags")
            Jdbc.exec(c,"ALTER TABLE manure.artifacts DROP COLUMN tags_json,DROP COLUMN hostname,DROP COLUMN project_path,DROP COLUMN hostname_match,DROP COLUMN project_path_match")
            Jdbc.exec(c,"DELETE FROM ponygirls_runtime_migrations WHERE namespace='manure' AND version=5")
            frozen
          }
        yield (ready,version,frozen) }
        _ <- Main.resources(config).use { services => for
          current <- services.artifacts.info(identity,original._1.id)
          _ <- IO(assertEquals(current,original._1))
          _ <- services.database.transaction { c =>
            assertEquals(ledger(c),original._3)
            assertEquals(Jdbc.rows(c,"SELECT version FROM ponygirls_runtime_migrations WHERE namespace='manure' ORDER BY version")(_.getInt(1)),Vector(1,2,3,4,5))
            val pinned=services.projection.pinned(c,current.id,original._2)
            assertEquals(pinned.tags,Nil);assertEquals(pinned.hostname,None);assertEquals(pinned.projectPath,None)
            val stored=Jdbc.rows(c,"SELECT metadata FROM manure.search_versions WHERE artifact_id=? AND version=?",Exact.utf8(current.id),Exact.utf8(original._2))(r => CurrentWire.parse(Exact.string(r.getBytes(1)))).head
            assertEquals(CurrentWire.decode(api.Artifact.codecJson,stored),pinned)
            val partial=stored.mapObject(_.remove("hostname"))
            assertEquals(intercept[DomainError](services.projection.storedSnapshot(partial)).code,"unavailable")
            assertEquals(intercept[DomainError](services.projection.storedSnapshot(stored.mapObject(_.add("tags",io.circe.Json.fromInt(1))))).code,"bad-envelope")
            Vector(pinned.copy(tags=List("x","x")),pinned.copy(tags=List.fill(33)("x")),pinned.copy(tags=List("𐀀"*129)),
              pinned.copy(hostname=Some("\ufeff")),pinned.copy(hostname=Some("𐀀"*254)),pinned.copy(projectPath=Some("x"*4097))).foreach { invalid =>
              val json=CurrentWire.encode(api.Artifact.codecJson,invalid)
              assertEquals(intercept[DomainError](services.projection.storedSnapshot(json)).code,"bad-envelope")
            }
          }
        yield () }
      yield ()
    }.unsafeRunSync()
  }
  test("legacy migration ledger upgrades hash-only records without recovering or rotating historical values") {
    BackendFixture.configuration.use { (config,token,_) =>
      val identity = new Auth(config.users).authenticate(token).get
      for
        old <- Main.resources(config).use { services =>
          services.artifacts.init(identity,InitUpload("legacy",ArtifactKind.Directory,Visibility.External,Vector.empty,None,Vector.empty,None,None))
        }
        _ <- JdbcDatabase.resource(config.database).use(_.transaction { c =>
          // Restore precisely the pre-feature schema/ledger. Migration1's SQL
          // checksum must remain identical even though the canonical mirror grew.
          Jdbc.exec(c,"DROP TABLE manure.external_passwords")
          Jdbc.exec(c,"DELETE FROM ponygirls_runtime_migrations WHERE namespace='manure' AND version>=4")
        })
        _ <- Main.resources(config).use { services => for
          password <- services.artifacts.externalPassword(identity,old.artifact.id)
          current <- services.artifacts.info(identity,old.artifact.id)
          _ <- IO { assertEquals(password,None);assertEquals(current.externalPasswordHash,old.artifact.externalPasswordHash) }
          rotated <- services.artifacts.rotate(identity,old.artifact.id)
          copied <- services.artifacts.externalPassword(identity,old.artifact.id)
          _ <- IO(assertEquals(copied,Some(rotated)))
        yield () }
        _ <- Main.resources(config).use { services =>
          services.artifacts.externalPassword(identity,old.artifact.id).map(p => assert(p.nonEmpty))
        }
      yield ()
    }.unsafeRunSync()
  }
  test("production startup backfills ROOT-lower projection before the real bounded SQL catalogue query") {
    BackendFixture.configuration.use { (config,token,_) =>
      val identity = new Auth(config.users).authenticate(token).get
      for
        id <- Main.resources(config).use { services =>
          services.artifacts.init(identity,InitUpload("Straße\u0000馬",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,Vector.empty,None,None)).map(_.artifact.id)
        }
        _ <- JdbcDatabase.resource(config.database).use(_.transaction(c => Jdbc.exec(c,"UPDATE manure.artifacts SET name_match=NULL")))
        _ <- Main.resources(config).use { services =>
          val catalogue = new Catalogue(services.artifacts,config.limits,SystemDomainClock)
          val query = manure.api.CatalogueQuery("straße\u0000",true,None,None,manure.api.CatalogueSort.Name,manure.api.SortDirection.Asc,2,None,Nil,None,None)
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
          initialized <- services.artifacts.init(identity,InitUpload("last session",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,Vector.empty,None,None))
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
  test("legacy device renumbering refuses before metadata or payload effects") {
    BackendFixture.configuration.use { (config,_,_) => for
      _ <- Main.resources(config).use(_ => IO.unit)
      legacy <- JdbcDatabase.resource(config.database).use(_.transaction { c =>
        Jdbc.rows(c,"SELECT identity FROM manure.root_owner WHERE singleton")(_.getBytes(1)).head
      })
      priorNode = legacy.clone()
      _ <- IO {
        val bytes=java.nio.ByteBuffer.wrap(priorNode)
        bytes.putLong(0,bytes.getLong(0) ^ 16L)
      }
      _ <- JdbcDatabase.resource(config.database).use(_.transaction { c =>
        Jdbc.exec(c,"UPDATE manure.root_owner SET identity=? WHERE singleton",priorNode)
      })
      result <- Main.resources(config).use(_ => IO.unit).attempt
      _ <- IO(assertEquals(result.left.toOption.collect { case e: DomainError => e.code },Some("migration-required")))
      _ <- JdbcDatabase.resource(config.database).use(_.transaction { c =>
        assert(java.util.Arrays.equals(Jdbc.rows(c,"SELECT identity FROM manure.root_owner WHERE singleton")(_.getBytes(1)).head,priorNode))
        assertEquals(Jdbc.rows(c,"SELECT count(*) FROM manure.artifacts")(_.getLong(1)).head,0L)
      })
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
