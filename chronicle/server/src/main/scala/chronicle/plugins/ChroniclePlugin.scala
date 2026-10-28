package chronicle.plugins
import chronicle.*
import chronicle.api.IndexingSettings
import distage.*
import izumi.distage.plugins.PluginDef
import cats.effect.IO
import org.http4s.client.Client

object ChroniclePlugin extends PluginDef {
  make[logstage.IzLogger].fromValue(logstage.IzLogger())
  make[IndexProfileCatalog].from { (config: Config) => IndexProfileCatalog.current(config) }
  make[Database]
  make[Auth]
  make[PostgresArchive]
  make[SessionArchive].from[PostgresArchive]
  make[SearchIndex].from[PostgresSearch]
  make[ArchiveIndex].from[PostgresArchiveIndex]
  make[ActivityIndex].from[PostgresActivity]
  make[cats.effect.kernel.Clock[IO]].fromValue(cats.effect.Clock[IO])
  make[ModelTelemetryClock].from[JavaModelTelemetryClock]
  make[ModelTelemetry].fromEffect { (clock: ModelTelemetryClock,config: Config) => ModelTelemetry.make(clock,config.users.map(_.id).toSet) }
  make[ModelAdmission].fromEffect { (config: Config) => ModelAdmission.make(config.indexing) }
  make[IndexingSettings].from { (config: Config) =>
    val capacity=config.indexing
    IndexingSettings(capacity.annotationSessions,capacity.embeddingRequests,capacity.embeddingBatchSize)
  }
  make[ModelUsageView]
  make[ExpressionHintIndex].from[PostgresExpressionHintIndex]
  make[ModelHttp]
  make[ProblemPassageAnnotator].from[OpenAIProblemPassageAnnotator]
  make[Embedder].from[OpenAIEmbedder]
  make[Worker]
  make[java.time.Clock].fromValue(java.time.Clock.systemUTC())
  make[CollectorProgressStore].from[PostgresCollectorProgressStore]
  make[CollectorProgress]
  make[Application]
  make[Mcp]
  make[RunAuthorization].from[PostgresRunAuthorization]
  make[McpRunTools].from[LiveMcpRunTools]
  make[ModelConfig].from { (config: Config) => config.annotation }
  make[McpTestModel].from[OpenAIMcpTestModel]
  make[McpRunClock].from[SystemMcpRunClock]
  make[Http.WebRoot].from { () => Http.WebRoot(sys.env.get("CHRONICLE_WEB_ROOT")) }
  make[chronicle.protocol.ProtocolConversions]
  make[VersionedWire]
  make[McpTestWire]
  make[McpRunPageEncoding].from { (wire: McpTestWire) => wire }
  make[McpTestRuns].fromResource[McpTestRunsResource]
  make[BrowserControlAdmission].fromResource[BrowserControlResource]
  make[BrowserRpc]
  make[Http]
  make[RuntimeServices]
}
