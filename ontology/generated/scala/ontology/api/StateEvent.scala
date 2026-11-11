import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class StateEvent(
    ref: Ref,
    scope: String,
    subject: Ref,
    previous: Option[Ref],
    phase: Phase,
    result: Option[Resolution],
    resolution: Option[String],
    evidence: List[Ref],
    uncertainty: String,
    gateBasis: GateBasis,
    provenance: Provenance
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = StateEvent.baboonDomainVersion
    override def baboonDomainIdentifier: String = StateEvent.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = StateEvent.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = StateEvent.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = StateEvent.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = StateEvent.baboonMinReaderVersions
  }
  
  object StateEvent {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#StateEvent"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[StateEvent] = StateEvent_JsonCodec.instance
  }
  
  object StateEvent_JsonCodec extends BaboonJsonCodec.BaseGenerated[StateEvent, BaboonJsonCodec[StateEvent]] {
    def encode(ctx: BaboonCodecContext, value: StateEvent): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref),
        "scope" -> Json.fromString(value.scope),
        "subject" -> Ref_JsonCodec.instance.encode(ctx, value.subject),
        "previous" -> value.previous.map(v => Ref_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "phase" -> Phase_JsonCodec.instance.encode(ctx, value.phase),
        "result" -> value.result.map(v => Resolution_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
        "resolution" -> value.resolution.map(v => Json.fromString(v)).getOrElse(Json.Null),
        "evidence" -> Json.fromValues(value.evidence.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
        "uncertainty" -> Json.fromString(value.uncertainty),
        "gateBasis" -> GateBasis_JsonCodec.instance.encode(ctx, value.gateBasis),
        "provenance" -> Provenance_JsonCodec.instance.encode(ctx, value.provenance)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, StateEvent] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            subject <- getField(jsonObject, "subject").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            previous <- getField(jsonObject, "previous").flatMap(v => decodeOption(Ref_JsonCodec.circeDecoder)(v.hcursor))
            phase <- getField(jsonObject, "phase").flatMap(v => Phase_JsonCodec.circeDecoder(v.hcursor))
            result <- getField(jsonObject, "result").flatMap(v => decodeOption(Resolution_JsonCodec.circeDecoder)(v.hcursor))
            resolution <- getField(jsonObject, "resolution").flatMap(v => decodeOption(decodeString)(v.hcursor))
            evidence <- getField(jsonObject, "evidence").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            uncertainty <- getField(jsonObject, "uncertainty").flatMap(v => decodeString(v.hcursor))
            gateBasis <- getField(jsonObject, "gateBasis").flatMap(v => GateBasis_JsonCodec.circeDecoder(v.hcursor))
            provenance <- getField(jsonObject, "provenance").flatMap(v => Provenance_JsonCodec.circeDecoder(v.hcursor))
          } yield StateEvent(ref,scope,subject,previous,phase,result,resolution,evidence,uncertainty,gateBasis,provenance)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to StateEvent: object expected"))
      }
    }
  
    def baboonDomainVersion: String = StateEvent.baboonDomainVersion
    
    def baboonDomainIdentifier: String = StateEvent.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = StateEvent.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[StateEvent]] = Lazy(StateEvent_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[StateEvent]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[StateEvent] = LazyInstance.value
  }
}