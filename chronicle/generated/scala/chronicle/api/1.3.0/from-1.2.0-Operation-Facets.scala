import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_3_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Facets__From__1_2_0
    extends AbstractConversion[chronicle.api.v1_2_0.Operation.Facets, Operation.Facets] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_2_0.Operation.Facets
      ): Operation.Facets = {
        val filter: SearchFilter = conversions.convertWithContext[C, chronicle.api.v1_2_0.SearchFilter, SearchFilter](context, _from.filter)
        Operation.Facets(
                filter
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Facets"
  }
}