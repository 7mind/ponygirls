package ontology

import java.time.Duration
import ontology.api.*
import ontology.domain.CurationGuardLimits

object TestCuration {
  val FixtureLease: Duration = Duration.ofSeconds(30)
  val FixtureAttempt: Duration = Duration.ofMinutes(2)
  def settings(scopes: Set[String]): CurationStoreSettings = CurationStoreSettings(
    Principal("curator-fixture", Actor("curator", ActorKind.Agent), scopes, Set(Capability.Read, Capability.Mutate)),
    Actor("curation-service", ActorKind.Service), scopes, FixtureLease, FixtureAttempt, CurationGuardLimits(4, 1048576, 1048576L, 512, 256), 16, 16)
}
