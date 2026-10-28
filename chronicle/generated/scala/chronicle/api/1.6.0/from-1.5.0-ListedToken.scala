import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ListedToken__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.ListedToken, ListedToken] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.ListedToken
      ): ListedToken = {
        val info: TokenInfo = conversions.convertWithContext[C, chronicle.api.v1_5_0.TokenInfo, TokenInfo](context, _from.info)
        val source: TokenSource = conversions.convertWithContext[C, chronicle.api.v1_5_0.TokenSource, TokenSource](context, _from.source)
        ListedToken(
                info,
                source
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/:#ListedToken"
  }
}