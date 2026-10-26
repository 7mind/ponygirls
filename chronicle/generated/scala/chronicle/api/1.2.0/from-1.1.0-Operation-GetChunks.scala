import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_2_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__GetChunks__From__1_1_0
    extends AbstractConversion[chronicle.api.v1_1_0.Operation.GetChunks, Operation.GetChunks] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_1_0.Operation.GetChunks
      ): Operation.GetChunks = {
        val sessionid: UUID = _from.sessionId
        val offset: Int = _from.offset
        val limit: Int = _from.limit
        val view: Option[ContentView] = _from.view.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_1_0.ContentView, ContentView](context, e1))
        Operation.GetChunks(
                sessionid,
                offset,
                limit,
                view
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#GetChunks"
  }
}