package haystack.query

import ponygirls.losslessjson.LosslessJson

/** All positions are half-open Java/JavaScript UTF-16 code-unit offsets. */
final case class Span(start: Int, end: Int)
final case class QueryDiagnostic(message: String, span: Span)
final class InvalidQuery(val diagnostics: Vector[QueryDiagnostic])
  extends IllegalArgumentException(diagnostics.map(d => s"${d.message} [${d.span.start},${d.span.end})").mkString("; ")) {
  val code = "invalid-query"
}
final class InvalidCursor(message: String = "malformed or mismatched cursor") extends IllegalArgumentException(message) {
  val code = "invalid-cursor"
}
sealed trait AstNode
object AstNode {
  final case class And(children: Vector[AstNode]) extends AstNode
  final case class Or(children: Vector[AstNode]) extends AstNode
  final case class Not(child: AstNode) extends AstNode
  final case class Text(words: Vector[String], span: Span) extends AstNode
  final case class Phrase(words: Vector[String], span: Span) extends AstNode
  final case class Pred(pred: Predicate) extends AstNode
}
sealed trait Predicate { def span: Span }
object Predicate {
  final case class Project(value: String, span: Span) extends Predicate
  final case class Id(qualified: String, span: Span) extends Predicate
  final case class Meta(field: String, value: String, span: Span) extends Predicate
  final case class Time(field: String, op: String, instant: String, span: Span) extends Predicate
  final case class Archived(mode: String, span: Span) extends Predicate
  final case class Field(pointer: String, op: String, value: LosslessJson.Value, span: Span) extends Predicate
  final case class Exists(pointer: String, span: Span) extends Predicate
  final case class Link(linkType: String, target: String, span: Span) extends Predicate
  final case class LinkedTo(target: String, span: Span) extends Predicate
  final case class LinkedFrom(source: String, span: Span) extends Predicate
  final case class Tag(value: String, span: Span) extends Predicate
}
object Query {
  val MaxChars = 4096
  val MaxTokens = 512
  val MaxNodes = 128
  val MaxDepth = 16
  val AtomMaxWords = 64
  def hasArchiveSelector(ast: AstNode): Boolean = ast match {
    case AstNode.And(xs) => xs.exists(hasArchiveSelector)
    case AstNode.Or(xs) => xs.exists(hasArchiveSelector)
    case AstNode.Not(x) => hasArchiveSelector(x)
    case AstNode.Pred(_: Predicate.Archived) => true
    case AstNode.Pred(Predicate.Meta("status", "archived", _)) => true
    case _ => false
  }
  def applyArchiveDefault(ast: Option[AstNode]): AstNode = {
    val exclude = AstNode.Not(AstNode.Pred(Predicate.Meta("status", "archived", Span(0, 0))))
    ast match {
      case None => exclude
      case Some(a) if hasArchiveSelector(a) => a
      case Some(a) => AstNode.And(Vector(a, exclude))
    }
  }
}
