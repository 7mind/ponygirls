package manure

import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files,Path,StandardOpenOption}
import java.nio.file.attribute.PosixFilePermissions
import ponygirls.runtime.BoundedSecretFile
import scala.util.Using

final case class RootMigrationDatabase(url: String,user: String,name: String,oid: Long)
final case class RootMigrationPlan(database: RootMigrationDatabase,payloadPath: Path,controlPath: Option[Path],
  legacy: PhysicalRootBinding,observed: PhysicalRootBinding,volume: RootVolumeWitness,
  imported: Option[ImportedRootWitness],destination: Option[ImportedDestination],marker: Vector[Byte],continuityEvidence: String):
  Require(payloadPath.isAbsolute && controlPath.forall(_.isAbsolute) && marker.size == RootMarker.Bytes &&
    legacy.inode == observed.inode && database.oid > 0 && database.name.nonEmpty &&
    continuityEvidence.nonEmpty && continuityEvidence.length <= 2048 && !continuityEvidence.exists(_.isControl) &&
    imported.nonEmpty == destination.nonEmpty,"migration-plan-invalid")
  def portable: PortableRootBinding = PortableRootBinding(volume.volume.digest,observed.inode,SecretCodec.sha256(marker.toArray))
  def json: Json = RootMigrationPlan.encode(this)
  def bytes: Array[Byte] = json.noSpacesSortKeys.getBytes(UTF_8)
  def sha256: String = SecretCodec.sha256(bytes)

object RootMigrationPlan:
  val MaximumBytes: Int = 32768
  private def string(value: String): Json = Json.fromString(value)
  private def path(value: Path): Json = string(value.toString)
  private def volume(value: RootVolume): Json = Json.obj("driver" -> string(value.driver),"handle" -> string(value.handle))
  private def physical(value: PhysicalRootBinding): Json = string(java.util.HexFormat.of().formatHex(value.bytes))
  private def imported(value: ImportedRootWitness): Json = Json.obj("controlVolume" -> volume(value.controlVolume),
    "control" -> physical(value.control),"payload" -> physical(value.payload),"ownerSha256" -> string(value.ownerSha256),
    "completeSha256" -> string(value.completeSha256),"manifestSha256" -> string(value.manifestSha256))
  private def destination(value: ImportedDestination): Json = Json.obj("id" -> string(value.id),"root" -> string(value.root),
    "source" -> string(value.source),"writesStarted" -> Json.fromBoolean(value.writesStarted))
  def encode(value: RootMigrationPlan): Json = Json.obj(
    "format" -> string("manure-root-migration-v1"),
    "database" -> Json.obj("url" -> string(value.database.url),"user" -> string(value.database.user),"name" -> string(value.database.name),"oid" -> Json.fromLong(value.database.oid)),
    "payloadPath" -> path(value.payloadPath),"controlPath" -> value.controlPath.fold(Json.Null)(path),
    "legacy" -> physical(value.legacy),"observed" -> physical(value.observed),
    "volume" -> Json.obj("identity" -> volume(value.volume.volume),"podUid" -> string(value.volume.podUid),
      "pvcUid" -> string(value.volume.pvcUid),"pvUid" -> string(value.volume.pvUid),"mountPath" -> path(value.volume.mountPath)),
    "imported" -> value.imported.fold(Json.Null)(imported),"destination" -> value.destination.fold(Json.Null)(destination),
    "marker" -> string(java.util.HexFormat.of().formatHex(value.marker.toArray)),"continuityEvidence" -> string(value.continuityEvidence))
  private def exact(value: Json,keys: Set[String]): Unit =
    Require(value.asObject.exists(_.keys.toSet == keys),"migration-plan-invalid")
  private def child(value: Json,key: String): Json = value.hcursor.downField(key).focus.getOrElse(throw DomainError("migration-plan-invalid"))
  private def text(value: Json,key: String): String = child(value,key).asString.getOrElse(throw DomainError("migration-plan-invalid"))
  private def optional[A](value: Json,key: String)(parse: Json => A): Option[A] =
    val found=child(value,key);if found.isNull then None else Some(parse(found))
  private def decodeVolume(value: Json): RootVolume =
    exact(value,Set("driver","handle"));RootVolume(text(value,"driver"),text(value,"handle"))
  private def decodePhysical(value: Json): PhysicalRootBinding =
    val text=value.asString.getOrElse(throw DomainError("migration-plan-invalid"))
    Require(text.matches("[0-9a-f]{32}"),"migration-plan-invalid")
    RootBinding.decode(java.util.HexFormat.of().parseHex(text)) match
      case physical: PhysicalRootBinding => physical
      case _ => throw DomainError("migration-plan-invalid")
  def decode(value: Json): RootMigrationPlan =
    exact(value,Set("format","database","payloadPath","controlPath","legacy","observed","volume","imported","destination","marker","continuityEvidence"))
    Require(text(value,"format") == "manure-root-migration-v1","migration-plan-invalid")
    val db=child(value,"database");exact(db,Set("url","user","name","oid"))
    val witness=child(value,"volume");exact(witness,Set("identity","podUid","pvcUid","pvUid","mountPath"))
    val marker=text(value,"marker");Require(marker.matches("[0-9a-f]{64}"),"migration-plan-invalid")
    val imported=optional(value,"imported") { found =>
      exact(found,Set("controlVolume","control","payload","ownerSha256","completeSha256","manifestSha256"))
      ImportedRootWitness(decodeVolume(child(found,"controlVolume")),decodePhysical(child(found,"control")),decodePhysical(child(found,"payload")),
        text(found,"ownerSha256"),text(found,"completeSha256"),text(found,"manifestSha256"))
    }
    val record=optional(value,"destination") { found =>
      exact(found,Set("id","root","source","writesStarted"))
      ImportedDestination(text(found,"id"),text(found,"root"),text(found,"source"),
        child(found,"writesStarted").asBoolean.getOrElse(throw DomainError("migration-plan-invalid")))
    }
    RootMigrationPlan(RootMigrationDatabase(text(db,"url"),text(db,"user"),text(db,"name"),
      child(db,"oid").asNumber.flatMap(_.toLong).getOrElse(throw DomainError("migration-plan-invalid"))),
      Path.of(text(value,"payloadPath")),optional(value,"controlPath")(found => Path.of(found.asString.getOrElse(throw DomainError("migration-plan-invalid")))),
      decodePhysical(child(value,"legacy")),decodePhysical(child(value,"observed")),
      RootVolumeWitness(decodeVolume(child(witness,"identity")),text(witness,"podUid"),text(witness,"pvcUid"),text(witness,"pvUid"),Path.of(text(witness,"mountPath"))),
      imported,record,java.util.HexFormat.of().parseHex(marker).toVector,text(value,"continuityEvidence"))
  def read(path: Path): RootMigrationPlan =
    Require(path.isAbsolute && !path.startsWith(Path.of("/nix/store")),"migration-plan-invalid")
    try decode(CurrentWire.parse(BoundedSecretFile.read(path,MaximumBytes)))
    catch case scala.util.control.NonFatal(_) => throw DomainError("migration-plan-invalid")
  def writeNew(plan: RootMigrationPlan,path: Path): Unit =
    Require(path.isAbsolute && path == path.normalize() && !path.startsWith(Path.of("/nix/store")) &&
      plan.bytes.length <= MaximumBytes,"migration-plan-invalid")
    val destination=path.getParent.toRealPath().resolve(path.getFileName)
    Require(!destination.startsWith(plan.payloadPath.toRealPath()) &&
      !plan.controlPath.exists(control => destination.startsWith(control.toRealPath())),"migration-plan-invalid")
    Files.createFile(destination,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))
    Using.resource(java.nio.channels.FileChannel.open(destination,StandardOpenOption.WRITE)) { channel =>
      val bytes=java.nio.ByteBuffer.wrap(plan.bytes)
      while bytes.hasRemaining do channel.write(bytes)
      channel.force(true)
    }
    Using.resource(java.nio.channels.FileChannel.open(destination.getParent,StandardOpenOption.READ))(_.force(true))
