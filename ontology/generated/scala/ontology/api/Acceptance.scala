import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class Acceptance(
    clauses: List[String],
    question: Option[Ref]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Acceptance.baboonDomainVersion
    override def baboonDomainIdentifier: String = Acceptance.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Acceptance.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Acceptance.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Acceptance.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Acceptance.baboonMinReaderVersions
  }
  
  object Acceptance {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Acceptance"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Acceptance] = Acceptance_JsonCodec.instance
  }
  
  object Acceptance_JsonCodec extends BaboonJsonCodec.BaseGenerated[Acceptance, BaboonJsonCodec[Acceptance]] {
    def encode(ctx: BaboonCodecContext, value: Acceptance): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "clauses" -> Json.fromValues(value.clauses.map(e => Json.fromString(e))),
        "question" -> value.question.map(v => Ref_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Acceptance] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            clauses <- getField(jsonObject, "clauses").flatMap(v => decodeList(decodeString)(v.hcursor))
            question <- getField(jsonObject, "question").flatMap(v => decodeOption(Ref_JsonCodec.circeDecoder)(v.hcursor))
          } yield Acceptance(clauses,question)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to Acceptance: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Acceptance.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Acceptance.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Acceptance.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Acceptance]] = Lazy(Acceptance_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Acceptance]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Acceptance] = LazyInstance.value
  }
}