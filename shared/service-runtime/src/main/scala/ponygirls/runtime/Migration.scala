package ponygirls.runtime

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.sql.Connection
import scala.util.Using

final case class Migration(version: Int, name: String, sql: String) {
  def checksum: String = MessageDigest.getInstance("SHA-256").digest(sql.getBytes(StandardCharsets.UTF_8)).map(b => f"${b & 0xff}%02x").mkString
}
object Migration {
  def validate(namespace: String, migrations: List[Migration]): Unit = {
    require(namespace.matches("[a-z][a-z0-9_.-]{0,95}"), "invalid migration namespace")
    require(migrations.map(_.version) == migrations.map(_.version).distinct.sorted && migrations.forall(_.version > 0), "migration versions must be positive and strictly ordered")
    require(migrations.forall(m => m.name.matches("[a-zA-Z0-9_.-]{1,128}") && m.sql.nonEmpty), "invalid migration")
  }

  private[runtime] def applyAll(c: Connection, namespace: String, migrations: List[Migration]): Unit = {
    // Per-database lock guards first ledger creation and serializes all migration namespaces.
    // Different DBs have independent PostgreSQL advisory-lock spaces and independent ledgers.
    Using.resource(c.prepareStatement("SELECT pg_advisory_xact_lock(71393722)"))(_.execute())
    Using.resource(c.createStatement())(_.execute("""CREATE TABLE IF NOT EXISTS ponygirls_runtime_migrations (
      namespace text NOT NULL, version integer NOT NULL, name text NOT NULL,
      checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(namespace,version))"""))
    val existing = Using.resource(c.prepareStatement("SELECT version,name,checksum FROM ponygirls_runtime_migrations WHERE namespace=? ORDER BY version")) { p =>
      p.setString(1, namespace)
      Using.resource(p.executeQuery()) { r =>
        val out = List.newBuilder[(Int, String, String)]
        while (r.next()) out += ((r.getInt(1), r.getString(2), r.getString(3)))
        out.result()
      }
    }
    val expected = migrations.map(m => (m.version, m.name, m.checksum))
    if (existing != expected.take(existing.size)) throw RuntimeFailure("migration-history-mismatch")
    migrations.drop(existing.size).foreach { migration =>
      Using.resource(c.createStatement())(_.execute(migration.sql))
      Using.resource(c.prepareStatement("INSERT INTO ponygirls_runtime_migrations(namespace,version,name,checksum) VALUES(?,?,?,?)")) { p =>
        p.setString(1, namespace); p.setInt(2, migration.version); p.setString(3, migration.name); p.setString(4, migration.checksum)
        p.executeUpdate()
      }
    }
  }
}
