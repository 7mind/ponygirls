import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CapsuleManifest(
    entries: List[CapsuleManifestEntry],
    changes: List[CapsuleChange],
    qualifications: List[CapsuleQualification]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CapsuleManifest.baboonDomainVersion
    override def baboonDomainIdentifier: String = CapsuleManifest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CapsuleManifest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CapsuleManifest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CapsuleManifest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CapsuleManifest.baboonMinReaderVersions
  }
  
  object CapsuleManifest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CapsuleManifest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CapsuleManifest] = CapsuleManifest_JsonCodec.instance
  }
  
  object CapsuleManifest_JsonCodec extends BaboonJsonCodec.BaseGenerated[CapsuleManifest, BaboonJsonCodec[CapsuleManifest]] {
    def encode(ctx: BaboonCodecContext, value: CapsuleManifest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "entries" -> Json.fromValues(value.entries.map(e => CapsuleManifestEntry_JsonCodec.instance.encode(ctx, e))),
        "changes" -> Json.fromValues(value.changes.map(e => CapsuleChange_JsonCodec.instance.encode(ctx, e))),
        "qualifications" -> Json.fromValues(value.qualifications.map(e => CapsuleQualification_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CapsuleManifest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            entries <- getField(jsonObject, "entries").flatMap(v => decodeList(CapsuleManifestEntry_JsonCodec.circeDecoder)(v.hcursor))
            changes <- getField(jsonObject, "changes").flatMap(v => decodeList(CapsuleChange_JsonCodec.circeDecoder)(v.hcursor))
            qualifications <- getField(jsonObject, "qualifications").flatMap(v => decodeList(CapsuleQualification_JsonCodec.circeDecoder)(v.hcursor))
          } yield CapsuleManifest(entries,changes,qualifications)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CapsuleManifest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CapsuleManifest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CapsuleManifest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CapsuleManifest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CapsuleManifest]] = Lazy(CapsuleManifest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CapsuleManifest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CapsuleManifest] = LazyInstance.value
  }
}