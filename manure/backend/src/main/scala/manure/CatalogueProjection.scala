package manure

import java.sql.Connection
import ponygirls.runtime.Migration
import scala.util.Using

/** App-computed full Unicode16 casefold UTF8 bytea, never PG text/lower.
  * Original authoritative strings/binary64 bytes remain untouched. Startup
  * backfill recomputes this derived value for every source before serving.
  * Migration3's historical name/SQL/checksum MUST remain immutable; the fold
  * correction changes derived values and current cursor policy, not its DDL.
  */
object CatalogueProjection:
  lazy val migration: Migration =
    val input = getClass.getResourceAsStream("/003_catalogue.sql")
    Require(input != null, "unavailable")
    val sql = Using.resource(scala.io.Source.fromInputStream(input,"UTF-8"))(_.mkString)
    Migration(3,"catalogue-utf8-lower-root-v1",sql)
  def initialize(c: Connection): Unit = Using.resource(c.createStatement()) { s => s.execute(migration.sql); () }
  def backfill(c: Connection,a: Artifact): Unit =
    Jdbc.exec(c,"UPDATE manure.artifacts SET name_match=? WHERE id=?",Exact.utf8(Exact.matching(a.name)),Exact.utf8(a.id))
