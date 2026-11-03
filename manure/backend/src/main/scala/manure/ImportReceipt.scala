package manure

import manure.storage.{ConfinedDirectory,ExistingFileAccess,RelativeName}
import io.circe.{Json,JsonObject}
import scala.util.Using

final case class ImportedDestination(id: String,root: String,source: String,writesStarted: Boolean)

/** First adoption is NOT a path-name check. The converter's exact completion
  * digest binds the copied payload inode and every raw directory/file/hash.
  * Validation runs with both claims held, outside a long JDBC transaction.
  * Restart after acknowledged target writes validates identities but does not
  * compare mutable target bytes to an obsolete pre-write snapshot.
  */
object ImportReceipt:
  private def bad(): Nothing = throw DomainError("migration-required")
  private def obj(value: Json,keys: Set[String]): JsonObject =
    val objectValue=value.asObject.getOrElse(bad())
    Require(objectValue.keys.toSet == keys,"migration-required");objectValue
  private def text(value: Json,key: String): String = value.hcursor.get[String](key).getOrElse(bad())
  private def unsigned(value: Json,key: String): String =
    val number=value.hcursor.get[BigInt](key).getOrElse(bad())
    Require(number >= 0 && number <= BigInt("18446744073709551615"),"migration-required");number.toString
  private def read(root: ConfinedDirectory,name: String,maxBytes: Int): Array[Byte] =
    Using.resource(root.openExistingFile(RelativeName.parse(name),ExistingFileAccess.ReadOnly)) { file =>
      val size=file.size()
      Require(size > 0 && size <= maxBytes,"migration-required")
      val bytes=file.read(0,size.toInt)
      Require(bytes.length == size && file.size() == size,"migration-required");bytes
    }
  def rootBytes(root: ConfinedDirectory): Array[Byte] =
    val buffer=java.nio.ByteBuffer.allocate(16)
    root.physicalIdentity.foreach(buffer.putLong);buffer.array()
  def validate(config: Config,payload: ConfinedDirectory,control: ConfinedDirectory,
    record: ImportedDestination,firstAdoption: Boolean,requireWritable: Boolean): Unit =
    try
      Require(config.migrationReceiptDir.exists(_.toString == record.root) && (!requireWritable || record.writesStarted) &&
        record.id.matches("[0-9a-f]{32}") && record.source.matches("[0-9a-f]{64}"),"migration-required")
      val owner=CurrentWire.parse(Exact.string(read(control,"OWNER.json",16384)))
      val controlId=control.physicalIdentity.map(java.lang.Long.toUnsignedString)
      Require(text(owner,"format") == "manure-offline-1" && text(owner,"id") == record.id && text(owner,"root") == record.root &&
        unsigned(owner,"device") == controlId(0) && unsigned(owner,"inode") == controlId(1),"migration-required")
      val complete=CurrentWire.parse(Exact.string(read(control,"COMPLETE",16384)))
      obj(complete,Set("source","destination","payloadManifestSha256"))
      val digest=text(complete,"payloadManifestSha256")
      Require(text(complete,"source") == record.source && text(complete,"destination") == record.id && digest.matches("[0-9a-f]{64}"),"migration-required")
      val manifestBytes=read(control,"PAYLOAD.json",config.migrationManifestMaxBytes)
      Require(SecretCodec.sha256(manifestBytes) == digest,"migration-required")
      val manifest=CurrentWire.parse(Exact.string(manifestBytes))
      obj(manifest,Set("format","source","destination","device","inode","entries"))
      val physical=payload.physicalIdentity.map(java.lang.Long.toUnsignedString)
      Require(text(manifest,"format") == "manure-payload-1" && text(manifest,"source") == record.source && text(manifest,"destination") == record.id &&
        unsigned(manifest,"device") == physical(0) && unsigned(manifest,"inode") == physical(1),"migration-required")
      if firstAdoption then
        val entries=manifest.hcursor.get[Vector[Json]]("entries").getOrElse(bad())
        Require(entries.nonEmpty && entries.size <= config.migrationManifestMaxEntries,"migration-required")
        var total=0L
        val paths=scala.collection.mutable.HashSet.empty[String]
        entries.foreach { entry =>
          val path=text(entry,"path");val kind=text(entry,"kind")
          Require(path.matches("(?:[0-9a-f]{2})*") && paths.add(path),"migration-required")
          kind match
            case "dir" => obj(entry,Set("path","kind"))
            case "file" =>
              obj(entry,Set("path","kind","size","sha256"))
              val size=entry.hcursor.get[Long]("size").getOrElse(bad())
              Require(size >= 0 && size <= Long.MaxValue-total && text(entry,"sha256").matches("[0-9a-f]{64}"),"migration-required")
              total += size
            case _ => bad()
        }
        Require(text(entries.head,"path").isEmpty && text(entries.head,"kind") == "dir","migration-required")
        val actual=payload.inventory(config.migrationManifestMaxEntries,68,total).map { entry =>
          if entry.directory then Json.obj("path" -> Json.fromString(entry.pathHex),"kind" -> Json.fromString("dir"))
          else Json.obj("path" -> Json.fromString(entry.pathHex),"kind" -> Json.fromString("file"),"size" -> Json.fromLong(entry.size),"sha256" -> Json.fromString(entry.sha256))
        }
        Require(actual == entries,"migration-required")
      // Revalidate configured roots after the possibly long hash pass, before any
      // DB root adoption; same-UID hostile file mutation is outside the boundary.
      payload.physicalIdentity;control.physicalIdentity
    catch
      case _: java.io.IOException | _: IllegalArgumentException | _: DomainError => bad()
