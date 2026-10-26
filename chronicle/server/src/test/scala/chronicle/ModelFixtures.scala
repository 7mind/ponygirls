package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import org.http4s.client.Client

object ModelFixtures {
  def http(client: Client[IO],config: Config): ModelHttp = {
    val clock=new JavaModelTelemetryClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO])
    (for {
      telemetry <- ModelTelemetry.make(clock,config.users.map(_.id).toSet)
      admission <- ModelAdmission.make(config.indexing)
    } yield new ModelHttp(client,telemetry,admission)).unsafeRunSync()
  }
  def usage(config: Config): ModelUsageView = {
    val clock=new JavaModelTelemetryClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO])
    val capacity=config.indexing
    ModelTelemetry.make(clock,config.users.map(_.id).toSet).map(store =>
      new ModelUsageView(store,chronicle.api.IndexingSettings(capacity.annotationSessions,capacity.embeddingRequests,capacity.embeddingBatchSize))).unsafeRunSync()
  }
  def legacyWorker(archive: SessionArchive,annotator: Annotator,embedder: Embedder,config: Config,logger: logstage.IzLogger): Worker = {
    val forbidden=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] = IO.raiseError(new AssertionError("legacy worker invoked passage annotator"))
    }
    val admission=ModelAdmission.make(config.indexing).unsafeRunSync()
    new Worker(archive,annotator,forbidden,embedder,config,IndexProfileCatalog.legacyOnly(config),admission,logger)
  }
}
