import io.circe.Decoder.{decodeBoolean, decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class Capabilities(
    contentMode: ContentMode,
    searchModes: List[SearchMode],
    metadataOnlySearch: Boolean,
    chunkBytes: Int,
    maxListLimit: Int,
    maxRequestBodyBytes: Long,
    maxFileBytes: Long,
    maxArtifactBytes: Long,
    maxFilesPerArtifact: Int,
    maxTtlSeconds: Int,
    cataloguePolicy: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Capabilities.baboonDomainVersion
    override def baboonDomainIdentifier: String = Capabilities.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Capabilities.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Capabilities.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Capabilities.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Capabilities.baboonMinReaderVersions
  }
  
  object Capabilities {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#Capabilities"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Capabilities] = Capabilities_JsonCodec.instance
  }
  
  object Capabilities_JsonCodec extends BaboonJsonCodec.BaseGenerated[Capabilities, BaboonJsonCodec[Capabilities]] {
    def encode(ctx: BaboonCodecContext, value: Capabilities): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "contentMode" -> ContentMode_JsonCodec.instance.encode(ctx, value.contentMode),
        "searchModes" -> Json.fromValues(value.searchModes.map(e => SearchMode_JsonCodec.instance.encode(ctx, e))),
        "metadataOnlySearch" -> Json.fromBoolean(value.metadataOnlySearch),
        "chunkBytes" -> Json.fromInt(value.chunkBytes),
        "maxListLimit" -> Json.fromInt(value.maxListLimit),
        "maxRequestBodyBytes" -> Json.fromString(value.maxRequestBodyBytes.toString),
        "maxFileBytes" -> Json.fromString(value.maxFileBytes.toString),
        "maxArtifactBytes" -> Json.fromString(value.maxArtifactBytes.toString),
        "maxFilesPerArtifact" -> Json.fromInt(value.maxFilesPerArtifact),
        "maxTtlSeconds" -> Json.fromInt(value.maxTtlSeconds),
        "cataloguePolicy" -> Json.fromString(value.cataloguePolicy)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Capabilities] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            contentMode <- getField(jsonObject, "contentMode").flatMap(v => ContentMode_JsonCodec.circeDecoder(v.hcursor))
            searchModes <- getField(jsonObject, "searchModes").flatMap(v => decodeList(SearchMode_JsonCodec.circeDecoder)(v.hcursor))
            metadataOnlySearch <- getField(jsonObject, "metadataOnlySearch").flatMap(v => decodeBoolean(v.hcursor))
            chunkBytes <- getField(jsonObject, "chunkBytes").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maxListLimit <- getField(jsonObject, "maxListLimit").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maxRequestBodyBytes <- getField(jsonObject, "maxRequestBodyBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            maxFileBytes <- getField(jsonObject, "maxFileBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            maxArtifactBytes <- getField(jsonObject, "maxArtifactBytes").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            maxFilesPerArtifact <- getField(jsonObject, "maxFilesPerArtifact").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            maxTtlSeconds <- getField(jsonObject, "maxTtlSeconds").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            cataloguePolicy <- getField(jsonObject, "cataloguePolicy").flatMap(v => decodeString(v.hcursor))
          } yield Capabilities(contentMode,searchModes,metadataOnlySearch,chunkBytes,maxListLimit,maxRequestBodyBytes,maxFileBytes,maxArtifactBytes,maxFilesPerArtifact,maxTtlSeconds,cataloguePolicy)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Capabilities: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Capabilities.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Capabilities.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Capabilities.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Capabilities]] = Lazy(Capabilities_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Capabilities]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Capabilities] = LazyInstance.value
  }
}