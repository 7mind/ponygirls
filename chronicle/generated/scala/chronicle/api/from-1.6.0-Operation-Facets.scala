import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Facets__From__1_6_0
    extends AbstractConversion[v1_6_0.Operation.Facets, Operation.Facets] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.Operation.Facets
      ): Operation.Facets = {
        val filter: SearchFilter = conversions.convertWithContext[C, v1_6_0.SearchFilter, SearchFilter](context, _from.filter)
        Operation.Facets(
                filter
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Facets"
  }
}