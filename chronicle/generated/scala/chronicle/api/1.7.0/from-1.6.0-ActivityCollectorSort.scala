import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ActivityCollectorSort__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.ActivityCollectorSort, ActivityCollectorSort] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: chronicle.api.v1_6_0.ActivityCollectorSort
      ): ActivityCollectorSort = ActivityCollectorSort.parse(from.toString).get
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#ActivityCollectorSort"
  }
}