import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_2_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__IngestRequest__From__1_1_0
    extends AbstractConversion[chronicle.api.v1_1_0.IngestRequest, IngestRequest] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_1_0.IngestRequest
      ): IngestRequest = {
        val requestid: UUID = _from.requestId
        val source: SourceIdentity = conversions.convertWithContext[C, chronicle.api.v1_1_0.SourceIdentity, SourceIdentity](context, _from.source)
        val expectedrevision: Int = _from.expectedRevision
        val digest: String = _from.digest
        val completion: Completion = conversions.convertWithContext[C, chronicle.api.v1_1_0.Completion, Completion](context, _from.completion)
        val redacted: Boolean = _from.redacted
        val metadata: Metadata = conversions.convertWithContext[C, chronicle.api.v1_1_0.Metadata, Metadata](context, _from.metadata)
        val messages: List[Message] = _from.messages.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_1_0.Message, Message](context, e1)).toList
        val files: List[RawFile] = _from.files.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_1_0.RawFile, RawFile](context, e1)).toList
        IngestRequest(
                requestid,
                source,
                expectedrevision,
                digest,
                completion,
                redacted,
                metadata,
                messages,
                files
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/:#IngestRequest"
  }
}