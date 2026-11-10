import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class JudgmentsResult(
    items: List[Judgment]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = JudgmentsResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = JudgmentsResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = JudgmentsResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = JudgmentsResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = JudgmentsResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = JudgmentsResult.baboonMinReaderVersions
  }
  
  object JudgmentsResult {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#JudgmentsResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[JudgmentsResult] = JudgmentsResult_JsonCodec.instance
  }
  
  object JudgmentsResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[JudgmentsResult, BaboonJsonCodec[JudgmentsResult]] {
    def encode(ctx: BaboonCodecContext, value: JudgmentsResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "items" -> Json.fromValues(value.items.map(e => Judgment_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, JudgmentsResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            items <- getField(jsonObject, "items").flatMap(v => decodeList(Judgment_JsonCodec.circeDecoder)(v.hcursor))
          } yield JudgmentsResult(items)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to JudgmentsResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = JudgmentsResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = JudgmentsResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = JudgmentsResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[JudgmentsResult]] = Lazy(JudgmentsResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[JudgmentsResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[JudgmentsResult] = LazyInstance.value
  }
}