import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Whoami__From__1_1_0
    extends AbstractConversion[v1_1_0.Result.Whoami, Result.Whoami] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_1_0.Result.Whoami
      ): Result.Whoami = {
        val user: UserInfo = conversions.convertWithContext[C, v1_1_0.UserInfo, UserInfo](context, _from.user)
        Result.Whoami(
                user
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Whoami"
  }
}