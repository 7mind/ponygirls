import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__SearchSessionMessages__From__1_7_0
    extends AbstractConversion[v1_7_0.Operation.SearchSessionMessages, Operation.SearchSessionMessages] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.Operation.SearchSessionMessages
      ): Operation.SearchSessionMessages = {
        val sessionid: UUID = _from.sessionId
        val view: ContentView = conversions.convertWithContext[C, v1_7_0.ContentView, ContentView](context, _from.view)
        val literal: String = _from.literal
        val cursor: Option[String] = _from.cursor.map(e1 => e1)
        val limit: Int = _from.limit
        Operation.SearchSessionMessages(
                sessionid,
                view,
                literal,
                cursor,
                limit
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#SearchSessionMessages"
  }
}