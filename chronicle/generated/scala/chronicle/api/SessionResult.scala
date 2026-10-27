import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package chronicle.api {
  final case class SessionResult(
    session: SessionInfo,
    chunks: List[Chunk]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SessionResult.baboonDomainVersion
    override def baboonDomainIdentifier: String = SessionResult.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SessionResult.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SessionResult.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SessionResult.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SessionResult.baboonMinReaderVersions
  }
  
  object SessionResult {
    def baboonDomainVersion: String = "1.5.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#SessionResult"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.5.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SessionResult] = SessionResult_JsonCodec.instance
  }
  
  object SessionResult_JsonCodec extends BaboonJsonCodec.BaseGenerated[SessionResult, BaboonJsonCodec[SessionResult]] {
    def encode(ctx: BaboonCodecContext, value: SessionResult): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "session" -> SessionInfo_JsonCodec.instance.encode(ctx, value.session),
        "chunks" -> Json.fromValues(value.chunks.map(e => Chunk_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SessionResult] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            session <- getField(jsonObject, "session").flatMap(v => SessionInfo_JsonCodec.circeDecoder(v.hcursor))
            chunks <- getField(jsonObject, "chunks").flatMap(v => decodeList(Chunk_JsonCodec.circeDecoder)(v.hcursor))
          } yield SessionResult(session,chunks)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to SessionResult: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SessionResult.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SessionResult.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SessionResult.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SessionResult]] = Lazy(SessionResult_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SessionResult]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SessionResult] = LazyInstance.value
  }
}