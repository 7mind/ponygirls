import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__SearchFilter__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.SearchFilter, SearchFilter] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.SearchFilter
      ): SearchFilter = {
        val project: Option[String] = _from.project.map(e1 => e1)
        val gitbranch: Option[String] = _from.gitBranch.map(e1 => e1)
        val after: Option[String] = _from.after.map(e1 => e1)
        val before: Option[String] = _from.before.map(e1 => e1)
        val tags: List[String] = _from.tags.map(e1 => e1).toList
        SearchFilter(
                project,
                gitbranch,
                after,
                before,
                tags
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/:#SearchFilter"
  }
}