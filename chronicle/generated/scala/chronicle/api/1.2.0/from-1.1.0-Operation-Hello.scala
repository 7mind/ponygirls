import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_2_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Hello__From__1_1_0
    extends AbstractConversion[chronicle.api.v1_1_0.Operation.Hello, Operation.Hello] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_1_0.Operation.Hello
      ): Operation.Hello = {
        val versions: List[String] = _from.versions.map(e1 => e1).toList
        Operation.Hello(
                versions
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Hello"
  }
}