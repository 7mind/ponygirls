import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class CapsuleQualification(
    code: CapsuleQualificationCode,
    subjects: List[Ref]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = CapsuleQualification.baboonDomainVersion
    override def baboonDomainIdentifier: String = CapsuleQualification.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = CapsuleQualification.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = CapsuleQualification.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = CapsuleQualification.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = CapsuleQualification.baboonMinReaderVersions
  }
  
  object CapsuleQualification {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#CapsuleQualification"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[CapsuleQualification] = CapsuleQualification_JsonCodec.instance
  }
  
  object CapsuleQualification_JsonCodec extends BaboonJsonCodec.BaseGenerated[CapsuleQualification, BaboonJsonCodec[CapsuleQualification]] {
    def encode(ctx: BaboonCodecContext, value: CapsuleQualification): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "code" -> CapsuleQualificationCode_JsonCodec.instance.encode(ctx, value.code),
        "subjects" -> Json.fromValues(value.subjects.map(e => Ref_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CapsuleQualification] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            code <- getField(jsonObject, "code").flatMap(v => CapsuleQualificationCode_JsonCodec.circeDecoder(v.hcursor))
            subjects <- getField(jsonObject, "subjects").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
          } yield CapsuleQualification(code,subjects)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to CapsuleQualification: object expected"))
      }
    }
  
    def baboonDomainVersion: String = CapsuleQualification.baboonDomainVersion
    
    def baboonDomainIdentifier: String = CapsuleQualification.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = CapsuleQualification.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CapsuleQualification]] = Lazy(CapsuleQualification_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CapsuleQualification]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CapsuleQualification] = LazyInstance.value
  }
}