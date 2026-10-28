import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__LoginResponse__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.LoginResponse, LoginResponse] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.LoginResponse
      ): LoginResponse = {
        val user: UserInfo = conversions.convertWithContext[C, chronicle.api.v1_5_0.UserInfo, UserInfo](context, _from.user)
        val versions: VersionInfo = conversions.convertWithContext[C, chronicle.api.v1_5_0.VersionInfo, VersionInfo](context, _from.versions)
        LoginResponse(
                user,
                versions
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/:#LoginResponse"
  }
}