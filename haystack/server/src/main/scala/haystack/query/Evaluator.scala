package haystack.query

import java.time.Instant
import ponygirls.losslessjson.LosslessJson as J
import haystack.domain.{ItemKey, QualifiedId, StoredItem}

object Evaluator {
  type IncomingLinks = (String, String) => Vector[ItemKey]
  def evaluate(ast: AstNode, candidate: StoredItem, incoming: IncomingLinks): Boolean = {
    val d = candidate.document
    lazy val segments = Text.corpusSegments(d.title, d.description, d.fields, d.tags)
    lazy val words = segments.flatten.toSet
    def run(a: AstNode): Boolean = a match {
      case AstNode.And(xs) => xs.forall(run)
      case AstNode.Or(xs) => xs.exists(run)
      case AstNode.Not(x) => !run(x)
      case AstNode.Text(ws, _) => ws.forall(words.contains)
      case AstNode.Phrase(ws, _) => segments.exists(_.sliding(ws.length).exists(_ == ws))
      case AstNode.Pred(p) => p match {
        case Predicate.Project(v, _) => candidate.key.project == v
        case Predicate.Id(v, _) => candidate.key == QualifiedId.decodeKey(v)
        case Predicate.Meta(field, v, _) =>
          val actual = field match {
            case "type" => d.docType
            case "status" => d.status
            case "importance" => d.importance
            case "human-attention" => d.humanAttention
            case "created-by" => candidate.metadata.createdBy
            case "modified-by" => candidate.metadata.modifiedBy
            case _ => ""
          }
          actual == v
        case Predicate.Time(field, op, instant, _) =>
          val actual = if (field == "created-at") candidate.metadata.createdAt else candidate.metadata.modifiedAt
          applyCmp(actual.compareTo(Instant.parse(instant)), op)
        case Predicate.Archived(mode, _) => mode == "all" || (if (mode == "only") d.status == "archived" else d.status != "archived")
        case Predicate.Exists(ptr, _) => Pointer.resolvePointer(d.fields, ptr).nonEmpty
        case Predicate.Field(ptr, op, want, _) => Pointer.resolvePointer(d.fields, ptr).exists(compareJson(_, op, want))
        case Predicate.Link(typ, target, _) => d.links.contains(typ -> target)
        case Predicate.LinkedTo(target, _) => d.links.exists(_._2 == target)
        case Predicate.LinkedFrom(source, _) => incoming(candidate.key.project, candidate.key.item).contains(QualifiedId.decodeKey(source))
        case Predicate.Tag(v, _) => d.tags.contains(v)
      }
    }
    run(ast)
  }
  def applyCmp(cmp: Int, op: String): Boolean = op match {
    case "=" => cmp == 0
    case "!=" => cmp != 0
    case "<" => cmp < 0
    case "<=" => cmp <= 0
    case ">" => cmp > 0
    case ">=" => cmp >= 0
    case _ => false
  }
  /** Missing handled by caller. Numeric wrong-type comparisons are false,
    * including !=. Nonnumeric != follows logical JSON inequality (TS contract).
    */
  def compareJson(actual: J.Value, op: String, want: J.Value): Boolean = want match {
    case n: J.Number => actual match {
      case a: J.Number => applyCmp(a.compare(n), op)
      case _ => false
    }
    case _: J.Str | _: J.Bool | J.Null =>
      val same = J.encode(actual) == J.encode(want)
      if (op == "=") same else if (op == "!=") !same else false
    case _ => false
  }
}
