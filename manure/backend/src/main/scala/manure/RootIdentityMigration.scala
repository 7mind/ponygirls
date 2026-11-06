package manure

import cats.effect.{IO,Resource}
import manure.storage.{ConfinedDirectory,ExistingFileAccess,RelativeName}
import ponygirls.runtime.JdbcDatabase
import java.sql.Connection
import scala.util.Using

enum RootMigrationPoint:
  case PendingCommitted,TemporaryCreated,TemporarySynced,MarkerPublished,BeforeBindingCommit,AppliedCommitted

trait RootMigrationCheckpoints:
  def reached(point: RootMigrationPoint): Unit

object RootMigrationCheckpoints:
  def quiet: RootMigrationCheckpoints = new RootMigrationCheckpoints:
    def reached(point: RootMigrationPoint): Unit = ()

final case class RootMigrationResult(planSha256: String,replayed: Boolean,contextRefreshed: Boolean)
private final case class RootMigrationView(database: RootMigrationDatabase,binding: RootBinding,
  destination: Option[ImportedDestination],migration: Option[StoredRootMigration])

object RootIdentityMigration:
  private def resources(config: Config): Resource[IO,(RootDirectories,JdbcDatabase)] = for
    files <- RootDirectories.resource(config,true)
    database <- JdbcDatabase.resource(config.database)
  yield (files,database)
  private def view(config: Config,c: Connection): RootMigrationView =
    RootMigrationStore.noOtherClients(c)
    RootMigrationView(RootMigrationStore.database(config,c),RootBinding.decode(RootMigrationStore.binding(c)),
      RootMigrationStore.destination(c),RootMigrationStore.read(c))
  private def physical(value: RootBinding): PhysicalRootBinding = value match
    case found: PhysicalRootBinding => found
    case _ => throw DomainError("migration-not-legacy")
  private def observe(provider: RootAuthorityProvider,path: java.nio.file.Path,root: ConfinedDirectory): IO[RootVolumeWitness] =
    provider.resource(path).use(authority => IO.blocking(authority.observe(root)))
  def prepare(config: Config,provider: RootAuthorityProvider,continuityEvidence: String): IO[RootMigrationPlan] =
    resources(config).use { (files,database) => for
      before <- database.transaction { c =>
        c.setReadOnly(true);c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
        val result=view(config,c)
        Require(result.migration.isEmpty,"migration-pending")
        result
      }
      legacy=physical(before.binding)
      _ <- IO.blocking {
        Require(RootMarker.read(files.payload).isEmpty && !files.payload.hasRootEntryPrefix(RootOwnership.TemporaryPrefix,config.migrationManifestMaxEntries),"migration-pending")
        Require(legacy.inode == RootBinding.physical(files.payload).inode,"authority-mismatch")
      }
      witness <- observe(provider,config.dataDir,files.payload)
      imported <- before.destination match
        case Some(record) =>
          val control=files.control.getOrElse(throw DomainError("migration-required"))
          val path=config.migrationReceiptDir.getOrElse(throw DomainError("migration-required"))
          observe(provider,path,control).flatMap { current => IO.blocking {
            val imported=ImportReceipt.capture(config,files.payload,control,record,current.volume)
            Require(imported.payload == legacy,"migration-required")
            Some(imported)
          }}
        case None => IO.pure(None)
      plan <- IO.blocking {
        val nonce=new Array[Byte](RootMarker.Bytes);new java.security.SecureRandom().nextBytes(nonce)
        RootMigrationPlan(before.database,config.dataDir,config.migrationReceiptDir,legacy,RootBinding.physical(files.payload),witness,
          imported,before.destination,nonce.toVector,continuityEvidence)
      }
      _ <- database.transaction { c =>
        c.setReadOnly(true)
        Require(view(config,c) == before,"migration-plan-stale")
      }
    yield plan }
  private def validate(config: Config,plan: RootMigrationPlan,files: RootDirectories,current: RootMigrationView,witness: RootVolumeWitness): Unit =
    files.lease.validate();files.controlLease.foreach(_.validate())
    Require(config.dataDir == plan.payloadPath && config.migrationReceiptDir == plan.controlPath &&
      current.database == plan.database && current.destination == plan.destination &&
      witness.volume == plan.volume.volume,"migration-plan-stale")
    val observed=RootBinding.physical(files.payload)
    current.migration match
      case Some(receipt) =>
        Require(receipt.plan == plan,"migration-plan-conflict")
        Require(observed.inode == plan.observed.inode,"migration-plan-stale")
      case None =>
        Require(current.binding == plan.legacy && observed == plan.observed && witness == plan.volume,"migration-plan-stale")
  private def validateImport(config: Config,plan: RootMigrationPlan,files: RootDirectories,provider: RootAuthorityProvider): IO[Unit] =
    plan.imported match
      case Some(accepted) =>
        val control=files.control.getOrElse(throw DomainError("migration-required"))
        val path=config.migrationReceiptDir.getOrElse(throw DomainError("migration-required"))
        observe(provider,path,control).flatMap { witness => IO.blocking {
          Require(witness.volume == accepted.controlVolume && RootBinding.physical(control).inode == accepted.control.inode,"authority-mismatch")
          ImportReceipt.validate(config,files.payload,control,plan.destination.getOrElse(throw DomainError("migration-required")),false,true,Some(accepted))
        }}
      case None => IO.unit
  private def temporary(plan: RootMigrationPlan): RelativeName = RelativeName.parse(RootOwnership.TemporaryPrefix.toString+plan.sha256)
  private def installMarker(files: RootDirectories,plan: RootMigrationPlan,steps: RootMigrationCheckpoints,maxRootEntries: Int): Unit =
    val root=files.payload
    RootMarker.read(root) match
      case Some(existing) =>
        Require(existing.toVector == plan.marker && !root.hasRootEntryPrefix(RootOwnership.TemporaryPrefix,maxRootEntries),"migration-pending")
      case None =>
        val name=temporary(plan)
        val file=try root.openExistingFile(name,ExistingFileAccess.ReadWrite)
          catch case _: java.nio.file.NoSuchFileException =>
            val created=root.createFile(name)
            try steps.reached(RootMigrationPoint.TemporaryCreated)
            catch case scala.util.control.NonFatal(error) =>
              created.close()
              throw error
            created
        Using.resource(file) { open =>
          val size=open.size();Require(size >= 0 && size <= RootMarker.Bytes,"migration-pending")
          val prefix=open.read(0,RootMarker.Bytes+1)
          Require(prefix.toVector == plan.marker.take(size.toInt) && open.size() == size,"migration-pending")
          open.write(size,plan.marker.drop(size.toInt).toArray);open.forceFile()
        }
        steps.reached(RootMigrationPoint.TemporarySynced)
        root.moveNew(name,RootMarker.Name);root.forceRootDirectory()
        Require(RootMarker.read(root).exists(_.toVector == plan.marker),"migration-pending")
    steps.reached(RootMigrationPoint.MarkerPublished)
  def applyPlan(config: Config,provider: RootAuthorityProvider,plan: RootMigrationPlan,expectedSha256: String,
    steps: RootMigrationCheckpoints): IO[RootMigrationResult] = IO.defer {
    Require(expectedSha256.matches("[0-9a-f]{64}") && expectedSha256 == plan.sha256,"migration-plan-invalid")
    resources(config).use { (files,database) => for
      witness <- observe(provider,config.dataDir,files.payload)
      _ <- IO.blocking(Require(witness.volume == plan.volume.volume,"migration-plan-stale"))
      _ <- validateImport(config,plan,files,provider)
      before <- database.transaction { c =>
        Jdbc.exec(c,"LOCK TABLE manure.root_owner IN ACCESS EXCLUSIVE MODE")
        val current=view(config,c);validate(config,plan,files,current,witness)
        current.migration match
          case Some(receipt) if receipt.status == "applied" =>
            Require(current.binding == plan.portable,"migration-receipt-invalid")
          case Some(receipt) =>
            Require(receipt.status == "pending" && current.binding == plan.legacy,"migration-receipt-invalid")
          case None =>
            Require(RootMarker.read(files.payload).isEmpty && !files.payload.hasRootEntryPrefix(RootOwnership.TemporaryPrefix,config.migrationManifestMaxEntries),"migration-pending")
            RootMigrationStore.begin(c,plan)
        current
      }
      contextRefreshed=witness != plan.volume || RootBinding.physical(files.payload) != plan.observed
      result <- before.migration match
        case Some(receipt) if receipt.status == "applied" => IO.blocking {
          Require(RootMarker.binding(files.payload,witness) == plan.portable &&
            !files.payload.hasRootEntryPrefix(RootOwnership.TemporaryPrefix,config.migrationManifestMaxEntries),"migration-receipt-invalid")
          RootMigrationResult(plan.sha256,true,contextRefreshed)
        }
        case _ =>
          for
            _ <- IO.blocking {steps.reached(RootMigrationPoint.PendingCommitted);installMarker(files,plan,steps,config.migrationManifestMaxEntries)}
            _ <- database.transaction { c =>
              Jdbc.exec(c,"LOCK TABLE manure.root_owner IN ACCESS EXCLUSIVE MODE")
              val current=view(config,c);validate(config,plan,files,current,witness)
              Require(current.binding == plan.legacy && current.migration.exists(receipt => receipt.status == "pending" && receipt.plan == plan),"migration-plan-stale")
              Require(RootMarker.binding(files.payload,witness) == plan.portable,"migration-pending")
              steps.reached(RootMigrationPoint.BeforeBindingCommit)
              RootMigrationStore.finish(c,plan)
            }
            _ <- IO.blocking(steps.reached(RootMigrationPoint.AppliedCommitted))
          yield RootMigrationResult(plan.sha256,false,contextRefreshed)
    yield result }
  }
