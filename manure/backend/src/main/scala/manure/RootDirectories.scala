package manure

import cats.effect.{IO,Resource}
import cats.syntax.all.*
import manure.storage.{ConfinedDirectory,ExistingFileAccess,PosixNative,RelativeName,RootLease}
import scala.util.Using

final case class RootDirectories(payload: ConfinedDirectory,lease: RootLease,
  control: Option[ConfinedDirectory],controlLease: Option[RootLease])

object RootDirectories:
  /** Physical claims and leases precede JDBC, schema, recovery and HTTP. */
  def resource(config: Config,rejectLegacySqlite: Boolean): Resource[IO,RootDirectories] = for
    _ <- Resource.eval(IO(config.validate()))
    bridge <- Resource.eval(IO.blocking {
      config.nativeMode match
        case "shared" => PosixNative.shared(config.posixLibrary.get)
        case "linked" => PosixNative.linked()
        case _ => throw DomainError("config")
    })
    payload <- Resource.make(IO.blocking(ConfinedDirectory.open(config.dataDir,bridge)))(root => IO.blocking(root.close()))
    lease <- Resource.make(IO.blocking(payload.lease()))(value => IO.blocking(value.close()))
    control <- config.migrationReceiptDir.traverse { path =>
      Resource.make(IO.blocking(ConfinedDirectory.open(path,bridge)))(root => IO.blocking(root.close()))
    }
    controlLease <- control.traverse { root => Resource.make(IO.blocking(root.lease()))(value => IO.blocking(value.close())) }
    _ <- Resource.eval(IO.blocking {
      if rejectLegacySqlite then
        val legacy=try
          Using.resource(payload.openExistingFile(RelativeName.parse("manure.db"),ExistingFileAccess.ReadOnly))(_ => true)
        catch case _: java.nio.file.NoSuchFileException => false
        Require(!legacy,"migration-required")
    })
  yield RootDirectories(payload,lease,control,controlLease)

trait RootAuthorityProvider:
  def resource(path: java.nio.file.Path): Resource[IO,RootVolumeAuthority]

object RootAuthorityProvider:
  def kubernetes(settings: KubernetesRootConfig): RootAuthorityProvider = new RootAuthorityProvider:
    def resource(path: java.nio.file.Path): Resource[IO,RootVolumeAuthority] =
      KubernetesRootAuthority.resource(settings,path,new KernelRootMounts(java.nio.file.Path.of("/proc/self/mountinfo")))
        .map(identity[RootVolumeAuthority])
  def configured(config: Config): RootAuthorityProvider =
    kubernetes(config.rootAuthority.getOrElse(throw DomainError("authority-required")))
