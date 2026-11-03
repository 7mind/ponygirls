package manure

import cats.effect.IO
import cats.syntax.all.*
import java.sql.Connection
import ponygirls.retrieval.*
import ponygirls.retrieval.postgres.PostgresRetrieval
import manure.{api => wire}
import io.circe.Json

/** Management-only, explicitly metadata+manifest paths. No binary extraction,
  * dereferencing, HTML execution, passwords, token/grant/hash or secret fields.
  */
final class SearchProjection(config: Config, engine: PostgresRetrieval):
  val policy = "manure-metadata-paths-v1"
  private def attribute(key: String,value: String): ProjectionAttribute = ProjectionAttribute(AttributeKey.parse(key),AttributeValue(value))
  def snapshot(a: Artifact): wire.Artifact = CurrentWire.artifact(a,config.contentUrl(a.id,config.apiOrigin))
  def version(a: Artifact): String = SecretCodec.sha256(Json.arr(
    CurrentWire.encode(wire.Artifact.codecJson,snapshot(a)),
    Json.fromValues(a.manifest.map(e => Json.fromString(e.path))),
    a.expiresAtSeconds.map(v => Json.fromString(SecretCodec.hex(Exact.timestamp(v)))).getOrElse(Json.Null)).noSpaces)
  def initialize(c: Connection): Unit =
    engine.initialize(c)
    Jdbc.exec(c,"CREATE TABLE IF NOT EXISTS manure.search_versions(artifact_id bytea NOT NULL REFERENCES manure.artifacts(id) ON DELETE CASCADE, version bytea NOT NULL, metadata bytea NOT NULL, PRIMARY KEY(artifact_id,version))")
  def put(c: Connection,a: Artifact): Unit =
    if a.state != UploadState.Ready then engine.remove(c,a.id)
    else
      val revision = version(a)
      val chunks = InputChunk("name",a.name,ChunkProvenance("name",None,None,None)) :: a.manifest.zipWithIndex.map { (e,i) =>
        InputChunk("path-" + i,e.path,ChunkProvenance("manifest-path",Some(e.path),None,None))
      }.toList
      val source = SourceProjection(a.id,revision,chunks,
        Vector(attribute("visibility",a.visibility.wire),attribute("kind",a.kind.wire),attribute("createdByUser",a.createdByUser)),
        config.users.map(_.id).toSet,true,false,a.expiresAtSeconds.map(EpochSeconds.fromDouble))
      engine.put(c,source)
      Jdbc.exec(c,"INSERT INTO manure.search_versions(artifact_id,version,metadata) VALUES(?,?,?) ON CONFLICT DO NOTHING",
        Exact.utf8(a.id),Exact.utf8(revision),Exact.utf8(CurrentWire.encode(wire.Artifact.codecJson,snapshot(a)).noSpaces))
  def remove(c: Connection,id: String): Unit = engine.remove(c,id)
  def pinned(c: Connection,id: String,version: String): wire.Artifact =
    Jdbc.rows(c,"SELECT metadata FROM manure.search_versions WHERE artifact_id=? AND version=?",Exact.utf8(id),Exact.utf8(version)) { r =>
      CurrentWire.decode(wire.Artifact.codecJson,CurrentWire.parse(Exact.string(r.getBytes(1))))
    }.headOption.getOrElse(throw DomainError("search-not-ready"))

final class Search(database: JdbcTransactions, root: manure.storage.RootLease, config: Config,
  auth: Auth, clock: DomainClock, engine: PostgresRetrieval, projection: SearchProjection,
  embedding: Option[EmbeddingClient]):
  def modes: List[wire.SearchMode] = if embedding.nonEmpty then List(wire.SearchMode.Lexical,wire.SearchMode.Semantic,wire.SearchMode.Hybrid) else List(wire.SearchMode.Lexical)
  private def filter(key: String,value: String): AttributeFilter = AttributeFilter.Equal(AttributeKey.parse(key),AttributeValue(value))
  def query(identity: Identity,q: wire.SearchQuery,origin: ApiOrigin): IO[wire.SearchPage] = IO {
    Require(auth.live(identity), "unauthorized")
    Require(q.query.nonEmpty && q.query.length <= 4096 && q.limit > 0 && q.limit <= config.limits.maxListLimit && q.cursor.isEmpty, "bad-envelope")
    val mode = q.mode match
      case wire.SearchMode.Lexical => RetrievalMode.Lexical
      case wire.SearchMode.Semantic => RetrievalMode.Semantic
      case wire.SearchMode.Hybrid => RetrievalMode.Hybrid
    Require(mode == RetrievalMode.Lexical || embedding.nonEmpty, "search-unavailable")
    val filters = q.filter.visibility.map(v => filter("visibility",CurrentWire.visibility(v).wire)).toVector ++
      q.filter.kind.map(k => filter("kind",CurrentWire.kind(k).wire)).toVector ++ q.filter.createdByUser.map(u => filter("createdByUser",u)).toVector
    (mode,filters)
  }.flatMap { (mode,filters) =>
    val vector = if mode == RetrievalMode.Lexical then IO.pure(None) else embedding.get.query(q.query).map(Some(_))
    vector.flatMap { values => database.transaction { c => root.run {
      Require(auth.live(identity), "unauthorized")
      val query = RetrievalQuery(identity.userId,q.query,mode,filters,false,0,q.limit,EpochSeconds.fromDouble(clock.now))
      val page = engine.search(c,query,values)
      val hits = page.hits.flatMap { hit =>
        // Fresh source authorization/expiry before returning any pinned metadata.
        if !engine.visible(c,query,hit.id) then None
        else
          val a = projection.pinned(c,hit.id,hit.version).copy(contentUrl=config.contentUrl(hit.id,origin))
          val field = if hit.chunk.provenance.field == "name" then wire.EvidenceField.Name else wire.EvidenceField.ManifestPath
          Some(wire.SearchHit(a,hit.version,hit.generation,projection.policy,hit.profile,
            List(wire.SearchEvidence(field,hit.chunk.provenance.pointer,hit.chunk.text,hit.score)),hit.score))
      }
      wire.SearchPage(hits,page.total,if page.countScope == CountScope.ExactMatches then wire.SearchCountScope.ExactMatches else wire.SearchCountScope.CandidateWindow,page.rankingLimit,None)
    }}}
  }.handleErrorWith {
    case _: RetrievalError => IO.raiseError(DomainError("search-unavailable"))
    case error => IO.raiseError(error)
  }

/** Explicit durable indexing worker. It never runs on writes/serving, calls the
  * model outside transactions and commits each accepted batch under source/run/
  * profile/fence checks implemented by the shared adapter.
  */
final class SearchWorker(database: JdbcTransactions,root: manure.storage.RootLease,engine: PostgresRetrieval,
  client: Option[EmbeddingClient],settings: Option[EmbeddingSettings]):
  private def transaction[A](f: Connection => A): IO[A] = database.transaction(c => root.run(f(c)))
  def once(): IO[Boolean] = client match
    case None => IO.pure(false)
    case Some(model) => transaction(c => engine.claim(c,settings.get.leaseSeconds)).flatMap {
      case None => IO.pure(false)
      case Some(claim) =>
        val batches = claim.chunks.grouped(settings.get.batchSize).zipWithIndex.toList
        batches.traverse_ { (chunks,index) =>
          val start = index*settings.get.batchSize
          transaction { c => engine.renew(c,claim,settings.get.leaseSeconds); engine.accepted(c,claim,start,chunks.size) }.flatMap { accepted =>
            if accepted.nonEmpty then IO.unit
            else model.documents(chunks.map(_.text)).flatMap(vectors => transaction(c => engine.accept(c,claim,start,vectors)))
          }
        } *> transaction(c => engine.publish(c,claim)).as(true)
          .handleErrorWith(error => transaction(c => engine.fail(c,claim)).attempt *> IO.raiseError(error))
    }
