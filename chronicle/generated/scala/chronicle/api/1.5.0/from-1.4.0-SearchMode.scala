import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__SearchMode__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.SearchMode, SearchMode] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: chronicle.api.v1_4_0.SearchMode
      ): SearchMode = SearchMode.parse(from.toString).get
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#SearchMode"
  }
}