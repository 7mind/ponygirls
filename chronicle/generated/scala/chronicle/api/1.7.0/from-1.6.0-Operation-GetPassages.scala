import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__GetPassages__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.Operation.GetPassages, Operation.GetPassages] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_6_0.Operation.GetPassages
      ): Operation.GetPassages = {
        val sessionid: UUID = _from.sessionId
        val view: ContentView = conversions.convertWithContext[C, chronicle.api.v1_6_0.ContentView, ContentView](context, _from.view)
        val offset: Int = _from.offset
        val limit: Int = _from.limit
        Operation.GetPassages(
                sessionid,
                view,
                offset,
                limit
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#GetPassages"
  }
}