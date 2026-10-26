import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_1_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__LoginRequest__From__1_0_0
    extends AbstractConversion[chronicle.api.v1_0_0.LoginRequest, LoginRequest] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_0_0.LoginRequest
      ): LoginRequest = {
        val login: String = _from.login
        val password: String = _from.password
        LoginRequest(
                login,
                password
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/:#LoginRequest"
  }
}