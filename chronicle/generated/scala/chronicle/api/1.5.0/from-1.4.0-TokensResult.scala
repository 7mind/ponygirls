import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__TokensResult__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.TokensResult, TokensResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.TokensResult
      ): TokensResult = {
        val tokens: List[ListedToken] = _from.tokens.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_4_0.ListedToken, ListedToken](context, e1)).toList
        TokensResult(
                tokens
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#TokensResult"
  }
}