import io.circe.Decoder.{decodeList, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

package ontology.api {
  final case class GraphSnapshot(
    scope: String,
    generation: Long,
    coveredFrontier: Long,
    sourceFrontier: Long,
    definitions: List[Definition],
    relations: List[Relation],
    bindings: List[Binding],
    events: List[StateEvent],
    actors: List[ActorRecord],
    selections: List[BindingSelection]
  ) extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = GraphSnapshot.baboonDomainVersion
    override def baboonDomainIdentifier: String = GraphSnapshot.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = GraphSnapshot.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = GraphSnapshot.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = GraphSnapshot.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = GraphSnapshot.baboonMinReaderVersions
  }
  
  object GraphSnapshot {
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#GraphSnapshot"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[GraphSnapshot] = GraphSnapshot_JsonCodec.instance
  }
  
  object GraphSnapshot_JsonCodec extends BaboonJsonCodec.BaseGenerated[GraphSnapshot, BaboonJsonCodec[GraphSnapshot]] {
    def encode(ctx: BaboonCodecContext, value: GraphSnapshot): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "scope" -> Json.fromString(value.scope),
        "generation" -> Json.fromString(value.generation.toString),
        "coveredFrontier" -> Json.fromString(value.coveredFrontier.toString),
        "sourceFrontier" -> Json.fromString(value.sourceFrontier.toString),
        "definitions" -> Json.fromValues(value.definitions.map(e => Definition_JsonCodec.instance.encode(ctx, e))),
        "relations" -> Json.fromValues(value.relations.map(e => Relation_JsonCodec.instance.encode(ctx, e))),
        "bindings" -> Json.fromValues(value.bindings.map(e => Binding_JsonCodec.instance.encode(ctx, e))),
        "events" -> Json.fromValues(value.events.map(e => StateEvent_JsonCodec.instance.encode(ctx, e))),
        "actors" -> Json.fromValues(value.actors.map(e => ActorRecord_JsonCodec.instance.encode(ctx, e))),
        "selections" -> Json.fromValues(value.selections.map(e => BindingSelection_JsonCodec.instance.encode(ctx, e)))
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GraphSnapshot] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            scope <- getField(jsonObject, "scope").flatMap(v => decodeString(v.hcursor))
            generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            coveredFrontier <- getField(jsonObject, "coveredFrontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            sourceFrontier <- getField(jsonObject, "sourceFrontier").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            definitions <- getField(jsonObject, "definitions").flatMap(v => decodeList(Definition_JsonCodec.circeDecoder)(v.hcursor))
            relations <- getField(jsonObject, "relations").flatMap(v => decodeList(Relation_JsonCodec.circeDecoder)(v.hcursor))
            bindings <- getField(jsonObject, "bindings").flatMap(v => decodeList(Binding_JsonCodec.circeDecoder)(v.hcursor))
            events <- getField(jsonObject, "events").flatMap(v => decodeList(StateEvent_JsonCodec.circeDecoder)(v.hcursor))
            actors <- getField(jsonObject, "actors").flatMap(v => decodeList(ActorRecord_JsonCodec.circeDecoder)(v.hcursor))
            selections <- getField(jsonObject, "selections").flatMap(v => decodeList(BindingSelection_JsonCodec.circeDecoder)(v.hcursor))
          } yield GraphSnapshot(scope,generation,coveredFrontier,sourceFrontier,definitions,relations,bindings,events,actors,selections)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to GraphSnapshot: object expected"))
      }
    }
  
    def baboonDomainVersion: String = GraphSnapshot.baboonDomainVersion
    
    def baboonDomainIdentifier: String = GraphSnapshot.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = GraphSnapshot.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GraphSnapshot]] = Lazy(GraphSnapshot_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[GraphSnapshot]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[GraphSnapshot] = LazyInstance.value
  }
}