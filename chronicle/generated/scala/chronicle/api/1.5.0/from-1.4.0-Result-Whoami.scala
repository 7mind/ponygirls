import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Whoami__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.Result.Whoami, Result.Whoami] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.Result.Whoami
      ): Result.Whoami = {
        val user: UserInfo = conversions.convertWithContext[C, chronicle.api.v1_4_0.UserInfo, UserInfo](context, _from.user)
        Result.Whoami(
                user
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Whoami"
  }
}