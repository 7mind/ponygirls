package manure

import cats.effect.IO
import java.sql.{Connection, PreparedStatement, ResultSet, Types}
import scala.util.Using
import manure.storage.RootLease

/** Caller-owned transaction, including projection/outbox work. No IO effects may
  * escape the callback; production callbacks run blocking under a validated root
  * lease. Lock order: root lease -> process exclusion -> quota advisory -> artifact
  * rows -> receipts/grants. Every mutator takes the same quota lock first, so a
  * quota SUM or session count cannot race with admission/deletion/publication.
  */
trait Metadata:
  def transaction[A](body: MetadataTxn => A): IO[A]
trait MetadataTxn:
  def artifact(id: String): Option[Artifact]
  def artifacts(after: Option[String], limit: Int): Vector[Artifact]
  def catalogue(selection: CataloguePolicy.Selection): Vector[Artifact]
  def put(artifact: Artifact): Unit
  def delete(id: String): Unit
  def reservation: Long
  def sessions(user: Option[String]): Long
  def receipts(id: String, path: String): Vector[Receipt]
  def putReceipt(receipt: Receipt): Unit
  def deleteReceipt(id: String, path: String, offset: Long): Unit
  def clearReceipts(id: String): Unit
  def oneTime(hash: String): Option[OneTimeGrant]
  def putOneTime(grant: OneTimeGrant): Unit
  def content(hash: String): Option[ContentGrant]
  def putContent(grant: ContentGrant): Unit
  def deleteContent(hash: String): Unit
  def trimContent(id: String, max: Int, newestHash: String): Unit
  def revokeArtifact(id: String): Unit
  def revokeCredential(user: String, token: String): Unit
  def sweepGrants(now: Double): Unit

trait JdbcTransactions:
  def transaction[A](body: Connection => A): IO[A]

final class PostgresMetadata(database: JdbcTransactions, root: RootLease, projection: SearchProjection) extends Metadata:
  override def transaction[A](body: MetadataTxn => A): IO[A] = database.transaction { connection =>
    root.run {
      // Fixed namespace, never derived from user data; transaction-scoped lock.
      Jdbc.exec(connection, "SELECT pg_advisory_xact_lock(714159263)")
      body(new PostgresTxn(connection,projection))
    }
  }

private[manure] object Jdbc:
  type Param = String | Array[Byte] | Long | Int | Double | Boolean | Null
  def bind(p: PreparedStatement, args: Seq[Param]): Unit = args.zipWithIndex.foreach { (arg, index) =>
    val n = index + 1
    arg match
      case null => p.setNull(n, Types.NULL)
      case b: Array[Byte] => p.setBytes(n, b)
      case s: String => p.setString(n, s)
      case v: Long => p.setLong(n, v)
      case v: Int => p.setInt(n, v)
      case v: Double => p.setDouble(n, v)
      case v: Boolean => p.setBoolean(n, v)
  }
  def exec(c: Connection, sql: String, args: Param*): Unit = Using.resource(c.prepareStatement(sql)) { p =>
    bind(p, args)
    if sql.startsWith("SELECT") then Using.resource(p.executeQuery())(_ => ()) else { p.executeUpdate(); () }
  }
  def rows[A](c: Connection, sql: String, args: Param*)(read: ResultSet => A): Vector[A] =
    Using.resource(c.prepareStatement(sql)) { p =>
      bind(p, args)
      Using.resource(p.executeQuery()) { r =>
        val out = Vector.newBuilder[A]; while r.next() do out += read(r); out.result()
      }
    }
  def text(r: ResultSet, column: String): String = Exact.string(r.getBytes(column))
  def optional(r: ResultSet, column: String): Option[String] = Option(r.getBytes(column)).map(Exact.string)
  def time(r: ResultSet, column: String): Double = Exact.timestamp(r.getBytes(column))
  def optionalTime(r: ResultSet, column: String): Option[Double] = Option(r.getBytes(column)).map(Exact.timestamp)
  def bytes(value: Option[String]): Array[Byte] | Null = value.map(Exact.utf8).orNull
  def bits(value: Option[Double]): Array[Byte] | Null = value.map(Exact.timestamp).orNull
  def double(value: Option[Double]): Double | Null = value match
    case Some(v) => v
    case None => null

/** SQL structure comes only from the generated sort enum and fixed clauses.
  * User strings, cursor positions, timestamp and LIMIT are always bound values.
  */
private[manure] object CatalogueSql:
  def page(s: CataloguePolicy.Selection): (String,Vector[Jdbc.Param]) =
    import CataloguePolicy.Value
    val q = s.query
    val column = q.sort match
      case api.CatalogueSort.Name => "a.name"
      case api.CatalogueSort.CreatedAt => "a.created_at_s_value"
      case api.CatalogueSort.ExpiresAt => "a.expires_at_s_value"
      case api.CatalogueSort.TotalBytes => "COALESCE(a.total_bytes,0)"
      case api.CatalogueSort.FileCount => "COALESCE(a.file_count,0)"
      case api.CatalogueSort.Visibility => "a.visibility"
      case api.CatalogueSort.State => "a.state"
      case api.CatalogueSort.Kind => "a.kind"
      case api.CatalogueSort.CreatedByUser => "a.created_by_user"
    val direction = if q.direction == api.SortDirection.Asc then "ASC" else "DESC"
    val operator = if q.direction == api.SortDirection.Asc then ">" else "<"
    var clauses = Vector.empty[String]
    var params = Vector.empty[Jdbc.Param]
    if !q.includeExpired then
      clauses :+= "(a.expires_at_s_value IS NULL OR a.expires_at_s_value>?)"
      params :+= s.now
    q.visibility.foreach { v => clauses :+= "a.visibility=?"; params :+= Exact.utf8(v.toString.toLowerCase(java.util.Locale.ROOT)) }
    q.state.foreach { v => clauses :+= "a.state=?"; params :+= Exact.utf8(v.toString.toLowerCase(java.util.Locale.ROOT)) }
    if q.query.nonEmpty then
      clauses :+= "(position(?::bytea in a.name_match)>0 OR position(?::bytea in a.id)>0)"
      params ++= Vector(Exact.utf8(s.matching),Exact.utf8(s.matching))
    s.boundary.foreach { b =>
      b.value match
        case Value.Never =>
          Require(q.sort == api.CatalogueSort.ExpiresAt,"bad-envelope")
          clauses :+= s"($column IS NULL AND a.id $operator ?)"
          params :+= Exact.utf8(b.id)
        case value =>
          val bound: Jdbc.Param = value match
            case Value.Text(v) => Exact.utf8(v)
            case Value.Time(v) => v
            case Value.Count(v) => v
            case Value.Never => throw DomainError("bad-envelope")
          val comparison = s"($column $operator ? OR ($column=? AND a.id $operator ?))"
          clauses :+= (if q.sort == api.CatalogueSort.ExpiresAt then s"($column IS NULL OR $comparison)" else comparison)
          params ++= Vector(bound,bound,Exact.utf8(b.id))
    }
    val where = if clauses.isEmpty then "" else clauses.mkString(" WHERE "," AND ","")
    // Materialize only IDs and one sort key before hydration. Even an owner
    // sort without a width-limiting btree never loads all manifests into the
    // application or into PostgreSQL's top-N sort tuples.
    val sql = s"""WITH page AS MATERIALIZED (
      SELECT a.id,$column AS sort_value FROM manure.artifacts a$where
      ORDER BY $column $direction NULLS LAST,a.id $direction LIMIT ?
    ) SELECT a.* FROM page JOIN manure.artifacts a ON a.id=page.id
      ORDER BY page.sort_value $direction NULLS LAST,page.id $direction"""
    (sql,params :+ s.fetch)

private[manure] final class PostgresTxn(c: Connection,projection: SearchProjection) extends MetadataTxn:
  import Jdbc.*
  private def readArtifact(r: ResultSet): Artifact = Artifact(
    text(r,"id"),text(r,"name"),ArtifactKind.parse(text(r,"kind")),Visibility.parse(text(r,"visibility")),
    text(r,"created_by_user"),text(r,"created_by_token"),text(r,"created_at"),time(r,"created_at_s"),
    optional(r,"expires_at"),optionalTime(r,"expires_at_s"),UploadState.parse(text(r,"state")),
    r.getLong("total_bytes"),r.getLong("file_count"),r.getLong("reserved_bytes"),optional(r,"ext_pwd_hash"),
    time(r,"last_activity_at"),text(r,"manifest_json"))
  def artifact(id: String): Option[Artifact] = rows(c,"SELECT * FROM manure.artifacts WHERE id=? FOR UPDATE",Exact.utf8(id))(readArtifact).headOption
  def artifacts(after: Option[String], limit: Int): Vector[Artifact] =
    Require(limit > 0 && limit <= 10000, "bad-envelope")
    after match
      case None => rows(c,"SELECT * FROM manure.artifacts ORDER BY id LIMIT ?",limit)(readArtifact)
      case Some(id) => rows(c,"SELECT * FROM manure.artifacts WHERE id>? ORDER BY id LIMIT ?",Exact.utf8(id),limit)(readArtifact)
  def catalogue(selection: CataloguePolicy.Selection): Vector[Artifact] =
    val (sql,params) = CatalogueSql.page(selection)
    rows(c,sql,params*)(readArtifact)
  def put(a: Artifact): Unit =
    exec(c,"""INSERT INTO manure.artifacts
    (id,name,kind,visibility,created_by_user,created_by_token,created_at,created_at_s,expires_at,expires_at_s,state,total_bytes,file_count,reserved_bytes,ext_pwd_hash,last_activity_at,manifest_json,created_at_s_value,expires_at_s_value,last_activity_at_value)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    name=excluded.name,kind=excluded.kind,visibility=excluded.visibility,created_by_user=excluded.created_by_user,
    created_by_token=excluded.created_by_token,created_at=excluded.created_at,created_at_s=excluded.created_at_s,
    expires_at=excluded.expires_at,expires_at_s=excluded.expires_at_s,state=excluded.state,total_bytes=excluded.total_bytes,
    file_count=excluded.file_count,reserved_bytes=excluded.reserved_bytes,ext_pwd_hash=excluded.ext_pwd_hash,
    last_activity_at=excluded.last_activity_at,manifest_json=excluded.manifest_json,
    created_at_s_value=excluded.created_at_s_value,expires_at_s_value=excluded.expires_at_s_value,last_activity_at_value=excluded.last_activity_at_value""",
    Exact.utf8(a.id),Exact.utf8(a.name),Exact.utf8(a.kind.wire),Exact.utf8(a.visibility.wire),Exact.utf8(a.createdByUser),Exact.utf8(a.createdByToken),Exact.utf8(a.createdAt),Exact.timestamp(a.createdAtSeconds),bytes(a.expiresAt),bits(a.expiresAtSeconds),Exact.utf8(a.state.wire),a.totalBytes,a.fileCount,a.reservedBytes,bytes(a.externalPasswordHash),Exact.timestamp(a.lastActivityAt),Exact.utf8(a.manifestJson),a.createdAtSeconds,double(a.expiresAtSeconds),a.lastActivityAt)
    CatalogueProjection.backfill(c,a)
    projection.put(c,a)
  def delete(id: String): Unit =
    projection.remove(c,id); revokeArtifact(id); clearReceipts(id); exec(c,"DELETE FROM manure.artifacts WHERE id=?",Exact.utf8(id))
  def reservation: Long = rows(c,"SELECT COALESCE(SUM(reserved_bytes),0) FROM manure.artifacts")(_.getLong(1)).head
  def sessions(user: Option[String]): Long =
    val sql = "SELECT COUNT(*) FROM manure.artifacts WHERE state IN (?,?)"
    user match
      case None => rows(c,sql,Exact.utf8("uploading"),Exact.utf8("publishing"))(_.getLong(1)).head
      case Some(u) => rows(c,sql + " AND created_by_user=?",Exact.utf8("uploading"),Exact.utf8("publishing"),Exact.utf8(u))(_.getLong(1)).head
  def receipts(id: String, path: String): Vector[Receipt] = rows(c,"SELECT * FROM manure.receipts WHERE artifact_id=? AND path=? ORDER BY \"offset\"",Exact.utf8(id),Exact.utf8(path)) { r =>
    Receipt(text(r,"artifact_id"),text(r,"path"),r.getLong("offset"),r.getLong("length"),text(r,"sha256"))
  }
  def putReceipt(r: Receipt): Unit = exec(c,"INSERT INTO manure.receipts(artifact_id,path,\"offset\",length,sha256) VALUES(?,?,?,?,?)",Exact.utf8(r.artifactId),Exact.utf8(r.path),r.offset,r.length,Exact.utf8(r.sha256))
  def deleteReceipt(id: String,path: String,offset: Long): Unit = exec(c,"DELETE FROM manure.receipts WHERE artifact_id=? AND path=? AND \"offset\"=?",Exact.utf8(id),Exact.utf8(path),offset)
  def clearReceipts(id: String): Unit = exec(c,"DELETE FROM manure.receipts WHERE artifact_id=?",Exact.utf8(id))
  def oneTime(hash: String): Option[OneTimeGrant] = rows(c,"SELECT * FROM manure.one_time_grants WHERE grant_hash=? FOR UPDATE",Exact.utf8(hash)) { r =>
    OneTimeGrant(text(r,"grant_hash"),text(r,"artifact_id"),text(r,"principal"),time(r,"expires_at"),r.getLong("used") != 0,optional(r,"user_id"),optional(r,"token_id"),optional(r,"token_digest"))
  }.headOption
  def putOneTime(g: OneTimeGrant): Unit = exec(c,"""INSERT INTO manure.one_time_grants(grant_hash,artifact_id,principal,expires_at,used,user_id,token_id,token_digest,expires_at_value) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(grant_hash) DO UPDATE SET used=excluded.used""",Exact.utf8(g.hash),Exact.utf8(g.artifactId),Exact.utf8(g.principal),Exact.timestamp(g.expiresAt),if g.used then 1L else 0L,bytes(g.userId),bytes(g.tokenId),bytes(g.tokenDigest),g.expiresAt)
  def content(hash: String): Option[ContentGrant] = rows(c,"SELECT * FROM manure.content_grants WHERE grant_hash=? FOR UPDATE",Exact.utf8(hash)) { r =>
    ContentGrant(text(r,"grant_hash"),text(r,"artifact_id"),time(r,"expires_at"),time(r,"created_at"),optional(r,"user_id"),optional(r,"token_id"),optional(r,"token_digest"),optional(r,"pwd_hash"))
  }.headOption
  def putContent(g: ContentGrant): Unit = exec(c,"INSERT INTO manure.content_grants(grant_hash,artifact_id,expires_at,created_at,user_id,token_id,token_digest,pwd_hash,expires_at_value,created_at_value) VALUES(?,?,?,?,?,?,?,?,?,?)",Exact.utf8(g.hash),Exact.utf8(g.artifactId),Exact.timestamp(g.expiresAt),Exact.timestamp(g.createdAt),bytes(g.userId),bytes(g.tokenId),bytes(g.tokenDigest),bytes(g.passwordHash),g.expiresAt,g.createdAt)
  def deleteContent(hash: String): Unit = exec(c,"DELETE FROM manure.content_grants WHERE grant_hash=?",Exact.utf8(hash))
  def trimContent(id: String,max: Int,newestHash: String): Unit =
    Require(max > 0, "bad-envelope")
    // Keep the actual newly-issued grant even when the source clock ties and its
    // random hash sorts lower. Retain max-1 deterministic prior grants.
    exec(c,"DELETE FROM manure.content_grants WHERE grant_hash IN (SELECT grant_hash FROM manure.content_grants WHERE artifact_id=? AND grant_hash<>? ORDER BY created_at_value DESC,grant_hash DESC OFFSET ?)",Exact.utf8(id),Exact.utf8(newestHash),max-1)
  def revokeArtifact(id: String): Unit =
    exec(c,"DELETE FROM manure.one_time_grants WHERE artifact_id=?",Exact.utf8(id))
    exec(c,"DELETE FROM manure.content_grants WHERE artifact_id=?",Exact.utf8(id))
  def revokeCredential(user: String,token: String): Unit =
    exec(c,"DELETE FROM manure.one_time_grants WHERE user_id=? AND token_id=?",Exact.utf8(user),Exact.utf8(token))
    exec(c,"DELETE FROM manure.content_grants WHERE user_id=? AND token_id=?",Exact.utf8(user),Exact.utf8(token))
  def sweepGrants(now: Double): Unit =
    exec(c,"DELETE FROM manure.one_time_grants WHERE expires_at_value<=?",now)
    exec(c,"DELETE FROM manure.content_grants WHERE expires_at_value<=?",now)
