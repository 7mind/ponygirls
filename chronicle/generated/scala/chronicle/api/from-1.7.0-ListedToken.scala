import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ListedToken__From__1_7_0
    extends AbstractConversion[v1_7_0.ListedToken, ListedToken] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.ListedToken
      ): ListedToken = {
        val info: TokenInfo = conversions.convertWithContext[C, v1_7_0.TokenInfo, TokenInfo](context, _from.info)
        val source: TokenSource = conversions.convertWithContext[C, v1_7_0.TokenSource, TokenSource](context, _from.source)
        ListedToken(
                info,
                source
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/:#ListedToken"
  }
}