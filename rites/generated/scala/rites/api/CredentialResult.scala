import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package rites.api {
  final case class CredentialResult(
    credential: CredentialInfo
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CredentialResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = CredentialResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CredentialResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CredentialResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CredentialResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CredentialResult.baboonMinReaderVersions
  }
  
  object CredentialResult {
    def baboonDomainVersion: String = "0.2.0"
    def baboonDomainIdentifier: String = "rites.api"
    def baboonTypeIdentifier: String = "rites.api/:#CredentialResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.2.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.2.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.2.0", "prefix-compact" -> "0.2.0", "prefix-any-mode" -> "0.2.0", "identical" -> "0.2.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CredentialResult] = CredentialResult_JsonCodec.instance
  }
  
  object CredentialResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[CredentialResult, BaboonJsonCodec[CredentialResult]] {
    def encode(ctx: BaboonCodecContext, value: CredentialResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "credential" -> CredentialInfo_JsonCodec.instance.encode(ctx, value.credential)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CredentialResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            credential <- getField(jsonObject, "credential").flatMap(v => CredentialInfo_JsonCodec.circeDecoder(v.hcursor))
          } yield CredentialResult(credential)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CredentialResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CredentialResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CredentialResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CredentialResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CredentialResult]] = Lazy(CredentialResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CredentialResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CredentialResult] = LazyInstance.value
  }
}