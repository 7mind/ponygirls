package chronicle

import java.sql.Connection
import ponygirls.auth.{IndexingPreferenceSql,IndexingService}

/** Index eligibility is a property of the source owner, separate from the archive's ACL. */
private[chronicle] object ChronicleIndexing {
  private val service = IndexingService.Chronicle
  private def ownerKeysSql(ownerSql: String): String = s"ARRAY[${IndexingPreferenceSql.ownerKeySql(ownerSql)}]"
  def allowsOwnerSql(defaultEnabled: Boolean,ownerSql: String): String =
    IndexingPreferenceSql.allowsAllSql(service,defaultEnabled,ownerKeysSql(ownerSql))
  def epochOwnerSql(ownerSql: String): String = IndexingPreferenceSql.epochSql(service,ownerKeysSql(ownerSql))

  final case class Eligibility(enabled: Boolean,epoch: Long) {
    def admits(claim: Claim): Boolean = enabled && epoch==claim.indexingEpoch
  }
  def read(c: Connection,defaultEnabled: Boolean,owner: String): Eligibility =
    Sql.one(c,s"SELECT ${allowsOwnerSql(defaultEnabled,"s.owner")},${epochOwnerSql("s.owner")} FROM (SELECT ?::text AS owner) s",owner) { r =>
      Eligibility(r.getBoolean(1),r.getLong(2))
    }.get
  def allows(c: Connection,defaultEnabled: Boolean,owner: String): Boolean = read(c,defaultEnabled,owner).enabled
  /** Serialize claim and job effects with the account preference write, even when the preference row doesn't exist. */
  def locked(c: Connection,defaultEnabled: Boolean,owner: String): Eligibility = {
    IndexingPreferenceSql.lockRead(c,service,List(IndexingPreferenceSql.ownerKey(owner)))
    read(c,defaultEnabled,owner)
  }
  def requireEnabled(eligibility: Eligibility): Long = {
    Check(eligibility.enabled,"forbidden","indexing is disabled for this account")
    eligibility.epoch
  }
}
