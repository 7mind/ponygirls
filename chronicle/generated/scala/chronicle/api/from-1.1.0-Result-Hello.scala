import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Hello__From__1_1_0
    extends AbstractConversion[v1_1_0.Result.Hello, Result.Hello] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_1_0.Result.Hello
      ): Result.Hello = {
        val versions: VersionInfo = conversions.convertWithContext[C, v1_1_0.VersionInfo, VersionInfo](context, _from.versions)
        val user: UserInfo = conversions.convertWithContext[C, v1_1_0.UserInfo, UserInfo](context, _from.user)
        Result.Hello(
                versions,
                user
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Hello"
  }
}