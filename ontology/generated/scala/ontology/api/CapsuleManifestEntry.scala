import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CapsuleManifestEntry(
    ref: Ref,
    partition: CapsulePartition,
    roles: List[CapsuleRole],
    evidence: List[Ref]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CapsuleManifestEntry.baboonDomainVersion
    override def baboonDomainIdentifier: String = CapsuleManifestEntry.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CapsuleManifestEntry.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CapsuleManifestEntry.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CapsuleManifestEntry.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CapsuleManifestEntry.baboonMinReaderVersions
  }
  
  object CapsuleManifestEntry {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CapsuleManifestEntry"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CapsuleManifestEntry] = CapsuleManifestEntry_JsonCodec.instance
  }
  
  object CapsuleManifestEntry_JsonCodec extends BaboonJsonCodec.BaseGenerated[CapsuleManifestEntry, BaboonJsonCodec[CapsuleManifestEntry]] {
    def encode(ctx: BaboonCodecContext, value: CapsuleManifestEntry): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref),
        "partition" -> CapsulePartition_JsonCodec.instance.encode(ctx, value.partition),
        "roles" -> Json.fromValues(value.roles.map(e => CapsuleRole_JsonCodec.instance.encode(ctx, e))),
        "evidence" -> Json.fromValues(value.evidence.map(e => Ref_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CapsuleManifestEntry] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            partition <- getField(jsonObject, "partition").flatMap(v => CapsulePartition_JsonCodec.circeDecoder(v.hcursor))
            roles <- getField(jsonObject, "roles").flatMap(v => decodeList(CapsuleRole_JsonCodec.circeDecoder)(v.hcursor))
            evidence <- getField(jsonObject, "evidence").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
          } yield CapsuleManifestEntry(ref,partition,roles,evidence)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CapsuleManifestEntry: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CapsuleManifestEntry.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CapsuleManifestEntry.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CapsuleManifestEntry.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CapsuleManifestEntry]] = Lazy(CapsuleManifestEntry_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CapsuleManifestEntry]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CapsuleManifestEntry] = LazyInstance.value
  }
}