import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_3_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__From__1_2_0
    extends AbstractConversion[chronicle.api.v1_2_0.Result, Result] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: chronicle.api.v1_2_0.Result
      ): Result = from match {
        case x: chronicle.api.v1_2_0.Result.Hello => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Hello, Result.Hello](context, x)
        case x: chronicle.api.v1_2_0.Result.Pong => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Pong, Result.Pong](context, x)
        case x: chronicle.api.v1_2_0.Result.Whoami => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Whoami, Result.Whoami](context, x)
        case x: chronicle.api.v1_2_0.Result.Search => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Search, Result.Search](context, x)
        case x: chronicle.api.v1_2_0.Result.Session => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Session, Result.Session](context, x)
        case x: chronicle.api.v1_2_0.Result.Chunks => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Chunks, Result.Chunks](context, x)
        case x: chronicle.api.v1_2_0.Result.Messages => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Messages, Result.Messages](context, x)
        case x: chronicle.api.v1_2_0.Result.Raw => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Raw, Result.Raw](context, x)
        case x: chronicle.api.v1_2_0.Result.Related => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Related, Result.Related](context, x)
        case x: chronicle.api.v1_2_0.Result.Facets => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Facets, Result.Facets](context, x)
        case x: chronicle.api.v1_2_0.Result.CollectionStatus => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.CollectionStatus, Result.CollectionStatus](context, x)
        case x: chronicle.api.v1_2_0.Result.Status => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Status, Result.Status](context, x)
        case x: chronicle.api.v1_2_0.Result.Tokens => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Tokens, Result.Tokens](context, x)
        case x: chronicle.api.v1_2_0.Result.Token => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Token, Result.Token](context, x)
        case x: chronicle.api.v1_2_0.Result.Groups => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Groups, Result.Groups](context, x)
        case x: chronicle.api.v1_2_0.Result.Mutation => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Mutation, Result.Mutation](context, x)
        case x: chronicle.api.v1_2_0.Result.Error => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Error, Result.Error](context, x)
        case x: chronicle.api.v1_2_0.Result.Ping => conversions.convertWithContext[C, chronicle.api.v1_2_0.Result.Ping, Result.Ping](context, x)
        case other => throw new IllegalArgumentException(s"Bad input: $other")
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/:#Result"
  }
}