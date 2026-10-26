import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__TokenSource__From__1_2_0
    extends AbstractConversion[v1_2_0.TokenSource, TokenSource] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: v1_2_0.TokenSource
      ): TokenSource = TokenSource.parse(from.toString).get
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/:#TokenSource"
  }
}