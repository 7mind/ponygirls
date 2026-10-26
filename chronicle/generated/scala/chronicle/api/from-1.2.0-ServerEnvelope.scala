import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ServerEnvelope__From__1_2_0
    extends AbstractConversion[v1_2_0.ServerEnvelope, ServerEnvelope] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_2_0.ServerEnvelope
      ): ServerEnvelope = {
        val requestid: UUID = _from.requestId
        val result: Result = conversions.convertWithContext[C, v1_2_0.Result, Result](context, _from.result)
        ServerEnvelope(
                requestid,
                result
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/:#ServerEnvelope"
  }
}