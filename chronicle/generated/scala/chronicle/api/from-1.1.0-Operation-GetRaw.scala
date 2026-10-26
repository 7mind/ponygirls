import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__GetRaw__From__1_1_0
    extends AbstractConversion[v1_1_0.Operation.GetRaw, Operation.GetRaw] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_1_0.Operation.GetRaw
      ): Operation.GetRaw = {
        val sessionid: UUID = _from.sessionId
        val revision: Option[Int] = _from.revision.map(e1 => e1)
        Operation.GetRaw(
                sessionid,
                revision
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#GetRaw"
  }
}