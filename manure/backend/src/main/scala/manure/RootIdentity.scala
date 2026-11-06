package manure

import io.circe.Json
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.Path
import manure.storage.{ConfinedDirectory,ExistingFileAccess,RelativeName}
import scala.util.Using

final case class RootVolume(driver: String,handle: String):
  Require(RootVolume.validDriver(driver) && RootVolume.validHandle(handle),"authority-unavailable")
  def digest: String = SecretCodec.sha256(Json.arr(Json.fromString("manure-csi-volume-v1"),Json.fromString(driver),Json.fromString(handle)).noSpaces.getBytes(UTF_8))

object RootVolume:
  val MaxHandleBytes: Int = 256
  private val MaxDriverCharacters: Int = 253
  def validHandle(value: String): Boolean =
    value.nonEmpty && value.length <= MaxHandleBytes && UTF_8.newEncoder().canEncode(value) &&
      value.getBytes(UTF_8).length <= MaxHandleBytes && !value.exists(character => Character.isISOControl(character))
  def validDriver(value: String): Boolean =
    value.length <= MaxDriverCharacters && value.contains(".") &&
      value.split("\\.",-1).forall(_.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"))

final case class RootVolumeWitness(volume: RootVolume,podUid: String,pvcUid: String,pvUid: String,mountPath: Path)

trait RootVolumeAuthority:
  def observe(root: ConfinedDirectory): RootVolumeWitness

sealed trait RootBinding:
  def inode: Long
  def bytes: Array[Byte]

final case class PhysicalRootBinding(device: Long,inode: Long) extends RootBinding:
  Require(inode != 0,"root-binding-invalid")
  def bytes: Array[Byte] = ByteBuffer.allocate(16).putLong(device).putLong(inode).array()

final case class PortableRootBinding(volumeDigest: String,inode: Long,markerDigest: String) extends RootBinding:
  Require(volumeDigest.matches("[0-9a-f]{64}") && markerDigest.matches("[0-9a-f]{64}") && inode != 0,"root-binding-invalid")
  def bytes: Array[Byte] = ByteBuffer.allocate(RootBinding.PortableBytes).put(RootBinding.Magic.getBytes(UTF_8))
    .put(java.util.HexFormat.of().parseHex(volumeDigest)).putLong(inode)
    .put(java.util.HexFormat.of().parseHex(markerDigest)).array()

object RootBinding:
  val Magic: String = "MNR2"
  val PortableBytes: Int = 76
  def physical(root: ConfinedDirectory): PhysicalRootBinding =
    val observed=root.physicalIdentity
    Require(observed.size == 2,"root-binding-invalid")
    PhysicalRootBinding(observed(0),observed(1))
  def decode(bytes: Array[Byte]): RootBinding =
    val input=ByteBuffer.wrap(bytes)
    if bytes.length == 16 then PhysicalRootBinding(input.getLong(),input.getLong())
    else
      Require(bytes.length == PortableBytes,"root-binding-invalid")
      val magic=new Array[Byte](Magic.length);input.get(magic)
      Require(java.util.Arrays.equals(magic,Magic.getBytes(UTF_8)),"root-binding-invalid")
      val volume=new Array[Byte](32);input.get(volume)
      val inode=input.getLong()
      val marker=new Array[Byte](32);input.get(marker)
      PortableRootBinding(java.util.HexFormat.of().formatHex(volume),inode,java.util.HexFormat.of().formatHex(marker))

object RootMarker:
  val Name: RelativeName = RelativeName.parse(".manure-root-owner-v2")
  val Bytes: Int = 32
  def read(root: ConfinedDirectory): Option[Array[Byte]] =
    try Some(Using.resource(root.openExistingFile(Name,ExistingFileAccess.ReadOnly)) { file =>
      Require(file.size() == Bytes,"migration-pending")
      val bytes=file.read(0,Bytes+1)
      Require(bytes.length == Bytes && file.size() == Bytes,"migration-pending")
      bytes
    })
    catch case _: java.nio.file.NoSuchFileException => None
  def binding(root: ConfinedDirectory,witness: RootVolumeWitness): PortableRootBinding =
    val marker=read(root).getOrElse(throw DomainError("migration-pending"))
    PortableRootBinding(witness.volume.digest,RootBinding.physical(root).inode,SecretCodec.sha256(marker))
