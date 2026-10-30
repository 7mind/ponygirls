import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__TokenResult__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.TokenResult, TokenResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_6_0.TokenResult
      ): TokenResult = {
        val token: TokenInfo = conversions.convertWithContext[C, chronicle.api.v1_6_0.TokenInfo, TokenInfo](context, _from.token)
        val secret: Option[String] = _from.secret.map(e1 => e1)
        TokenResult(
                token,
                secret
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#TokenResult"
  }
}