import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__PassagePoint__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.PassagePoint, PassagePoint] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.PassagePoint
      ): PassagePoint = {
        val messageid: String = _from.messageId
        val messageposition: Int = _from.messagePosition
        val byteoffset: Int = _from.byteOffset
        PassagePoint(
                messageid,
                messageposition,
                byteoffset
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/:#PassagePoint"
  }
}