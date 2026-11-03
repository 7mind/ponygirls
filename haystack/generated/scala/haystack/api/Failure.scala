import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class Failure(
    code: String,
    message: String,
    spans: List[Span],
    currentRevision: Option[Int]
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
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#Failure"
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
        "code" -> Json.fromString(value.code),
        "message" -> Json.fromString(value.message),
        "spans" -> Json.fromValues(value.spans.map(e => Span_JsonCodec.instance.encode(ctx, e))),
        "currentRevision" -> value.currentRevision.map(v => Json.fromInt(v)).getOrElse(Json.Null)
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
            spans <- getField(jsonObject, "spans").flatMap(v => decodeList(Span_JsonCodec.circeDecoder)(v.hcursor))
            currentRevision <- getField(jsonObject, "currentRevision").flatMap(v => decodeOption(BaboonJsonCodec.decodeInt)(v.hcursor))
          } yield Failure(code,message,spans,currentRevision)
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