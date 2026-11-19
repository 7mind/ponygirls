package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import org.http4s.client.Client

object ModelFixtures {
  // Tests do not wait out the production back-off after a failed job.
  val failureBackoff: Worker.FailureBackoff = Worker.FailureBackoff(scala.concurrent.duration.DurationInt(10).millis)
  def http(client: Client[IO],config: Config): ModelHttp = {
    val clock=new JavaModelTelemetryClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO])
    (for {
      telemetry <- ModelTelemetry.make(clock)
      admission <- ModelAdmission.make(config.indexing)
    } yield new ModelHttp(client,telemetry,admission)).unsafeRunSync()
  }
  def usage(config: Config): ModelUsageView = {
    val clock=new JavaModelTelemetryClock(java.time.Clock.systemUTC(),cats.effect.Clock[IO])
    val capacity=config.indexing
    ModelTelemetry.make(clock).map(store =>
      new ModelUsageView(store,chronicle.api.IndexingSettings(capacity.annotationSessions,capacity.embeddingRequests,capacity.embeddingBatchSize))).unsafeRunSync()
  }
  def worker(archive: SessionArchive,annotator: ProblemPassageAnnotator,embedder: Embedder,config: Config,logger: logstage.IzLogger): Worker = {
    val admission=ModelAdmission.make(config.indexing).unsafeRunSync()
    new Worker(archive,annotator,embedder,config,IndexProfileCatalog.current(config),admission,logger,failureBackoff,snapshots)
  }
  /** A worker's own snapshot admission; its semaphore needs no release. */
  def snapshots: SnapshotAdmission = SnapshotAdmission.resource(logstage.IzLogger(),SnapshotAdmission.ingestWait).allocated.unsafeRunSync()._1
}
