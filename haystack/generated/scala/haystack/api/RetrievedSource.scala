import io.circe.Decoder.{decodeDouble, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package haystack.api {
  final case class RetrievedSource(
    key: String,
    revision: Int,
    pointer: String,
    text: String,
    score: Double,
    generation: String
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RetrievedSource.baboonDomainVersion
    override def baboonDomainIdentifier: String = RetrievedSource.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RetrievedSource.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RetrievedSource.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RetrievedSource.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RetrievedSource.baboonMinReaderVersions
  }
  
  object RetrievedSource {
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "haystack.api"
    def baboonTypeIdentifier: String = "haystack.api/:#RetrievedSource"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RetrievedSource] = RetrievedSource_JsonCodec.instance
  }
  
  object RetrievedSource_JsonCodec extends BaboonJsonCodec.BaseGenerated[RetrievedSource, BaboonJsonCodec[RetrievedSource]] {
    def encode(ctx: BaboonCodecContext, value: RetrievedSource): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "key" -> Json.fromString(value.key),
        "revision" -> Json.fromInt(value.revision),
        "pointer" -> Json.fromString(value.pointer),
        "text" -> Json.fromString(value.text),
        "score" -> Json.fromDouble(value.score).get,
        "generation" -> Json.fromString(value.generation)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RetrievedSource] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            key <- getField(jsonObject, "key").flatMap(v => decodeString(v.hcursor))
            revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            pointer <- getField(jsonObject, "pointer").flatMap(v => decodeString(v.hcursor))
            text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
            score <- getField(jsonObject, "score").flatMap(v => decodeDouble(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => decodeString(v.hcursor))
          } yield RetrievedSource(key,revision,pointer,text,score,generation)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to RetrievedSource: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RetrievedSource.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RetrievedSource.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RetrievedSource.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RetrievedSource]] = Lazy(RetrievedSource_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RetrievedSource]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RetrievedSource] = LazyInstance.value
  }
}