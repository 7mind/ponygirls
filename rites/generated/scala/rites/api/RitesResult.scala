import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class RitesResult(
    items: List[RiteInfo]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RitesResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = RitesResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RitesResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RitesResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RitesResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RitesResult.baboonMinReaderVersions
  }
  
  object RitesResult {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#RitesResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RitesResult] = RitesResult_JsonCodec.instance
  }
  
  object RitesResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[RitesResult, BaboonJsonCodec[RitesResult]] {
    def encode(ctx: BaboonCodecContext, value: RitesResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "items" -> Json.fromValues(value.items.map(e => RiteInfo_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RitesResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            items <- getField(jsonObject, "items").flatMap(v => decodeList(RiteInfo_JsonCodec.circeDecoder)(v.hcursor))
          } yield RitesResult(items)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RitesResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RitesResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RitesResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RitesResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RitesResult]] = Lazy(RitesResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RitesResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RitesResult] = LazyInstance.value
  }
}