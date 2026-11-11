package manure

import cats.effect.{IO,Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.Json
import java.sql.{Connection,DriverManager}
import java.nio.file.{Files,LinkOption,Path}
import manure.storage.ConfinedDirectory
import ponygirls.runtime.{JdbcDatabase,JdbcFailure}
import scala.jdk.CollectionConverters.*
import scala.util.Using

private final case class RootMetadataFingerprint(table: String,rows: Vector[String])
private final case class RootPayloadFingerprint(path: String,sha256: String)

final class RootMigrationSuite extends munit.FunSuite:
  private val originalVolume="computedisk-original"
  private val originalPod="11111111-1111-4111-8111-111111111111"
  private val payload=Exact.utf8("portable\u0000資料 payload")
  private def provider(handle: String,pod: String): RootAuthorityProvider = new RootAuthorityProvider:
    def resource(path: Path): Resource[IO,RootVolumeAuthority] = Resource.pure(new RootVolumeAuthority:
      def observe(root: ConfinedDirectory): RootVolumeWitness =
        root.physicalIdentity
        RootVolumeWitness(RootVolume("storage.example.test",handle),pod,
          "22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333",path.getParent)
    )
  private def database[A](config: Config)(body: java.sql.Connection => A): IO[A] =
    JdbcDatabase.resource(config.database).use(_.transaction(body))
  private def state(config: Config): IO[RootOwnershipState] = database(config)(RootOwnership.read)
  private def metadata(config: Config): IO[Vector[RootMetadataFingerprint]] = database(config) { c =>
    val tables=Jdbc.rows(c,"SELECT tablename FROM pg_tables WHERE schemaname='manure' AND tablename NOT IN ('root_owner','root_identity_migrations') ORDER BY tablename")(_.getString(1))
    tables.map { table =>
      val quoted="\""+table.replace("\"","\"\"")+"\""
      val rows=Jdbc.rows(c,"SELECT pg_catalog.record_send(t) FROM manure."+quoted+" t")(r => SecretCodec.sha256(r.getBytes(1))).sorted
      RootMetadataFingerprint(table,rows)
    }
  }
  private def files(config: Config): IO[Vector[RootPayloadFingerprint]] = IO.blocking {
    Using.resource(Files.walk(config.dataDir)) { walk =>
      walk.iterator().asScala.filter(path => Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS)).flatMap { path =>
        val relative=config.dataDir.relativize(path).toString
        if relative == RootMarker.Name.toString || relative.startsWith(RootOwnership.TemporaryPrefix.toString) then None
        else Some(RootPayloadFingerprint(relative,SecretCodec.sha256(Files.readAllBytes(path))))
      }.toVector.sortBy(_.path)
    }
  }
  private def ownedAdmin[A](config: Config)(body: Connection => A): IO[A] = IO.blocking {
    val base=sys.env("MANURE_TEST_JDBC_URL")
    val prefix=base.substring(0,base.lastIndexOf('/')+1)
    Require(sys.env.get("MANURE_TEST_ALLOW_CREATEDB").contains("1") && config.database.jdbcUrl.startsWith(prefix) &&
      config.database.jdbcUrl.stripPrefix(prefix).matches("manure_test_[0-9a-f]{32}"),"owned-fixture-required")
    val password=Files.readString(Path.of(sys.env("MANURE_TEST_JDBC_PASSWORD_FILE"))).stripSuffix("\n")
    Using.resource(DriverManager.getConnection(config.database.jdbcUrl,sys.env("MANURE_TEST_JDBC_USER"),password))(body)
  }
  private def imported(config: Config,deviceDelta: Long): IO[Config] = for
    target <- IO.blocking {
      val control=Files.createDirectory(config.dataDir.getParent.resolve("destination"))
      Files.move(config.dataDir,control.resolve("data"))
      config.copy(dataDir=control.resolve("data"),migrationReceiptDir=Some(control))
    }
    legacy <- RootDirectories.resource(target,true).use { roots => IO.blocking {
      val control=roots.control.get
      val owner=RootBinding.physical(control)
      val payloadRoot=RootBinding.physical(roots.payload)
      def unsigned(value: Long): Json = Json.fromBigInt(BigInt(java.lang.Long.toUnsignedString(value)))
      val id="1"*32
      val source=SecretCodec.sha256(Exact.utf8("owned imported snapshot"))
      val maximumFixtureBytes=1024L*1024L
      val entries=roots.payload.inventory(target.migrationManifestMaxEntries,68,maximumFixtureBytes).map { entry =>
        if entry.directory then Json.obj("path" -> Json.fromString(entry.pathHex),"kind" -> Json.fromString("dir"))
        else Json.obj("path" -> Json.fromString(entry.pathHex),"kind" -> Json.fromString("file"),"size" -> Json.fromLong(entry.size),"sha256" -> Json.fromString(entry.sha256))
      }
      val manifest=Json.obj("format" -> Json.fromString("manure-payload-1"),"source" -> Json.fromString(source),
        "destination" -> Json.fromString(id),"device" -> unsigned(payloadRoot.device ^ deviceDelta),"inode" -> unsigned(payloadRoot.inode),"entries" -> Json.arr(entries*))
      val manifestBytes=Exact.utf8(manifest.noSpaces)
      Files.write(target.migrationReceiptDir.get.resolve("PAYLOAD.json"),manifestBytes)
      Files.writeString(target.migrationReceiptDir.get.resolve("OWNER.json"),Json.obj("format" -> Json.fromString("manure-offline-1"),
        "id" -> Json.fromString(id),"root" -> Json.fromString(target.migrationReceiptDir.get.toString),
        "device" -> unsigned(owner.device ^ deviceDelta),"inode" -> unsigned(owner.inode)).noSpaces)
      Files.writeString(target.migrationReceiptDir.get.resolve("COMPLETE"),Json.obj("source" -> Json.fromString(source),
        "destination" -> Json.fromString(id),"payloadManifestSha256" -> Json.fromString(SecretCodec.sha256(manifestBytes))).noSpaces)
      payloadRoot.copy(device=payloadRoot.device ^ deviceDelta)
    }}
    _ <- ownedAdmin(target) { c =>
      Require(target.database.user.matches("manure_runtime_[0-9a-f]{32}"),"owned-fixture-required")
      Jdbc.exec(c,"CREATE SCHEMA manure_offline; CREATE TABLE manure_offline.destination(id text PRIMARY KEY,root text NOT NULL,source text,writes_started boolean NOT NULL)")
      Jdbc.exec(c,"INSERT INTO manure_offline.destination VALUES(?,?,?,true)","1"*32,target.migrationReceiptDir.get.toString,SecretCodec.sha256(Exact.utf8("owned imported snapshot")))
      Jdbc.exec(c,"GRANT USAGE ON SCHEMA manure_offline TO "+target.database.user)
      Jdbc.exec(c,"GRANT SELECT ON manure_offline.destination TO "+target.database.user)
      Jdbc.exec(c,"UPDATE manure.root_owner SET identity=? WHERE singleton",legacy.bytes)
    }
  yield target
  private def initialize(config: Config,token: String): IO[String] = Main.resources(config).use { services =>
    val identity=new Auth(config.users).authenticate(token).get
    val request=InitUpload("portable\u0000馬",ArtifactKind.File,Visibility.Internal,
      Vector(ManifestEntry("資料/file.txt",false,payload.length,SecretCodec.sha256(payload))),None,Vector.empty,None,None)
    for
      upload <- services.artifacts.init(identity,request)
      _ <- services.artifacts.putChunk(identity,upload.artifact.id,"資料/file.txt",0,payload,SecretCodec.sha256(payload))
      ready <- services.artifacts.finish(identity,upload.artifact.id)
    yield ready.id
  }
  private def fails[A](code: String,work: IO[A]): IO[Unit] = work.attempt.map {
    case Left(error: DomainError) => assertEquals(error.code,code)
    case other => fail("expected "+code+", got "+other.map(_ => "success"))
  }
  private def applyQuiet(config: Config,plan: RootMigrationPlan,authority: RootAuthorityProvider): IO[RootMigrationResult] =
    RootIdentityMigration.applyPlan(config,authority,plan,plan.sha256,RootMigrationCheckpoints.quiet)

  test("authority-enabled startup refuses an unbound root before schema or adoption effects") {
    BackendFixture.configuration.use { (config,_,_) =>
      val authority=provider(originalVolume,originalPod)
      for
        beforeFiles <- files(config)
        _ <- fails("migration-required",Main.resourcesWithAuthority(config,authority).use(_ => IO.unit))
        after <- state(config)
        afterFiles <- files(config)
        rows <- metadata(config)
        _ <- IO {assertEquals(after.binding,None);assertEquals(afterFiles,beforeFiles);assertEquals(rows,Vector.empty)}
      yield ()
    }.unsafeRunSync()
  }

  test("authority-enabled startup refuses an unmigrated legacy binding without side effects") {
    BackendFixture.configuration.use { (config,token,_) =>
      val authority=provider(originalVolume,originalPod)
      for
        _ <- initialize(config,token)
        before <- state(config)
        beforeFiles <- files(config)
        beforeRows <- metadata(config)
        _ <- fails("migration-required",Main.resourcesWithAuthority(config,authority).use(_ => IO.unit))
        after <- state(config)
        afterFiles <- files(config)
        afterRows <- metadata(config)
        _ <- IO {assertEquals(after,before);assertEquals(afterFiles,beforeFiles);assertEquals(afterRows,beforeRows)}
      yield ()
    }.unsafeRunSync()
  }

  test("explicit migration handles a prior-node legacy binding, preserves data and replays") {
    BackendFixture.configuration.use { (config,token,_) =>
      val authority=provider(originalVolume,originalPod)
      for
        id <- initialize(config,token)
        initial <- state(config)
        old=initial.binding.collect {case physical: PhysicalRootBinding => physical}.get
        prior=old.copy(device=old.device ^ 16L)
        _ <- database(config)(c => Jdbc.exec(c,"UPDATE manure.root_owner SET identity=? WHERE singleton",prior.bytes))
        before <- metadata(config)
        beforeFiles <- files(config)
        plan <- RootIdentityMigration.prepare(config,authority,"owned fixture: independently retained original volume")
        _ <- IO {
          assertEquals(plan.legacy,prior)
          assertEquals(plan.observed,old)
          assertEquals(RootMigrationPlan.decode(plan.json),plan)
          assertEquals(RootMigrationPlan.decode(plan.json).sha256,plan.sha256)
          assert(!Files.exists(config.dataDir.resolve(RootMarker.Name.toString)))
        }
        unmodified <- state(config)
        _ <- IO {assertEquals(unmodified.binding,Some(prior));assertEquals(unmodified.migration,None)}
        result <- applyQuiet(config,plan,authority)
        after <- metadata(config)
        afterFiles <- files(config)
        _ <- IO {assert(!result.replayed);assert(!result.contextRefreshed);assertEquals(after,before);assertEquals(afterFiles,beforeFiles)}
        receipt <- state(config)
        _ <- IO {assertEquals(receipt.binding,Some(plan.portable));assertEquals(receipt.migration.get.status,"applied")}
        replay <- applyQuiet(config,plan,authority)
        _ <- IO(assert(replay.replayed))
        _ <- fails("authority-required",Main.resources(config).use(_ => IO.unit))
        moved=provider(originalVolume,"44444444-4444-4444-8444-444444444444")
        _ <- Main.resourcesWithAuthority(config,moved).use { services => for
          identity <- IO.fromOption(new Auth(config.users).authenticate(token))(DomainError("unauthorized"))
          _ <- services.artifacts.info(identity,id)
          _ <- services.artifacts.openContent(id,"資料/file.txt",None,None,Some(identity)).use { (_,file) =>
            IO.blocking(assertEquals(file.read(0,payload.length+1).toVector,payload.toVector))
          }
        yield () }
        _ <- fails("authority-mismatch",Main.resourcesWithAuthority(config,provider("computedisk-clone",originalPod)).use(_ => IO.unit))
      yield ()
    }.unsafeRunSync()
  }

  RootMigrationPoint.values.foreach { window =>
    test("owned migration fault/replay window "+window.toString) {
      BackendFixture.configuration.use { (config,token,_) =>
        val authority=provider(originalVolume,originalPod)
        val fault=new RootMigrationCheckpoints:
          def reached(point: RootMigrationPoint): Unit = if point == window then throw DomainError("owned-fault")
        for
          _ <- initialize(config,token)
          before <- metadata(config)
          beforeFiles <- files(config)
          plan <- RootIdentityMigration.prepare(config,authority,"owned crash fixture original volume")
          _ <- fails("owned-fault",RootIdentityMigration.applyPlan(config,authority,plan,plan.sha256,fault))
          interrupted <- state(config)
          _ <- if window == RootMigrationPoint.AppliedCommitted then IO(assertEquals(interrupted.binding,Some(plan.portable)))
            else fails("migration-pending",Main.resourcesWithAuthority(config,authority).use(_ => IO.unit))
          result <- applyQuiet(config,plan,authority)
          _ <- IO(assertEquals(result.replayed,window == RootMigrationPoint.AppliedCommitted))
          after <- metadata(config)
          afterFiles <- files(config)
          _ <- IO {assertEquals(after,before);assertEquals(afterFiles,beforeFiles)}
          _ <- Main.resourcesWithAuthority(config,authority).use(_ => IO.unit)
        yield ()
      }.unsafeRunSync()
    }
  }

  test("an exact pending intent resumes with a fresh pod witness without rewriting its plan") {
    BackendFixture.configuration.use { (config,token,_) =>
      val authority=provider(originalVolume,originalPod)
      val moved=provider(originalVolume,"44444444-4444-4444-8444-444444444444")
      val fault=new RootMigrationCheckpoints:
        def reached(point: RootMigrationPoint): Unit =
          if point == RootMigrationPoint.PendingCommitted then throw DomainError("owned-fault")
      for
        _ <- initialize(config,token)
        plan <- RootIdentityMigration.prepare(config,authority,"owned pending pod replacement fixture")
        _ <- fails("owned-fault",RootIdentityMigration.applyPlan(config,authority,plan,plan.sha256,fault))
        _ <- fails("migration-plan-stale",applyQuiet(config,plan,provider("computedisk-clone",originalPod)))
        resumed <- applyQuiet(config,plan,moved)
        after <- state(config)
        _ <- IO {assert(!resumed.replayed);assert(resumed.contextRefreshed);assertEquals(after.migration.get.plan,plan)}
        replay <- applyQuiet(config,plan,moved)
        _ <- IO(assert(replay.replayed))
        _ <- Main.resourcesWithAuthority(config,moved).use(_ => IO.unit)
      yield ()
    }.unsafeRunSync()
  }

  test("owned prior-node pending fixture resumes after device and pod witness changes") {
    BackendFixture.configuration.use { (config,token,_) =>
      val authority=provider(originalVolume,originalPod)
      val previousDeviceDelta=16L
      for
        _ <- initialize(config,token)
        plan <- RootIdentityMigration.prepare(config,authority,"owned historical device witness simulation")
        previous=plan.observed.copy(device=plan.observed.device ^ previousDeviceDelta)
        historical=plan.copy(legacy=previous,observed=previous,volume=plan.volume.copy(podUid="44444444-4444-4444-8444-444444444444"))
        _ <- database(config) { c =>
          Jdbc.exec(c,"UPDATE manure.root_owner SET identity=? WHERE singleton",previous.bytes)
          RootMigrationStore.begin(c,historical)
        }
        result <- applyQuiet(config,historical,authority)
        after <- state(config)
        _ <- IO {assert(result.contextRefreshed);assertEquals(after.migration.get.plan,historical);assertEquals(after.binding,Some(historical.portable))}
      yield ()
    }.unsafeRunSync()
  }

  test("imported legacy receipt tuples and raw hashes survive device-renumbering migration") {
    BackendFixture.configuration.use { (config,token,_) =>
      val authority=provider(originalVolume,originalPod)
      val previousDeviceDelta=16L
      for
        id <- initialize(config,token)
        target <- imported(config,previousDeviceDelta)
        before <- metadata(target)
        beforeFiles <- files(target)
        beforeState <- state(target)
        _ <- fails("migration-required",Main.resources(target).use(_ => IO.unit))
        plan <- RootIdentityMigration.prepare(target,authority,"owned imported prior-device receipt simulation")
        _ <- IO {
          assertEquals(plan.imported.get.payload,plan.legacy)
          assertEquals(plan.imported.get.manifestSha256,SecretCodec.sha256(Files.readAllBytes(target.migrationReceiptDir.get.resolve("PAYLOAD.json"))))
          intercept[DomainError](RootMigrationPlan.writeNew(plan,target.migrationReceiptDir.get.resolve("forbidden-plan.json")))
        }
        _ <- applyQuiet(target,plan,authority)
        _ <- Main.resourcesWithAuthority(target,authority).use { services =>
          val identity=new Auth(target.users).authenticate(token).get
          services.artifacts.openContent(id,"資料/file.txt",None,None,Some(identity)).use { (_,file) =>
            IO.blocking(assertEquals(file.read(0,payload.length+1).toVector,payload.toVector))
          }
        }
        after <- metadata(target)
        afterFiles <- files(target)
        afterState <- state(target)
        _ <- IO {assertEquals(after,before);assertEquals(afterFiles,beforeFiles);assertEquals(afterState.destination,beforeState.destination)}
        _ <- IO.blocking {
          val owner=target.migrationReceiptDir.get.resolve("OWNER.json")
          Files.writeString(owner,Files.readString(owner)+" ")
        }
        _ <- fails("migration-required",Main.resourcesWithAuthority(target,authority).use(_ => IO.unit))
      yield ()
    }.unsafeRunSync()
  }

  test("an unbound imported root cannot use portable planning as an adoption bypass") {
    BackendFixture.configuration.use { (config,token,_) =>
      val authority=provider(originalVolume,originalPod)
      for
        _ <- initialize(config,token)
        target <- imported(config,0L)
        _ <- database(target)(c => Jdbc.exec(c,"DELETE FROM manure.root_owner"))
        _ <- fails("migration-required",RootIdentityMigration.prepare(target,authority,"owned unbound import"))
        _ <- IO(assert(!Files.exists(target.dataDir.resolve(RootMarker.Name.toString))))
      yield ()
    }.unsafeRunSync()
  }

  test("partial marker preparation replays only a matching prefix and the same immutable intent") {
    BackendFixture.configuration.use { (config,token,_) =>
      val authority=provider(originalVolume,originalPod)
      val fault=new RootMigrationCheckpoints:
        def reached(point: RootMigrationPoint): Unit =
          if point == RootMigrationPoint.TemporaryCreated then throw DomainError("owned-fault")
      for
        _ <- initialize(config,token)
        plan <- RootIdentityMigration.prepare(config,authority,"owned partial marker fixture")
        _ <- fails("owned-fault",RootIdentityMigration.applyPlan(config,authority,plan,plan.sha256,fault))
        _ <- fails("migration-plan-conflict",applyQuiet(config,plan.copy(continuityEvidence="different intent"),authority))
        temporary=config.dataDir.resolve(RootOwnership.TemporaryPrefix.toString+plan.sha256)
        _ <- IO.blocking(Files.write(temporary,Array((plan.marker.head ^ 1).toByte)))
        _ <- fails("migration-pending",applyQuiet(config,plan,authority))
        _ <- IO.blocking {
          assertEquals(Files.readAllBytes(temporary).toVector,Vector((plan.marker.head ^ 1).toByte))
          Files.write(temporary,plan.marker.take(11).toArray)
        }
        _ <- applyQuiet(config,plan,authority)
        _ <- IO(assertEquals(Files.readAllBytes(config.dataDir.resolve(RootMarker.Name.toString)).toVector,plan.marker))
      yield ()
    }.unsafeRunSync()
  }

  test("same-volume directory copies and replaced marker bytes do not acquire the binding") {
    BackendFixture.configuration.use { (config,token,_) =>
      val authority=provider(originalVolume,originalPod)
      for
        _ <- initialize(config,token)
        plan <- RootIdentityMigration.prepare(config,authority,"owned directory-copy fixture")
        _ <- applyQuiet(config,plan,authority)
        copied <- IO.blocking {
          val target=config.dataDir.resolveSibling("copied-root")
          Using.resource(Files.walk(config.dataDir)) { paths => paths.iterator().asScala.foreach { path =>
            val destination=target.resolve(config.dataDir.relativize(path))
            if Files.isDirectory(path,LinkOption.NOFOLLOW_LINKS) then Files.createDirectory(destination)
            else Files.copy(path,destination)
          }}
          config.copy(dataDir=target)
        }
        _ <- fails("authority-mismatch",Main.resourcesWithAuthority(copied,authority).use(_ => IO.unit))
        _ <- IO.blocking(Files.write(config.dataDir.resolve(RootMarker.Name.toString),plan.marker.map(byte => (byte ^ 1).toByte).toArray))
        _ <- fails("authority-mismatch",Main.resourcesWithAuthority(config,authority).use(_ => IO.unit))
      yield ()
    }.unsafeRunSync()
  }

  test("disabled receipt immutability guard is rejected rather than repaired") {
    BackendFixture.configuration.use { (config,token,_) =>
      val authority=provider(originalVolume,originalPod)
      for
        _ <- initialize(config,token)
        plan <- RootIdentityMigration.prepare(config,authority,"owned schema-tamper fixture")
        _ <- applyQuiet(config,plan,authority)
        _ <- database(config)(c => Jdbc.exec(c,"ALTER TABLE manure.root_identity_migrations DISABLE TRIGGER manure_root_identity_immutable"))
        _ <- fails("migration-receipt-invalid",Main.resourcesWithAuthority(config,authority).use(_ => IO.unit))
      yield ()
    }.unsafeRunSync()
  }

  test("wrong approval hash or stale authority witness causes no ownership effects") {
    BackendFixture.configuration.use { (config,token,_) =>
      val authority=provider(originalVolume,originalPod)
      for
        _ <- initialize(config,token)
        before <- state(config)
        plan <- RootIdentityMigration.prepare(config,authority,"owned stale plan fixture")
        _ <- fails("migration-plan-invalid",RootIdentityMigration.applyPlan(config,authority,plan,"0"*64,RootMigrationCheckpoints.quiet))
        _ <- fails("migration-plan-stale",applyQuiet(config,plan,provider("computedisk-other",originalPod)))
        _ <- fails("migration-plan-stale",applyQuiet(config,plan,provider(originalVolume,"44444444-4444-4444-8444-444444444444")))
        after <- state(config)
        _ <- IO {assertEquals(after,before);assert(!Files.exists(config.dataDir.resolve(RootMarker.Name.toString)))}
      yield ()
    }.unsafeRunSync()
  }

  test("applied receipt is immutable to ordinary SQL update and delete") {
    BackendFixture.configuration.use { (config,token,_) =>
      val authority=provider(originalVolume,originalPod)
      for
        _ <- initialize(config,token)
        plan <- RootIdentityMigration.prepare(config,authority,"owned immutable receipt fixture")
        _ <- applyQuiet(config,plan,authority)
        changed <- database(config)(c => Jdbc.exec(c,"UPDATE manure.root_identity_migrations SET status='pending'")).attempt
        removed <- database(config)(c => Jdbc.exec(c,"DELETE FROM manure.root_identity_migrations")).attempt
        _ <- IO {
          assertEquals(changed.left.toOption.collect {case e: JdbcFailure => e.sqlState},Some(Some("23514")))
          assertEquals(removed.left.toOption.collect {case e: JdbcFailure => e.sqlState},Some(Some("23514")))
        }
        replay <- applyQuiet(config,plan,authority)
        _ <- IO(assert(replay.replayed))
      yield ()
    }.unsafeRunSync()
  }

  test("private plan writer is create-new and cannot write through a payload-directory alias") {
    BackendFixture.configuration.use { (config,token,_) =>
      val authority=provider(originalVolume,originalPod)
      for
        _ <- initialize(config,token)
        plan <- RootIdentityMigration.prepare(config,authority,"owned plan file fixture")
        _ <- IO.blocking {
          val path=config.dataDir.getParent.resolve("reviewed-plan.json")
          RootMigrationPlan.writeNew(plan,path)
          assertEquals(RootMigrationPlan.read(path),plan)
          intercept[java.nio.file.FileAlreadyExistsException](RootMigrationPlan.writeNew(plan,path))
          val alias=config.dataDir.getParent.resolve("payload-alias")
          Files.createSymbolicLink(alias,config.dataDir)
          intercept[DomainError](RootMigrationPlan.writeNew(plan,alias.resolve("forbidden-plan.json")))
          assert(!Files.exists(config.dataDir.resolve("forbidden-plan.json")))
        }
      yield ()
    }.unsafeRunSync()
  }
