import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__SessionInfo__From__1_7_0
    extends AbstractConversion[v1_7_0.SessionInfo, SessionInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.SessionInfo
      ): SessionInfo = {
        val view: ContentView = conversions.convertWithContext[C, v1_7_0.ContentView, ContentView](context, _from.view)
        val id: UUID = _from.id
        val ownerid: String = _from.ownerId
        val revision: Int = _from.revision
        val indexedrevision: Option[Int] = _from.indexedRevision.map(e1 => e1)
        val metadata: Metadata = conversions.convertWithContext[C, v1_7_0.Metadata, Metadata](context, _from.metadata)
        val source: SourceIdentity = conversions.convertWithContext[C, v1_7_0.SourceIdentity, SourceIdentity](context, _from.source)
        val completion: Completion = conversions.convertWithContext[C, v1_7_0.Completion, Completion](context, _from.completion)
        val redacted: Boolean = _from.redacted
        SessionInfo(
                view,
                id,
                ownerid,
                revision,
                indexedrevision,
                metadata,
                source,
                completion,
                redacted
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/:#SessionInfo"
  }
}