import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_4_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Archive__From__1_3_0
    extends AbstractConversion[chronicle.api.v1_3_0.Operation.Archive, Operation.Archive] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_3_0.Operation.Archive
      ): Operation.Archive = {
        val query: ArchiveQuery = conversions.convertWithContext[C, chronicle.api.v1_3_0.ArchiveQuery, ArchiveQuery](context, _from.query)
        Operation.Archive(
                query
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Archive"
  }
}