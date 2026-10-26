import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ClientEnvelope__From__1_1_0
    extends AbstractConversion[v1_1_0.ClientEnvelope, ClientEnvelope] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_1_0.ClientEnvelope
      ): ClientEnvelope = {
        val requestid: UUID = _from.requestId
        val operation: Operation = conversions.convertWithContext[C, v1_1_0.Operation, Operation](context, _from.operation)
        ClientEnvelope(
                requestid,
                operation
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/:#ClientEnvelope"
  }
}