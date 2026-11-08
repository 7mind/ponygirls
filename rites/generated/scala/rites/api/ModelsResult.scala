import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class ModelsResult(
    items: List[ModelInfo]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ModelsResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ModelsResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ModelsResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ModelsResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ModelsResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ModelsResult.baboonMinReaderVersions
  }
  
  object ModelsResult {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#ModelsResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ModelsResult] = ModelsResult_JsonCodec.instance
  }
  
  object ModelsResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ModelsResult, BaboonJsonCodec[ModelsResult]] {
    def encode(ctx: BaboonCodecContext, value: ModelsResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "items" -> Json.fromValues(value.items.map(e => ModelInfo_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ModelsResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            items <- getField(jsonObject, "items").flatMap(v => decodeList(ModelInfo_JsonCodec.circeDecoder)(v.hcursor))
          } yield ModelsResult(items)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ModelsResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ModelsResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ModelsResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ModelsResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ModelsResult]] = Lazy(ModelsResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ModelsResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ModelsResult] = LazyInstance.value
  }
}