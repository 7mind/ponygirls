package haystack.storage

import cats.effect.IO
import haystack.domain.{Fault,QualifiedId}
import ponygirls.runtime.JdbcDatabase
import java.nio.charset.StandardCharsets

object Migrations {
  private val versions = Vector("0001-initial", "0002-search", "0003-tags", "0004-scala-current", "0005-exact-numeric-query")
  def initialize(database: JdbcDatabase, activityProjectId: String): IO[Unit] = database.transaction { c =>
    QualifiedId.encodeComponent(activityProjectId)
    Sql.lock(c,"haystack/migrate/",Vector("schema"))
    val exists = Sql.rows(c,"SELECT to_regclass('schema_migrations') IS NOT NULL")(_.getBoolean(1)).head
    val applied = if (exists) Sql.rows(c,"SELECT version FROM schema_migrations")(_.getString(1)).toSet else Set.empty[String]
    if (!applied.subsetOf(versions.toSet)) throw Fault("config","unknown database migration")
    versions.filterNot(applied).foreach { version =>
      val resource = Option(getClass.getResourceAsStream("/" + version + ".sql")).getOrElse(throw Fault("config","missing migration resource"))
      val sql = try new String(resource.readAllBytes(),StandardCharsets.UTF_8) finally resource.close()
      val statement=c.createStatement()
      try statement.execute(sql) finally statement.close()
      Sql.update(c,"INSERT INTO schema_migrations(version) VALUES(?)",version)
    }
    val stored = Sql.rows(c,"SELECT activity_project_id FROM store_metadata WHERE id=1")(_.getString(1)).headOption
    stored match {
      case None => Sql.update(c,"INSERT INTO store_metadata(id,activity_project_id) VALUES(1,?)",activityProjectId)
      case Some(value) if value != activityProjectId => throw Fault("config","activity namespace mismatch")
      case _ => ()
    }
    ()
  }
}
