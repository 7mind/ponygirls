package haystack.storage

import cats.effect.IO
import haystack.domain.{Fault,ItemKey,QualifiedId}
import java.sql.{Connection,PreparedStatement}
import java.util.Locale
import ponygirls.runtime.JdbcDatabase
import java.nio.charset.StandardCharsets

object Migrations {
  private val versions = Vector("0001-initial", "0002-search", "0003-tags", "0004-scala-current", "0005-exact-numeric-query", "0006-tag-completion")
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
      if(version=="0006-tag-completion") TagValuesProjection.backfill(c)
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

/** Derived current-tag projection only. Both forward backfill and regular
  * writes use the caller's transaction, and exactly the pure completion fold.
  */
private[storage] object TagValuesProjection {
  private val insert = "INSERT INTO item_tag_values(project_id,item_id,position,tag,tag_folded) VALUES(?,?,?,?,?)"
  private def bind(p:PreparedStatement,key:ItemKey,position:Int,tag:String):Unit={
    p.setString(1,key.project);p.setString(2,key.item);p.setInt(3,position)
    p.setString(4,tag);p.setString(5,tag.toLowerCase(Locale.ROOT))
  }
  def replace(c:Connection,key:ItemKey,tags:Vector[String]):Unit={
    Sql.update(c,"DELETE FROM item_tag_values WHERE project_id=? AND item_id=?",key.project,key.item)
    if(tags.nonEmpty) Sql.prepared(c,insert) { p=>
      tags.zipWithIndex.foreach { case(tag,position)=>bind(p,key,position,tag);p.addBatch() }
      p.executeBatch();()
    }
  }
  def backfill(c:Connection):Unit=Sql.prepared(c,insert) { insertStatement=>
    // Stream only the existing JSONB tag strings: arbitrary document fields and
    // historical text are neither materialized nor serialized again.
    Sql.prepared(c,"""SELECT project_id,item_id,(ordinality-1)::integer,tag
      FROM items CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(document->'tags','[]'::jsonb))
      WITH ORDINALITY AS tags(tag,ordinality)""") { select=>
      select.setFetchSize(128)
      val rows=select.executeQuery()
      var pending=0
      try {
        while(rows.next()) {
          bind(insertStatement,ItemKey(rows.getString(1),rows.getString(2)),rows.getInt(3),rows.getString(4))
          insertStatement.addBatch();pending+=1
          if(pending==128){insertStatement.executeBatch();pending=0}
        }
        if(pending>0)insertStatement.executeBatch()
      } finally rows.close()
      ()
    }
  }
}
