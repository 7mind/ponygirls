import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__CollectorProgressAck__From__1_3_0
    extends AbstractConversion[v1_3_0.CollectorProgressAck, CollectorProgressAck] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_3_0.CollectorProgressAck
      ): CollectorProgressAck = {
        val sequence: Long = _from.sequence
        val accepted: Boolean = _from.accepted
        CollectorProgressAck(
                sequence,
                accepted
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#CollectorProgressAck"
  }
}