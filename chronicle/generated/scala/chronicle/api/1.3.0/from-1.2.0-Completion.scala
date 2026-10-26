import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_3_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Completion__From__1_2_0
    extends AbstractConversion[chronicle.api.v1_2_0.Completion, Completion] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: chronicle.api.v1_2_0.Completion
      ): Completion = Completion.parse(from.toString).get
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/:#Completion"
  }
}