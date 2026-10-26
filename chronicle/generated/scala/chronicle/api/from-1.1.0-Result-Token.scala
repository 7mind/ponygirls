import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Token__From__1_1_0
    extends AbstractConversion[v1_1_0.Result.Token, Result.Token] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_1_0.Result.Token
      ): Result.Token = {
        val result: TokenResult = conversions.convertWithContext[C, v1_1_0.TokenResult, TokenResult](context, _from.result)
        Result.Token(
                result
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Token"
  }
}