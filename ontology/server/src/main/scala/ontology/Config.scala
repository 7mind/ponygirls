package ontology

import com.comcast.ip4s.{Host, Port}
import java.nio.file.{Files, Path}
import java.nio.charset.StandardCharsets.UTF_8
import scala.concurrent.duration.*
import scala.util.Using
import scala.util.control.NonFatal
import ontology.api.*
import ontology.curation.*
import ontology.domain.*
import ponygirls.runtime.JdbcConfig

final case class ListenerConfig(listenHost: Host, listenPort: Port, maxConnections: Int, maxHeaderBytes: Int,
  shutdown: FiniteDuration, webRoot: Option[Path]) {
  Require(listenPort.value > 0 && maxConnections > 0 && maxHeaderBytes > 0 && shutdown > Duration.Zero, "config", "invalid listener bounds")
  Require(webRoot.forall(_.isAbsolute), "config", "absolute web root required")
}
final case class ProjectionRuntimeConfig(settings: ProjectionSettings, storage: RdfStorage,
  resource: ProjectionResourceConfig, step: ProjectionStepConfig)
final case class Config(http: ListenerConfig, database: JdbcConfig, auth: AuthConfig, serviceActor: Actor,
  cursorKeyFile: Path, query: QueryLimits, review: ReviewLimits, capsule: CapsuleStoreSettings,
  curation: CurationStoreSettings, cycle: CurationCycleConfig, runner: CurationRunnerConfig,
  curator: CuratorConfig, projection: ProjectionRuntimeConfig) {
  Config.validate(this)
  override def toString: String = "OntologyConfig(<redacted>)"
}
object Config {
  private val MaximumBytes = 1024 * 1024
  private val HttpDefaultPort = 80
  private def label(value: String): Unit = Require(value.trim.nonEmpty && value.length <= Contexts.MaximumTextLength && UTF_8.newEncoder().canEncode(value), "config", "invalid configured label")
  private[ontology] def validate(config: Config): Unit = {
    config.database.validate()
    val origin = AuthConfig.validate(config.auth)
    Require(origin.getPort == -1 || origin.getPort > 0, "config", "positive explicit origin port required")
    config.auth.credentials.foreach { value =>
      label(value.id); label(value.actor.id); value.scopes.foreach(label)
      Require(value.hashFile.isAbsolute, "config", "absolute credential hash reference required")
    }
    label(config.serviceActor.id)
    Require(config.serviceActor.kind == ActorKind.Service && config.curation.service == config.serviceActor, "config", "configured Service recorder required")
    Require(config.cursorKeyFile.isAbsolute, "config", "absolute cursor key reference required")
    CuratorModel.validateConfig(config.curator)
    CurationRunner.validate(config.curation, config.cycle, config.runner)
    config.curation.scopes.foreach(label)
    Require((config.curation.scopes.toList :+ config.curator.profileId :+ CurationInputs.Encoding).forall(_.length <= config.curation.guards.maxLabelChars),
      "config", "configured curation labels exceed their admission bound")
    config.projection.settings.scopes.foreach(label)
    List(config.curation.principal, config.projection.settings.principal).foreach { value =>
      label(value.credentialId); label(value.actor.id); value.scopes.foreach(label)
    }
    Require(config.curation.scopes.subsetOf(config.projection.settings.scopes), "config", "curation scopes require projection coverage")
    Require(config.capsule.projection.contexts.forall(value => config.curation.scopes.contains(value.scope)), "config", "capsule contexts require maintained scopes")
    val primary = Set(Capability.Mutate, Capability.Capture, Capability.HostCapture, Capability.Review)
    config.auth.credentials.filter(_.capabilities.exists(primary.contains)).foreach(value =>
      Require(value.scopes.subsetOf(config.curation.scopes), "config", "primary writer scopes require maintenance"))
    if (config.auth.loopbackDevelopment) {
      Require(Set("127.0.0.1", "::1").contains(config.http.listenHost.toString), "config", "development listener must bind literal loopback")
      if (origin.getScheme == "http") Require(config.http.listenPort.value == (if (origin.getPort == -1) HttpDefaultPort else origin.getPort), "config", "development listener and origin ports differ")
    }
  }
  private def checked[A](operation: => A): A = try operation catch {
    case fault: Fault if fault.code == "config" => throw fault
    case NonFatal(_) => throw Fault("config", "invalid configuration")
  }
  def decode(json: io.circe.Json): Config = checked(ConfigDecoder.decode(json))
  def decode(bytes: Array[Byte]): Config = checked {
    Require(bytes.length <= MaximumBytes, "config", "configuration exceeds byte bound")
    decode(Wire.parse(bytes))
  }
  def load(path: Path): Config = checked {
    val bytes = Using.resource(Files.newInputStream(path))(_.readNBytes(MaximumBytes + 1))
    decode(bytes)
  }
}
