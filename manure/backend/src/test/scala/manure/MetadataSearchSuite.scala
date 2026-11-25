package manure

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import manure.{api => wire}
import munit.FunSuite
import ponygirls.auth.IndexingService
import ponygirls.retrieval.*
import ponygirls.retrieval.postgres.PostgresRetrieval

/** Specified-origin Blackbox/Good Communication: controlled vectors establish
  * filter/publication behavior, not model relevance quality.
  */
final class MetadataSearchSuite extends FunSuite:
  test("lexical/semantic/hybrid apply all exact metadata filters before counts and bounded selection") {
    BackendFixture.resource(true).use { f =>
      val profile=RetrievalProfile(EmbeddingSpace("controlled-metadata","immutable-v1",3,false,"","","cosine"),"manure-metadata-paths-v2")
      val engine=new PostgresRetrieval("manure",Some(profile),IndexingService.Manure,f.config.indexingPolicy)
      val projection=new SearchProjection(f.config,engine)
      // Published while "other" is not yet configured; it must still find the artifacts after live authentication.
      val publishedBeforeOther=new SearchProjection(f.config.copy(users=f.config.users.filter(_.id==f.identity.userId)),engine)
      val embedding=new EmbeddingClient:
        def documents(values: List[String]): IO[List[List[Double]]] = IO.pure(values.map(_ => List(1.0,0.0,0.0)))
        def query(value: String): IO[List[Double]] = IO.pure(List(1.0,0.0,0.0))
      val search=new Search(f.database.get,f.lease,f.config,f.auth,f.clock,engine,projection,Some(embedding))
      val input=InitUpload("needle",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,(Vector("needle tag\u0000馬","release") ++ Vector.tabulate(MetadataRules.MaxTags-2)(i => "tag-"+i)),Some("host\u0000例"),Some("/project/𐀀"))
      def publish: IO[Unit] = f.database.get.transaction { c =>
        var claim=engine.claim(c,30,java.time.Instant.now())
        while claim.nonEmpty do
          val work=claim.get
          if work.chunks.nonEmpty then engine.accept(c,work,0,List.fill(work.chunks.size)(List(1.0,0.0,0.0)))
          engine.publish(c,work)
          claim=engine.claim(c,30,java.time.Instant.now())
      }
      for
        a <- f.artifacts.init(f.identity,input)
        ready <- f.artifacts.finish(f.identity,a.artifact.id)
        b <- f.artifacts.init(f.identity,input.copy(tags=Vector("needle tag\u0000馬")))
        excluded <- f.artifacts.finish(f.identity,b.artifact.id)
        _ <- f.database.get.transaction { c => engine.initialize(c); publishedBeforeOther.put(c,ready);publishedBeforeOther.put(c,excluded) }
        _ <- publish
        _ <- wire.SearchMode.all.traverse_ { mode =>
          val filter=wire.SearchFilter(Some(wire.Visibility.Internal),Some(wire.ArtifactKind.Directory),Some(f.identity.userId),input.tags.toList,input.hostname,input.projectPath)
          val query=wire.SearchQuery("needle",mode,filter,1,None)
          for
            page <- search.query(f.other,query,f.config.apiOrigin)
            _ <- IO {
              assertEquals(page.total,1L);assertEquals(page.hits.map(_.artifact.artifactId),List(ready.id))
              assertEquals(page.hits.head.artifact.tags,input.tags.toList)
              assertEquals(page.hits.head.artifact.hostname,input.hostname)
              assertEquals(page.hits.head.policyId,"manure-metadata-paths-v2")
            }
            _ <- Vector(filter.copy(tags=List("Release")),filter.copy(hostname=Some("Host\u0000例")),filter.copy(projectPath=Some("/Project/𐀀"))).traverse_ { changed =>
              search.query(f.other,query.copy(filter=changed),f.config.apiOrigin).map(page => assertEquals(page.total,0L))
            }
            invalid <- search.query(f.other,query.copy(filter=filter.copy(tags=List("x","x"))),f.config.apiOrigin).attempt
            _ <- IO(assertEquals(invalid.left.toOption.collect { case error: DomainError => error.code },Some("bad-envelope")))
          yield ()
        }
        _ <- wire.SearchMode.all.traverse_ { mode =>
          val query=wire.SearchQuery("needle",mode,wire.SearchFilter(None,None,None,Nil,None,None),f.config.limits.maxListLimit,None)
          for
            page <- search.query(f.other,query,f.config.apiOrigin)
            _ <- IO {
              assertEquals(f.config.limits.maxListLimit,200)
              assertEquals(page.total,2L)
              assertEquals(page.hits.map(_.artifact.artifactId).toSet,Set(ready.id,excluded.id))
            }
            rejected <- search.query(f.other,query.copy(limit=query.limit+1),f.config.apiOrigin).attempt
            _ <- IO(assertEquals(rejected.left.toOption.collect { case error: DomainError => error.code },Some("bad-envelope")))
            expandedConfig=f.config.copy(limits=f.config.limits.copy(maxListLimit=201))
            expanded=new Search(f.database.get,f.lease,expandedConfig,f.auth,f.clock,engine,projection,Some(embedding))
            larger <- expanded.query(f.other,query.copy(limit=201),f.config.apiOrigin)
            _ <- IO(assertEquals(larger.hits.map(_.artifact.artifactId).toSet,Set(ready.id,excluded.id)))
          yield ()
        }
        _ <- IO {
          val longTag="𐀀"*128
          val key=AttributeKey.parse(projection.tagKey(longTag))
          assertEquals(key.value.length,68)
          assert(projection.tagKey("release") != projection.tagKey("Release"))
        }
      yield ()
    }.unsafeRunSync()
  }

  test("semantic declares an in-scope unpublished artifact as pending; unavailability keeps its fixed reason") {
    BackendFixture.resource(true).use { f =>
      val profile=RetrievalProfile(EmbeddingSpace("controlled-metadata","immutable-v1",3,false,"","","cosine"),"manure-metadata-paths-v2")
      val engine=new PostgresRetrieval("manure",Some(profile),IndexingService.Manure,f.config.indexingPolicy)
      val projection=new SearchProjection(f.config,engine)
      val embedding=new EmbeddingClient:
        def documents(values: List[String]): IO[List[List[Double]]] = IO.pure(values.map(_ => List(1.0,0.0,0.0)))
        def query(value: String): IO[List[Double]] = IO.pure(List(1.0,0.0,0.0))
      val failing=new EmbeddingClient:
        def documents(values: List[String]): IO[List[List[Double]]] = IO.raiseError(new RuntimeException("provider detail"))
        def query(value: String): IO[List[Double]] = IO.raiseError(new RuntimeException("provider detail"))
      def search(client: Option[EmbeddingClient]): Search = new Search(f.database.get,f.lease,f.config,f.auth,f.clock,engine,projection,client)
      def query(mode: wire.SearchMode): wire.SearchQuery = wire.SearchQuery("needle",mode,wire.SearchFilter(None,None,None,Nil,None,None),10,None)
      def failure(result: Either[Throwable,wire.SearchPage]): Option[(String,Option[UnavailableReason])] =
        result.left.toOption.collect { case error: DomainError => (error.code,error.reason) }
      val input=InitUpload("needle",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,Vector.empty,None,None)
      for
        a <- f.artifacts.init(f.identity,input)
        published <- f.artifacts.finish(f.identity,a.artifact.id)
        _ <- f.database.get.transaction { c =>
          engine.initialize(c); projection.put(c,published)
          var claim=engine.claim(c,30,java.time.Instant.now())
          while claim.nonEmpty do
            val work=claim.get
            if work.chunks.nonEmpty then engine.accept(c,work,0,List.fill(work.chunks.size)(List(1.0,0.0,0.0)))
            engine.publish(c,work)
            claim=engine.claim(c,30,java.time.Instant.now())
        }
        b <- f.artifacts.init(f.identity,input)
        unpublished <- f.artifacts.finish(f.identity,b.artifact.id)
        _ <- f.database.get.transaction(c => projection.put(c,unpublished))
        semantic <- search(Some(embedding)).query(f.other,query(wire.SearchMode.Semantic),f.config.apiOrigin)
        lexical <- search(Some(embedding)).query(f.other,query(wire.SearchMode.Lexical),f.config.apiOrigin)
        failed <- search(Some(failing)).query(f.other,query(wire.SearchMode.Hybrid),f.config.apiOrigin).attempt
        unconfigured <- search(None).query(f.other,query(wire.SearchMode.Semantic),f.config.apiOrigin).attempt
        _ <- IO {
          assertEquals(semantic.hits.map(_.artifact.artifactId),List(published.id))
          assertEquals(semantic.pending,1L)
          assertEquals(lexical.hits.map(_.artifact.artifactId).toSet,Set(published.id,unpublished.id))
          assertEquals(lexical.pending,0L)
          assertEquals(failure(failed),Some(("search-unavailable",Some(UnavailableReason.EmbeddingFailed))))
          assertEquals(failure(unconfigured),Some(("search-unavailable",Some(UnavailableReason.NotConfigured))))
        }
      yield ()
    }.unsafeRunSync()
  }

  test("all 32 supported tags can be combined with every other exact search filter") {
    BackendFixture.resource(true).use { f =>
      val tags=Vector.tabulate(MetadataRules.MaxTags)(i => "tag-" + i)
      val input=InitUpload("needle",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,tags,Some("host"),Some("/project"))
      val engine=SearchProjection.retrieval(f.config)
      val projection=new SearchProjection(f.config,engine)
      val search=new Search(f.database.get,f.lease,f.config,f.auth,f.clock,engine,projection,None)
      for
        initialized <- f.artifacts.init(f.identity,input)
        ready <- f.artifacts.finish(f.identity,initialized.artifact.id)
        page <- search.query(f.other,wire.SearchQuery("needle",wire.SearchMode.Lexical,
          wire.SearchFilter(Some(wire.Visibility.Internal),Some(wire.ArtifactKind.Directory),Some(f.identity.userId),tags.toList,input.hostname,input.projectPath),1,None),f.config.apiOrigin)
        _ <- IO { assertEquals(page.total,1L);assertEquals(page.hits.map(_.artifact.artifactId),List(ready.id)) }
      yield ()
    }.unsafeRunSync()
  }
