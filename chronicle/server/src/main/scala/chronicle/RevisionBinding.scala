package chronicle

import chronicle.api.IngestRequest
import java.util.UUID

/** Opaque claim-local binding to the immutable object decoded from one stored revision.
  * No whole-source serialization per checkpoint, mutable global memo, or physical MVCC identity.
  * IngestRequest and its complete projection (including raw files) are immutable generated values.
  */
final class RevisionBinding private (val id: UUID,sessionId: UUID,revision: Int,snapshot: IngestRequest) {
  private[chronicle] def matches(claim: Claim): Boolean =
    claim.sessionId==sessionId && claim.revision==revision && (claim.snapshot eq snapshot)
}
object RevisionBinding {
  private[chronicle] def captured(id: UUID,sessionId: UUID,revision: Int,snapshot: IngestRequest): RevisionBinding =
    new RevisionBinding(id,sessionId,revision,snapshot)
}
