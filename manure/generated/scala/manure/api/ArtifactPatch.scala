import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class ArtifactPatch(
    name: Option[String],
    visibility: Option[Visibility],
    expiry: ExpiryChange
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ArtifactPatch.baboonDomainVersion
    override def baboonDomainIdentifier: String = ArtifactPatch.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ArtifactPatch.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ArtifactPatch.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ArtifactPatch.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ArtifactPatch.baboonMinReaderVersions
  }
  
  object ArtifactPatch {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#ArtifactPatch"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ArtifactPatch] = ArtifactPatch_JsonCodec.instance
  }
  
  object ArtifactPatch_JsonCodec extends BaboonJsonCodec.BaseGenerated[ArtifactPatch, BaboonJsonCodec[ArtifactPatch]] {
    def encode(ctx: BaboonCodecContext, value: ArtifactPatch): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "name" -> value.name.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "visibility" -> value.visibility.map(v => Visibility_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "expiry" -> ExpiryChange_JsonCodec.instance.encode(ctx, value.expiry)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ArtifactPatch] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            name <- getField(jsonObject, "name").flatMap(v => decodeOption(decodeString)(v.hcursor))
            visibility <- getField(jsonObject, "visibility").flatMap(v => decodeOption(Visibility_JsonCodec.circeDecoder)(v.hcursor))
            expiry <- getField(jsonObject, "expiry").flatMap(v => ExpiryChange_JsonCodec.circeDecoder(v.hcursor))
          } yield ArtifactPatch(name,visibility,expiry)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ArtifactPatch: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ArtifactPatch.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ArtifactPatch.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ArtifactPatch.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ArtifactPatch]] = Lazy(ArtifactPatch_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ArtifactPatch]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ArtifactPatch] = LazyInstance.value
  }
}