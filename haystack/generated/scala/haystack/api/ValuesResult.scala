import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class ValuesResult(
    values: List[String]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ValuesResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = ValuesResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ValuesResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ValuesResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ValuesResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ValuesResult.baboonMinReaderVersions
  }
  
  object ValuesResult {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#ValuesResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ValuesResult] = ValuesResult_JsonCodec.instance
  }
  
  object ValuesResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[ValuesResult, BaboonJsonCodec[ValuesResult]] {
    def encode(ctx: BaboonCodecContext, value: ValuesResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "values" -> Json.fromValues(value.values.map(e => Json.fromString(e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ValuesResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            values <- getField(jsonObject, "values").flatMap(v => decodeList(decodeString)(v.hcursor))
          } yield ValuesResult(values)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to ValuesResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ValuesResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ValuesResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ValuesResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ValuesResult]] = Lazy(ValuesResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ValuesResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ValuesResult] = LazyInstance.value
  }
}