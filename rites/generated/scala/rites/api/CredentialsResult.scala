import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class CredentialsResult(
    items: List[CredentialInfo]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CredentialsResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = CredentialsResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CredentialsResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CredentialsResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CredentialsResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CredentialsResult.baboonMinReaderVersions
  }
  
  object CredentialsResult {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#CredentialsResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CredentialsResult] = CredentialsResult_JsonCodec.instance
  }
  
  object CredentialsResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[CredentialsResult, BaboonJsonCodec[CredentialsResult]] {
    def encode(ctx: BaboonCodecContext, value: CredentialsResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "items" -> Json.fromValues(value.items.map(e => CredentialInfo_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CredentialsResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            items <- getField(jsonObject, "items").flatMap(v => decodeList(CredentialInfo_JsonCodec.circeDecoder)(v.hcursor))
          } yield CredentialsResult(items)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CredentialsResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CredentialsResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CredentialsResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CredentialsResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CredentialsResult]] = Lazy(CredentialsResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CredentialsResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CredentialsResult] = LazyInstance.value
  }
}