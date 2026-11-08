import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class ModelInfo(
    id: String,
    provider: String,
    model: String,
    thinkingLevel: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ModelInfo.baboonDomainVersion
    override def baboonDomainIdentifier: String = ModelInfo.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ModelInfo.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ModelInfo.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ModelInfo.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ModelInfo.baboonMinReaderVersions
  }
  
  object ModelInfo {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#ModelInfo"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ModelInfo] = ModelInfo_JsonCodec.instance
  }
  
  object ModelInfo_JsonCodec extends BaboonJsonCodec.BaseGenerated[ModelInfo, BaboonJsonCodec[ModelInfo]] {
    def encode(ctx: BaboonCodecContext, value: ModelInfo): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "id" -> Json.fromString(value.id),
        "provider" -> Json.fromString(value.provider),
        "model" -> Json.fromString(value.model),
        "thinkingLevel" -> Json.fromString(value.thinkingLevel)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ModelInfo] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            id <- getField(jsonObject, "id").flatMap(v => decodeString(v.hcursor))
            provider <- getField(jsonObject, "provider").flatMap(v => decodeString(v.hcursor))
            model <- getField(jsonObject, "model").flatMap(v => decodeString(v.hcursor))
            thinkingLevel <- getField(jsonObject, "thinkingLevel").flatMap(v => decodeString(v.hcursor))
          } yield ModelInfo(id,provider,model,thinkingLevel)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ModelInfo: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ModelInfo.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ModelInfo.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ModelInfo.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ModelInfo]] = Lazy(ModelInfo_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ModelInfo]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ModelInfo] = LazyInstance.value
  }
}