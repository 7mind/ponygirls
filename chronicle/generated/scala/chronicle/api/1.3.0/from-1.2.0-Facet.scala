import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_3_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Facet__From__1_2_0
    extends AbstractConversion[chronicle.api.v1_2_0.Facet, Facet] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_2_0.Facet
      ): Facet = {
        val value: String = _from.value
        val count: Int = _from.count
        Facet(
                value,
                count
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/:#Facet"
  }
}