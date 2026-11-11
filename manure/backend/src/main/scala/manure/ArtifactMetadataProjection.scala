package manure

import java.sql.Connection
import ponygirls.runtime.Migration
import scala.util.Using

object ArtifactMetadataProjection:
  lazy val migration: Migration =
    val input = getClass.getResourceAsStream("/005_artifact_metadata.sql")
    Require(input != null,"unavailable")
    val sql = Using.resource(scala.io.Source.fromInputStream(input,"UTF-8"))(_.mkString)
    Migration(5,"artifact-metadata-byte-exact-v1",sql)
  def backfill(c: Connection,a: Artifact): Unit =
    Jdbc.exec(c,"UPDATE manure.artifacts SET hostname_match=?,project_path_match=? WHERE id=?",
      Jdbc.bytes(a.hostname.map(Exact.matching)),Jdbc.bytes(a.projectPath.map(Exact.matching)),Exact.utf8(a.id))
    Jdbc.exec(c,"DELETE FROM manure.artifact_tags WHERE artifact_id=?",Exact.utf8(a.id))
    a.tags.foreach { tag => Jdbc.exec(c,"INSERT INTO manure.artifact_tags(artifact_id,tag,tag_match) VALUES(?,?,?)",Exact.utf8(a.id),Exact.utf8(tag),Exact.utf8(Exact.matching(tag))) }
