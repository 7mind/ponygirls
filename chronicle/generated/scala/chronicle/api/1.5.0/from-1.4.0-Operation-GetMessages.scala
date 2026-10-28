import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__GetMessages__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.Operation.GetMessages, Operation.GetMessages] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.Operation.GetMessages
      ): Operation.GetMessages = {
        val sessionid: UUID = _from.sessionId
        val offset: Int = _from.offset
        val limit: Int = _from.limit
        val view: Option[ContentView] = _from.view.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_4_0.ContentView, ContentView](context, e1))
        Operation.GetMessages(
                sessionid,
                offset,
                limit,
                view
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#GetMessages"
  }
}