import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class RiteResult(
    rite: RiteInfo
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RiteResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = RiteResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RiteResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RiteResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RiteResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RiteResult.baboonMinReaderVersions
  }
  
  object RiteResult {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#RiteResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RiteResult] = RiteResult_JsonCodec.instance
  }
  
  object RiteResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[RiteResult, BaboonJsonCodec[RiteResult]] {
    def encode(ctx: BaboonCodecContext, value: RiteResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "rite" -> RiteInfo_JsonCodec.instance.encode(ctx, value.rite)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RiteResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            rite <- getField(jsonObject, "rite").flatMap(v => RiteInfo_JsonCodec.circeDecoder(v.hcursor))
          } yield RiteResult(rite)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RiteResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RiteResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RiteResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RiteResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RiteResult]] = Lazy(RiteResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RiteResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RiteResult] = LazyInstance.value
  }
}