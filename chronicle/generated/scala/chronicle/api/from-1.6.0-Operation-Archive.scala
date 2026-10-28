import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Archive__From__1_6_0
    extends AbstractConversion[v1_6_0.Operation.Archive, Operation.Archive] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.Operation.Archive
      ): Operation.Archive = {
        val query: ArchiveQuery = conversions.convertWithContext[C, v1_6_0.ArchiveQuery, ArchiveQuery](context, _from.query)
        Operation.Archive(
                query
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Archive"
  }
}