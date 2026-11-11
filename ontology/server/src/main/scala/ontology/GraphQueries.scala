package ontology

import cats.effect.IO
import cats.syntax.all.*
import ontology.api.*
import ontology.domain.*
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import java.util.Base64

final case class QueryLimits(maxPageRecords: Int, maxTargets: Int, maxPageBytes: Int, maxQueryBytes: Int) {
  Require(maxPageRecords > 0 && maxTargets > 0 && maxPageBytes >= 4096 && maxQueryBytes > 0, "config", "invalid graph query limits")
}
final case class CursorPosition(generation: Long, offset: Int)
final class CursorSigner(key: Array[Byte]) {
  Require(key.length >= 32, "config", "cursor signing key too short")
  private val secret = key.clone()
  private val encoder = Base64.getUrlEncoder.withoutPadding()
  private def mac(bytes: Array[Byte]): Array[Byte] = {
    val algorithm = "HmacSHA256"
    val instance = Mac.getInstance(algorithm)
    instance.init(new SecretKeySpec(secret, algorithm))
    instance.doFinal(bytes)
  }
  def encode(query: String, position: CursorPosition): String = {
    Require(position.generation >= 0 && position.offset >= 0, "cursor", "invalid cursor position")
    val data = io.circe.Json.obj("query" -> io.circe.Json.fromString(query), "generation" -> io.circe.Json.fromString(position.generation.toString), "offset" -> io.circe.Json.fromInt(position.offset)).noSpaces.getBytes(UTF_8)
    encoder.encodeToString(data) + "." + encoder.encodeToString(mac(data))
  }
  def decode(token: String, query: String): CursorPosition = {
    Require(token.length <= 1024, "cursor", "cursor too long")
    try {
      val parts = token.split("\\.", -1)
      Require(parts.length == 2, "cursor", "invalid cursor")
      val data = Base64.getUrlDecoder.decode(parts(0)); val signature = Base64.getUrlDecoder.decode(parts(1))
      Require(encoder.encodeToString(data) == parts(0) && encoder.encodeToString(signature) == parts(1) && MessageDigest.isEqual(mac(data), signature), "cursor", "invalid cursor signature")
      val value = Wire.parse(data)
      Require(value.asObject.exists(_.keys.toSet == Set("query", "generation", "offset")), "cursor", "invalid cursor fields")
      val h = value.hcursor
      Require(h.get[String]("query").toOption.contains(query), "cursor", "cursor query changed")
      val generation = h.get[String]("generation").fold(_ => throw Fault("cursor", "invalid generation"), _.toLong)
      val offset = h.get[Int]("offset").fold(_ => throw Fault("cursor", "invalid offset"), identity)
      Require(generation >= 0 && offset >= 0, "cursor", "invalid cursor position")
      CursorPosition(generation, offset)
    } catch { case f: Fault if f.code == "cursor" => throw f; case _: Exception => throw Fault("cursor", "invalid cursor") }
  }
}
final class GraphQueries(repository: GraphRepository, cursors: CursorSigner, limits: QueryLimits) {
  private val EnvelopeReserveBytes = 2048
  private def start(cursor: Option[String], query: String, generation: Long, count: Int): Int = cursor match {
    case None => 0
    case Some(token) =>
      val position = cursors.decode(token, query)
      Require(position.generation == generation, "stale-cursor", "graph changed during pagination")
      Require(position.offset <= count, "cursor", "cursor is outside result")
      position.offset
  }
  private def page[A](items: List[A], offset: Int, limit: Int, bytes: A => Int): (List[A], Int) = {
    val candidates = items.drop(offset).take(limit)
    val selected = List.newBuilder[A]
    var total = EnvelopeReserveBytes
    var count = 0
    candidates.iterator.takeWhile { value =>
      val size = bytes(value) + 1
      if (count == 0) Require(total + size <= limits.maxPageBytes, "record-too-large", "record exceeds one page; no content was truncated")
      val fits = total + size <= limits.maxPageBytes
      if (fits) { total += size; count += 1; selected += value }
      fits
    }.foreach(_ => ())
    (selected.result(), offset + count)
  }
  private def next(query: String, generation: Long, position: Int, total: Int): Option[String] = if (position < total) Some(cursors.encode(query, CursorPosition(generation, position))) else None
  private def limit(value: Int): Unit = Require(value >= 1 && value <= limits.maxPageRecords, "limit", "invalid page limit")
  private def ordered(records: List[GraphRecord]): List[GraphRecord] = records.distinct.sortBy(r => (Graph.recordRef(r).id.toString, Graph.recordRef(r).revision))
  def read(principal: Principal, request: ReadRequest): IO[ReadResult] = IO.defer {
    principal.require(request.scope, Capability.Read); limit(request.limit)
    Require(request.targets.size <= limits.maxTargets && request.targets.distinct == request.targets, "targets", "invalid or duplicate read targets")
    repository.read(request.scope).flatMap { graph =>
      request.targets.filterNot(ref => Graph.exists(graph, ref)).traverse(ref => repository.input(request.scope, ref)).map { inputs =>
      inputs.foreach(receipt => Require(receipt.generation <= graph.generation, "stale-reference", "input receipt belongs to a newer graph generation"))
      val all = Graph.records(graph) ++ inputs.map(GraphRecord.Input(_))
      val currentBindings = graph.bindings.filter { binding =>
        try { Graph.validateSelectedBinding(graph, binding); true }
        catch { case f: Fault if Set("stale-context", "missing-context", "unselected-context").contains(f.code) => false }
      }
      val currentProgress = currentBindings.flatMap(b => Graph.latestEvent(graph, b.ref)).filter { event =>
        if (!Gates.requiresWarrant(event.phase)) true
        else try { Gates.validateEvent(graph, event); true }
        catch { case f: Fault if Set("stale-context", "missing-context", "unselected-context", "stale-warrant", "assessment-use", "condition", "prerequisite").contains(f.code) => false }
      }
      val current = Graph.definitions(graph).map(GraphRecord.Node(_)) ++ Graph.relations(graph).filter(PlanRequirements.visibleCurrent(graph, _)).map(GraphRecord.Edge(_)) ++ graph.actors.map(GraphRecord.Person(_)) ++
        Selections.latest(graph).map(GraphRecord.Selection(_)) ++ currentBindings.map(GraphRecord.Contract(_)) ++ currentProgress.map(GraphRecord.Progress(_)) ++ inputs.map(GraphRecord.Input(_))
      val selected = request.view match {
        case ReadView.History => if (request.targets.isEmpty) all else all.filter(r => request.targets.exists(_.id == Graph.recordRef(r).id))
        case ReadView.Current =>
          if (request.targets.isEmpty) current
          else {
            request.targets.foreach(r => Require(current.exists(v => Graph.recordRef(v) == r), "stale-reference", "use history for a historical reference"))
            current.filter(r => request.targets.contains(Graph.recordRef(r)))
          }
        case ReadView.BindingContext =>
          Require(request.targets.nonEmpty, "targets", "binding context requires explicit targets")
          val wanted = request.targets.flatMap { ref =>
            graph.bindings.find(_.ref == ref) match {
              case Some(b) => List(b.ref, b.definition) ++ Graph.definitions(graph).filter(_.ref.id == b.definition.id).map(_.ref) ++ b.context ++ Graph.context(graph, b.definition, Some(b.workContext)) ++ graph.selections.filter(_.binding == b.ref).map(_.ref) ++ Selections.current(graph, b).toList.flatMap(s => List(s.ref, s.binding)) ++ graph.events.filter(_.subject == b.ref).flatMap(e => e.ref :: Gates.references(e.gateBasis)) ++ graph.relations.filter(r => r.kind == RelationKind.UsesAssessment && r.targets.contains(b.ref)).flatMap(r => r.ref :: r.sources)
              case None => Graph.node(graph, ref); List(ref) ++ Graph.definitions(graph).filter(_.ref.id == ref.id).map(_.ref) ++ Graph.context(graph, ref, None)
            }
          }.distinct
          val related = graph.relations.filter(r => wanted.contains(r.ref)).flatMap { r =>
            val detailRefs = r.detail match { case use: RelationDetail.AssessmentUse => use.requirement :: use.basis; case _ => Nil }
            r.sources ++ r.targets ++ detailRefs
          } ++ graph.selections.filter(s => wanted.contains(s.ref)).flatMap(s => s.binding :: s.basis) ++ graph.events.filter(e => wanted.contains(e.ref)).flatMap(e => Gates.references(e.gateBasis))
          val anchors = all.filter(r => (wanted ++ related).contains(Graph.recordRef(r))).flatMap {
            case GraphRecord.Node(value) => Applicabilities.references(value.applicability)
            case GraphRecord.Edge(value) => Applicabilities.references(value.applicability)
            case _ => Nil
          }
          all.filter(r => (wanted ++ related ++ anchors).contains(Graph.recordRef(r)))
      }
      val records = ordered(selected)
      val digest = Digests.text(Wire.encode(ReadRequest.codecJson, request.copy(cursor = None)).noSpaces)
      val offset = start(request.cursor, digest, graph.generation, records.size)
      val (values, position) = page(records, offset, request.limit, (r: GraphRecord) => Wire.encode(GraphRecord.codecJson, r).noSpaces.getBytes(UTF_8).length)
      ReadResult(graph.scope, graph.generation, values, next(digest, graph.generation, position, records.size))
      }
    }
  }
  def find(principal: Principal, request: FindRequest): IO[FindResult] = IO.defer {
    principal.require(request.scope, Capability.Read); limit(request.limit)
    Require(request.query.getBytes(UTF_8).length <= limits.maxQueryBytes, "query", "query exceeds declared bound")
    repository.read(request.scope).map { graph =>
      val items = Graph.definitions(graph).filter(d => request.kind.forall(kind => kind.toString.toLowerCase(java.util.Locale.ROOT) == Graph.kind(d.content)) && Graph.text(d.content).contains(request.query)).map(d => SearchHit(d.ref, Graph.kind(d.content), Graph.text(d.content), d.standing, d.applicability))
      val digest = Digests.text(Wire.encode(FindRequest.codecJson, request.copy(cursor = None)).noSpaces)
      val offset = start(request.cursor, digest, graph.generation, items.size)
      val (values, position) = page(items, offset, request.limit, (item: SearchHit) => Wire.encode(SearchHit.codecJson, item).noSpaces.getBytes(UTF_8).length)
      FindResult(graph.scope, graph.generation, values, next(digest, graph.generation, position, items.size))
    }
  }
}
