package manure

import cats.effect.IO
import io.circe.{Json, parser}
import java.util.Base64
import manure.{api => wire}
import baboon.runtime.shared.BaboonCodecContext

/** Shared pure current policy. PostgreSQL executes the same typed selection in
  * SQL; the handwritten dummy uses select. Neither accepts SQL from a caller.
  */
object CataloguePolicy:
  enum Value:
    case Text(value: String)
    case Time(value: Double)
    case Count(value: Long)
    case Never
  final case class Position(value: Value,id: String)
  final case class Selection(query: wire.CatalogueQuery,boundary: Option[Position],now: Double):
    Require(query.limit > 0 && query.limit < Int.MaxValue, "bad-envelope")
    def fetch: Int = query.limit + 1
    def matching: String = Exact.matching(query.query)
  def key(a: Artifact,sort: wire.CatalogueSort): Value = sort match
    case wire.CatalogueSort.Name => Value.Text(a.name)
    case wire.CatalogueSort.CreatedAt => Value.Time(a.createdAtSeconds)
    case wire.CatalogueSort.ExpiresAt => a.expiresAtSeconds.map(Value.Time.apply).getOrElse(Value.Never)
    case wire.CatalogueSort.TotalBytes => Value.Count(a.totalBytes)
    case wire.CatalogueSort.FileCount => Value.Count(a.fileCount)
    case wire.CatalogueSort.Visibility => Value.Text(a.visibility.wire)
    case wire.CatalogueSort.State => Value.Text(a.state.wire)
    case wire.CatalogueSort.Kind => Value.Text(a.kind.wire)
    case wire.CatalogueSort.CreatedByUser => Value.Text(a.createdByUser)
  def position(a: Artifact,q: wire.CatalogueQuery): Position = Position(key(a,q.sort),a.id)
  def compare(a: Position,b: Position,q: wire.CatalogueQuery): Int =
    // Null expiry stays last independently of the requested ID tie direction.
    if (a.value == Value.Never) != (b.value == Value.Never) then
      if a.value == Value.Never then 1 else -1
    else
      val primary = (a.value,b.value) match
        case (Value.Never,Value.Never) => 0
        case (Value.Text(x),Value.Text(y)) => Exact.compare(x,y)
        case (Value.Count(x),Value.Count(y)) => java.lang.Long.compare(x,y)
        case (Value.Time(x),Value.Time(y)) => if x < y then -1 else if x > y then 1 else 0
        case _ => throw DomainError("bad-envelope")
      val value = if primary == 0 then Exact.compare(a.id,b.id) else primary
      if q.direction == wire.SortDirection.Asc then value else -value
  private def fingerprint(q: wire.CatalogueQuery): String =
    SecretCodec.sha256(wire.CatalogueQuery.codecJson.encode(BaboonCodecContext.Default,q.copy(cursor=None)).noSpaces)
  private def json(value: Value): Json = value match
    case Value.Never => Json.Null
    case Value.Text(v) => Json.fromString(v)
    case Value.Count(v) => Json.fromLong(v)
    case Value.Time(v) => Json.fromDouble(v).getOrElse(throw DomainError("bad-envelope"))
  def encode(p: Position,q: wire.CatalogueQuery): String = Base64.getUrlEncoder.withoutPadding().encodeToString(Exact.utf8(
    Json.obj("policy" -> Json.fromString("utf8-lower-root-v1"),"query" -> Json.fromString(fingerprint(q)),"value" -> json(p.value),"id" -> Json.fromString(p.id)).noSpaces))
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
      val typed = q.sort match
        case wire.CatalogueSort.CreatedAt | wire.CatalogueSort.ExpiresAt =>
          if v.isNull && q.sort == wire.CatalogueSort.ExpiresAt then Value.Never
          else Value.Time(v.asNumber.map(_.toDouble).filter(java.lang.Double.isFinite).getOrElse(throw DomainError("bad-envelope")))
        case wire.CatalogueSort.TotalBytes | wire.CatalogueSort.FileCount =>
          Value.Count(v.asNumber.flatMap(_.toLong).getOrElse(throw DomainError("bad-envelope")))
        case _ => Value.Text(v.asString.getOrElse(throw DomainError("bad-envelope")))
      Position(typed,id)
    catch case _: IllegalArgumentException | _: java.nio.charset.CharacterCodingException => throw DomainError("bad-envelope")
  def prepare(q: wire.CatalogueQuery,limits: Limits,now: Double): Selection =
    Require(q.limit > 0 && q.limit <= limits.maxListLimit && q.limit < Int.MaxValue && q.query.length <= 1024, "bad-envelope")
    try Exact.utf8(q.query) catch case _: java.nio.charset.CharacterCodingException => throw DomainError("bad-envelope")
    Selection(q,q.cursor.map(decode(_,q)),now)
  def select(values: Iterable[Artifact],selection: Selection): Vector[Artifact] =
    val q = selection.query
    values.iterator.filter { a =>
      (q.includeExpired || !a.expired(selection.now)) &&
      q.visibility.forall(v => v.toString.toLowerCase(java.util.Locale.ROOT) == a.visibility.wire) &&
      q.state.forall(s => s.toString.toLowerCase(java.util.Locale.ROOT) == a.state.wire) &&
      (q.query.isEmpty || Exact.matching(a.name).contains(selection.matching) || Exact.matching(a.id).contains(selection.matching)) &&
      selection.boundary.forall(b => compare(position(a,q),b,q) > 0)
    }.toVector.sortWith((a,b) => compare(position(a,q),position(b,q),q) < 0).take(selection.fetch)

/** Exactly one bounded metadata query (LIMIT limit+1); no application-side
  * scan or hydration of unrelated manifests. Cursors are not snapshots/auth.
  */
final class Catalogue(artifacts: Artifacts, limits: Limits, clock: DomainClock):
  def list(identity: Identity,q: wire.CatalogueQuery): IO[(Vector[Artifact],Option[String])] =
    IO(CataloguePolicy.prepare(q,limits,clock.now)).flatMap { selection =>
      artifacts.catalogue(identity,selection).map { rows =>
        val page = rows.take(q.limit)
        (page,if rows.size > q.limit then page.lastOption.map(a => CataloguePolicy.encode(CataloguePolicy.position(a,q),q)) else None)
      }
    }
