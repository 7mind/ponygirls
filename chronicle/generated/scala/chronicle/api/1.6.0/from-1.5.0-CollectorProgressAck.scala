import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__CollectorProgressAck__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.CollectorProgressAck, CollectorProgressAck] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.CollectorProgressAck
      ): CollectorProgressAck = {
        val sequence: Long = _from.sequence
        val accepted: Boolean = _from.accepted
        CollectorProgressAck(
                sequence,
                accepted
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/:#CollectorProgressAck"
  }
}