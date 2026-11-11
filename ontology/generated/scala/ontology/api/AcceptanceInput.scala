import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class AcceptanceInput(
    clauses: List[String],
    question: Option[Target]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = AcceptanceInput.baboonDomainVersion
    override def baboonDomainIdentifier: String = AcceptanceInput.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = AcceptanceInput.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = AcceptanceInput.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = AcceptanceInput.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = AcceptanceInput.baboonMinReaderVersions
  }
  
  object AcceptanceInput {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#AcceptanceInput"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[AcceptanceInput] = AcceptanceInput_JsonCodec.instance
  }
  
  object AcceptanceInput_JsonCodec extends BaboonJsonCodec.BaseGenerated[AcceptanceInput, BaboonJsonCodec[AcceptanceInput]] {
    def encode(ctx: BaboonCodecContext, value: AcceptanceInput): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "clauses" -> Json.fromValues(value.clauses.map(e => Json.fromString(e))),
        "question" -> value.question.map(v => Target_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, AcceptanceInput] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            clauses <- getField(jsonObject, "clauses").flatMap(v => decodeList(decodeString)(v.hcursor))
            question <- getField(jsonObject, "question").flatMap(v => decodeOption(Target_JsonCodec.circeDecoder)(v.hcursor))
          } yield AcceptanceInput(clauses,question)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to AcceptanceInput: object expected"))
      }
    }
  
    def baboonDomainVersion: String = AcceptanceInput.baboonDomainVersion
    
    def baboonDomainIdentifier: String = AcceptanceInput.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = AcceptanceInput.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[AcceptanceInput]] = Lazy(AcceptanceInput_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[AcceptanceInput]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[AcceptanceInput] = LazyInstance.value
  }
}