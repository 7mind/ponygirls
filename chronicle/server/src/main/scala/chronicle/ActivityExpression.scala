package chronicle

import chronicle.api.{ActivityJobClass, CollectorPhase}
import java.time.Instant
import java.util.Locale

enum ActivityLease {
  case Active, Expired, Unleased, Inactive
}

enum ActivityFreshness {
  case Recent, Stale, Unknown
}

enum ActivityJobPredicate {
  case Source(value: ArchivePredicate)
  case Collector(value: String)
  case Profile(value: String)
  case Classification(value: ActivityJobClass)
  case Reason(value: String)
  case Lease(value: ActivityLease)
}

enum ActivityCollectorPredicate {
  case Collector(value: String)
  case Phase(value: CollectorPhase)
  case Freshness(value: ActivityFreshness)
  case After(value: Instant)
  case Before(value: Instant)
}

object ActivityExpression {
  def jobs(input: String): BooleanExpression[ActivityJobPredicate] =
    ExpressionSyntax.parse(input,ExpressionSyntax.Directives.Forbidden,job).expression

  def collectors(input: String): BooleanExpression[ActivityCollectorPredicate] =
    ExpressionSyntax.parse(input,ExpressionSyntax.Directives.Forbidden,collector).expression

  private def job(field: ExpressionSyntax.Field): ActivityJobPredicate = field.name match {
    case "collector" => ActivityJobPredicate.Collector(field.value)
    case "profile" => ActivityJobPredicate.Profile(field.value)
    case "classification" => ActivityJobPredicate.Classification(field.value.toLowerCase(Locale.ROOT) match {
      case "current" => ActivityJobClass.Current
      case "superseded-revision" => ActivityJobClass.SupersededRevision
      case "obsolete-profile" => ActivityJobClass.ObsoleteProfile
      case "superseded-revision-and-profile" => ActivityJobClass.SupersededRevisionAndProfile
      case _ => field.valueLocation.invalid("invalid classification")
    })
    case "reason" => ActivityJobPredicate.Reason(field.value)
    case "lease" => ActivityJobPredicate.Lease(field.value.toLowerCase(Locale.ROOT) match {
      case "active" => ActivityLease.Active
      case "expired" => ActivityLease.Expired
      case "unleased" => ActivityLease.Unleased
      case "inactive" => ActivityLease.Inactive
      case _ => field.valueLocation.invalid("invalid lease")
    })
    case _ =>
      val predicate=ArchiveExpression.predicate(field)
      if(predicate==ArchivePredicate.Status(ArchiveStatus.Unscheduled)) field.valueLocation.invalid("invalid job status")
      ActivityJobPredicate.Source(predicate)
  }

  private def collector(field: ExpressionSyntax.Field): ActivityCollectorPredicate = field.name match {
    case "collector" => ActivityCollectorPredicate.Collector(field.value)
    case "phase" => ActivityCollectorPredicate.Phase(field.value.toLowerCase(Locale.ROOT) match {
      case "discovering" => CollectorPhase.Discovering
      case "scanning" => CollectorPhase.Scanning
      case "uploading" => CollectorPhase.Uploading
      case "idle" => CollectorPhase.Idle
      case "failed" => CollectorPhase.Failed
      case _ => field.valueLocation.invalid("invalid phase")
    })
    case "freshness" => ActivityCollectorPredicate.Freshness(field.value.toLowerCase(Locale.ROOT) match {
      case "recent" => ActivityFreshness.Recent
      case "stale" => ActivityFreshness.Stale
      case "unknown" => ActivityFreshness.Unknown
      case _ => field.valueLocation.invalid("invalid freshness")
    })
    case "after" => ActivityCollectorPredicate.After(field.instant)
    case "before" => ActivityCollectorPredicate.Before(field.instant)
    case _ => field.location.invalid("unknown field")
  }
}
