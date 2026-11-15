package manure

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.Json
import java.nio.file.Files
import ponygirls.runtime.JdbcDatabase

final class RootBindingPolicySuite extends munit.FunSuite:
  private def configured(base: Config,mode: String): Config =
    val path=base.dataDir.getParent.resolve("config.json")
    val json=CurrentWire.parse(Files.readString(path))
    Files.writeString(path,json.mapObject(_.add("root_binding",Json.obj("mode" -> Json.fromString(mode)))).noSpaces)
    Config.load(path).copy(database=base.database)
  private def database[A](config: Config)(body: java.sql.Connection => A): IO[A] =
    JdbcDatabase.resource(config.database).use(_.transaction(body))
  private def binding(config: Config): IO[Vector[Byte]] = database(config) { c =>
    Jdbc.rows(c,"SELECT identity FROM manure.root_owner WHERE singleton")(_.getBytes(1).toVector).head
  }
  private def refuses(config: Config,code: String): IO[Unit] = Main.resources(config).use(_ => IO.unit).attempt.map { result =>
    assertEquals(result.left.toOption.collect {case error: DomainError => error.code},Some(code))
  }

  test("inode-anchored accepts device drift without rebinding and strict still refuses") {
    BackendFixture.configuration.use { (base,token,_) => for
      _ <- Main.resources(base).use { services =>
        val identity=new Auth(base.users).authenticate(token).get
        services.artifacts.init(identity,InitUpload("preserved",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,Vector.empty,None,None)).void
      }
      original <- binding(base)
      prior=RootBinding.decode(original.toArray).asInstanceOf[PhysicalRootBinding]
      drift=prior.copy(device=prior.device ^ 16L)
      _ <- database(base)(c => Jdbc.exec(c,"UPDATE manure.root_owner SET identity=? WHERE singleton",drift.bytes))
      config <- IO.blocking(configured(base,"inode-anchored"))
      _ <- Main.resources(config).use { services => services.database.transaction { c =>
        assertEquals(Jdbc.rows(c,"SELECT count(*) FROM manure.artifacts")(_.getLong(1)).head,1L)
      }}
      after <- binding(base)
      _ <- IO(assertEquals(after,drift.bytes.toVector))
      _ <- refuses(base,"migration-required")
    yield () }.unsafeRunSync()
  }

  test("inode-anchored refuses inode drift before ownership mutation") {
    BackendFixture.configuration.use { (base,_,_) => for
      _ <- Main.resources(base).use(_ => IO.unit)
      original <- binding(base)
      prior=RootBinding.decode(original.toArray).asInstanceOf[PhysicalRootBinding]
      changed=prior.copy(inode=prior.inode ^ 16L)
      _ <- database(base)(c => Jdbc.exec(c,"UPDATE manure.root_owner SET identity=? WHERE singleton",changed.bytes))
      config <- IO.blocking(configured(base,"inode-anchored"))
      _ <- refuses(config,"migration-required")
      after <- binding(base)
      _ <- IO(assertEquals(after,changed.bytes.toVector))
    yield () }.unsafeRunSync()
  }

  test("unsafe-off never creates a persistent binding and strict can subsequently adopt an empty root") {
    BackendFixture.configuration.use { (base,_,_) => for
      config <- IO.blocking(configured(base,"unsafe-off"))
      _ <- Main.resources(config).use(_ => IO.unit)
      _ <- Main.resources(config).use(_ => IO.unit)
      _ <- database(base)(c => assertEquals(Jdbc.rows(c,"SELECT count(*) FROM manure.root_owner")(_.getLong(1)).head,0L))
      _ <- Main.resources(base).use(_ => IO.unit)
      _ <- binding(base)
    yield () }.unsafeRunSync()
  }

  test("unsafe-off ignores an existing physical binding without modifying it") {
    BackendFixture.configuration.use { (base,_,_) => for
      _ <- Main.resources(base).use(_ => IO.unit)
      original <- binding(base)
      replacement <- IO.blocking(Files.createDirectory(base.dataDir.resolveSibling("replacement")))
      config <- IO.blocking(configured(base,"unsafe-off").copy(dataDir=replacement))
      _ <- Main.resources(config).use(_ => IO.unit)
      after <- binding(base)
      _ <- IO(assertEquals(after,original))
      _ <- refuses(base.copy(dataDir=replacement),"migration-required")
    yield () }.unsafeRunSync()
  }

  Vector("inode-anchored","unsafe-off").foreach { mode =>
    test(mode+" preserves empty-catalogue refusal without sweeping payload") {
      BackendFixture.configuration.use { (base,_,_) => for
        _ <- if mode == "unsafe-off" then Main.resources(base).use(_ => IO.unit) else IO.unit
        _ <- IO.blocking {
          Files.createDirectories(base.dataDir.resolve("staging/unknown"))
          Files.writeString(base.dataDir.resolve("staging/unknown/file"),"preserve")
        }
        config <- IO.blocking(configured(base,mode))
        _ <- refuses(config,"migration-required")
        _ <- IO.blocking(assertEquals(Files.readString(base.dataDir.resolve("staging/unknown/file")),"preserve"))
      yield () }.unsafeRunSync()
    }
    test(mode+" refuses imported state even when control configuration was removed") {
      BackendFixture.configuration.use { (base,_,_) => for
        config <- IO.blocking(configured(base,mode))
        result <- RootDirectories.resource(config,true).use { roots =>
          val state=RootOwnershipState(Some(ImportedDestination("1"*32,"/removed","2"*64,true)),None,true,None)
          RootOwnership.verify(config,roots,state,None).attempt
        }
        _ <- IO(assertEquals(result.left.toOption.collect {case error: DomainError => error.code},Some("root-binding-policy")))
      yield () }.unsafeRunSync()
    }
    test(mode+" preserves marker and pending-preparation refusals") {
      BackendFixture.configuration.use { (base,_,_) => for
        config <- IO.blocking(configured(base,mode))
        _ <- IO.blocking(Files.write(base.dataDir.resolve(RootMarker.Name.toString),Array.fill[Byte](RootMarker.Bytes)(1)))
        _ <- refuses(config,"migration-pending")
        _ <- IO.blocking {
          Files.delete(base.dataDir.resolve(RootMarker.Name.toString))
          Files.writeString(base.dataDir.resolve(RootOwnership.TemporaryPrefix.toString+"foreign"),"preserve")
        }
        _ <- refuses(config,"migration-pending")
        _ <- IO.blocking(assertEquals(Files.readString(base.dataDir.resolve(RootOwnership.TemporaryPrefix.toString+"foreign")),"preserve"))
      yield () }.unsafeRunSync()
    }
    test(mode+" refuses portable binding state rather than downgrading it") {
      BackendFixture.configuration.use { (base,_,_) => for
        _ <- Main.resources(base).use(_ => IO.unit)
        portable=PortableRootBinding("1"*64,1L,"2"*64)
        _ <- database(base)(c => Jdbc.exec(c,"UPDATE manure.root_owner SET identity=? WHERE singleton",portable.bytes))
        config <- IO.blocking(configured(base,mode))
        _ <- refuses(config,"root-binding-policy")
        after <- binding(base)
        _ <- IO(assertEquals(after,portable.bytes.toVector))
      yield () }.unsafeRunSync()
    }
  }
