import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__CollectorPhase__From__1_6_0
    extends AbstractConversion[v1_6_0.CollectorPhase, CollectorPhase] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: v1_6_0.CollectorPhase
      ): CollectorPhase = CollectorPhase.parse(from.toString).get
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#CollectorPhase"
  }
}