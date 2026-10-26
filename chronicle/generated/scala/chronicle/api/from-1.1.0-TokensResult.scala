import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") abstract class Convert__TokensResult__From__1_1_0
    extends AbstractConversion[v1_1_0.TokensResult, TokensResult] {
      def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: v1_1_0.TokensResult
      ): TokensResult
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/:#TokensResult"
  }
}