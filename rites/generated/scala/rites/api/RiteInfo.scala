import io.circe.Decoder.{decodeBoolean, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class RiteInfo(
    repositoryId: String,
    id: String,
    schedule: String,
    promptPath: String,
    modelId: String,
    enabled: Boolean,
    revision: Int
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RiteInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = RiteInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RiteInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RiteInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RiteInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RiteInfo.baboonMinReaderVersions
  }
  
  object RiteInfo {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#RiteInfo"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RiteInfo] = RiteInfo_JsonCodec.instance
  }
  
  object RiteInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[RiteInfo, BaboonJsonCodec[RiteInfo]] {
    def encode(ctx: BaboonCodecContext, value: RiteInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "repositoryId" -> Json.fromString(value.repositoryId),
        "id" -> Json.fromString(value.id),
        "schedule" -> Json.fromString(value.schedule),
        "promptPath" -> Json.fromString(value.promptPath),
        "modelId" -> Json.fromString(value.modelId),
        "enabled" -> Json.fromBoolean(value.enabled),
        "revision" -> Json.fromInt(value.revision)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RiteInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            repositoryId <- getField(jsonObject, "repositoryId").flatMap(v => decodeString(v.hcursor))
            id <- getField(jsonObject, "id").flatMap(v => decodeString(v.hcursor))
            schedule <- getField(jsonObject, "schedule").flatMap(v => decodeString(v.hcursor))
            promptPath <- getField(jsonObject, "promptPath").flatMap(v => decodeString(v.hcursor))
            modelId <- getField(jsonObject, "modelId").flatMap(v => decodeString(v.hcursor))
            enabled <- getField(jsonObject, "enabled").flatMap(v => decodeBoolean(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
          } yield RiteInfo(repositoryId,id,schedule,promptPath,modelId,enabled,revision)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RiteInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RiteInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RiteInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RiteInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RiteInfo]] = Lazy(RiteInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RiteInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RiteInfo] = LazyInstance.value
  }
}