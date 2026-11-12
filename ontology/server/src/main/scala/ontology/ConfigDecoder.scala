package ontology

import com.comcast.ip4s.{Host, Port}
import io.circe.Json
import ontology.api.*
import ontology.curation.*
import ontology.domain.*
import ponygirls.runtime.{JdbcConfig, JdbcLimits}

private[ontology] object ConfigDecoder {
  private def actor(value: Json): Actor = {
    val f = ConfigFields(value, "actor").exact(Set("id", "kind"))
    Actor(f.string("id"), f.enumValue("kind", ActorKind.parse))
  }
  private def capabilities(f: ConfigFields): Set[Capability] = f.uniqueStrings("capabilities").map(value =>
    Capability.parse(value).getOrElse(throw Fault("config", "invalid capability")))
  private def principal(value: Json): Principal = {
    val f = ConfigFields(value, "principal").exact(Set("credentialId", "actor", "scopes", "capabilities"))
    Principal(f.string("credentialId"), actor(f.field("actor")), f.uniqueStrings("scopes"), capabilities(f))
  }
  private def listener(f: ConfigFields): ListenerConfig = {
    f.exact(Set("listenHost", "listenPort", "maxConnections", "maxHeaderBytes", "shutdownMs", "webRoot"))
    val host = Host.fromString(f.string("listenHost")).getOrElse(throw Fault("config", "invalid listener host"))
    val port = Port.fromInt(f.int("listenPort")).getOrElse(throw Fault("config", "invalid listener port"))
    ListenerConfig(host, port, f.int("maxConnections"), f.int("maxHeaderBytes"), f.duration("shutdownMs"), f.optionalPath("webRoot"))
  }
  private def database(f: ConfigFields): JdbcConfig = {
    f.exact(Set("jdbcUrl", "user", "passwordFile", "limits"))
    val l = f.child("limits").exact(Set("maxConnections", "maxQueued", "queueTimeoutMs", "connectTimeoutMs", "statementTimeoutMs", "lockTimeoutMs", "idleTransactionTimeoutMs", "socketTimeoutMs"))
    JdbcConfig(f.string("jdbcUrl"), f.string("user"), f.absolutePath("passwordFile"), JdbcLimits(l.int("maxConnections"), l.int("maxQueued"),
      l.duration("queueTimeoutMs"), l.duration("connectTimeoutMs"), l.duration("statementTimeoutMs"), l.duration("lockTimeoutMs"), l.duration("idleTransactionTimeoutMs"), l.duration("socketTimeoutMs")))
  }
  private def authentication(f: ConfigFields): AuthConfig = {
    f.exact(Set("publicOrigin", "loopbackDevelopment", "sessionTtlSeconds", "maxSessions", "credentials"))
    val credentials = f.array("credentials").map { value =>
      val c = ConfigFields(value, "credential").exact(Set("id", "actor", "scopes", "capabilities", "hashFile"))
      CredentialConfig(c.string("id"), actor(c.field("actor")), c.uniqueStrings("scopes"), capabilities(c), c.absolutePath("hashFile"))
    }
    AuthConfig(f.string("publicOrigin"), f.boolean("loopbackDevelopment"), credentials, f.long("sessionTtlSeconds"), f.int("maxSessions"))
  }
  private def query(f: ConfigFields): QueryLimits = {
    f.exact(Set("maxPageRecords", "maxTargets", "maxPageBytes", "maxQueryBytes"))
    QueryLimits(f.int("maxPageRecords"), f.int("maxTargets"), f.int("maxPageBytes"), f.int("maxQueryBytes"))
  }
  private def review(f: ConfigFields): ReviewLimits = {
    f.exact(Set("presentation", "maxRationaleBytes", "maxRequestBytes"))
    val p = f.child("presentation").exact(Set("maxTargets", "maxRecords", "maxPayloadBytes"))
    ReviewLimits(PresentationLimits(p.int("maxTargets"), p.int("maxRecords"), p.int("maxPayloadBytes")), f.int("maxRationaleBytes"), f.int("maxRequestBytes"))
  }
  private def capsule(f: ConfigFields): CapsuleStoreSettings = {
    f.exact(Set("projection", "maxBaselineChain", "maxMaterialSnapshots"))
    val p = f.child("projection").exact(Set("contexts", "limits"))
    val contexts = p.array("contexts").map { value =>
      val c = ConfigFields(value, "workContext").exact(Set("scope", "name"))
      WorkContextKey(c.string("scope"), c.string("name"))
    }
    Require(contexts.distinct.size == contexts.size, "config", "duplicate work context")
    val l = p.child("limits").exact(Set("maxRecords", "maxPayloadBytes"))
    CapsuleStoreSettings(CapsuleSettings(contexts.toSet, CapsuleLimits(l.int("maxRecords"), l.int("maxPayloadBytes"))), f.int("maxBaselineChain"), f.int("maxMaterialSnapshots"))
  }
  private def curation(f: ConfigFields, service: Actor): CurationStoreSettings = {
    f.exact(Set("principal", "scopes", "leaseDurationMs", "attemptDurationMs", "guards", "maxScanScopes", "maxRecoveryAttempts"))
    val g = f.child("guards").exact(Set("maxOrdinals", "maxAuditBytes", "maxInputBytes", "maxPins", "maxLabelChars"))
    CurationStoreSettings(principal(f.field("principal")), service, f.uniqueStrings("scopes"), java.time.Duration.ofMillis(f.duration("leaseDurationMs").toMillis),
      java.time.Duration.ofMillis(f.duration("attemptDurationMs").toMillis), CurationGuardLimits(g.int("maxOrdinals"), g.int("maxAuditBytes"), g.long("maxInputBytes"), g.int("maxPins"), g.int("maxLabelChars")),
      f.int("maxScanScopes"), f.int("maxRecoveryAttempts"))
  }
  private def cycle(f: ConfigFields): CurationCycleConfig = {
    f.exact(Set("scanLimit", "recoveryLimit", "cleanupBudgetMs"))
    CurationCycleConfig(f.int("scanLimit"), f.int("recoveryLimit"), f.duration("cleanupBudgetMs"))
  }
  private def runner(f: ConfigFields): CurationRunnerConfig = {
    f.exact(Set("pollEveryMs", "renewEveryMs", "cleanupBudgetMs"))
    CurationRunnerConfig(f.duration("pollEveryMs"), f.duration("renewEveryMs"), f.duration("cleanupBudgetMs"))
  }
  private def curator(f: ConfigFields): CuratorConfig = {
    f.exact(Set("profileId", "operationUrl", "model", "credentialFile", "deadlineMs", "maxInputBytes", "maxResponseBytes", "maxOutputTokens", "reasoningEffort", "allowSourceSharing", "outputTokenField", "responseFormat"))
    CuratorConfig(f.string("profileId"), f.string("operationUrl"), f.string("model"), f.absolutePath("credentialFile").toString, f.duration("deadlineMs"),
      f.int("maxInputBytes"), f.int("maxResponseBytes"), f.int("maxOutputTokens"), f.optionalString("reasoningEffort"), f.boolean("allowSourceSharing"),
      f.enumValue("outputTokenField", name => CuratorOutputTokenField.values.find(_.toString == name)),
      f.enumValue("responseFormat", name => CuratorResponseFormat.values.find(_.toString == name)))
  }
  private def storage(value: Json): RdfStorage = {
    val tags = value.asObject.getOrElse(throw Fault("config", "tagged RDF storage required"))
    val f = ConfigFields(value, "storage")
    tags.keys.toSet match {
      case names if names == Set("Memory") => f.child("Memory").exact(Set.empty); RdfStorage.Memory
      case names if names == Set("Native") => RdfStorage.Native(f.child("Native").exact(Set("path")).absolutePath("path"))
      case _ => throw Fault("config", "one supported RDF storage tag required")
    }
  }
  private def projection(f: ConfigFields): ProjectionRuntimeConfig = {
    f.exact(Set("principal", "targetId", "scopes", "batchLimit", "storage", "resource", "step"))
    val r = f.child("resource").exact(Set("queryDeadlineSeconds", "observationBudgetMs", "closeBudgetMs"))
    val s = f.child("step").exact(Set("ioObservationBudgetMs"))
    ProjectionRuntimeConfig(ProjectionSettings(principal(f.field("principal")), f.string("targetId"), f.uniqueStrings("scopes"), f.int("batchLimit")), storage(f.field("storage")),
      ProjectionResourceConfig(r.int("queryDeadlineSeconds"), r.duration("observationBudgetMs"), r.duration("closeBudgetMs")), ProjectionStepConfig(s.duration("ioObservationBudgetMs")))
  }
  def decode(value: Json): Config = {
    val f = ConfigFields(value, "config").exact(Set("http", "database", "auth", "serviceActor", "cursorKeyFile", "query", "review", "capsule", "curation", "cycle", "runner", "curator", "projection"))
    val service = actor(f.field("serviceActor"))
    Config(listener(f.child("http")), database(f.child("database")), authentication(f.child("auth")), service, f.absolutePath("cursorKeyFile"),
      query(f.child("query")), review(f.child("review")), capsule(f.child("capsule")), curation(f.child("curation"), service),
      cycle(f.child("cycle")), runner(f.child("runner")), curator(f.child("curator")), projection(f.child("projection")))
  }
}
