import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ServerEnvelope__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.ServerEnvelope, ServerEnvelope] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.ServerEnvelope
      ): ServerEnvelope = {
        val requestid: UUID = _from.requestId
        val result: Result = conversions.convertWithContext[C, chronicle.api.v1_4_0.Result, Result](context, _from.result)
        ServerEnvelope(
                requestid,
                result
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#ServerEnvelope"
  }
}