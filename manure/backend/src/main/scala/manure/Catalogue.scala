package manure

import cats.effect.IO
import io.circe.{Json, parser}
import java.util.Base64
import manure.{api => wire}
import baboon.runtime.shared.BaboonCodecContext

/** Current keyset policy. Page scan keeps only limit+1 candidates and one bounded
  * metadata batch, not every manifest in memory. Cursors bind ALL effective query
  * fields and sort, but confer no authorization or snapshot guarantee.
  */
final class Catalogue(artifacts: Artifacts, limits: Limits, clock: DomainClock):
  private case class Position(value: Json,id: String)
  private def key(a: Artifact,sort: wire.CatalogueSort): Json = sort match
    case wire.CatalogueSort.Name => Json.fromString(a.name)
    case wire.CatalogueSort.CreatedAt => Json.fromDoubleOrNull(a.createdAtSeconds)
    case wire.CatalogueSort.ExpiresAt => a.expiresAtSeconds.map(Json.fromDoubleOrNull).getOrElse(Json.Null)
    case wire.CatalogueSort.TotalBytes => Json.fromLong(a.totalBytes)
    case wire.CatalogueSort.FileCount => Json.fromLong(a.fileCount)
    case wire.CatalogueSort.Visibility => Json.fromString(a.visibility.wire)
    case wire.CatalogueSort.State => Json.fromString(a.state.wire)
    case wire.CatalogueSort.Kind => Json.fromString(a.kind.wire)
    case wire.CatalogueSort.CreatedByUser => Json.fromString(a.createdByUser)
  private def position(a: Artifact,q: wire.CatalogueQuery): Position = Position(key(a,q.sort),a.id)
  private def compare(a: Position,b: Position,q: wire.CatalogueQuery): Int =
    // Expiry null remains LAST in both directions, independent of ID tie order.
    if a.value.isNull != b.value.isNull then if a.value.isNull then 1 else -1
    else
      val primary = if a.value.isNull then 0 else (a.value.asString,b.value.asString) match
        case (Some(x),Some(y)) => Exact.compare(x,y)
        case _ =>
          val x = a.value.asNumber.flatMap(_.toBigDecimal).getOrElse(throw DomainError("bad-envelope"))
          val y = b.value.asNumber.flatMap(_.toBigDecimal).getOrElse(throw DomainError("bad-envelope"))
          x.compare(y)
      val value = if primary == 0 then Exact.compare(a.id,b.id) else primary
      if q.direction == wire.SortDirection.Asc then value else -value
  private def fingerprint(q: wire.CatalogueQuery): String =
    SecretCodec.sha256(wire.CatalogueQuery.codecJson.encode(BaboonCodecContext.Default,q.copy(cursor=None)).noSpaces)
  private def encode(p: Position,q: wire.CatalogueQuery): String = Base64.getUrlEncoder.withoutPadding().encodeToString(Exact.utf8(
    Json.obj("policy" -> Json.fromString("utf8-lower-root-v1"),"query" -> Json.fromString(fingerprint(q)),"value" -> p.value,"id" -> Json.fromString(p.id)).noSpaces))
  private def decode(value: String,q: wire.CatalogueQuery): Position =
    try
      Require(value.length <= 8192 && value.matches("[A-Za-z0-9_-]+"), "bad-envelope")
      val bytes = Base64.getUrlDecoder.decode(value)
      Require(Base64.getUrlEncoder.withoutPadding().encodeToString(bytes) == value, "bad-envelope")
      val obj = parser.parse(Exact.string(bytes)).toOption.flatMap(_.asObject).getOrElse(throw DomainError("bad-envelope"))
      Require(obj.keys.toSet == Set("policy","query","value","id") && obj("policy").flatMap(_.asString).contains("utf8-lower-root-v1") &&
        obj("query").flatMap(_.asString).contains(fingerprint(q)), "bad-envelope")
      val id = obj("id").flatMap(_.asString).getOrElse(throw DomainError("bad-envelope"))
      Require(id.matches("[0-9a-f]{32}"), "bad-envelope")
      val v = obj("value").get
      val numeric = Set(wire.CatalogueSort.CreatedAt,wire.CatalogueSort.ExpiresAt,wire.CatalogueSort.TotalBytes,wire.CatalogueSort.FileCount)(q.sort)
      Require(if v.isNull then q.sort == wire.CatalogueSort.ExpiresAt else if numeric then v.isNumber else v.isString, "bad-envelope")
      Position(v,id)
    catch case _: IllegalArgumentException | _: java.nio.charset.CharacterCodingException => throw DomainError("bad-envelope")
  def list(identity: Identity,q: wire.CatalogueQuery): IO[(Vector[Artifact],Option[String])] = IO {
    Require(q.limit > 0 && q.limit <= limits.maxListLimit && q.query.length <= 1024, "bad-envelope")
    q.cursor.map(decode(_,q))
  }.flatMap { boundary =>
    def eligible(a: Artifact): Boolean =
      (q.includeExpired || !a.expired(clock.now)) &&
      q.visibility.forall(v => v.toString.toLowerCase(java.util.Locale.ROOT) == a.visibility.wire) &&
      q.state.forall(s => s.toString.toLowerCase(java.util.Locale.ROOT) == a.state.wire) &&
      (a.state == UploadState.Ready || a.createdByUser == identity.userId) &&
      (q.query.isEmpty || Exact.matching(a.name).contains(Exact.matching(q.query)) || Exact.matching(a.id).contains(Exact.matching(q.query))) &&
      boundary.forall(b => compare(position(a,q),b,q) > 0)
    def scan(after: Option[String],best: Vector[Artifact]): IO[(Vector[Artifact],Option[String])] =
      artifacts.snapshot(identity,after,limits.sweepBatch).flatMap { batch =>
        val candidates = (best ++ batch.filter(eligible)).sortWith((a,b) => compare(position(a,q),position(b,q),q) < 0).take(q.limit+1)
        if batch.size == limits.sweepBatch then scan(Some(batch.last.id),candidates)
        else
          val page = candidates.take(q.limit)
          IO.pure((page,if candidates.size > q.limit then page.lastOption.map(a => encode(position(a,q),q)) else None))
      }
    scan(None,Vector.empty)
  }
