import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__MessageSearchHit__From__1_6_0
    extends AbstractConversion[v1_6_0.MessageSearchHit, MessageSearchHit] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.MessageSearchHit
      ): MessageSearchHit = {
        val messageid: String = _from.messageId
        val position: Int = _from.position
        MessageSearchHit(
                messageid,
                position
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#MessageSearchHit"
  }
}