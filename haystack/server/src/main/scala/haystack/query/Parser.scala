package haystack.query

import java.time.{Instant, LocalDateTime, ZoneOffset}
import java.util.Locale
import ponygirls.losslessjson.LosslessJson as J
import haystack.domain.QualifiedId
import scala.util.control.NonFatal

final case class Token(kind: String, raw: String, value: String, span: Span)
object Lexer {
  final case class Result(tokens: Vector[Token], diagnostics: Vector[QueryDiagnostic])
  def lex(query: String): Result = {
    val tokens = Vector.newBuilder[Token]
    val diagnostics = Vector.newBuilder[QueryDiagnostic]
    if (query.length > Query.MaxChars)
      return Result(Vector.empty, Vector(QueryDiagnostic(s"query exceeds ${Query.MaxChars} characters", Span(0, query.length))))
    var i = 0
    def push(kind: String, start: Int, end: Int, value: String): Unit = tokens += Token(kind, query.substring(start, end), value, Span(start, end))
    val punctuation = Map('(' -> "lparen", ')' -> "rparen", '[' -> "lbracket", ']' -> "rbracket", ',' -> "comma", ':' -> "colon", '-' -> "minus")
    val wordEnd = " \t\n\r()\"[],=<>!"
    while (i < query.length) {
      val start = i
      val c = query.charAt(i)
      if (" \t\n\r".contains(c)) i += 1
      else if (punctuation.contains(c)) { i += 1; push(punctuation(c), start, i, c.toString) }
      else if ("=<>!".contains(c)) {
        i += 1
        if (i < query.length && query.charAt(i) == '=' && c != '=') i += 1
        if (c == '!' && i == start + 1) diagnostics += QueryDiagnostic("unexpected '!'", Span(start, i))
        else push("op", start, i, query.substring(start, i))
      } else if (c == '"') {
        i += 1
        var escaped = false
        var closed = false
        while (i < query.length && !closed) {
          val d = query.charAt(i)
          if (!escaped && d == '"') closed = true
          if (!escaped && d == '\\') escaped = true else escaped = false
          i += 1
        }
        if (!closed) diagnostics += QueryDiagnostic("unterminated quoted string", Span(start, query.length))
        else J.parse(query.substring(start, i), J.StandardLimits) match {
          case Right(s: J.Str) => push("quoted", start, i, s.value)
          case Left(e) => diagnostics += QueryDiagnostic("bad escape or invalid JSON quoted string", Span(math.min(start + e.offset, i - 1), i))
          case _ => ()
        }
      } else {
        while (i < query.length && !wordEnd.contains(query.charAt(i))) i += 1
        push("word", start, i, query.substring(start, i))
      }
    }
    val result = tokens.result()
    if (result.length > Query.MaxTokens) Result(Vector.empty, Vector(QueryDiagnostic(s"query exceeds ${Query.MaxTokens} tokens", Span(0, query.length))))
    else Result(result, diagnostics.result())
  }
}
object Parser {
  private val instantShape = "^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(\\.\\d{1,6})?Z$".r
  def isUtcInstant(text: String): Boolean = text match {
    case instantShape(y, m, d, h, min, sec, fraction) =>
      try {
        LocalDateTime.of(y.toInt, m.toInt, d.toInt, h.toInt, min.toInt, sec.toInt,
          Option(fraction).fold(0)(f => (f.substring(1) + "000000000").take(9).toInt)).toInstant(ZoneOffset.UTC)
        true
      } catch { case _: java.time.DateTimeException => false }
    case _ => false
  }
  def parseQuery(query: String): Option[AstNode] = {
    val lexed = Lexer.lex(query) // Limits apply even to all-whitespace input.
    if (lexed.diagnostics.nonEmpty) throw new InvalidQuery(lexed.diagnostics)
    if (query.forall(c => Character.isWhitespace(c) || Character.isSpaceChar(c) || c == '\uFEFF')) None
    else Some(parse(lexed.tokens, Span(0, query.length)))
  }
  def parse(tokens: Vector[Token], fullSpan: Span): AstNode = new Reader(tokens, fullSpan).parse()
  private final class Reader(tokens: Vector[Token], fullSpan: Span) {
    import AstNode.*
    import Predicate.*
    private var pos = 0
    private var nodes = 0
    private def peek: Option[Token] = tokens.lift(pos)
    private def fail(message: String, span: Span): Nothing = throw new InvalidQuery(Vector(QueryDiagnostic(message, span)))
    private def next(): Token = { val t = peek.getOrElse(fail("incomplete expression", fullSpan)); pos += 1; t }
    private def lower(s: String): String = s.toLowerCase(Locale.ROOT)
    private def keyword(s: String): Boolean = peek.exists(t => t.kind == "word" && t.value.equalsIgnoreCase(s))
    private def count[A <: AstNode](a: A, span: Span): A = {
      nodes += 1
      if (nodes > Query.MaxNodes) fail(s"query exceeds ${Query.MaxNodes} nodes", span)
      a
    }
    private def pred(p: Predicate): AstNode = count(Pred(p), p.span)
    def parse(): AstNode = {
      val a = expression(0)
      peek.foreach(t => fail(s"unexpected ${t.raw}", t.span))
      a
    }
    private def expression(depth: Int): AstNode = {
      var left = conjunction(depth)
      while (keyword("OR")) { val t = next(); left = count(Or(Vector(left, conjunction(depth))), t.span) }
      left
    }
    private def conjunction(depth: Int): AstNode = {
      val out = Vector.newBuilder[AstNode]
      out += unary(depth)
      var n = 1
      while (peek.nonEmpty && !peek.exists(_.kind == "rparen") && !keyword("OR")) {
        if (keyword("AND")) next()
        out += unary(depth); n += 1
      }
      val xs = out.result()
      if (n == 1) xs.head else count(And(xs), fullSpan)
    }
    private def unary(depth: Int): AstNode = {
      if (depth > Query.MaxDepth) fail(s"query exceeds depth ${Query.MaxDepth}", peek.map(_.span).getOrElse(fullSpan))
      if (keyword("NOT") || peek.exists(_.kind == "minus")) {
        val t = next(); count(Not(unary(depth + 1)), t.span)
      } else if (peek.exists(_.kind == "lparen")) {
        val t = next(); val a = expression(depth + 1)
        if (!peek.exists(_.kind == "rparen")) fail("unclosed parenthesis", t.span)
        next(); a
      } else atom()
    }
    private def qualified(t: Token): String = {
      if (t.kind != "quoted") fail("value must be a quoted qualified key", t.span)
      try { QualifiedId.decodeKey(t.value); t.value }
      catch { case NonFatal(_) => fail("malformed qualified key", t.span) }
    }
    private def text(t: Token): AstNode = {
      val words = haystack.query.Text.extractWords(t.value)
      if (words.isEmpty) fail("text has no searchable words", t.span)
      if (words.length > Query.AtomMaxWords) fail(s"atom exceeds ${Query.AtomMaxWords} words", t.span)
      count(if (t.kind == "quoted") Phrase(words, t.span) else AstNode.Text(words, t.span), t.span)
    }
    private def value(head: Token): Token = {
      val colon = head.value.indexOf(':')
      val rest = head.value.substring(colon + 1)
      if (rest.nonEmpty) Token("word", rest, rest, Span(head.span.start + colon + 1, head.span.end))
      else if (peek.exists(t => t.kind == "word" || t.kind == "quoted")) next()
      else fail(s"missing value for '${head.value}'", head.span)
    }
    private def expect(kind: String, message: String, span: Span): Token = {
      val t = peek.getOrElse(fail(message, span))
      if (t.kind != kind) fail(message, t.span)
      next()
    }
    private def pointer(head: Token): String = {
      expect("lbracket", "expected [", head.span)
      val t = expect("quoted", "expected quoted pointer", head.span)
      expect("rbracket", "expected ]", head.span)
      if (t.value.nonEmpty && !t.value.startsWith("/")) fail("pointer must be empty or start with /", t.span)
      t.value
    }
    private def op(head: Token): String = expect("op", "comparison operator required", head.span).value
    private def time(field: String, operator: String, t: Token, span: Span): AstNode = {
      if (t.kind != "quoted" || !isUtcInstant(t.value)) fail("time value must be a quoted UTC RFC3339 instant", t.span)
      pred(Time(field, operator, t.value, span))
    }
    private def literal(head: Token): J.Value = {
      val t = next()
      if (t.kind == "quoted") J.parse(t.raw, J.StandardLimits).toOption.get
      else {
        val raw = if (t.kind == "minus") "-" + expect("word", "expected number after -", t.span).value else t.value
        J.parse(raw, J.StandardLimits) match {
          case Right(v: J.Number) => v
          case Right(v: J.Bool) if t.kind == "word" => v
          case Right(J.Null) if t.kind == "word" => J.Null
          case _ => fail("expected a JSON scalar literal", t.span)
        }
      }
    }
    private def atom(): AstNode = {
      val t = next()
      if (t.kind == "quoted") return text(t)
      if (t.kind != "word" || Set("and", "or").contains(lower(t.value))) fail(s"unexpected ${t.raw}", t.span)
      val colon = t.value.indexOf(':')
      val name = lower(if (colon < 0) t.value else t.value.take(colon))
      val span = t.span
      if (colon < 0) name match {
        case "field" if peek.exists(_.kind == "lbracket") =>
          val ptr = pointer(t); val operator = op(t); return pred(Field(ptr, operator, literal(t), span))
        case "exists" if peek.exists(_.kind == "lbracket") => return pred(Exists(pointer(t), span))
        case "created-at" | "modified-at" if peek.exists(_.kind == "op") =>
          val operator = op(t); return time(name, operator, next(), span)
        case _ => return text(t)
      }
      name match {
        case "link" =>
          if (t.value.substring(colon + 1).nonEmpty) fail("link must be link:[\"type\",\"project:item\"]", span)
          expect("lbracket", "expected link tuple", span)
          val typ = expect("quoted", "expected quoted link type", span)
          if (typ.value.isEmpty || typ.value.length > 128) fail("invalid link type", typ.span)
          expect("comma", "expected comma", span)
          val target = qualified(next())
          expect("rbracket", "expected ]", span)
          pred(Link(typ.value, target, span))
        case "linked-to" => pred(LinkedTo(qualified(value(t)), span))
        case "linked-from" => pred(LinkedFrom(qualified(value(t)), span))
        case "id" => pred(Id(qualified(value(t)), span))
        case "project" => pred(Project(value(t).value, span))
        case "tag" | "tags" =>
          val v = value(t)
          if (v.value.isEmpty || v.value.length > 128 || v.value.contains('\u0000')) fail("invalid tag value", v.span)
          pred(Tag(v.value, span))
        case "archived" =>
          val v = value(t)
          val mode = lower(v.value) match {
            case "true" => "only"
            case "false" => "exclude"
            case "all" => "all"
            case _ => fail("archived must be true, false, or all", v.span)
          }
          pred(Archived(mode, span))
        case "type" | "status" | "importance" | "human-attention" | "created-by" | "modified-by" => pred(Meta(name, value(t).value, span))
        case "created-at" | "modified-at" => time(name, "=", value(t), span)
        case _ => fail(s"unknown attribute '$name'", span)
      }
    }
  }
}
