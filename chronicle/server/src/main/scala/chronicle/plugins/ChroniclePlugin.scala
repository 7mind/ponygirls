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
  make[Database].fromResource[DatabaseResource]
  make[JobBudget].from { (clock: java.time.Clock) => new JobBudget(JobLimits.production,clock) }
  make[Auth]
  make[RevisionLayoutPolicy].fromValue(RevisionLayoutPolicy.production)
  make[PostgresArchive]
  make[SessionArchive].from[PostgresArchive]
  make[SearchIndex].from[PostgresSearch]
  make[ArchiveIndex].from[PostgresArchiveIndex]
  make[SemanticLegBudget].fromValue(SemanticLegBudget.production)
  make[ActivityIndex].from[PostgresActivity]
  make[cats.effect.kernel.Clock[IO]].fromValue(cats.effect.Clock[IO])
  make[ModelTelemetryClock].from[JavaModelTelemetryClock]
  make[ModelTelemetry].fromEffect { (clock: ModelTelemetryClock) => ModelTelemetry.make(clock) }
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
  make[Worker.FailureBackoff].fromValue(Worker.FailureBackoff.production)
  make[Worker.Leases].fromValue(Worker.Leases.production)
  make[WorkerArchive].from { (db: Database,config: Config,layout: RevisionLayoutPolicy) => WorkerArchive(new PostgresArchive(db.background,config,layout)) }
  make[Worker].from { (archive: WorkerArchive,annotator: ProblemPassageAnnotator,embedder: Embedder,config: Config,profiles: IndexProfileCatalog,
      admission: ModelAdmission,logger: logstage.IzLogger,backoff: Worker.FailureBackoff,snapshots: SnapshotAdmission,leases: Worker.Leases) =>
    new Worker(archive.archive,annotator,embedder,config,profiles,admission,logger,backoff,snapshots,leases)
  }
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
  make[Http.SocketLiveness].fromValue(Http.SocketLiveness.production)
  make[Http.WebRoot].from { () => Http.WebRoot(sys.env.get("CHRONICLE_WEB_ROOT")) }
  make[VersionedWire]
  make[McpTestWire]
  make[McpRunPageEncoding].from { (wire: McpTestWire) => wire }
  make[McpTestRuns].fromResource[McpTestRunsResource]
  make[BrowserControlAdmission].fromResource[BrowserControlResource]
  make[SnapshotAdmission].fromResource[SnapshotAdmissionResource]
  make[UploadPolicy].fromValue(UploadPolicy.production)
  make[Uploads]
  make[RawStream.Policy].fromValue(RawStream.Policy.production)
  make[RawStream]
  make[EpochMaintenance].fromResource[EpochMaintenanceResource]
  make[BrowserRpc]
  make[Http]
  make[RuntimeServices].addDependency[EpochMaintenance]
}
