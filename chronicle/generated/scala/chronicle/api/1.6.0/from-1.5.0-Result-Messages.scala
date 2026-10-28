import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Messages__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.Result.Messages, Result.Messages] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.Result.Messages
      ): Result.Messages = {
        val result: MessagesResult = conversions.convertWithContext[C, chronicle.api.v1_5_0.MessagesResult, MessagesResult](context, _from.result)
        Result.Messages(
                result
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Messages"
  }
}