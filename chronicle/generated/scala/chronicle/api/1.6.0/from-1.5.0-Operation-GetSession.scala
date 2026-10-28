import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__GetSession__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.Operation.GetSession, Operation.GetSession] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.Operation.GetSession
      ): Operation.GetSession = {
        val sessionid: UUID = _from.sessionId
        val view: Option[ContentView] = _from.view.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_5_0.ContentView, ContentView](context, e1))
        Operation.GetSession(
                sessionid,
                view
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#GetSession"
  }
}