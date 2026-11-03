package haystack.domain

import java.nio.charset.StandardCharsets
import ponygirls.losslessjson.LosslessJson
import ponygirls.losslessjson.LosslessJson.*

/** Lossless authoritative text, not Circe/Double or PostgreSQL's reserialized JSONB.
  * The shared parser rejects duplicate decoded keys, NUL and non-scalar Unicode.
  * Admission is bounded: 1 MiB source and canonical text, 64 nested containers,
  * 65536-character numeric tokens, explicit exponents within +/-999999.
  */
object DocumentCodec {
  val DocumentMaxBytes = 1024 * 1024
  val TitleMax = 512
  val DescriptionMax = 64 * 1024
  val StringLeafMax = 256 * 1024
  val LinksMax = 256
  val TagsMax = 64
  val MetaValueMax = 128
  val Limits: LosslessJson.Limits = LosslessJson.Limits(DocumentMaxBytes, 64, 65536, 999999)
  private val Allowed = Set("title", "description", "fields", "type", "status", "importance", "human-attention", "links", "tags")
  private def invalid(message: String): Nothing = throw Fault("invalid-document", message)

  /** Syntax/codec failures precede acceptance and never enter the replay ledger. */
  def parseRaw(text: String): Value = LosslessJson.parse(text, Limits).fold(
    error => throw Fault("bad-envelope", "invalid document JSON: " + error.code), identity)

  def parse(text: String): ItemDocument = validate(parseRaw(text))
  def canonical(document: ItemDocument): String = LosslessJson.encode(toJson(document))

  def validate(value: Value): ItemDocument = {
    if (LosslessJson.encodeUtf8(value).length > DocumentMaxBytes) invalid("document exceeds byte limit")
    val obj = value match {
      case o: Obj => o.fields.toMap
      case _ => invalid("document must be an object")
    }
    if (obj.keys.exists(k => !Allowed(k))) invalid("unknown document field")
    def string(name: String, max: Int): String = obj.get(name) match {
      case Some(s: Str) if s.value.nonEmpty && s.value.length <= max => s.value
      case _ => invalid("invalid document " + name)
    }
    val title = string("title", TitleMax)
    val description = string("description", DescriptionMax)
    val fields = obj.getOrElse("fields", invalid("document fields required"))
    checkLeaves(fields)
    val docType = string("type", MetaValueMax)
    val status = string("status", MetaValueMax)
    val importance = string("importance", MetaValueMax)
    val attention = string("human-attention", MetaValueMax)
    if (attention != "required" && attention != "cleared") invalid("invalid human-attention")
    val links = obj.get("links") match {
      case None => Vector.empty
      case Some(a: Arr) if a.values.size <= LinksMax => a.values.map {
        case pair: Arr if pair.values.size == 2 => (pair.values(0), pair.values(1)) match {
          case (kind: Str, target: Str) if kind.value.nonEmpty && kind.value.length <= MetaValueMax =>
            try QualifiedId.decodeKey(target.value)
            catch { case _: Fault => invalid("link target is not a canonical qualified id") }
            kind.value -> target.value
          case _ => invalid("invalid link tuple")
        }
        case _ => invalid("invalid link tuple")
      }
      case _ => invalid("invalid links array")
    }
    val tags = obj.get("tags") match {
      case None => Vector.empty
      case Some(a: Arr) if a.values.size <= TagsMax => a.values.map {
        case s: Str if s.value.nonEmpty && s.value.length <= MetaValueMax && s.value == s.value.strip() => s.value
        case _ => invalid("invalid tag")
      }
      case _ => invalid("invalid tags array")
    }
    PostgresAdmission.validate(value)
    ItemDocument(title, description, fields, docType, status, importance, attention, links, tags)
  }

  private def checkLeaves(value: Value): Unit = value match {
    case s: Str if s.value.length > StringLeafMax => invalid("fields string exceeds limit")
    case a: Arr => a.values.foreach(checkLeaves)
    case o: Obj => o.fields.foreach { case (key, v) =>
      if (key.length > StringLeafMax) invalid("fields object key exceeds limit")
      checkLeaves(v)
    }
    case _ => ()
  }

  /** Case classes are convenient application data; they are revalidated at the write boundary. */
  def toJson(document: ItemDocument): Value = {
    val d = document
    val links = d.links.map { case (kind, target) => "[" + JsonText.quote(kind) + "," + JsonText.quote(target) + "]" }.mkString("[", ",", "]")
    val tags = d.tags.map(JsonText.quote).mkString("[", ",", "]")
    val text = "{\"title\":" + JsonText.quote(d.title) + ",\"description\":" + JsonText.quote(d.description) +
      ",\"fields\":" + LosslessJson.encode(d.fields) + ",\"type\":" + JsonText.quote(d.docType) +
      ",\"status\":" + JsonText.quote(d.status) + ",\"importance\":" + JsonText.quote(d.importance) +
      ",\"human-attention\":" + JsonText.quote(d.humanAttention) + ",\"links\":" + links + ",\"tags\":" + tags + "}"
    val value = LosslessJson.parse(text, Limits).fold(_ => invalid("invalid constructed document"), identity)
    validate(value)
    value
  }
}

/** Explicit projection-admission policy. JSONB numeric limits are stricter than
  * the shared JSON domain: no rounding, stringification, clamping or omission.
  * This runs only on new writes, never rewrites acknowledged text/history.
  */
object PostgresAdmission {
  val MaxIntegralDigits = 131072
  val MaxFractionalDigits = 16383
  def validate(value: Value): Unit = value match {
    case n: Number =>
      val token = n.lexeme
      val parts = token.toLowerCase(java.util.Locale.ROOT).split("e", -1)
      val exponent = if (parts.length == 2) parts(1).toInt else 0
      val mantissa = parts(0).stripPrefix("-")
      val dot = mantissa.indexOf('.')
      val fraction = if (dot < 0) 0 else mantissa.length - dot - 1
      val digits = mantissa.filter(_ != '.').dropWhile(_ == '0')
      val integral = if (digits.isEmpty) 0 else math.max(0, digits.length + exponent - fraction)
      val scale = math.max(0, fraction - exponent)
      if (integral > MaxIntegralDigits || scale > MaxFractionalDigits)
        throw Fault("invalid-document", "number exceeds PostgreSQL JSONB numeric bounds")
    case s: Str => noNul(s.value)
    case a: Arr => a.values.foreach(validate)
    case o: Obj => o.fields.foreach { case (key, v) => noNul(key); validate(v) }
    case _ => ()
  }
  private def noNul(s: String): Unit =
    if (s.indexOf(0.toChar) >= 0) throw Fault("invalid-document", "PostgreSQL JSONB cannot contain NUL")
}

/** Serialization glue for building validated shared ASTs; not a second parser. */
private[domain] object JsonText {
  def quote(s: String): String = {
    val out = new java.lang.StringBuilder("\"")
    s.foreach {
      case '"' => out.append("\\\"")
      case '\\' => out.append("\\\\")
      case '\b' => out.append("\\b")
      case '\f' => out.append("\\f")
      case '\n' => out.append("\\n")
      case '\r' => out.append("\\r")
      case '\t' => out.append("\\t")
      case c if c < ' ' => out.append(f"\\u${c.toInt}%04x")
      case c => out.append(c)
    }
    out.append('"').toString
  }
}
