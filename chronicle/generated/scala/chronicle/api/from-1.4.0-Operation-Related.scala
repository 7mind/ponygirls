import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Related__From__1_4_0
    extends AbstractConversion[v1_4_0.Operation.Related, Operation.Related] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.Operation.Related
      ): Operation.Related = {
        val sessionid: UUID = _from.sessionId
        val limit: Int = _from.limit
        Operation.Related(
                sessionid,
                limit
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Related"
  }
}