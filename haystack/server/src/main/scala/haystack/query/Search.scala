package haystack.query

import java.time.Instant
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.util.Base64
import scala.util.control.NonFatal
import ponygirls.losslessjson.LosslessJson as J
import haystack.domain.{StoredItem, QualifiedId}

final case class SearchSort(field: String = "key", direction: String = "asc")
final case class SearchInput(query: String, project: Option[String] = None, limit: Int = 20,
  cursor: Option[String] = None, sort: SearchSort = SearchSort())
final case class SearchSummary(project: String, item: String, revision: Long, title: String, docType: String,
  status: String, importance: String, humanAttention: String, tags: Vector[String], modifiedAt: Instant, modifiedBy: String)
final case class SearchResult(items: Vector[SearchSummary], cursor: Option[String])
final case class SearchPosition(project: String, item: String, value: String)

object Search {
  val SortFields = Vector("key", "title", "project", "type", "status", "importance", "human-attention", "modified-at", "revision")
  val CursorMaxChars = 16 * 1024
  val CursorVersion = "haystack-scala-search-v1"
  def validateSort(sort: SearchSort): SearchSort = {
    if (sort == null || !SortFields.contains(sort.field) || !Set("asc", "desc").contains(sort.direction))
      throw haystack.domain.Fault("bad-envelope", "invalid sort field or direction")
    sort
  }
  def parseSearchSort(value: Option[J.Value]): SearchSort = value match {
    case None => SearchSort()
    case Some(o: J.Obj) if o.fields.map(_._1).toSet == Set("field", "direction") && o.fields.size == 2 =>
      val fields = o.fields.toMap
      (fields("field"), fields("direction")) match {
        case (f: J.Str, d: J.Str) => validateSort(SearchSort(f.value, d.value))
        case _ => throw haystack.domain.Fault("bad-envelope", "invalid sort field or direction")
      }
    case _ => throw haystack.domain.Fault("bad-envelope", "sort must be an object with field and direction")
  }
  /** Literal UTF-8 bytes, NOT JVM UTF-16 String ordering. */
  def compareSearchText(a: String, b: String): Int = java.util.Arrays.compareUnsigned(a.getBytes(UTF_8), b.getBytes(UTF_8))
  def searchPosition(s: SearchSummary, sort: SearchSort): SearchPosition = SearchPosition(s.project, s.item, sort.field match {
    case "key" | "project" => s.project
    case "title" => s.title
    case "type" => s.docType
    case "status" => s.status
    case "importance" => s.importance
    case "human-attention" => s.humanAttention
    case "modified-at" => s.modifiedAt.toString
    case "revision" => s.revision.toString
  })
  def compareSearchPositions(a: SearchPosition, b: SearchPosition, sort: SearchSort): Int = {
    val primary = sort.field match {
      case "revision" => java.lang.Long.compare(a.value.toLong, b.value.toLong)
      case "modified-at" => Instant.parse(a.value).compareTo(Instant.parse(b.value))
      case _ => compareSearchText(a.value, b.value)
    }
    val direction = if (sort.direction == "asc") 1 else -1
    if (primary != 0) Integer.signum(primary) * direction
    else {
      val project = compareSearchText(a.project, b.project)
      val key = if (project != 0) project else compareSearchText(a.item, b.item)
      Integer.signum(key) * (if (sort.field == "key") direction else 1)
    }
  }
  private def summary(s: StoredItem): SearchSummary = {
    val d = s.document
    SearchSummary(s.key.project, s.key.item, s.revision, d.title, d.docType, d.status, d.importance,
      d.humanAttention, d.tags, s.metadata.modifiedAt, s.metadata.modifiedBy)
  }
  /** A lossless JSON array is also an unambiguous length-delimited fingerprint input. */
  private def quote(s: String): String = {
    val out = new java.lang.StringBuilder("\"")
    s.foreach {
      case '"' => out.append("\\\"")
      case '\\' => out.append("\\\\")
      case c if c < ' ' || Character.isSurrogate(c) => out.append(f"\\u${c.toInt}%04x")
      case c => out.append(c)
    }
    out.append('"').toString
  }
  def fingerprint(input: SearchInput): String = {
    val text = Vector(quote(CursorVersion), quote(input.query), input.project.fold("null")(quote), input.limit.toString,
      quote(input.sort.field), quote(input.sort.direction)).mkString("[", ",", "]")
    MessageDigest.getInstance("SHA-256").digest(text.getBytes(UTF_8)).map(b => f"${b & 255}%02x").mkString
  }
  /** Deliberately new cursor version, with saved primary value; no boundary lookup. */
  def encodeCursor(fp: String, last: SearchPosition): String = {
    val text = Vector(CursorVersion, fp, last.project, last.item, last.value).map(quote).mkString("[", ",", "]")
    Base64.getUrlEncoder.withoutPadding.encodeToString(text.getBytes(UTF_8))
  }
  def decodeCursor(cursor: String, fp: String, sort: SearchSort): SearchPosition = {
    def bad(): Nothing = throw new InvalidCursor()
    try {
      if (cursor == null || cursor.isEmpty || cursor.length > CursorMaxChars || !cursor.matches("[A-Za-z0-9_-]+")) bad()
      val bytes = Base64.getUrlDecoder.decode(cursor)
      if (Base64.getUrlEncoder.withoutPadding.encodeToString(bytes) != cursor) bad()
      val parsed = J.parseUtf8(bytes, J.StandardLimits).toOption.getOrElse(bad())
      val values = parsed match {
        case a: J.Arr if a.values.length == 5 => a.values.map { case s: J.Str => s.value; case _ => bad() }
        case _ => bad()
      }
      if (values(0) != CursorVersion || values(1) != fp) bad()
      val p = SearchPosition(values(2), values(3), values(4))
      QualifiedId.encodeComponent(p.project); QualifiedId.encodeComponent(p.item)
      sort.field match {
        case "key" | "project" => if (p.value != p.project) bad()
        case "revision" => if (!p.value.matches("[1-9][0-9]*") || p.value.toLongOption.isEmpty) bad()
        case "modified-at" =>
          if (!Parser.isUtcInstant(p.value) || p.value.startsWith("0000-") || Instant.parse(p.value).toString != p.value) bad()
        case "human-attention" => if (!Set("required", "cleared").contains(p.value)) bad()
        case _ =>
          val max = if (sort.field == "title") 512 else 128
          if (p.value.isEmpty || p.value.length > max) bad()
      }
      p
    } catch { case _: InvalidCursor => bad(); case NonFatal(_) => bad() }
  }
  def search(items: Vector[StoredItem], input: SearchInput): SearchResult = {
    validateSort(input.sort)
    if (input.limit < 1 || input.limit > 100) throw new InvalidQuery(Vector(QueryDiagnostic("limit must be 1–100", Span(0, 0))))
    val ast = Query.applyArchiveDefault(Parser.parseQuery(input.query))
    val fp = fingerprint(input)
    val after = input.cursor.map(decodeCursor(_, fp, input.sort))
    // Reverse edges must be built from the entire corpus, not scoped candidates.
    val reverse = items.flatMap(s => s.document.links.map { case (_, target) => target -> s.key }).groupMap(_._1)(_._2)
    val incoming: Evaluator.IncomingLinks = (p, i) => reverse.getOrElse(QualifiedId.encodeKey(haystack.domain.ItemKey(p, i)), Vector.empty)
    val eligible = items.iterator.filter(s => input.project.forall(_ == s.key.project))
      .filter(Evaluator.evaluate(ast, _, incoming)).map(summary)
      .filter(s => after.forall(p => compareSearchPositions(searchPosition(s, input.sort), p, input.sort) > 0)).toVector
      .sortWith((a, b) => compareSearchPositions(searchPosition(a, input.sort), searchPosition(b, input.sort), input.sort) < 0)
    val page = eligible.take(input.limit)
    SearchResult(page, if (eligible.length > input.limit) Some(encodeCursor(fp, searchPosition(page.last, input.sort))) else None)
  }
  val Builtins = Vector("project:", "id:", "type:", "status:", "importance:", "human-attention:", "created-by:", "modified-by:",
    "created-at", "modified-at", "archived:", "tag:", "tags:", "link:", "linked-to:", "linked-from:", "exists", "field", "AND", "OR", "NOT")
  def analyze(query: String): Vector[QueryDiagnostic] = try { Parser.parseQuery(query); Vector.empty } catch { case e: InvalidQuery => e.diagnostics }
  def complete(items: Vector[StoredItem], fragment: String, limit: Int = 20): Vector[String] = {
    val low = fragment.toLowerCase(java.util.Locale.ROOT)
    val out = Vector.newBuilder[String]
    Builtins.filter(_.toLowerCase(java.util.Locale.ROOT).startsWith(low)).foreach(out += _)
    val colon = fragment.indexOf(':')
    if (colon >= 0) {
      val field = low.take(colon)
      val values = items.flatMap { s => field match {
        case "type" => Vector(s.document.docType)
        case "status" => Vector(s.document.status)
        case "importance" => Vector(s.document.importance)
        case "tag" | "tags" => s.document.tags.filter(_.toLowerCase(java.util.Locale.ROOT).startsWith(low.substring(colon + 1)))
        case _ => Vector.empty
      }}.distinct.sortWith(compareSearchText(_, _) < 0)
      values.foreach(v => out += (fragment.take(colon) + ":" + (if ((field == "tag" || field == "tags") && !v.matches("[A-Za-z0-9._~\\-]+")) quote(v) else v)))
    }
    if (fragment.length >= 2) items.sortWith((a, b) => compareSearchText(a.key.qualified, b.key.qualified) < 0)
      .filter(s => s"${s.project}:${s.item}".contains(fragment)).foreach(s => out += ("id:" + quote(s.key.qualified)))
    out.result().distinct.take(math.max(0, limit))
  }
}
