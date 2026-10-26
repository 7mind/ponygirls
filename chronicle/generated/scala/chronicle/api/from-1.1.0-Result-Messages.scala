import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Messages__From__1_1_0
    extends AbstractConversion[v1_1_0.Result.Messages, Result.Messages] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_1_0.Result.Messages
      ): Result.Messages = {
        val result: MessagesResult = conversions.convertWithContext[C, v1_1_0.MessagesResult, MessagesResult](context, _from.result)
        Result.Messages(
                result
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Messages"
  }
}