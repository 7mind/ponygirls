import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__GetChunks__From__1_3_0
    extends AbstractConversion[v1_3_0.Operation.GetChunks, Operation.GetChunks] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_3_0.Operation.GetChunks
      ): Operation.GetChunks = {
        val sessionid: UUID = _from.sessionId
        val offset: Int = _from.offset
        val limit: Int = _from.limit
        val view: Option[ContentView] = _from.view.map(e1 => conversions.convertWithContext[C, v1_3_0.ContentView, ContentView](context, e1))
        Operation.GetChunks(
                sessionid,
                offset,
                limit,
                view
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#GetChunks"
  }
}