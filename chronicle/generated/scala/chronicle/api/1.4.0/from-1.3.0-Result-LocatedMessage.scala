import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_4_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__LocatedMessage__From__1_3_0
    extends AbstractConversion[chronicle.api.v1_3_0.Result.LocatedMessage, Result.LocatedMessage] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_3_0.Result.LocatedMessage
      ): Result.LocatedMessage = {
        val result: MessageLocation = conversions.convertWithContext[C, chronicle.api.v1_3_0.MessageLocation, MessageLocation](context, _from.result)
        Result.LocatedMessage(
                result
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#LocatedMessage"
  }
}