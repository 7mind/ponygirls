package chronicle

import chronicle.api.*
import io.circe.Json
import java.util.UUID

final class McpTestWire(protocol: VersionedWire) extends McpRunPageEncoding {
  private val sizingRequestId=new UUID(0L,0L)
  val supportedVersions=Wire.versions.supported
  val versionRequirement=s"MCP testing requires API ${Wire.versions.current}"

  def snapshot(value: McpRunSnapshot): Result.McpTestRun = Result.McpTestRun(McpTestSnapshot(
    value.instanceId,value.runId,value.state match {
      case McpRunState.Queued => McpTestState.Queued
      case McpRunState.Running => McpTestState.Running
      case McpRunState.Complete => McpTestState.Complete
      case McpRunState.Failed => McpTestState.Failed
      case McpRunState.Cancelled => McpTestState.Cancelled
      case McpRunState.AuthorizationLost => McpTestState.AuthorizationLost
      case McpRunState.Expired => McpTestState.Expired
    },value.observedAt.toString,value.events.map { event => McpTestEvent(event.sequence,event.observedAt.toString,event.item match {
      case McpRunItem.ToolCall(id,tool,index,count,part) => McpTestItem.ToolCall(id,tool,index,count,part)
      case McpRunItem.ToolResult(id,index,count,part) => McpTestItem.ToolResult(id,index,count,part)
      case McpRunItem.Response(index,count,part) => McpTestItem.Response(index,count,part)
    }) },value.lastSequence,value.hasMore,value.failure.map(value => Failure(value.code,value.message))))

  def catalog(value: McpRunCatalog): Result.McpTestTools = Result.McpTestTools(McpTestCatalog(
    value.instanceId,value.model.model,value.model.revision,value.model.maximumOutputTokens,value.model.reasoningPolicy,
    McpTestLimits(McpRunLimits.maximumRounds,McpRunLimits.maximumToolCalls,McpRunLimits.maximumPromptBytes,
      McpRunLimits.maximumSourceBytes,McpRunLimits.maximumResultBytes,McpRunLimits.maximumRequestBytes,
      McpRunLimits.maximumTraceBytes,McpRunLimits.maximumEvents,McpRunLimits.pageBytes,McpRunLimits.deadlineSeconds,McpRunLimits.retentionSeconds),
    value.tools.map(tool => McpToolDefinition(tool.name,tool.description,tool.inputSchemaJson.noSpaces))))

  def bytes(value: McpRunSnapshot): Long = JsonUtf8Size(protocol.encodeServer(Wire.versions.current,ServerEnvelope(sizingRequestId,snapshot(value))))

  def encode(envelope: ServerEnvelope,version: String): Json = {
    Check(supportedVersions.contains(version),"version-mismatch",versionRequirement)
    val json=protocol.encodeServer(version,envelope)
    val code=envelope.result match {
      case _: Result.McpTestTools => "mcp-catalog-limit"
      case _ => "mcp-page-invariant"
    }
    Check(JsonUtf8Size(json)<=McpRunLimits.pageBytes,code,"complete MCP response frame exceeds byte limit")
    json
  }
}
