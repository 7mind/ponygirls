import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__MessageLocation__From__1_6_0
    extends AbstractConversion[v1_6_0.MessageLocation, MessageLocation] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.MessageLocation
      ): MessageLocation = {
        val view: ContentView = conversions.convertWithContext[C, v1_6_0.ContentView, ContentView](context, _from.view)
        val position: Int = _from.position
        val total: Int = _from.total
        MessageLocation(
                view,
                position,
                total
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#MessageLocation"
  }
}