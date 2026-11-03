import io.circe.Decoder.{decodeDouble, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class LiveFrame(
    kind: String,
    key: Option[String],
    revision: Option[Int],
    nonce: Option[String],
    clientTs: Option[Double],
    serverTs: Option[Double]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = LiveFrame.baboonDomainVersion
    override def baboonDomainIdentifier: String = LiveFrame.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = LiveFrame.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = LiveFrame.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = LiveFrame.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = LiveFrame.baboonMinReaderVersions
  }
  
  object LiveFrame {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#LiveFrame"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[LiveFrame] = LiveFrame_JsonCodec.instance
  }
  
  object LiveFrame_JsonCodec extends BaboonJsonCodec.BaseGenerated[LiveFrame, BaboonJsonCodec[LiveFrame]] {
    def encode(ctx: BaboonCodecContext, value: LiveFrame): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "kind" -> Json.fromString(value.kind),
        "key" -> value.key.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "revision" -> value.revision.map(v => Json.fromInt(v)).getOrElse(Json.Null),
        "nonce" -> value.nonce.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "clientTs" -> value.clientTs.map(v => Json.fromDouble(v).get).getOrElse(Json.Null),
        "serverTs" -> value.serverTs.map(v => Json.fromDouble(v).get).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, LiveFrame] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            kind <- getField(jsonObject, "kind").flatMap(v => decodeString(v.hcursor))
            key <- getField(jsonObject, "key").flatMap(v => decodeOption(decodeString)(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => decodeOption(BaboonJsonCodec.decodeInt)(v.hcursor))
            nonce <- getField(jsonObject, "nonce").flatMap(v => decodeOption(decodeString)(v.hcursor))
            clientTs <- getField(jsonObject, "clientTs").flatMap(v => decodeOption(decodeDouble)(v.hcursor))
            serverTs <- getField(jsonObject, "serverTs").flatMap(v => decodeOption(decodeDouble)(v.hcursor))
          } yield LiveFrame(kind,key,revision,nonce,clientTs,serverTs)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to LiveFrame: object expected"))
      }
    }
  
    def baboonDomainVersion: String = LiveFrame.baboonDomainVersion
    
    def baboonDomainIdentifier: String = LiveFrame.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = LiveFrame.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[LiveFrame]] = Lazy(LiveFrame_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[LiveFrame]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[LiveFrame] = LazyInstance.value
  }
}