import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ServerEnvelope__From__1_6_0
    extends AbstractConversion[v1_6_0.ServerEnvelope, ServerEnvelope] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.ServerEnvelope
      ): ServerEnvelope = {
        val requestid: UUID = _from.requestId
        val result: Result = conversions.convertWithContext[C, v1_6_0.Result, Result](context, _from.result)
        ServerEnvelope(
                requestid,
                result
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#ServerEnvelope"
  }
}