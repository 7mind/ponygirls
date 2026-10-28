import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__CollectorStatusResult__From__1_6_0
    extends AbstractConversion[v1_6_0.CollectorStatusResult, CollectorStatusResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.CollectorStatusResult
      ): CollectorStatusResult = {
        val collectors: List[CollectorStatus] = _from.collectors.map(e1 => conversions.convertWithContext[C, v1_6_0.CollectorStatus, CollectorStatus](context, e1)).toList
        CollectorStatusResult(
                collectors
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#CollectorStatusResult"
  }
}