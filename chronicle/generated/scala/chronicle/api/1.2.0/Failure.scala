import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}

package chronicle.api.v1_2_0 {
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.4.0")
  final case class Failure(
    code: String,
    message: String
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = Failure.baboonDomainVersion
    override def baboonDomainIdentifier: String = Failure.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Failure.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Failure.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Failure.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Failure.baboonMinReaderVersions
  }
  
  object Failure {
    def baboonDomainVersion: String = "1.2.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#Failure"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.2.0" -> "identical", "1.3.0" -> "identical", "1.4.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[Failure] = Failure_JsonCodec.instance
  }
  
  @deprecated("Version 1.2.0 is deprecated, you should migrate to 1.4.0")
  object Failure_JsonCodec extends BaboonJsonCodec.BaseGenerated[Failure, BaboonJsonCodec[Failure]] {
    def encode(ctx: BaboonCodecContext, value: Failure): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "code" -> Json.fromString(value.code),
        "message" -> Json.fromString(value.message)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Failure] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            code <- getField(jsonObject, "code").flatMap(v => decodeString(v.hcursor))
            message <- getField(jsonObject, "message").flatMap(v => decodeString(v.hcursor))
          } yield Failure(code,message)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Failure: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Failure.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Failure.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Failure.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Failure]] = Lazy(Failure_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Failure]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Failure] = LazyInstance.value
  }
}