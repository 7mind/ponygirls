import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_3_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__SessionInfo__From__1_2_0
    extends AbstractConversion[chronicle.api.v1_2_0.SessionInfo, SessionInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_2_0.SessionInfo
      ): SessionInfo = {
        val view: ContentView = conversions.convertWithContext[C, chronicle.api.v1_2_0.ContentView, ContentView](context, _from.view)
        val id: UUID = _from.id
        val ownerid: String = _from.ownerId
        val revision: Int = _from.revision
        val indexedrevision: Option[Int] = _from.indexedRevision.map(e1 => e1)
        val metadata: Metadata = conversions.convertWithContext[C, chronicle.api.v1_2_0.Metadata, Metadata](context, _from.metadata)
        val source: SourceIdentity = conversions.convertWithContext[C, chronicle.api.v1_2_0.SourceIdentity, SourceIdentity](context, _from.source)
        val completion: Completion = conversions.convertWithContext[C, chronicle.api.v1_2_0.Completion, Completion](context, _from.completion)
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
      override def versionFrom: String = "1.2.0"
      override def versionTo: String = "1.3.0"
      override def typeId: String = "chronicle.api/:#SessionInfo"
  }
}