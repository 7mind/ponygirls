import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_3_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Span__From__1_2_0
    extends AbstractConversion[chronicle.api.v1_2_0.Span, Span] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_2_0.Span
      ): Span = {
        val messageid: String = _from.messageId
        val start: Int = _from.start
        val `end`: Int = _from.`end`
        Span(
                messageid,
                start,
                `end`
             )
      }
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/:#Span"
  }
}