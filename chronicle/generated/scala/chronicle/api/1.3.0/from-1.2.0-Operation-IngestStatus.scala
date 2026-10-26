import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_3_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__IngestStatus__From__1_2_0
    extends AbstractConversion[chronicle.api.v1_2_0.Operation.IngestStatus, Operation.IngestStatus] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_2_0.Operation.IngestStatus
      ): Operation.IngestStatus = {
        val offset: Int = _from.offset
        val limit: Int = _from.limit
        Operation.IngestStatus(
                offset,
                limit
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#IngestStatus"
  }
}