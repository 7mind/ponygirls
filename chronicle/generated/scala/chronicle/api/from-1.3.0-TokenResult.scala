import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__TokenResult__From__1_3_0
    extends AbstractConversion[v1_3_0.TokenResult, TokenResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_3_0.TokenResult
      ): TokenResult = {
        val token: TokenInfo = conversions.convertWithContext[C, v1_3_0.TokenInfo, TokenInfo](context, _from.token)
        val secret: Option[String] = _from.secret.map(e1 => e1)
        TokenResult(
                token,
                secret
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#TokenResult"
  }
}