import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ActivityJobsQuery__From__1_3_0
    extends AbstractConversion[v1_3_0.ActivityJobsQuery, ActivityJobsQuery] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_3_0.ActivityJobsQuery
      ): ActivityJobsQuery = {
        val collectorid: Option[String] = _from.collectorId.map(e1 => e1)
        val scope: ActivityJobScope = conversions.convertWithContext[C, v1_3_0.ActivityJobScope, ActivityJobScope](context, _from.scope)
        val expression: String = _from.expression
        val sort: ActivityJobSort = conversions.convertWithContext[C, v1_3_0.ActivityJobSort, ActivityJobSort](context, _from.sort)
        val direction: SortDirection = conversions.convertWithContext[C, v1_3_0.SortDirection, SortDirection](context, _from.direction)
        val cursor: Option[String] = _from.cursor.map(e1 => e1)
        val limit: Int = _from.limit
        ActivityJobsQuery(
                collectorid,
                scope,
                expression,
                sort,
                direction,
                cursor,
                limit
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#ActivityJobsQuery"
  }
}