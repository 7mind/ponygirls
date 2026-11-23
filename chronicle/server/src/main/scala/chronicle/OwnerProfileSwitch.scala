package chronicle

import io.circe.Json
import java.sql.Connection
import java.util.UUID
import ponygirls.auth.AccountJson

/** Change the owner's target for future revisions, without the cohort or retirement intent of a rebuild. */
private[chronicle] object OwnerProfileSwitch {
  val operation = "owner-profile-switch"
  val maxBodyBytes = 1024
  val superseded = "profile-switch-superseded"

  final case class Preview(ownerId: String,currentProfile: String,targetProfile: String,selectionHash: String) {
    def json: Json = Json.obj("ownerId" -> Json.fromString(ownerId),"actor" -> Json.fromString(AccountJson.actor(ownerId)),
      "currentProfile" -> Json.fromString(currentProfile),"targetProfile" -> Json.fromString(targetProfile),
      "selectionHash" -> Json.fromString(selectionHash),"backfillJobs" -> Json.fromInt(0))
  }
  final case class Apply(requestId: UUID,targetProfile: String,selectionHash: String) {
    // A separate domain from the canonical Baboon operation encodings. The ID is the receipt key;
    // explicit confirmation (the only accepted value) remains part of the encoded payload.
    def digest: String = Wire.hash(Json.arr(Json.fromString(operation),Json.fromInt(1),Json.fromString(targetProfile),
      Json.fromString(selectionHash),Json.True).noSpaces)
    def success: Json = Json.obj("requestId" -> Json.fromString(requestId.toString),"targetProfile" -> Json.fromString(targetProfile),
      "backfillJobs" -> Json.fromInt(0))
  }
  def decode(value: Json): Apply = {
    def invalid = DomainError("invalid","invalid profile switch request")
    def string(key: String): String = value.hcursor.get[String](key).fold(_ => throw invalid,identity)
    if (!value.asObject.exists(_.keys.toSet == Set("requestId","targetProfile","selectionHash","confirm")) ||
      !value.hcursor.get[Boolean]("confirm").contains(true)) throw invalid
    val id=string("requestId"); val profile=string("targetProfile"); val hash=string("selectionHash")
    if (!id.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}") ||
      !profile.matches("[0-9a-f]{64}") || !hash.matches("[0-9a-f]{64}")) throw invalid
    Apply(UUID.fromString(id),profile,hash)
  }

  private def plan(c: Connection,owner: String,current: OwnerTarget,catalog: IndexProfileCatalog): Preview = {
    val destination=catalog.preferred.profile
    val space=IndexProfiles.registered(c,destination)
    Check(space==catalog.preferred.embedding.id && IndexProfiles.registered(c,current.profile)==space,
      "unavailable","incompatible embedding space for profile switch")
    val selection=Json.arr(Json.fromString("owner-profile-switch-selection-v1"),Json.fromString(owner),
      Json.fromString(current.profile),Json.fromLong(current.epoch),Json.fromString(destination))
    Preview(owner,current.profile,destination,Wire.hash(selection.noSpaces))
  }
  def preview(c: Connection,owner: String,catalog: IndexProfileCatalog): Preview =
    plan(c,owner,OwnerTargets.read(c,owner,false),catalog)

  def apply(c: Connection,owner: String,request: Apply,catalog: IndexProfileCatalog): Unit = {
    // Writers and claim/publication authority take this row FOR SHARE. This is the compare-and-swap:
    // either their work precedes the switch, or it observes the new target and epoch.
    val current=Sql.one(c,"SELECT profile,epoch FROM ch_owner_targets WHERE owner=? FOR UPDATE",owner)(r => OwnerTarget(r.getString(1),r.getLong(2)))
      .getOrElse(throw DomainError("unavailable","missing owner target profile"))
    val selected=plan(c,owner,current,catalog)
    Check(current.profile!=selected.targetProfile && request.targetProfile==selected.targetProfile && request.selectionHash==selected.selectionHash,
      "conflict","profile switch selection changed or already current")
    Check(current.epoch<Long.MaxValue,"unavailable","owner target epoch overflow")
    Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=? WHERE owner=?",selected.targetProfile,current.epoch+1,owner)
    Sql.exec(c,Jobs.superseded("""UPDATE ch_jobs j SET state='Failed',error=?,failure_stage=NULL,fence=j.fence+1,lease_until=NULL
      FROM ch_sources s WHERE s.id=j.session_id AND s.owner=? AND j.profile<>? AND j.state IN('Queued','Running') RETURNING j.id"""),
      superseded,owner,selected.targetProfile)
    ()
  }
}
