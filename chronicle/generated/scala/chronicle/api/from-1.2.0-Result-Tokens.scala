import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Tokens__From__1_2_0
    extends AbstractConversion[v1_2_0.Result.Tokens, Result.Tokens] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_2_0.Result.Tokens
      ): Result.Tokens = {
        val result: TokensResult = conversions.convertWithContext[C, v1_2_0.TokensResult, TokensResult](context, _from.result)
        Result.Tokens(
                result
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Tokens"
  }
}