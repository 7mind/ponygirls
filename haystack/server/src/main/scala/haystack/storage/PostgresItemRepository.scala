package haystack.storage

import cats.effect.IO
import haystack.domain.*
import ponygirls.runtime.JdbcDatabase
import java.sql.{Connection, PreparedStatement, ResultSet, Timestamp}
import java.time.Instant
import io.circe.Json
import io.circe.parser.parse

private[storage] object Sql {
  final case class TextArray(values:Vector[String])
  def prepared[A](c: Connection, sql: String, values: Seq[Any] = Seq.empty)(f: PreparedStatement => A): A = {
    val p = c.prepareStatement(sql)
    var arrays=Vector.empty[java.sql.Array]
    try { values.zipWithIndex.foreach { case (value, i) => value match {
      case s: String => p.setString(i + 1, s)
      case TextArray(values)=>val array=c.createArrayOf("text",values.toArray[AnyRef]);arrays=arrays:+array;p.setArray(i+1,array)
      case n: Long => p.setLong(i + 1, n)
      case n: Int => p.setInt(i + 1, n)
      case t: Instant => p.setTimestamp(i + 1, Timestamp.from(t))
      case null => p.setObject(i + 1, null)
      case other => p.setObject(i + 1, other)
    }}; f(p) } finally {arrays.foreach(_.free());p.close()}
  }
  def update(c: Connection, sql: String, values: Any*): Int = prepared(c, sql, values)(_.executeUpdate())
  def rows[A](c: Connection, sql: String, values: Seq[Any] = Seq.empty)(f: ResultSet => A): Vector[A] = prepared(c, sql, values) { p =>
    val r = p.executeQuery(); val out = Vector.newBuilder[A]
    try { while (r.next()) out += f(r); out.result() } finally r.close()
  }
  def lock(c: Connection, namespace: String, identity: Vector[String]): Unit = {
    val key = namespace + identity.map(s => s.length.toString + ":" + s).mkString
    rows(c, "SELECT pg_advisory_xact_lock(hashtextextended(?,0))", Seq(key))(_ => ())
    ()
  }
}

final class PostgresItemRepository(database: JdbcDatabase, projection: Option[haystack.retrieval.HaystackRetrieval] = None) extends ItemRepository {
  import Sql.*
  private val columns = "project_id,item_id,revision,document_text,created_at,created_by,modified_at,modified_by"
  private def stored(r: ResultSet): StoredItem = {
    val text = r.getString("document_text")
    StoredItem(ItemKey(r.getString("project_id"), r.getString("item_id")), r.getLong("revision"), DocumentCodec.decodeStored(text), text,
      ItemMetadata(r.getTimestamp("created_at").toInstant, r.getString("created_by"), r.getTimestamp("modified_at").toInstant, r.getString("modified_by")))
  }
  private def readCurrent(c: Connection, key: ItemKey): Option[StoredItem] = rows(c, s"SELECT $columns FROM items WHERE project_id=? AND item_id=?", Seq(key.project, key.item))(stored).headOption
  def current(key: ItemKey): IO[Option[StoredItem]] = database.transaction(c => readCurrent(c, key))
  def revision(key: ItemKey, revision: Long): IO[Option[StoredItem]] = database.transaction { c =>
    rows(c, """SELECT r.project_id,r.item_id,r.revision,r.document_text,i.created_at,i.created_by,r.modified_at,r.modified_by
      FROM item_revisions r JOIN items i USING(project_id,item_id) WHERE r.project_id=? AND r.item_id=? AND r.revision=?""", Seq(key.project,key.item,revision))(stored).headOption
  }
  def history(key: ItemKey): IO[Vector[RevisionMeta]] = database.transaction { c =>
    rows(c, "SELECT revision,modified_at,modified_by,token_id FROM item_revisions WHERE project_id=? AND item_id=? ORDER BY revision DESC", Seq(key.project,key.item)) { r =>
      RevisionMeta(r.getLong(1),r.getTimestamp(2).toInstant,r.getString(3),r.getString(4))
    }
  }
  override def search(input:haystack.query.SearchInput):IO[haystack.query.SearchResult]=database.transaction(c=>PostgresSearch.search(c,input))
  def allCurrent(): IO[Vector[StoredItem]] = database.transaction(c => rows(c, s"SELECT $columns FROM items")(stored))

  def initializeProjection():IO[Unit]=database.transaction { c=>
    projection.foreach { shared=>
      shared.store.initialize(c)
      val keys=rows(c,"SELECT project_id,item_id FROM items ORDER BY project_id COLLATE \"C\",item_id COLLATE \"C\"")(r=>ItemKey(r.getString(1),r.getString(2)))
      keys.foreach { key=>
        lock(c,"haystack/item/",Vector(key.project,key.item))
        readCurrent(c,key).foreach { item=>
          writeSearchProjection(c,item)
          shared.put(c,item)
        }
      }
    }
  }

  def commit(op: AcceptedOperation, principal: Principal, now: Instant): IO[CommitSuccess] = database.transaction { c =>
    // Fixed global order: replay identity first, item identity second. Both
    // locks include absent rows, so creates and invalid-document retries race
    // safely too. Hash collisions serialize harmlessly, never alias identities.
    lock(c, "haystack/replay/", Vector(principal.userId,principal.tokenId,op.requestId))
    val seen = rows(c, "SELECT digest_format,digest,outcome::text FROM write_requests WHERE principal_user=? AND token_id=? AND request_id=?::uuid", Seq(principal.userId,principal.tokenId,op.requestId)) { r => (r.getString(1),r.getString(2),r.getString(3)) }.headOption
    seen match {
      case Some((format,digest,outcome)) =>
        if (format != op.digest.format || digest != op.digest.hex) Left(Fault("replay-conflict", "request identity belongs to another operation or retired digest format"))
        else decodeOutcome(outcome).map(_.copy(replayed = true))
      case None =>
        lock(c,"haystack/item/",Vector(op.key.project,op.key.item))
        val decision = Mutation.decide(op,principal,now,readCurrent(c,op.key))
        val outcome = decision.map { item =>
          write(c,item,principal.tokenId)
          CommitSuccess(item.revision,item.metadata,false)
        }
        update(c,"INSERT INTO write_requests(principal_user,token_id,request_id,digest_format,digest,outcome,created_at) VALUES(?,?,?::uuid,?,?,?::jsonb,?)",principal.userId,principal.tokenId,op.requestId,op.digest.format,op.digest.hex,encodeOutcome(outcome),now)
        outcome
    }
  }.flatMap(IO.fromEither)

  private def write(c: Connection, item: StoredItem, token: String): Unit = {
    val k=item.key; val m=item.metadata
    update(c,"""INSERT INTO items(project_id,item_id,revision,document,document_text,created_at,created_by,modified_at,modified_by)
      VALUES(?,?,?,?::jsonb,?,?,?,?,?) ON CONFLICT(project_id,item_id) DO UPDATE SET revision=EXCLUDED.revision,document=EXCLUDED.document,document_text=EXCLUDED.document_text,modified_at=EXCLUDED.modified_at,modified_by=EXCLUDED.modified_by""",
      k.project,k.item,item.revision,item.documentCanonical,item.documentCanonical,m.createdAt,m.createdBy,m.modifiedAt,m.modifiedBy)
    update(c,"INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id) VALUES(?,?,?,?::jsonb,?,?,?,?)",k.project,k.item,item.revision,item.documentCanonical,item.documentCanonical,m.modifiedAt,m.modifiedBy,token)
    update(c,"DELETE FROM item_links WHERE source_project_id=? AND source_item_id=?",k.project,k.item)
    item.document.links.zipWithIndex.foreach { case ((kind,target),position) =>
      val dest=QualifiedId.decodeKey(target)
      update(c,"INSERT INTO item_links(source_project_id,source_item_id,position,link_type,target_project_id,target_item_id) VALUES(?,?,?,?,?,?)",k.project,k.item,position,kind,dest.project,dest.item)
    }
    writeSearchProjection(c,item)
    projection.foreach(_.put(c,item))
  }
  private def writeSearchProjection(c:Connection,item:StoredItem):Unit={
    val k=item.key
    val segments = haystack.query.Text.corpusSegments(item.document)
    val words = segments.flatMap(haystack.query.Text.words).distinct
    prepared(c,"INSERT INTO item_search(project_id,item_id,words,segments) VALUES(?,?,?,?) ON CONFLICT(project_id,item_id) DO UPDATE SET words=EXCLUDED.words,segments=EXCLUDED.segments") { p =>
      p.setString(1,k.project); p.setString(2,k.item)
      val a=c.createArrayOf("text",words.toArray[AnyRef]); val b=c.createArrayOf("text",segments.toArray[AnyRef])
      try { p.setArray(3,a); p.setArray(4,b); p.executeUpdate(); () } finally { a.free(); b.free() }
    }
  }
  private def encodeOutcome(result: Either[Fault,CommitSuccess]): String = result.fold(
    e => Json.obj("kind"->Json.fromString(e.code),"message"->Json.fromString(e.message),"currentRevision"->e.currentRevision.fold(Json.Null)(Json.fromLong)),
    s => Json.obj("kind"->Json.fromString("committed"),"revision"->Json.fromLong(s.revision),"createdAt"->Json.fromString(s.metadata.createdAt.toString),"createdBy"->Json.fromString(s.metadata.createdBy),"modifiedAt"->Json.fromString(s.metadata.modifiedAt.toString),"modifiedBy"->Json.fromString(s.metadata.modifiedBy))
  ).noSpaces
  private def decodeOutcome(text: String): Either[Fault,CommitSuccess] = {
    val cursor = parse(text).fold(_ => throw Fault("unavailable","invalid stored replay"),identity).hcursor
    def str(name:String)=cursor.get[String](name).fold(_=>throw Fault("unavailable","invalid stored replay"),identity)
    val kind=str("kind")
    if(kind!="committed") Left(Fault(kind,cursor.get[String]("message").getOrElse("recorded terminal outcome"),cursor.get[Option[Long]]("currentRevision").getOrElse(None)))
    else Right(CommitSuccess(cursor.get[Long]("revision").fold(_=>throw Fault("unavailable","invalid stored replay"),identity),ItemMetadata(Instant.parse(str("createdAt")),str("createdBy"),Instant.parse(str("modifiedAt")),str("modifiedBy")),true))
  }
}
