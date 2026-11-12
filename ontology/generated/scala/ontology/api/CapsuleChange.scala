import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CapsuleChange(
    previous: Option[Ref],
    current: Option[Ref],
    account: Ref,
    reason: Option[String],
    basis: List[Ref],
    humanBasis: List[Ref]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CapsuleChange.baboonDomainVersion
    override def baboonDomainIdentifier: String = CapsuleChange.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CapsuleChange.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CapsuleChange.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CapsuleChange.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CapsuleChange.baboonMinReaderVersions
  }
  
  object CapsuleChange {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CapsuleChange"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CapsuleChange] = CapsuleChange_JsonCodec.instance
  }
  
  object CapsuleChange_JsonCodec extends BaboonJsonCodec.BaseGenerated[CapsuleChange, BaboonJsonCodec[CapsuleChange]] {
    def encode(ctx: BaboonCodecContext, value: CapsuleChange): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "previous" -> value.previous.map(v => Ref_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "current" -> value.current.map(v => Ref_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "account" -> Ref_JsonCodec.instance.encode(ctx, value.account),
        "reason" -> value.reason.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "basis" -> Json.fromValues(value.basis.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "humanBasis" -> Json.fromValues(value.humanBasis.map(e => Ref_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CapsuleChange] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            previous <- getField(jsonObject, "previous").flatMap(v => decodeOption(Ref_JsonCodec.circeDecoder)(v.hcursor))
            current <- getField(jsonObject, "current").flatMap(v => decodeOption(Ref_JsonCodec.circeDecoder)(v.hcursor))
            account <- getField(jsonObject, "account").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            reason <- getField(jsonObject, "reason").flatMap(v => decodeOption(decodeString)(v.hcursor))
            basis <- getField(jsonObject, "basis").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            humanBasis <- getField(jsonObject, "humanBasis").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
          } yield CapsuleChange(previous,current,account,reason,basis,humanBasis)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CapsuleChange: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CapsuleChange.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CapsuleChange.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CapsuleChange.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CapsuleChange]] = Lazy(CapsuleChange_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CapsuleChange]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CapsuleChange] = LazyInstance.value
  }
}