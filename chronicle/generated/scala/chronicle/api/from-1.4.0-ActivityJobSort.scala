import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ActivityJobSort__From__1_4_0
    extends AbstractConversion[v1_4_0.ActivityJobSort, ActivityJobSort] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: v1_4_0.ActivityJobSort
      ): ActivityJobSort = ActivityJobSort.parse(from.toString).get
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#ActivityJobSort"
  }
}