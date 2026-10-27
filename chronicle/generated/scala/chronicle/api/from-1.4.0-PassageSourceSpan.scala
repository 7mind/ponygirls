import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__PassageSourceSpan__From__1_4_0
    extends AbstractConversion[v1_4_0.PassageSourceSpan, PassageSourceSpan] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.PassageSourceSpan
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
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#PassageSourceSpan"
  }
}