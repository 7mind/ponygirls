import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_1_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__SearchMode__From__1_0_0
    extends AbstractConversion[chronicle.api.v1_0_0.SearchMode, SearchMode] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: chronicle.api.v1_0_0.SearchMode
      ): SearchMode = SearchMode.parse(from.toString).get
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/:#SearchMode"
  }
}