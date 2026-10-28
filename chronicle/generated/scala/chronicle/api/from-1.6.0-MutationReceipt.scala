import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__MutationReceipt__From__1_6_0
    extends AbstractConversion[v1_6_0.MutationReceipt, MutationReceipt] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.MutationReceipt
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
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#MutationReceipt"
  }
}