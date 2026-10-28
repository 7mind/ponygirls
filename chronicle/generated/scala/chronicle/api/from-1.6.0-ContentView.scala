import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ContentView__From__1_6_0
    extends AbstractConversion[v1_6_0.ContentView, ContentView] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.ContentView
      ): ContentView = {
        val revision: Int = _from.revision
        val generationid: Option[UUID] = _from.generationId.map(e1 => e1)
        ContentView(
                revision,
                generationid
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#ContentView"
  }
}