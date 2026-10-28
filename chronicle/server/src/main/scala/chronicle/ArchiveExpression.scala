package chronicle

import chronicle.api.{SearchMode, SourceFormat, SourceIdentity}
import java.time.Instant
import java.util.Locale

enum ArchiveStatus {
  case Queued, Running, Failed, Complete, Unscheduled
}

// Source identity alone determines the agent kind; descriptive metadata and raw
// parent-session links are deliberately not classification signals.
enum AgentKind {
  case Main, Subagent
}
object AgentKind {
  def classify(source: SourceIdentity): AgentKind = if(source.subagentId.isDefined) AgentKind.Subagent else AgentKind.Main

  private[chronicle] def sql(source: String,kind: AgentKind): String =
    s"($source->>'subagentId') IS ${if(kind==AgentKind.Main) "NULL" else "NOT NULL"}"
}

enum ArchivePredicate {
  case User(value: String)
  case Tag(value: String)
  case Project(value: String)
  case Branch(value: String)
  case Producer(value: String)
  case Format(value: SourceFormat)
  case Agent(value: AgentKind)
  case Model(value: String)
  case YoloProfile(value: String)
  case Status(value: ArchiveStatus)
  case After(value: Instant)
  case Before(value: Instant)
}

type ArchiveExpression = BooleanExpression[ArchivePredicate]

final case class ParsedArchiveExpression(expression: ArchiveExpression, mode: SearchMode, textOperands: List[String], candidateFilter: ArchiveExpression)

object ArchiveExpression {
  export BooleanExpression.{True, Text, Field, And, Or, Not}

  def parse(input: String): ParsedArchiveExpression = {
    val parsed=ExpressionSyntax.parse(input,ExpressionSyntax.Directives.ArchiveMode,predicate)
    val candidateFilter=candidateConjuncts(parsed.expression).reduceLeftOption(And.apply).getOrElse(True)
    ParsedArchiveExpression(parsed.expression,parsed.mode.getOrElse(SearchMode.Hybrid),parsed.textOperands,candidateFilter)
  }

  private[chronicle] def predicate(field: ExpressionSyntax.Field): ArchivePredicate = field.name match {
    case "user" => ArchivePredicate.User(field.value)
    case "tag" | "tags" => ArchivePredicate.Tag(field.value)
    case "project" => ArchivePredicate.Project(field.value)
    case "branch" => ArchivePredicate.Branch(field.value)
    case "producer" => ArchivePredicate.Producer(field.value)
    case "model" => ArchivePredicate.Model(field.value)
    case "yolo-profile" => ArchivePredicate.YoloProfile(field.value)
    case "agent" => ArchivePredicate.Agent(field.value.toLowerCase(Locale.ROOT) match {
      case "main" => AgentKind.Main
      case "subagent" => AgentKind.Subagent
      case _ => field.valueLocation.invalid("invalid agent")
    })
    case "format" => ArchivePredicate.Format(field.value.toLowerCase(Locale.ROOT) match {
      case "claude" => SourceFormat.Claude
      case "codex" => SourceFormat.Codex
      case "pi" => SourceFormat.Pi
      case _ => field.valueLocation.invalid("invalid format")
    })
    case "status" => ArchivePredicate.Status(field.value.toLowerCase(Locale.ROOT) match {
      case "queued" => ArchiveStatus.Queued
      case "running" => ArchiveStatus.Running
      case "failed" => ArchiveStatus.Failed
      case "complete" => ArchiveStatus.Complete
      case "unscheduled" => ArchiveStatus.Unscheduled
      case _ => field.valueLocation.invalid("invalid status")
    })
    case "after" => ArchivePredicate.After(field.instant)
    case "before" => ArchivePredicate.Before(field.instant)
    case _ => field.location.invalid("unknown field")
  }

  private def candidateConjuncts(expression: ArchiveExpression): List[ArchiveExpression] = expression match {
    case And(left,right) => candidateConjuncts(left)++candidateConjuncts(right)
    case True => Nil
    case other => if(other.containsText) Nil else List(other)
  }
}
