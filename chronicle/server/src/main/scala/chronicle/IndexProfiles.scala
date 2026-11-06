package chronicle

import io.circe.Json
import java.sql.Connection
import java.nio.charset.StandardCharsets.UTF_8

enum IndexPolicy { case ContextAwareProblemsV1 }
enum ReadableIndexPolicy { case LegacyV4, ContiguousPassagesV1, ContextAwareProblemsV1 }
type EmbeddingSpaceDescriptor = ponygirls.retrieval.EmbeddingSpace
object EmbeddingSpaceDescriptor {
  def from(config: EmbeddingConfig): EmbeddingSpaceDescriptor =
    ponygirls.retrieval.EmbeddingSpace(config.model,config.revision,config.dimensions,config.sendDimensions,config.queryPrefix,config.documentPrefix,"cosine")
}
final case class IndexProfile(profile: String,policy: IndexPolicy,embedding: EmbeddingSpaceDescriptor,descriptor: Json)
final class IndexProfileCatalog private (val profiles: List[IndexProfile],val preferred: IndexProfile) {
  val knownProfiles: Set[String] = profiles.map(_.profile).toSet
  def resolve(profile: String): IndexProfile = profiles.find(_.profile==profile).getOrElse(throw DomainError("unavailable","retained target profile is not executable by this deployment"))
  def register(c: Connection): Unit = profiles.foreach(IndexProfiles.register(c,_))
}
object IndexProfileCatalog {
  private def annotation(config: Config): Json = {
    val a=config.annotation
    Json.arr(List(a.model,a.revision,a.requestPolicy.identity,a.maxResponseBytes.toString).map(Json.fromString)*)
  }
  def current(config: Config): IndexProfileCatalog = {
    val embedding=EmbeddingSpaceDescriptor.from(config.embedding)
    val descriptor=Json.arr(Json.fromString("index-profile-descriptor-v2"),annotation(config),Json.fromString(ProblemPassages.identity))
    val profile=contextAware(embedding,descriptor)
    new IndexProfileCatalog(List(profile),profile)
  }
  private[chronicle] def contextAware(embedding: EmbeddingSpaceDescriptor,descriptor: Json): IndexProfile =
    IndexProfile(Wire.hash(Json.arr(Json.fromString("context-aware-problems-profile-v2"),Json.fromString(embedding.id),descriptor).noSpaces),IndexPolicy.ContextAwareProblemsV1,embedding,descriptor)
}
final case class OwnerTarget(profile: String,epoch: Long)
object OwnerTargets {
  def enabled(c: Connection,owner: String,lock: Boolean): Unit = {
    val suffix=if(lock) " FOR SHARE" else ""
    Check(Sql.one(c,"SELECT 1 FROM ch_users WHERE id=? AND enabled"+suffix,owner)(_ => true).contains(true),"unauthorized","owner disabled")
  }
  def eligible(c: Connection,owner: String): Option[OwnerTarget] = {
    val active=Sql.one(c,"SELECT 1 FROM ch_users WHERE id=? AND enabled FOR SHARE",owner)(_ => true).contains(true)
    if(!active) None else {
      val target=Sql.one(c,"SELECT profile,epoch FROM ch_owner_targets WHERE owner=? FOR SHARE",owner)(r => OwnerTarget(r.getString(1),r.getLong(2)))
        .getOrElse(throw DomainError("internal","missing owner target profile"))
      IndexProfiles.registered(c,target.profile)
      Some(target)
    }
  }
  def read(c: Connection,owner: String,lock: Boolean): OwnerTarget = {
    if(lock) eligible(c,owner).getOrElse(throw DomainError("unauthorized","owner disabled")) else {
      Sql.one(c,"""SELECT t.profile,t.epoch,p.embedding_space,e.descriptor FROM ch_users u
        LEFT JOIN ch_owner_targets t ON t.owner=u.id LEFT JOIN ch_index_profiles p ON p.profile=t.profile
        LEFT JOIN ch_embedding_spaces e ON e.id=p.embedding_space WHERE u.id=? AND u.enabled""",owner) { r =>
        val profile=Option(r.getString("profile")).getOrElse(throw DomainError("internal","missing owner target profile"))
        val space=Option(r.getString("embedding_space")).getOrElse(throw DomainError("unavailable","index profile has no verified descriptor"))
        IndexProfiles.verifiedSpace(space,Sql.json(r,"descriptor"))
        OwnerTarget(profile,r.getLong("epoch"))
      }.getOrElse(throw DomainError("unauthorized","owner disabled"))
    }
  }

}
object IndexProfiles {
  def register(c: Connection,profile: IndexProfile): Unit = {
    Sql.exec(c,"INSERT INTO ch_embedding_spaces(id,descriptor) VALUES(?,?::jsonb) ON CONFLICT DO NOTHING",profile.embedding.id,profile.embedding.json.noSpaces)
    Check(Sql.one(c,"SELECT descriptor=?::jsonb FROM ch_embedding_spaces WHERE id=?",profile.embedding.json.noSpaces,profile.embedding.id)(_.getBoolean(1)).contains(true),"config","immutable embedding space descriptor mismatch")
    Sql.exec(c,"INSERT INTO ch_index_profiles(profile,embedding_space,policy,descriptor) VALUES(?,?,?,?::jsonb) ON CONFLICT DO NOTHING",profile.profile,profile.embedding.id,profile.policy.toString,profile.descriptor.noSpaces)
    Check(Sql.one(c,"SELECT embedding_space=? AND policy=? AND descriptor=?::jsonb FROM ch_index_profiles WHERE profile=?",profile.embedding.id,profile.policy.toString,profile.descriptor.noSpaces,profile.profile)(_.getBoolean(1)).contains(true),"config","immutable index profile descriptor mismatch")
  }
  private[chronicle] def verifiedSpace(id: String,json: Json): Unit = {
    try { ponygirls.retrieval.EmbeddingSpace.verified(id,json); () }
    catch { case _: ponygirls.retrieval.RetrievalError => throw DomainError("unavailable","embedding space descriptor is unverified") }
  }
  def registered(c: Connection,profile: String): String =
    Sql.one(c,"SELECT p.embedding_space,e.descriptor FROM ch_index_profiles p JOIN ch_embedding_spaces e ON e.id=p.embedding_space WHERE p.profile=? AND p.policy IN('LegacyV4','ContiguousPassagesV1','ContextAwareProblemsV1')",profile) { r =>
      val id=r.getString(1); verifiedSpace(id,Sql.json(r,"descriptor")); id
    }.getOrElse(throw DomainError("unavailable","index profile has no verified descriptor"))
  private def readSpaceSql(profileColumn: String): String = {
    val policies=ReadableIndexPolicy.values.map(value=>s"'$value'").mkString(",")
    // V1 prepends a transport hash; only the remaining complete model tuple can authorize reads.
    val sameModel="CASE WHEN jsonb_typeof(legacy.descriptor)='array' AND jsonb_typeof(canonical.descriptor)='array' AND legacy.descriptor->>0='embedding-space-v1' AND canonical.descriptor->>0='embedding-space-v2' THEN legacy.descriptor-0-0=canonical.descriptor-0 ELSE false END"
    s"SELECT canonical.id FROM ch_index_profiles compatible JOIN ch_embedding_spaces legacy ON legacy.id=compatible.embedding_space LEFT JOIN ch_retained_profile_reads approved ON approved.profile=compatible.profile AND approved.legacy_space=compatible.embedding_space AND approved.policy=compatible.policy AND approved.profile_descriptor=compatible.descriptor AND approved.legacy_descriptor=legacy.descriptor JOIN ch_embedding_spaces canonical ON canonical.id=COALESCE(approved.canonical_space,compatible.embedding_space) AND canonical.descriptor=COALESCE(approved.canonical_descriptor,legacy.descriptor) AND (approved.profile IS NULL OR ($sameModel)) AND (approved.profile IS NULL OR EXISTS(SELECT 1 FROM ch_index_profiles declared WHERE declared.profile=approved.canonical_profile AND declared.embedding_space=approved.canonical_space)) WHERE compatible.profile=$profileColumn AND compatible.policy IN($policies)"
  }
  def semantic(c: Connection,reader: String,visible: String,embedding: EmbeddingSpaceDescriptor): Unit = {
    OwnerTargets.read(c,reader,false)
    verifiedSpace(embedding.id,embedding.json)
    Check(Sql.one(c,"SELECT 1 FROM ch_embedding_spaces WHERE id=? AND descriptor=?::jsonb",embedding.id,embedding.json.noSpaces)(_=>true).contains(true),"unavailable","configured embedding space descriptor is unavailable")
    val incompatible=Sql.one(c,s"""SELECT 1 FROM ch_sources s LEFT JOIN ch_generations g ON g.id=s.published
      LEFT JOIN ch_owner_targets t ON t.owner=s.owner
      WHERE ($visible) AND (NOT ${compatibleSql("t.profile")} OR (g.id IS NOT NULL AND NOT ${compatibleSql("g.profile")})) LIMIT 1""",reader,reader,reader,embedding.id,embedding.id)(_ => true).contains(true)
    Check(!incompatible,"unavailable","visible publications or owner targets have an unknown, incompatible or unapproved embedding profile")
  }
  def compatibleSql(profileColumn: String): String = s"EXISTS(${readSpaceSql(profileColumn)} AND canonical.id=?)"
}
