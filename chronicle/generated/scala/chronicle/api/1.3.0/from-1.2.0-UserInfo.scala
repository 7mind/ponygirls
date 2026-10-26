import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_3_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__UserInfo__From__1_2_0
    extends AbstractConversion[chronicle.api.v1_2_0.UserInfo, UserInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_2_0.UserInfo
      ): UserInfo = {
        val id: String = _from.id
        val login: String = _from.login
        val scopes: List[Scope] = _from.scopes.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_2_0.Scope, Scope](context, e1)).toList
        UserInfo(
                id,
                login,
                scopes
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/:#UserInfo"
  }
}