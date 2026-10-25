import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__GetSession__From__1_0_0
    extends AbstractConversion[v1_0_0.Operation.GetSession, Operation.GetSession] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_0_0.Operation.GetSession
      ): Operation.GetSession = {
        val sessionid: UUID = _from.sessionId
        val view: Option[ContentView] = _from.view.map(e1 => conversions.convertWithContext[C, v1_0_0.ContentView, ContentView](context, e1))
        Operation.GetSession(
                sessionid,
                view
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#GetSession"
  }
}