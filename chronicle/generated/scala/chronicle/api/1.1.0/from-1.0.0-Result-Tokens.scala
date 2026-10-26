import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_1_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Tokens__From__1_0_0
    extends AbstractConversion[chronicle.api.v1_0_0.Result.Tokens, Result.Tokens] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_0_0.Result.Tokens
      ): Result.Tokens = {
        val result: TokensResult = conversions.convertWithContext[C, chronicle.api.v1_0_0.TokensResult, TokensResult](context, _from.result)
        Result.Tokens(
                result
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Tokens"
  }
}