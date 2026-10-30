import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Pong__From__1_7_0
    extends AbstractConversion[v1_7_0.Operation.Pong, Operation.Pong] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.Operation.Pong
      ): Operation.Pong = {
        val nonce: String = _from.nonce
        Operation.Pong(
                nonce
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Pong"
  }
}