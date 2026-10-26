package chronicle.plugins
import chronicle.*
import distage.*
import izumi.distage.plugins.PluginDef
import cats.effect.IO
import org.http4s.client.Client

object ChroniclePlugin extends PluginDef {
  make[logstage.IzLogger].fromValue(logstage.IzLogger())
  make[IndexProfileCatalog].from { (config: Config) => IndexProfileCatalog.legacyOnly(config) }
  make[Database]
  make[Auth]
  make[PostgresArchive]
  make[SessionArchive].from[PostgresArchive]
  make[SearchIndex].from[PostgresSearch]
  make[ArchiveIndex].from[PostgresArchiveIndex]
  make[ActivityIndex].from[PostgresActivity]
  make[ModelHttp]
  make[Annotator].from[OpenAIAnnotator]
  make[Embedder].from[OpenAIEmbedder]
  make[Worker]
  make[java.time.Clock].fromValue(java.time.Clock.systemUTC())
  make[CollectorProgressStore].from[PostgresCollectorProgressStore]
  make[CollectorProgress]
  make[Application]
  make[Mcp]
  make[Http.WebRoot].from { () => Http.WebRoot(sys.env.get("CHRONICLE_WEB_ROOT")) }
  make[chronicle.protocol.ProtocolConversions]
  make[VersionedWire]
  make[Http]
  make[RuntimeServices]
}
