import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ActivityJobScope__From__1_7_0
    extends AbstractConversion[v1_7_0.ActivityJobScope, ActivityJobScope] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: v1_7_0.ActivityJobScope
      ): ActivityJobScope = ActivityJobScope.parse(from.toString).get
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/:#ActivityJobScope"
  }
}