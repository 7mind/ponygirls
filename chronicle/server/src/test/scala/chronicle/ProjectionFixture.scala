package chronicle
import java.sql.Connection

/** Seeds the archive projection of many identical revisions without one backfill transaction per four of them.
  * A template revision is projected by the production [[ArchiveProjection.backfill]]; its rows are then copied
  * to every revision that has an identical snapshot (up to the session id).
  */
object ProjectionFixture {
  /** `pairs` selects (template uuid, sid uuid): the projected template revision 1 and the revision-1 session that copies it. */
  def copy(c: Connection,pairs: String): Unit = {
    Sql.exec(c,s"INSERT INTO ch_revision_info(session_id,revision,metadata,source,completion,redacted,last_timestamp,last_timestamp_order,message_count,lexical_version) SELECT p.sid,i.revision,i.metadata,i.source,i.completion,i.redacted,i.last_timestamp,i.last_timestamp_order,i.message_count,i.lexical_version FROM ($pairs) p(template,sid) JOIN ch_revision_info i ON i.session_id=p.template AND i.revision=1")
    Sql.exec(c,s"INSERT INTO ch_messages(session_id,revision,position,message_id,value) SELECT p.sid,m.revision,m.position,m.message_id,m.value FROM ($pairs) p(template,sid) JOIN ch_messages m ON m.session_id=p.template AND m.revision=1")
    Sql.exec(c,s"INSERT INTO ch_archive_fragments(session_id,revision,ordinal,value) SELECT p.sid,f.revision,f.ordinal,f.value FROM ($pairs) p(template,sid) JOIN ch_archive_fragments f ON f.session_id=p.template AND f.revision=1")
  }
}
