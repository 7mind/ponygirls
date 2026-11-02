package ponygirls.losslessjson

import java.nio.ByteBuffer
import java.nio.charset.{CharacterCodingException, CodingErrorAction, StandardCharsets}
import java.security.MessageDigest
import scala.collection.mutable
import scala.util.control.NoStackTrace

/** A validated JSON text boundary, not an arbitrary-object serializer.
  * Constructors are closed: every Value has passed the same parser checks.
  */
object LosslessJson {
  val EncodingVersion = "lossless-json-v1"

  /** Depth counts nested containers (a scalar has depth zero). Byte limits
    * apply to the complete original UTF-8 input, including whitespace.
    * Safety ceilings cannot be disabled by callers.
    */
  final case class Limits(
    maxBytes: Int,
    maxDepth: Int,
    maxNumberChars: Int,
    maxExponentAbs: Int
  ) {
    require(maxBytes >= 1 && maxBytes <= 16 * 1024 * 1024, "maxBytes must be 1..16777216")
    require(maxDepth >= 0 && maxDepth <= 128, "maxDepth must be 0..128")
    require(maxNumberChars >= 1 && maxNumberChars <= 65536, "maxNumberChars must be 1..65536")
    require(maxExponentAbs >= 0 && maxExponentAbs <= 999999, "maxExponentAbs must be 0..999999")
  }

  val StandardLimits: Limits = Limits(1024 * 1024, 64, 4096, 999999)

  /** Offset is a zero-based UTF-16 input index, or zero for whole-input
    * UTF-8/size failures. Diagnostics never include payload text.
    */
  final case class Error(code: String, offset: Int, message: String)
  private final case class Rejected(error: Error) extends RuntimeException with NoStackTrace

  sealed trait Value
  case object Null extends Value
  final class Bool private[LosslessJson] (val value: Boolean) extends Value
  final class Str private[LosslessJson] (val value: String) extends Value
  final class Arr private[LosslessJson] (val values: Vector[Value]) extends Value
  /** Fields retain input order for inspection; encoding sorts them. */
  final class Obj private[LosslessJson] (val fields: Vector[(String, Value)]) extends Value

  final class Number private[LosslessJson] (val lexeme: String, exponent: Int) extends Value with Ordered[Number] {
    private val negative = lexeme.head == '-'
    private val mantissa = lexeme.takeWhile(c => c != 'e' && c != 'E').stripPrefix("-")
    private val dot = mantissa.indexOf('.')
    private val fractionSize = if (dot < 0) 0 else mantissa.length - dot - 1
    private val digits = mantissa.filter(_ != '.').dropWhile(_ == '0')
    private val sign = if (digits.isEmpty) 0 else if (negative) -1 else 1
    private val magnitude = digits.length + exponent - fractionSize

    /** Exact mathematical comparison; spelling (including negative zero)
      * remains available separately in lexeme. No Double/BigDecimal and no
      * exponent-sized integer/string allocations.
      */
    override def compare(other: Number): Int = {
      if (sign != other.sign) java.lang.Integer.compare(sign, other.sign)
      else if (sign == 0) 0
      else {
        var cmp = java.lang.Integer.compare(magnitude, other.magnitude)
        var i = 0
        while (cmp == 0 && i < math.max(digits.length, other.digits.length)) {
          val a = if (i < digits.length) digits.charAt(i) else '0'
          val b = if (i < other.digits.length) other.digits.charAt(i) else '0'
          cmp = java.lang.Integer.compare(a.toInt, b.toInt)
          i += 1
        }
        cmp * sign
      }
    }
  }

  private def fail(code: String, offset: Int, message: String): Nothing =
    throw Rejected(Error(code, offset, message))

  def parse(text: String, limits: Limits): Either[Error, Value] = {
    try {
      // Count before allocating UTF-8 bytes and reject malformed Java UTF-16
      // rather than letting getBytes silently substitute replacement chars.
      var bytes = 0L
      var i = 0
      while (i < text.length) {
        val c = text.charAt(i)
        if (Character.isHighSurrogate(c)) {
          if (i + 1 >= text.length || !Character.isLowSurrogate(text.charAt(i + 1)))
            fail("unicode", i, "unpaired surrogate")
          bytes += 4
          i += 2
        } else if (Character.isLowSurrogate(c)) fail("unicode", i, "unpaired surrogate")
        else {
          bytes += (if (c < 0x80) 1 else if (c < 0x800) 2 else 3)
          i += 1
        }
        if (bytes > limits.maxBytes) fail("byte-limit", 0, "input exceeds byte limit")
      }
      Right(new Parser(text, limits).parse())
    } catch { case Rejected(error) => Left(error) }
  }

  def parseUtf8(bytes: Array[Byte], limits: Limits): Either[Error, Value] = {
    if (bytes.length > limits.maxBytes) Left(Error("byte-limit", 0, "input exceeds byte limit"))
    else {
      val decoder = StandardCharsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
      try parse(decoder.decode(ByteBuffer.wrap(bytes)).toString, limits)
      catch { case _: CharacterCodingException => Left(Error("unicode", 0, "invalid UTF-8")) }
    }
  }

  /** Version 1: UTF-16 lexical key order, array order unchanged, original
    * numeric tokens, literal Unicode scalars, lowercase control escapes.
    * Not numerical canonicalization: 1, 1.0 and 1e0 encode differently.
    */
  def encode(value: Value): String = {
    val out = new java.lang.StringBuilder
    def string(s: String): Unit = {
      out.append('"')
      s.foreach {
        case '"' => out.append("\\\"")
        case '\\' => out.append("\\\\")
        case '\b' => out.append("\\b")
        case '\f' => out.append("\\f")
        case '\n' => out.append("\\n")
        case '\r' => out.append("\\r")
        case '\t' => out.append("\\t")
        case c if c < ' ' =>
          out.append("\\u00")
          out.append("0123456789abcdef".charAt(c.toInt >>> 4))
          out.append("0123456789abcdef".charAt(c.toInt & 15))
        case c => out.append(c)
      }
      out.append('"')
    }
    def append(v: Value): Unit = v match {
      case Null => out.append("null"); ()
      case b: Bool => out.append(b.value); ()
      case s: Str => string(s.value)
      case n: Number => out.append(n.lexeme); ()
      case a: Arr =>
        out.append('[')
        a.values.zipWithIndex.foreach { case (item, index) =>
          if (index != 0) out.append(',')
          append(item)
        }
        out.append(']'); ()
      case o: Obj =>
        out.append('{')
        o.fields.sortBy(_._1).zipWithIndex.foreach { case ((key, item), index) =>
          if (index != 0) out.append(',')
          string(key); out.append(':'); append(item)
        }
        out.append('}'); ()
    }
    append(value)
    out.toString
  }

  def encodeUtf8(value: Value): Array[Byte] = encode(value).getBytes(StandardCharsets.UTF_8)

  /** A versioned content fingerprint, not a service operation/replay digest. */
  def sha256(value: Value): String = {
    val hash = MessageDigest.getInstance("SHA-256")
    hash.update((EncodingVersion + "\n").getBytes(StandardCharsets.UTF_8))
    hash.digest(encodeUtf8(value)).map(b => f"${b & 255}%02x").mkString
  }

  private final class Parser(text: String, limits: Limits) {
    private var pos = 0
    private def syntax(): Nothing = fail("syntax", pos, "invalid JSON syntax")
    private def peek: Char = if (pos < text.length) text.charAt(pos) else 0.toChar
    private def eat(c: Char): Boolean = {
      if (pos < text.length && text.charAt(pos) == c) { pos += 1; true } else false
    }
    private def expect(c: Char): Unit = if (!eat(c)) syntax()
    private def whitespace(): Unit = {
      while (pos < text.length && (peek == ' ' || peek == '\t' || peek == '\r' || peek == '\n')) pos += 1
    }
    private def digit(c: Char): Boolean = c >= '0' && c <= '9'

    def parse(): Value = {
      whitespace()
      val result = value(0)
      whitespace()
      if (pos != text.length) syntax()
      result
    }

    private def value(depth: Int): Value = {
      whitespace()
      peek match {
        case '[' | '{' if depth >= limits.maxDepth => fail("depth-limit", pos, "container depth exceeds limit")
        case '[' => array(depth + 1)
        case '{' => obj(depth + 1)
        case '"' => new Str(string())
        case 't' => literal("true"); new Bool(true)
        case 'f' => literal("false"); new Bool(false)
        case 'n' => literal("null"); Null
        case c if c == '-' || digit(c) => number()
        case _ => syntax()
      }
    }

    private def literal(s: String): Unit = {
      if (!text.startsWith(s, pos)) syntax()
      pos += s.length
    }

    private def array(depth: Int): Arr = {
      expect('['); whitespace()
      val values = Vector.newBuilder[Value]
      if (!eat(']')) {
        values += value(depth)
        whitespace()
        while (eat(',')) { values += value(depth); whitespace() }
        expect(']')
      }
      new Arr(values.result())
    }

    private def obj(depth: Int): Obj = {
      expect('{'); whitespace()
      val fields = Vector.newBuilder[(String, Value)]
      val seen = mutable.HashSet.empty[String]
      def field(): Unit = {
        whitespace()
        if (peek != '"') syntax()
        val offset = pos
        val key = string()
        if (!seen.add(key)) fail("duplicate-key", offset, "duplicate object key")
        whitespace(); expect(':')
        fields += key -> value(depth)
        whitespace()
      }
      if (!eat('}')) {
        field()
        while (eat(',')) field()
        expect('}')
      }
      new Obj(fields.result())
    }

    private def string(): String = {
      expect('"')
      val out = new java.lang.StringBuilder
      var done = false
      while (!done) {
        if (pos >= text.length) syntax()
        val c = text.charAt(pos)
        pos += 1
        c match {
          case '"' => done = true
          case '\\' =>
            if (pos >= text.length) syntax()
            val escape = text.charAt(pos)
            pos += 1
            escape match {
              case '"' | '\\' | '/' => out.append(escape)
              case 'b' => out.append('\b')
              case 'f' => out.append('\f')
              case 'n' => out.append('\n')
              case 'r' => out.append('\r')
              case 't' => out.append('\t')
              case 'u' =>
                var code = 0
                var j = 0
                while (j < 4) {
                  if (pos >= text.length) syntax()
                  val h = text.charAt(pos)
                  val n = if (h >= '0' && h <= '9') h - '0'
                    else if (h >= 'a' && h <= 'f') h - 'a' + 10
                    else if (h >= 'A' && h <= 'F') h - 'A' + 10
                    else syntax()
                  code = code * 16 + n
                  pos += 1; j += 1
                }
                out.append(code.toChar)
              case _ => syntax()
            }
          case c if c < ' ' => syntax()
          case c => out.append(c)
        }
      }
      val result = out.toString
      var i = 0
      while (i < result.length) {
        val c = result.charAt(i)
        if (c == 0) fail("unicode", pos, "NUL is not supported")
        if (Character.isHighSurrogate(c)) {
          if (i + 1 >= result.length || !Character.isLowSurrogate(result.charAt(i + 1)))
            fail("unicode", pos, "unpaired surrogate")
          i += 2
        } else if (Character.isLowSurrogate(c)) fail("unicode", pos, "unpaired surrogate")
        else i += 1
      }
      result
    }

    private def number(): Number = {
      val start = pos
      eat('-')
      if (!eat('0')) {
        if (peek < '1' || peek > '9') syntax()
        while (digit(peek)) pos += 1
      }
      if (eat('.')) {
        if (!digit(peek)) syntax()
        while (digit(peek)) pos += 1
      }
      var exponentStart = -1
      var exponentNegative = false
      if (eat('e') || eat('E')) {
        exponentNegative = eat('-')
        if (!exponentNegative) eat('+')
        exponentStart = pos
        if (!digit(peek)) syntax()
        while (digit(peek)) pos += 1
      }
      if (pos - start > limits.maxNumberChars) fail("number-limit", start, "number token exceeds limit")
      var exponent = 0
      if (exponentStart >= 0) {
        var i = exponentStart
        while (i < pos) {
          exponent = exponent * 10 + (text.charAt(i) - '0')
          if (exponent > limits.maxExponentAbs) fail("exponent-limit", start, "number exponent exceeds limit")
          i += 1
        }
      }
      new Number(text.substring(start, pos), if (exponentNegative) -exponent else exponent)
    }
  }
}
