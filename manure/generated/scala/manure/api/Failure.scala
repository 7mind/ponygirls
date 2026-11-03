import io.circe.Decoder.{decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package manure.api {
  final case class Failure(
    code: ErrorCode,
    message: String,
    retryAfterSeconds: Option[Int]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Failure.baboonDomainVersion
    override def baboonDomainIdentifier: String = Failure.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Failure.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Failure.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Failure.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Failure.baboonMinReaderVersions
  }
  
  object Failure {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#Failure"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Failure] = Failure_JsonCodec.instance
  }
  
  object Failure_JsonCodec extends BaboonJsonCodec.BaseGenerated[Failure, BaboonJsonCodec[Failure]] {
    def encode(ctx: BaboonCodecContext, value: Failure): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "code" -> ErrorCode_JsonCodec.instance.encode(ctx, value.code),
        "message" -> Json.fromString(value.message),
        "retryAfterSeconds" -> value.retryAfterSeconds.map(v => Json.fromInt(v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Failure] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            code <- getField(jsonObject, "code").flatMap(v => ErrorCode_JsonCodec.circeDecoder(v.hcursor))
            message <- getField(jsonObject, "message").flatMap(v => decodeString(v.hcursor))
            retryAfterSeconds <- getField(jsonObject, "retryAfterSeconds").flatMap(v => decodeOption(BaboonJsonCodec.decodeInt)(v.hcursor))
          } yield Failure(code,message,retryAfterSeconds)
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