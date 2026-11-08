import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.worker {
  final case class ModelSelection(
    provider: String,
    model: String,
    thinkingLevel: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ModelSelection.baboonDomainVersion
    override def baboonDomainIdentifier: String = ModelSelection.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ModelSelection.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ModelSelection.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ModelSelection.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ModelSelection.baboonMinReaderVersions
  }
  
  object ModelSelection {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.worker"
    def baboonTypeIdentifier: String = "rites.worker/:#ModelSelection"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ModelSelection] = ModelSelection_JsonCodec.instance
  }
  
  object ModelSelection_JsonCodec extends BaboonJsonCodec.BaseGenerated[ModelSelection, BaboonJsonCodec[ModelSelection]] {
    def encode(ctx: BaboonCodecContext, value: ModelSelection): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "provider" -> Json.fromString(value.provider),
        "model" -> Json.fromString(value.model),
        "thinkingLevel" -> Json.fromString(value.thinkingLevel)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ModelSelection] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            provider <- getField(jsonObject, "provider").flatMap(v => decodeString(v.hcursor))
            model <- getField(jsonObject, "model").flatMap(v => decodeString(v.hcursor))
            thinkingLevel <- getField(jsonObject, "thinkingLevel").flatMap(v => decodeString(v.hcursor))
          } yield ModelSelection(provider,model,thinkingLevel)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ModelSelection: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ModelSelection.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ModelSelection.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ModelSelection.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ModelSelection]] = Lazy(ModelSelection_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ModelSelection]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ModelSelection] = LazyInstance.value
  }
}