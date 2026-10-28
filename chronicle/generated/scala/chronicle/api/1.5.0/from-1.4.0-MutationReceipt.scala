import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__MutationReceipt__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.MutationReceipt, MutationReceipt] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.MutationReceipt
      ): MutationReceipt = {
        val requestid: UUID = _from.requestId
        val operation: String = _from.operation
        val entityid: Option[UUID] = _from.entityId.map(e1 => e1)
        MutationReceipt(
                requestid,
                operation,
                entityid
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#MutationReceipt"
  }
}