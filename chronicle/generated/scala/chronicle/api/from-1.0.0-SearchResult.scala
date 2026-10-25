import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") abstract class Convert__SearchResult__From__1_0_0
    extends AbstractConversion[v1_0_0.SearchResult, SearchResult] {
      def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: v1_0_0.SearchResult
      ): SearchResult
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/:#SearchResult"
  }
}