import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.Result, Result] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: chronicle.api.v1_6_0.Result
      ): Result = from match {
        case x: chronicle.api.v1_6_0.Result.Hello => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Hello, Result.Hello](context, x)
        case x: chronicle.api.v1_6_0.Result.Pong => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Pong, Result.Pong](context, x)
        case x: chronicle.api.v1_6_0.Result.Whoami => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Whoami, Result.Whoami](context, x)
        case x: chronicle.api.v1_6_0.Result.Search => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Search, Result.Search](context, x)
        case x: chronicle.api.v1_6_0.Result.Session => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Session, Result.Session](context, x)
        case x: chronicle.api.v1_6_0.Result.Chunks => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Chunks, Result.Chunks](context, x)
        case x: chronicle.api.v1_6_0.Result.Messages => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Messages, Result.Messages](context, x)
        case x: chronicle.api.v1_6_0.Result.SessionMessageSearch => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.SessionMessageSearch, Result.SessionMessageSearch](context, x)
        case x: chronicle.api.v1_6_0.Result.Raw => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Raw, Result.Raw](context, x)
        case x: chronicle.api.v1_6_0.Result.Related => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Related, Result.Related](context, x)
        case x: chronicle.api.v1_6_0.Result.Facets => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Facets, Result.Facets](context, x)
        case x: chronicle.api.v1_6_0.Result.CollectionStatus => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.CollectionStatus, Result.CollectionStatus](context, x)
        case x: chronicle.api.v1_6_0.Result.Status => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Status, Result.Status](context, x)
        case x: chronicle.api.v1_6_0.Result.Tokens => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Tokens, Result.Tokens](context, x)
        case x: chronicle.api.v1_6_0.Result.Token => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Token, Result.Token](context, x)
        case x: chronicle.api.v1_6_0.Result.Groups => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Groups, Result.Groups](context, x)
        case x: chronicle.api.v1_6_0.Result.Mutation => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Mutation, Result.Mutation](context, x)
        case x: chronicle.api.v1_6_0.Result.Error => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Error, Result.Error](context, x)
        case x: chronicle.api.v1_6_0.Result.Ping => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Ping, Result.Ping](context, x)
        case x: chronicle.api.v1_6_0.Result.Archive => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Archive, Result.Archive](context, x)
        case x: chronicle.api.v1_6_0.Result.Activity => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Activity, Result.Activity](context, x)
        case x: chronicle.api.v1_6_0.Result.ActivityJobs => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.ActivityJobs, Result.ActivityJobs](context, x)
        case x: chronicle.api.v1_6_0.Result.LocatedMessage => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.LocatedMessage, Result.LocatedMessage](context, x)
        case x: chronicle.api.v1_6_0.Result.RetryFailedPreview => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.RetryFailedPreview, Result.RetryFailedPreview](context, x)
        case x: chronicle.api.v1_6_0.Result.RetryFailed => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.RetryFailed, Result.RetryFailed](context, x)
        case x: chronicle.api.v1_6_0.Result.ExpressionHints => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.ExpressionHints, Result.ExpressionHints](context, x)
        case x: chronicle.api.v1_6_0.Result.ModelUsage => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.ModelUsage, Result.ModelUsage](context, x)
        case x: chronicle.api.v1_6_0.Result.Passages => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.Passages, Result.Passages](context, x)
        case x: chronicle.api.v1_6_0.Result.PassageSpans => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.PassageSpans, Result.PassageSpans](context, x)
        case x: chronicle.api.v1_6_0.Result.OwnerReindexPreview => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.OwnerReindexPreview, Result.OwnerReindexPreview](context, x)
        case x: chronicle.api.v1_6_0.Result.OwnerReindexed => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.OwnerReindexed, Result.OwnerReindexed](context, x)
        case x: chronicle.api.v1_6_0.Result.McpTestTools => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.McpTestTools, Result.McpTestTools](context, x)
        case x: chronicle.api.v1_6_0.Result.McpTestRun => conversions.convertWithContext[C, chronicle.api.v1_6_0.Result.McpTestRun, Result.McpTestRun](context, x)
        case other => throw new IllegalArgumentException(s"Bad input: $other")
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#Result"
  }
}