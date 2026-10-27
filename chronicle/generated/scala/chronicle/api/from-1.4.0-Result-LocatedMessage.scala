import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__LocatedMessage__From__1_4_0
    extends AbstractConversion[v1_4_0.Result.LocatedMessage, Result.LocatedMessage] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.Result.LocatedMessage
      ): Result.LocatedMessage = {
        val result: MessageLocation = conversions.convertWithContext[C, v1_4_0.MessageLocation, MessageLocation](context, _from.result)
        Result.LocatedMessage(
                result
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#LocatedMessage"
  }
}