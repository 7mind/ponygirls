import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__UserInfo__From__1_7_0
    extends AbstractConversion[v1_7_0.UserInfo, UserInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.UserInfo
      ): UserInfo = {
        val id: String = _from.id
        val login: String = _from.login
        val scopes: List[Scope] = _from.scopes.map(e1 => conversions.convertWithContext[C, v1_7_0.Scope, Scope](context, e1)).toList
        UserInfo(
                id,
                login,
                scopes
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/:#UserInfo"
  }
}