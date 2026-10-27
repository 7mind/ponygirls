import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__GetPassageSpans__From__1_4_0
    extends AbstractConversion[v1_4_0.Operation.GetPassageSpans, Operation.GetPassageSpans] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.Operation.GetPassageSpans
      ): Operation.GetPassageSpans = {
        val sessionid: UUID = _from.sessionId
        val view: ContentView = conversions.convertWithContext[C, v1_4_0.ContentView, ContentView](context, _from.view)
        val passageid: UUID = _from.passageId
        val offset: Int = _from.offset
        val limit: Int = _from.limit
        Operation.GetPassageSpans(
                sessionid,
                view,
                passageid,
                offset,
                limit
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#GetPassageSpans"
  }
}