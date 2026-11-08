import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class OAuthClientsResult(
    items: List[OAuthClientInfo]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = OAuthClientsResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = OAuthClientsResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = OAuthClientsResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = OAuthClientsResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = OAuthClientsResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = OAuthClientsResult.baboonMinReaderVersions
  }
  
  object OAuthClientsResult {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#OAuthClientsResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[OAuthClientsResult] = OAuthClientsResult_JsonCodec.instance
  }
  
  object OAuthClientsResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[OAuthClientsResult, BaboonJsonCodec[OAuthClientsResult]] {
    def encode(ctx: BaboonCodecContext, value: OAuthClientsResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "items" -> Json.fromValues(value.items.map(e => OAuthClientInfo_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, OAuthClientsResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            items <- getField(jsonObject, "items").flatMap(v => decodeList(OAuthClientInfo_JsonCodec.circeDecoder)(v.hcursor))
          } yield OAuthClientsResult(items)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to OAuthClientsResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = OAuthClientsResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = OAuthClientsResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = OAuthClientsResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[OAuthClientsResult]] = Lazy(OAuthClientsResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[OAuthClientsResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[OAuthClientsResult] = LazyInstance.value
  }
}