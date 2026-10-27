import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_4_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__CollectorStatusResult__From__1_3_0
    extends AbstractConversion[chronicle.api.v1_3_0.CollectorStatusResult, CollectorStatusResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_3_0.CollectorStatusResult
      ): CollectorStatusResult = {
        val collectors: List[CollectorStatus] = _from.collectors.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_3_0.CollectorStatus, CollectorStatus](context, e1)).toList
        CollectorStatusResult(
                collectors
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#CollectorStatusResult"
  }
}