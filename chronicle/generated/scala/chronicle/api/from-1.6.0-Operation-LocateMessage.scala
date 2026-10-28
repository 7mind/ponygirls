import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__LocateMessage__From__1_6_0
    extends AbstractConversion[v1_6_0.Operation.LocateMessage, Operation.LocateMessage] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.Operation.LocateMessage
      ): Operation.LocateMessage = {
        val sessionid: UUID = _from.sessionId
        val view: ContentView = conversions.convertWithContext[C, v1_6_0.ContentView, ContentView](context, _from.view)
        val messageid: String = _from.messageId
        Operation.LocateMessage(
                sessionid,
                view,
                messageid
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#LocateMessage"
  }
}