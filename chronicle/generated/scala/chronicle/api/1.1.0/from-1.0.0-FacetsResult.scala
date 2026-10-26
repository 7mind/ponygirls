import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_1_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__FacetsResult__From__1_0_0
    extends AbstractConversion[chronicle.api.v1_0_0.FacetsResult, FacetsResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_0_0.FacetsResult
      ): FacetsResult = {
        val projects: List[Facet] = _from.projects.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_0_0.Facet, Facet](context, e1)).toList
        val branches: List[Facet] = _from.branches.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_0_0.Facet, Facet](context, e1)).toList
        val tags: List[Facet] = _from.tags.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_0_0.Facet, Facet](context, e1)).toList
        FacetsResult(
                projects,
                branches,
                tags
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/:#FacetsResult"
  }
}