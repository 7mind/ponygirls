package manure

import cats.effect.{IO,Ref,Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import com.comcast.ip4s.{Host,Port}
import io.circe.Json
import java.nio.file.Files
import manure.{api => wire}
import manure.plugins.RuntimeServices
import munit.FunSuite
import org.http4s.{HttpApp,Response,Status}
import org.http4s.ember.server.EmberServerBuilder
import ponygirls.auth.{IndexingChoice,IndexingPolicy,IndexingPreferenceSql,IndexingService}
import ponygirls.retrieval.EmbeddingEndpoint
import scala.concurrent.duration.*

/** Specified-origin, Good Communication: the live service graph and owned PostgreSQL,
  * with a loopback scripted embedding provider (behavior, not relevance quality).
  */
final class IndexingPreferenceSearchSuite extends FunSuite:
  private val keyword = "prefneedle"
  private val filePath = "file.txt"
  private val payload = Exact.utf8("payload is never embedded\n")

  private def provider: Resource[IO,(String,Ref[IO,Vector[String]])] = for
    submitted <- Resource.eval(Ref.of[IO,Vector[String]](Vector.empty))
    app = HttpApp[IO] { req => for
      raw <- req.as[String]
      json <- IO.fromEither(io.circe.parser.parse(raw))
      texts <- IO.fromEither(json.hcursor.get[List[String]]("input"))
      _ <- submitted.update(_ ++ texts.collect { case text if text.startsWith("doc:") => text.stripPrefix("doc:") })
      body = Json.obj("data" -> Json.fromValues(texts.indices.map { i =>
        Json.obj("index" -> Json.fromInt(i),"embedding" -> Json.arr(Json.fromInt(1),Json.fromInt(0),Json.fromInt(0)))
      }))
    yield Response[IO](Status.Ok).withEntity(body.noSpaces) }
    server <- EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get).withHttpApp(app).build
  yield (s"http://127.0.0.1:${server.address.getPort}/embeddings",submitted)

  private def fixture(body: (Config,Identity,Identity,Ref[IO,Vector[String]]) => IO[Unit]): Unit =
    (BackendFixture.configuration,provider).tupled.use { case ((base,ownerToken,otherToken),(url,submitted)) => for
      credential <- IO.blocking(Files.writeString(base.dataDir.getParent.resolve("embedding-credential"),""))
      endpoint = EmbeddingEndpoint(url,"controlled-indexing","immutable-v1",3,false,"doc:","query:","cosine",credential.toString,
        5.seconds,4096,16,1024,4096)
      config = base.copy(embedding=Some(EmbeddingSettings(endpoint,1,0,16,30,1.second)),indexingPolicy=IndexingPolicy(true,true,true))
      auth = new Auth(config.users)
      _ <- body(config,auth.authenticate(ownerToken).get,auth.authenticate(otherToken).get,submitted)
    yield () }.unsafeRunSync()

  private def upload(s: RuntimeServices,owner: Identity,suffix: String,withFile: Boolean = false): IO[Artifact] =
    val hash = SecretCodec.sha256(payload)
    val files = if withFile then Vector(ManifestEntry(filePath,false,payload.length.toLong,hash)) else Vector.empty
    val input = InitUpload(s"$keyword $suffix",ArtifactKind.Directory,Visibility.Internal,files,None,Vector.empty,None,None)
    for
      draft <- s.artifacts.init(owner,input)
      _ <- if withFile then s.artifacts.putChunk(owner,draft.artifact.id,filePath,0,payload,hash).void else IO.unit
      ready <- s.artifacts.finish(owner,draft.artifact.id)
    yield ready

  private def choose(s: RuntimeServices,config: Config,owner: Identity,choice: IndexingChoice): IO[Unit] =
    s.database.transaction(c => IndexingPreferenceSql.store(c,IndexingService.Manure,config.indexingPolicy).setChoice(owner.userId,choice)).void

  private def search(s: RuntimeServices,config: Config,reader: Identity,mode: wire.SearchMode,owner: Option[String] = None): IO[wire.SearchPage] =
    s.search.query(reader,wire.SearchQuery(keyword,mode,wire.SearchFilter(None,None,owner,Nil,None,None),20,None),config.apiOrigin)

  private def expect(page: wire.SearchPage,ids: Set[String],pending: Long = 0L): Unit =
    assertEquals(page.hits.map(_.artifact.artifactId).toSet,ids)
    assertEquals(page.total,ids.size.toLong)
    assertEquals(page.pending,pending)

  private def expectAll(s: RuntimeServices,config: Config,reader: Identity,ids: Set[String],owner: Option[String] = None): IO[Unit] =
    wire.SearchMode.all.traverse_(mode => search(s,config,reader,mode,owner).map(expect(_,ids)))

  private def work(s: RuntimeServices,expected: Boolean): IO[Unit] = s.worker.once().map(assertEquals(_,expected))

  private def catalogue(s: RuntimeServices,config: Config,reader: Identity): IO[Vector[Artifact]] =
    new Catalogue(s.artifacts,config.limits,SystemDomainClock).list(reader,
      wire.CatalogueQuery(keyword,false,None,Some(wire.ArtifactState.Ready),wire.CatalogueSort.Name,wire.SortDirection.Asc,20,None,Nil,None,None)).map(_._1)

  test("producer opt-out hides retained and new search content without changing upload, catalogue or links") { fixture { (config,producer,reader,submitted) =>
    for
      saved <- Main.resources(config).use { s => for
        _ <- IO(assertEquals(producer.userId,"owner\u0000馬"))
        old <- upload(s,producer,"retained",withFile=true)
        other <- upload(s,reader,"control")
        grant <- s.artifacts.createGrant(producer,old.id)
        _ <- work(s,true) *> work(s,true)
        _ <- expectAll(s,config,reader,Set(old.id,other.id))
        oldSemantic <- search(s,config,reader,wire.SearchMode.Semantic,Some(producer.userId)).map(_.hits.head)
        initialDocs <- submitted.get
        before <- catalogue(s,config,reader)
        _ <- choose(s,config,producer,IndexingChoice.Disable)
        after <- catalogue(s,config,reader)
        info <- s.artifacts.info(reader,old.id)
        _ <- IO {
          assertEquals(after,before)
          assertEquals(after.map(_.id).toSet,Set(old.id,other.id))
          assertEquals(info,old)
        }
        content <- s.artifacts.redeem(old.id,grant)
        _ <- s.artifacts.openContent(old.id,filePath,Some(content._1),None,None).use { (_,file) =>
          IO.blocking(assertEquals(file.read(0,1024).toVector,payload.toVector))
        }
        fresh <- upload(s,producer,"staged",withFile=true)
        patched <- s.artifacts.patch(producer,fresh.id,ArtifactPatch(Some(s"$keyword latest"),None,TtlPatch.Unchanged))
        _ <- expectAll(s,config,reader,Set(other.id)) *> expectAll(s,config,producer,Set(other.id))
        _ <- expectAll(s,config,reader,Set.empty,Some(producer.userId))
        _ <- work(s,false)
        _ <- submitted.get.map(assertEquals(_,initialDocs))
      yield (old,other,patched.artifact,oldSemantic,initialDocs) }
      (old,other,latest,oldSemantic,initialDocs) = saved
      _ <- Main.resources(config).use { s => for
        // Preference and the latest disabled head both survive restart.
        _ <- expectAll(s,config,reader,Set(other.id)) *> work(s,false)
        all <- catalogue(s,config,reader)
        _ <- IO(assertEquals(all.map(a => a.id -> a.name).toMap,Vector(old,other,latest).map(a => a.id -> a.name).toMap))
        _ <- choose(s,config,producer,IndexingChoice.Enable)
        lexical <- search(s,config,reader,wire.SearchMode.Lexical,Some(producer.userId))
        semantic <- search(s,config,reader,wire.SearchMode.Semantic,Some(producer.userId))
        _ <- IO {
          expect(lexical,Set(old.id,latest.id))
          expect(semantic,Set(old.id),pending=1L)
          assertEquals(semantic.hits,List(oldSemantic))
          assertEquals(lexical.hits.find(_.artifact.artifactId == latest.id).map(_.artifact.name),Some(latest.name))
        }
        _ <- work(s,true) *> work(s,false)
        _ <- expectAll(s,config,reader,Set(old.id,latest.id),Some(producer.userId))
        _ <- submitted.get.map(assertEquals(_,initialDocs ++ Vector(latest.name,filePath)))
      yield () }
    yield ()
  }}

  test("startup restores exact creator attribution to a historical semantic publication without replacing it") { fixture { (config,producer,reader,_) =>
    val disabled = config.copy(indexingPolicy=config.indexingPolicy.copy(defaultEnabled=false))
    for
      saved <- Main.resources(config).use { s => for
        old <- upload(s,producer,"historical")
        _ <- work(s,true)
        original <- search(s,config,reader,wire.SearchMode.Semantic).map(_.hits.head)
        _ <- s.artifacts.patch(producer,old.id,ArtifactPatch(Some(s"$keyword new head"),None,TtlPatch.Unchanged))
        head <- search(s,config,reader,wire.SearchMode.Lexical).map(_.hits.head)
        // Emulate the migration defaults on a pre-attribution head and retained, older generation.
        _ <- s.database.transaction { c =>
          Jdbc.exec(c,"UPDATE pony_retrieval_sources SET owner_keys='{}'")
          Jdbc.exec(c,"UPDATE pony_retrieval_generations SET owner_keys='{}'")
          ()
        }
      yield (head,original) }
      (head,original) = saved
      _ <- Main.resources(disabled).use { s => for
        _ <- expectAll(s,disabled,reader,Set.empty) *> work(s,false)
        _ <- choose(s,disabled,producer,IndexingChoice.Enable)
        lexical <- search(s,disabled,reader,wire.SearchMode.Lexical)
        semantic <- search(s,disabled,reader,wire.SearchMode.Semantic)
        _ <- IO {
          expect(lexical,Set(head.artifact.artifactId))
          assertEquals(lexical.hits,List(head))
          expect(semantic,Set(head.artifact.artifactId),pending=1L)
          assertEquals(semantic.hits,List(original))
        }
      yield () }
    yield ()
  }}
