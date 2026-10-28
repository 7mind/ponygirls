import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__PassageSourceSpan__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.PassageSourceSpan, PassageSourceSpan] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.PassageSourceSpan
      ): PassageSourceSpan = {
        val messageid: String = _from.messageId
        val messageposition: Int = _from.messagePosition
        val start: Int = _from.start
        val `end`: Int = _from.`end`
        PassageSourceSpan(
                messageid,
                messageposition,
                start,
                `end`
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/:#PassageSourceSpan"
  }
}