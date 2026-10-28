import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ActivityJobScope__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.ActivityJobScope, ActivityJobScope] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: chronicle.api.v1_5_0.ActivityJobScope
      ): ActivityJobScope = ActivityJobScope.parse(from.toString).get
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/:#ActivityJobScope"
  }
}