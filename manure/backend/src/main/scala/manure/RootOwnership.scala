package manure

import cats.effect.IO
import java.sql.Connection
import manure.storage.{ConfinedDirectory,RelativeName}

final case class RootOwnershipState(destination: Option[ImportedDestination],binding: Option[RootBinding],
  emptyArtifacts: Boolean,migration: Option[StoredRootMigration])
final case class AcceptedRootOwnership(binding: RootBinding,imported: Option[ImportedRootWitness]):
  def revalidate(root: ConfinedDirectory): Unit =
    val actual=binding match
      case _: PhysicalRootBinding => RootBinding.physical(root)
      case portable: PortableRootBinding =>
        val marker=RootMarker.read(root).getOrElse(throw DomainError("migration-pending"))
        PortableRootBinding(portable.volumeDigest,RootBinding.physical(root).inode,SecretCodec.sha256(marker))
    Require(actual == binding,"migration-required")

object RootOwnership:
  val TemporaryPrefix: RelativeName = RelativeName.parse(".manure-root-prepare-")
  def read(c: Connection): RootOwnershipState =
    val record=RootMigrationStore.destination(c)
    val bound=if Jdbc.rows(c,"SELECT to_regclass('manure.root_owner') IS NOT NULL")(_.getBoolean(1)).head then
      val rows=Jdbc.rows(c,"SELECT identity FROM manure.root_owner WHERE singleton")(_.getBytes(1))
      Require(rows.size <= 1,"migration-required");rows.headOption.map(RootBinding.decode)
    else None
    val hasArtifacts=Jdbc.rows(c,"SELECT to_regclass('manure.artifacts') IS NOT NULL")(_.getBoolean(1)).head
    val empty= !hasArtifacts || Jdbc.rows(c,"SELECT NOT EXISTS(SELECT 1 FROM manure.artifacts)")(_.getBoolean(1)).head
    RootOwnershipState(record,bound,empty,RootMigrationStore.read(c))
  def verify(config: Config,files: RootDirectories,state: RootOwnershipState,
    provider: Option[RootAuthorityProvider]): IO[AcceptedRootOwnership] =
    state.binding match
      case Some(portable: PortableRootBinding) =>
        val authority=provider.getOrElse(throw DomainError("authority-required"))
        val receipt=state.migration.getOrElse(throw DomainError("migration-receipt-invalid"))
        Require(receipt.status == "applied" && receipt.plan.portable == portable && receipt.plan.destination == state.destination,"migration-receipt-invalid")
        for
          witness <- authority.resource(config.dataDir).use(value => IO.blocking(value.observe(files.payload)))
          _ <- IO.blocking {
            Require(RootMarker.binding(files.payload,witness) == portable,"authority-mismatch")
            Require(!files.payload.hasRootEntryPrefix(TemporaryPrefix,config.migrationManifestMaxEntries),"migration-pending")
          }
          _ <- receipt.plan.imported match
            case Some(imported) =>
              val control=files.control.getOrElse(throw DomainError("migration-required"))
              val path=config.migrationReceiptDir.getOrElse(throw DomainError("migration-required"))
              authority.resource(path).use { value => IO.blocking {
                Require(value.observe(control).volume == imported.controlVolume && RootBinding.physical(control).inode == imported.control.inode,"authority-mismatch")
              }}
            case None => IO.unit
        yield AcceptedRootOwnership(portable,receipt.plan.imported)
      case legacy => IO.blocking {
        Require(state.migration.isEmpty && RootMarker.read(files.payload).isEmpty &&
          !files.payload.hasRootEntryPrefix(TemporaryPrefix,config.migrationManifestMaxEntries),"migration-pending")
        Require(provider.isEmpty,"migration-required")
        val observed=RootBinding.physical(files.payload)
        Require(legacy.forall(_ == observed),"migration-required")
        AcceptedRootOwnership(observed,None)
      }
