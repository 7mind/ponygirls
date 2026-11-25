package ponygirls.auth

import java.sql.Connection
import java.nio.charset.StandardCharsets.UTF_8

/** Service accounts are separate even when two services use the same database. */
enum IndexingService(private[auth] val key: String) {
  case Manure extends IndexingService("manure")
  case Haystack extends IndexingService("haystack")
  case Chronicle extends IndexingService("chronicle")
}

final case class IndexingPreference(choice: IndexingChoice, overrideChoice: IndexingChoice, epoch: Long) {
  def enabled(policy: IndexingPolicy): Boolean = policy.enabled(choice, overrideChoice)
}
object IndexingPreference {
  val inherited: IndexingPreference = IndexingPreference(IndexingChoice.Inherit, IndexingChoice.Inherit, 0)
}

/** Connection-scoped: lock the preference before any read that will authorize a change based on it. */
trait IndexingPreferences {
  def lock(owner: String): Unit
  def get(owner: String): IndexingPreference
  def setChoice(owner: String, choice: IndexingChoice): IndexingPreference
  def setOverride(owner: String, overrideChoice: IndexingChoice): IndexingPreference
}

object IndexingPreferenceSql {
  import ImperativeStatements.{query, text, update}

  private val table = "ponygirls_indexing_preferences"
  private val schemaLock = 71393724
  private val ownerLockSeed = 71393725L

  private def requireTransaction(c: Connection): Unit = if (c.getAutoCommit) throw AccountFailure("config")

  def initialize(c: Connection): Unit = {
    requireTransaction(c)
    update(c, "SELECT pg_advisory_xact_lock(?)", SqlValue.Integer(schemaLock))
    update(c, s"""CREATE TABLE IF NOT EXISTS $table(
      service text NOT NULL, owner_key text NOT NULL CHECK(owner_key ~ '^[0-9a-f]{64}$$'),
      user_choice boolean, admin_override boolean, epoch bigint NOT NULL CHECK(epoch>=0),
      PRIMARY KEY (service,owner_key))""")
    ()
  }

  /** A bounded key for byte-exact account IDs, including Manure IDs which are not PostgreSQL text. */
  def ownerKey(owner: String): String = {
    if (!UTF_8.newEncoder().canEncode(owner)) throw AccountFailure("invalid")
    Secrets.digest(owner)
  }

  /** Hash of a trusted SQL expression of type text (not a value supplied by a request). */
  def ownerKeySql(ownerSql: String): String = s"encode(sha256(convert_to(($ownerSql),'UTF8')),'hex')"

  /** Predicate on a nonempty text[] of owner keys. A source without attributed owners is not eligible.
    * SQL fragments must be trusted; booleans and the service namespace are not user-controlled text.
    */
  def allowsAllSql(service: IndexingService, defaultEnabled: Boolean, ownerKeysSql: String): String =
    s"""(cardinality(($ownerKeysSql))>0 AND NOT EXISTS(
      SELECT 1 FROM unnest(($ownerKeysSql)) AS indexing_owner(owner_key)
      LEFT JOIN $table AS indexing_pref ON indexing_pref.service='${service.key}' AND indexing_pref.owner_key=indexing_owner.owner_key
      WHERE indexing_owner.owner_key IS NULL OR NOT COALESCE(indexing_pref.admin_override,indexing_pref.user_choice,$defaultEnabled)))"""

  /** Fence over a fixed set of owners: their epochs only advance, including when clearing overrides. */
  def epochSql(service: IndexingService, ownerKeysSql: String): String =
    s"""COALESCE((SELECT sum(indexing_pref.epoch) FROM $table AS indexing_pref
      WHERE indexing_pref.service='${service.key}' AND indexing_pref.owner_key=ANY(($ownerKeysSql))),0)::bigint"""

  private def lockKey(c: Connection, service: IndexingService, key: String, shared: Boolean): Unit = {
    val function = if (shared) "pg_advisory_xact_lock_shared" else "pg_advisory_xact_lock"
    update(c, s"SELECT $function(hashtextextended(?,?))", text(s"${service.key}:$key"), SqlValue.BigInt(ownerLockSeed))
    ()
  }

  /** Serialize a fresh eligibility check, and any associated JDBC effects, with preference changes.
    * Take any source locks before this or after it consistently within the service. Never hold across a model call.
    */
  def lockRead(c: Connection, service: IndexingService, ownerKeys: Iterable[String]): Unit = {
    requireTransaction(c)
    ownerKeys.iterator.toVector.distinct.sorted.foreach(key => lockKey(c, service, key, shared = true))
  }

  def store(c: Connection, service: IndexingService, policy: IndexingPolicy): IndexingPreferences = new IndexingPreferences {
    private def read(key: String): IndexingPreference =
      query(c, s"SELECT user_choice,admin_override,epoch FROM $table WHERE service=? AND owner_key=?", text(service.key), text(key)) { r =>
        def choice(column: Int): IndexingChoice = r.getObject(column, classOf[java.lang.Boolean]) match {
          case null => IndexingChoice.Inherit
          case value if value.booleanValue() => IndexingChoice.Enable
          case _ => IndexingChoice.Disable
        }
        IndexingPreference(choice(1), choice(2), r.getLong(3))
      }.headOption.getOrElse(IndexingPreference.inherited)

    def lock(owner: String): Unit = {
      requireTransaction(c)
      lockKey(c, service, ownerKey(owner), shared = false)
    }
    def get(owner: String): IndexingPreference = read(ownerKey(owner))

    def setChoice(owner: String, choice: IndexingChoice): IndexingPreference = change(owner, _.copy(choice = choice))
    def setOverride(owner: String, overrideChoice: IndexingChoice): IndexingPreference = change(owner, _.copy(overrideChoice = overrideChoice))

    private def change(owner: String, select: IndexingPreference => IndexingPreference): IndexingPreference = {
      val key = ownerKey(owner)
      lock(owner)
      val before = read(key)
      val requested = select(before)
      if (before == requested) before
      else {
        val next = requested.copy(epoch = if (before.enabled(policy) == requested.enabled(policy)) before.epoch else Math.incrementExact(before.epoch))
        def flag(value: IndexingChoice): SqlValue = value.setting.fold[SqlValue](SqlValue.NullFlag)(SqlValue.Flag(_))
        update(c, s"""INSERT INTO $table(service,owner_key,user_choice,admin_override,epoch) VALUES(?,?,?,?,?)
          ON CONFLICT (service,owner_key) DO UPDATE SET user_choice=excluded.user_choice,admin_override=excluded.admin_override,epoch=excluded.epoch""",
          text(service.key), text(key), flag(next.choice), flag(next.overrideChoice), SqlValue.BigInt(next.epoch))
        next
      }
    }
  }
}
