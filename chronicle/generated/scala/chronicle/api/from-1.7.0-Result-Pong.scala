import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Pong__From__1_7_0
    extends AbstractConversion[v1_7_0.Result.Pong, Result.Pong] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.Result.Pong
      ): Result.Pong = {
        val nonce: String = _from.nonce
        Result.Pong(
                nonce
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Pong"
  }
}