package chronicle

import chronicle.api.IngestRequest
import java.util.UUID

/** Opaque claim-local binding to the immutable objects of one stored revision: its decoded envelope and its messages' reader.
  * No whole-source serialization per checkpoint, mutable global memo, or physical MVCC identity.
  * IngestRequest and its complete projection (including raw files) are immutable generated values.
  */
final class RevisionBinding private (val id: UUID,sessionId: UUID,revision: Int,snapshot: IngestRequest,messages: ClaimedMessages) {
  private[chronicle] def matches(claim: Claim): Boolean =
    claim.sessionId==sessionId && claim.revision==revision && (claim.snapshot eq snapshot) && (claim.messages eq messages)
}
object RevisionBinding {
  private[chronicle] def captured(id: UUID,sessionId: UUID,revision: Int,snapshot: IngestRequest,messages: ClaimedMessages): RevisionBinding =
    new RevisionBinding(id,sessionId,revision,snapshot,messages)
}
