import io.circe.Decoder.decodeList
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class PresentationManifest(
    choices: List[PresentedSelection],
    adoptionTargets: List[Ref]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = PresentationManifest.baboonDomainVersion
    override def baboonDomainIdentifier: String = PresentationManifest.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = PresentationManifest.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = PresentationManifest.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = PresentationManifest.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = PresentationManifest.baboonMinReaderVersions
  }
  
  object PresentationManifest {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#PresentationManifest"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[PresentationManifest] = PresentationManifest_JsonCodec.instance
  }
  
  object PresentationManifest_JsonCodec extends BaboonJsonCodec.BaseGenerated[PresentationManifest, BaboonJsonCodec[PresentationManifest]] {
    def encode(ctx: BaboonCodecContext, value: PresentationManifest): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "choices" -> Json.fromValues(value.choices.map(e => PresentedSelection_JsonCodec.instance.encode(ctx, e))),
        "adoptionTargets" -> Json.fromValues(value.adoptionTargets.map(e => Ref_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, PresentationManifest] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            choices <- getField(jsonObject, "choices").flatMap(v => decodeList(PresentedSelection_JsonCodec.circeDecoder)(v.hcursor))
            adoptionTargets <- getField(jsonObject, "adoptionTargets").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
          } yield PresentationManifest(choices,adoptionTargets)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to PresentationManifest: object expected"))
      }
    }
  
    def baboonDomainVersion: String = PresentationManifest.baboonDomainVersion
    
    def baboonDomainIdentifier: String = PresentationManifest.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = PresentationManifest.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[PresentationManifest]] = Lazy(PresentationManifest_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[PresentationManifest]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[PresentationManifest] = LazyInstance.value
  }
}