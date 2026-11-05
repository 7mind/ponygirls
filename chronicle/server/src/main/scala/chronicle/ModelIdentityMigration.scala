package chronicle

import io.circe.Json
import java.sql.Connection
import java.nio.file.{Files,Path}
import ponygirls.retrieval.{EmbeddingSpace,RetrievalError}

private[chronicle] final case class ModelIdentityPlan(legacyProfiles: Set[String],canonicalProfile: String)
private[chronicle] object ModelIdentityPlan {
  def load(path: String): ModelIdentityPlan = {
    val file=Path.of(path)
    Check(Files.isRegularFile(file) && Files.size(file)<=32768,"invalid","invalid model identity plan file")
    val raw=Files.readString(file)
    Check(raw.length<=32768,"invalid","model identity plan exceeds limit")
    val json=io.circe.parser.parse(raw).fold(_=>throw DomainError("invalid","invalid model identity plan JSON"),identity)
    Check(json.asObject.exists(_.keys.toSet==Set("version","legacyProfiles","canonicalProfile")),"invalid","invalid model identity plan fields")
    val cursor=json.hcursor
    Check(cursor.get[String]("version").contains("model-identity-migration-v1"),"invalid","unsupported model identity plan")
    val ids=cursor.get[Vector[String]]("legacyProfiles").fold(_=>throw DomainError("invalid","legacy profile IDs required"),identity)
    Check(ids.nonEmpty && ids.size<=128 && ids.distinct.size==ids.size && ids.forall(_.matches("[0-9a-f]{64}")),"invalid","invalid legacy profile IDs")
    val canonical=cursor.get[String]("canonicalProfile").fold(_=>throw DomainError("invalid","canonical profile ID required"),identity)
    Check(canonical.matches("[0-9a-f]{64}"),"invalid","invalid canonical profile ID")
    ModelIdentityPlan(ids.toSet,canonical)
  }
}

/** Explicit identity migration: model equivalence requires independent operator verification. */
private[chronicle] object ModelIdentityMigration {
  private val references=List(
    "ch_profile"->"active","ch_profile"->"target","ch_owner_targets"->"profile",
    "ch_jobs"->"profile","ch_generations"->"profile","ch_search_chunks"->"profile",
    "ch_reindex_requests"->"target_profile",
  )
  private def verified(id: String,json: Json): EmbeddingSpace =
    try EmbeddingSpace.verified(id,json)
    catch { case _: RetrievalError => throw DomainError("unavailable","model identity migration requires a verified descriptor") }
  private def descriptor(json: Json): Json = {
    val fields=json.asArray.getOrElse(Vector.empty)
    Check(fields.size==3 && fields.head.asString.contains("index-profile-descriptor-v1") && fields(2).asString.exists(_.nonEmpty),"unavailable","unsupported legacy annotation descriptor")
    val annotation=fields(1).asArray.getOrElse(Vector.empty)
    Check(annotation.size==5 && annotation.forall(_.asString.exists(_.nonEmpty)) &&
      annotation.head.asString.exists(_.matches("[0-9a-f]{64}")),"unavailable","unverified legacy annotation model identity")
    Json.arr(Json.fromString("index-profile-descriptor-v2"),Json.arr(annotation.tail*),fields(2))
  }
  def apply(c: Connection,catalog: IndexProfileCatalog,plan: ModelIdentityPlan): Unit = {
    Check(!c.getAutoCommit,"config","model identity migration requires a transaction")
    Check(plan.legacyProfiles.nonEmpty && plan.legacyProfiles.size<=128 && plan.legacyProfiles.forall(_.matches("[0-9a-f]{64}")),"invalid","explicit legacy profile approval required")
    Check(plan.canonicalProfile==catalog.preferred.profile,"conflict","plan does not match configured immutable model and semantic policy")
    Sql.lock(c,"model-identity-migration-v1")
    Sql.exec(c,"LOCK TABLE ch_jobs,ch_owner_targets IN SHARE ROW EXCLUSIVE MODE")
    plan.legacyProfiles.toList.sorted.foreach { legacyProfile =>
      val (legacySpace,policy,legacyDescriptor,spaceJson)=Sql.one(c,"SELECT p.embedding_space,p.policy,p.descriptor,s.descriptor AS space_descriptor FROM ch_index_profiles p JOIN ch_embedding_spaces s ON s.id=p.embedding_space WHERE p.profile=?",legacyProfile)(r=>(r.getString(1),r.getString(2),Sql.json(r,"descriptor"),Sql.json(r,"space_descriptor"))).getOrElse(throw DomainError("unavailable","approved legacy profile is absent"))
      Check(spaceJson.asArray.flatMap(_.headOption).flatMap(_.asString).contains("embedding-space-v1"),"unavailable","approved profile is not a legacy model identity")
      Check(policy==IndexPolicy.ContextAwareProblemsV1.toString,"unavailable","unsupported legacy indexing policy")
      val canonical=verified(legacySpace,spaceJson)
      val expected=Wire.hash(Json.arr(Json.fromString("context-aware-problems-profile-v1"),Json.fromString(legacySpace),legacyDescriptor).noSpaces)
      Check(expected==legacyProfile,"unavailable","legacy model profile identity does not match its descriptor")
      val canonicalProfile=IndexProfileCatalog.contextAware(canonical,descriptor(legacyDescriptor))
      Check(canonicalProfile.profile==plan.canonicalProfile && canonicalProfile==catalog.preferred,"unavailable","legacy model, revision or semantic policy is incompatible with the verified target")
      Check(!Sql.one(c,"SELECT 1 FROM ch_jobs WHERE profile=? AND state='Running' AND lease_until>clock_timestamp() LIMIT 1",legacyProfile)(_=>true).contains(true),"conflict","stop legacy model workers and wait for their leases before identity migration")
      IndexProfiles.register(c,canonicalProfile)
      Sql.exec(c,"INSERT INTO ch_model_identity_migrations VALUES(?,?,?,?) ON CONFLICT DO NOTHING",legacyProfile,canonicalProfile.profile,legacySpace,canonical.id)
      Check(Sql.one(c,"SELECT canonical_profile=? AND legacy_space=? AND canonical_space=? FROM ch_model_identity_migrations WHERE legacy_profile=?",canonicalProfile.profile,legacySpace,canonical.id,legacyProfile)(_.getBoolean(1)).contains(true),"internal","immutable model migration mapping mismatch")
      // Accepted hashes keep their original namespace for this run, never for a later rebuild.
      Sql.exec(c,"INSERT INTO ch_checkpoint_namespaces SELECT id,run_id,?,? FROM ch_jobs WHERE profile=? ON CONFLICT DO NOTHING",legacyProfile,legacySpace,legacyProfile)
      Check(!Sql.one(c,"SELECT 1 FROM ch_jobs j JOIN ch_checkpoint_namespaces n ON n.job_id=j.id AND n.run_id=j.run_id WHERE j.profile=? AND (n.profile<>? OR n.embedding_space<>?) LIMIT 1",legacyProfile,legacyProfile,legacySpace)(_=>true).contains(true),"internal","checkpoint namespace collision")
      references.foreach { (table,column) => Sql.exec(c,s"UPDATE $table SET $column=? WHERE $column=?",canonicalProfile.profile,legacyProfile) }
    }
  }
}
