import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__TokensResult__From__1_0_0
    extends AbstractConversion[v1_0_0.TokensResult, TokensResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_0_0.TokensResult
      ): TokensResult = {
        val tokens: List[TokenInfo] = _from.tokens.map(e1 => conversions.convertWithContext[C, v1_0_0.TokenInfo, TokenInfo](context, e1)).toList
        TokensResult(
                tokens
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/:#TokensResult"
  }
}