import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_1_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Pong__From__1_0_0
    extends AbstractConversion[chronicle.api.v1_0_0.Operation.Pong, Operation.Pong] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_0_0.Operation.Pong
      ): Operation.Pong = {
        val nonce: String = _from.nonce
        Operation.Pong(
                nonce
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Pong"
  }
}