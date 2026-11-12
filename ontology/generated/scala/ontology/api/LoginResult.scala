import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class LoginResult(
    identity: Identity,
    versions: VersionInfo
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = LoginResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = LoginResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = LoginResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = LoginResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = LoginResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = LoginResult.baboonMinReaderVersions
  }
  
  object LoginResult {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#LoginResult"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[LoginResult] = LoginResult_JsonCodec.instance
  }
  
  object LoginResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[LoginResult, BaboonJsonCodec[LoginResult]] {
    def encode(ctx: BaboonCodecContext, value: LoginResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "identity" -> Identity_JsonCodec.instance.encode(ctx, value.identity),
        "versions" -> VersionInfo_JsonCodec.instance.encode(ctx, value.versions)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, LoginResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            identity <- getField(jsonObject, "identity").flatMap(v => Identity_JsonCodec.circeDecoder(v.hcursor))
            versions <- getField(jsonObject, "versions").flatMap(v => VersionInfo_JsonCodec.circeDecoder(v.hcursor))
          } yield LoginResult(identity,versions)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to LoginResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = LoginResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = LoginResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = LoginResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[LoginResult]] = Lazy(LoginResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[LoginResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[LoginResult] = LazyInstance.value
  }
}