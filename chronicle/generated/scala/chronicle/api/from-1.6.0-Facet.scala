import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Facet__From__1_6_0
    extends AbstractConversion[v1_6_0.Facet, Facet] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.Facet
      ): Facet = {
        val value: String = _from.value
        val count: Int = _from.count
        Facet(
                value,
                count
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#Facet"
  }
}