import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_1_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Related__From__1_0_0
    extends AbstractConversion[chronicle.api.v1_0_0.Operation.Related, Operation.Related] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_0_0.Operation.Related
      ): Operation.Related = {
        val sessionid: UUID = _from.sessionId
        val limit: Int = _from.limit
        Operation.Related(
                sessionid,
                limit
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Related"
  }
}