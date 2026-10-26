import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ActivityQuery__From__1_3_0
    extends AbstractConversion[v1_3_0.ActivityQuery, ActivityQuery] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_3_0.ActivityQuery
      ): ActivityQuery = {
        val expression: String = _from.expression
        val sort: ActivityCollectorSort = conversions.convertWithContext[C, v1_3_0.ActivityCollectorSort, ActivityCollectorSort](context, _from.sort)
        val direction: SortDirection = conversions.convertWithContext[C, v1_3_0.SortDirection, SortDirection](context, _from.direction)
        val cursor: Option[String] = _from.cursor.map(e1 => e1)
        val limit: Int = _from.limit
        ActivityQuery(
                expression,
                sort,
                direction,
                cursor,
                limit
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#ActivityQuery"
  }
}