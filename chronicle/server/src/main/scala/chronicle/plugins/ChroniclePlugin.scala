package chronicle.plugins
import chronicle.*
import distage.*
import izumi.distage.plugins.PluginDef
import cats.effect.IO
import org.http4s.client.Client

object ChroniclePlugin extends PluginDef {
  make[logstage.IzLogger].fromValue(logstage.IzLogger())
  make[Database]
  make[Auth]
  make[PostgresArchive]
  make[SessionArchive].from[PostgresArchive]
  make[SearchIndex].from[PostgresSearch]
  make[ModelHttp]
  make[Annotator].from[OpenAIAnnotator]
  make[Embedder].from[OpenAIEmbedder]
  make[Worker]
  make[Application]
  make[Mcp]
  make[Http]
  make[RuntimeServices]
}
