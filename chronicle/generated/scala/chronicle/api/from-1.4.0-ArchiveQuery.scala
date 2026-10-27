import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ArchiveQuery__From__1_4_0
    extends AbstractConversion[v1_4_0.ArchiveQuery, ArchiveQuery] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.ArchiveQuery
      ): ArchiveQuery = {
        val expression: String = _from.expression
        val sort: ArchiveSort = conversions.convertWithContext[C, v1_4_0.ArchiveSort, ArchiveSort](context, _from.sort)
        val direction: SortDirection = conversions.convertWithContext[C, v1_4_0.SortDirection, SortDirection](context, _from.direction)
        val cursor: Option[String] = _from.cursor.map(e1 => e1)
        val limit: Int = _from.limit
        ArchiveQuery(
                expression,
                sort,
                direction,
                cursor,
                limit
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#ArchiveQuery"
  }
}