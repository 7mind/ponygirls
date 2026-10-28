import io.circe.Decoder.{decodeBoolean, decodeList, decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonGenerated, Lazy}
import java.util.UUID

package chronicle.api.v1_5_0 {
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.7.0")
  final case class McpTestSnapshot(
    instanceId: UUID,
    runId: UUID,
    state: McpTestState,
    observedAt: String,
    events: List[McpTestEvent],
    lastSequence: Long,
    hasMore: Boolean,
    failure: Option[Failure]
  ) extends BaboonGenerated {
    override def baboonDomainVersion: String = McpTestSnapshot.baboonDomainVersion
    override def baboonDomainIdentifier: String = McpTestSnapshot.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = McpTestSnapshot.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = McpTestSnapshot.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = McpTestSnapshot.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = McpTestSnapshot.baboonMinReaderVersions
  }
  
  object McpTestSnapshot {
    def baboonDomainVersion: String = "1.5.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#McpTestSnapshot"
    private lazy val _baboonSameInVersions: List[String] = List("1.4.0", "1.5.0", "1.6.0", "1.7.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.5.0" -> "identical", "1.6.0" -> "identical", "1.7.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.4.0", "prefix-compact" -> "1.4.0", "prefix-any-mode" -> "1.4.0", "identical" -> "1.4.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    @scala.annotation.nowarn("cat=deprecation") def codecJson: BaboonJsonCodec[McpTestSnapshot] = McpTestSnapshot_JsonCodec.instance
  }
  
  @deprecated("Version 1.5.0 is deprecated, you should migrate to 1.7.0")
  object McpTestSnapshot_JsonCodec extends BaboonJsonCodec.BaseGenerated[McpTestSnapshot, BaboonJsonCodec[McpTestSnapshot]] {
    def encode(ctx: BaboonCodecContext, value: McpTestSnapshot): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.obj(
        "instanceId" -> Json.fromString(value.instanceId.toString()),
        "runId" -> Json.fromString(value.runId.toString()),
        "state" -> McpTestState_JsonCodec.instance.encode(ctx, value.state),
        "observedAt" -> Json.fromString(value.observedAt),
        "events" -> Json.fromValues(value.events.map(e => McpTestEvent_JsonCodec.instance.encode(ctx, e))),
        "lastSequence" -> Json.fromString(value.lastSequence.toString),
        "hasMore" -> Json.fromBoolean(value.hasMore),
        "failure" -> value.failure.map(v => Failure_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
      )
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, McpTestSnapshot] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) => for {
            instanceId <- getField(jsonObject, "instanceId").flatMap(v => decodeUUID(v.hcursor))
            runId <- getField(jsonObject, "runId").flatMap(v => decodeUUID(v.hcursor))
            state <- getField(jsonObject, "state").flatMap(v => McpTestState_JsonCodec.circeDecoder(v.hcursor))
            observedAt <- getField(jsonObject, "observedAt").flatMap(v => decodeString(v.hcursor))
            events <- getField(jsonObject, "events").flatMap(v => decodeList(McpTestEvent_JsonCodec.circeDecoder)(v.hcursor))
            lastSequence <- getField(jsonObject, "lastSequence").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            hasMore <- getField(jsonObject, "hasMore").flatMap(v => decodeBoolean(v.hcursor))
            failure <- getField(jsonObject, "failure").flatMap(v => decodeOption(Failure_JsonCodec.circeDecoder)(v.hcursor))
          } yield McpTestSnapshot(instanceId,runId,state,observedAt,events,lastSequence,hasMore,failure)
        case _ => Left(new IllegalArgumentException("Cannot decode $wire to McpTestSnapshot: object expected"))
      }
    }
  
    def baboonDomainVersion: String = McpTestSnapshot.baboonDomainVersion
    
    def baboonDomainIdentifier: String = McpTestSnapshot.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = McpTestSnapshot.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[McpTestSnapshot]] = Lazy(McpTestSnapshot_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[McpTestSnapshot]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[McpTestSnapshot] = LazyInstance.value
  }
}