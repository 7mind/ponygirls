package rites

import java.sql.{Connection, DriverManager, PreparedStatement, ResultSet}
import java.time.Instant
import java.util.UUID
import ponygirls.runtime.{BlockingJdbcDatabase, CredentialFile, Migration}
import rites.api.*
import scala.util.Using

private[rites] object Sql {
  type Param = String | Int | Long | Boolean | UUID | Instant | Array[Byte] | Null
  def bind(p: PreparedStatement, args: Seq[Param]): Unit = args.zipWithIndex.foreach { case (a, i) => a match {
    case s: String => p.setString(i + 1, s); case n: Int => p.setInt(i + 1, n); case n: Long => p.setLong(i + 1, n)
    case b: Boolean => p.setBoolean(i + 1, b); case u: UUID => p.setObject(i + 1, u); case t: Instant => p.setTimestamp(i + 1, java.sql.Timestamp.from(t))
    case b: Array[Byte] => p.setBytes(i + 1, b); case null => p.setObject(i + 1, null)
  }}
  def exec(c: Connection, sql: String, args: Param*): Int = Using.resource(c.prepareStatement(sql)) { p => bind(p, args); if (sql.startsWith("SELECT")) Using.resource(p.executeQuery())(_ => 0) else p.executeUpdate() }
  def rows[A](c: Connection, sql: String, args: Param*)(f: ResultSet => A): List[A] = Using.resource(c.prepareStatement(sql)) { p => bind(p, args); Using.resource(p.executeQuery()) { r => val b = List.newBuilder[A]; while (r.next()) b += f(r); b.result() } }
  def one[A](c: Connection, sql: String, args: Param*)(f: ResultSet => A): Option[A] = rows(c, sql, args*)(f).headOption
  def uuid(r: ResultSet, name: String): UUID = r.getObject(name, classOf[UUID])
  def instant(r: ResultSet, name: String): Instant = r.getTimestamp(name).toInstant
  def option[A](r: ResultSet, name: String, get: (ResultSet, String) => A): Option[A] = if (r.getObject(name) == null) None else Some(get(r, name))
}

final class PostgresStore(config: Config) extends RitesStore {
  private val db = new BlockingJdbcDatabase(config.jdbcConfig)
  private val coordinatorLock = "rites-singleton-coordinator-v1"
  private var coordinator: Option[(Connection, Int)] = None
  private def coordinatorPing(): Unit = coordinator.foreach { case (connection, _) => connection.synchronized {
    try scala.util.Using.resource(connection.createStatement()) { statement => scala.util.Using.resource(statement.executeQuery("SELECT 1")) { result => Check(result.next(), "coordinator-lost", "coordinator database session lost") } }
    catch { case error: DomainError => throw error; case scala.util.control.NonFatal(_) => throw DomainError("coordinator-lost", "coordinator database session lost") }
  }}
  private def tx[A](f: Connection => A): A = { coordinatorPing(); db.transaction(f) }
  def acquireCoordinator(): Unit = {
    coordinatorPing()
    synchronized {
      if (coordinator.nonEmpty) throw DomainError("coordinator-already-started", "coordinator ownership is already held")
      val props = new java.util.Properties
      props.setProperty("user", config.databaseUser); props.setProperty("password", CredentialFile.read(config.jdbcConfig.passwordFile))
      props.setProperty("connectTimeout", math.max(1, config.databaseLimits.connectTimeout.toSeconds).toString); props.setProperty("loginTimeout", math.max(1, config.databaseLimits.connectTimeout.toSeconds).toString)
      props.setProperty("socketTimeout", math.max(1, config.databaseLimits.socketTimeout.toSeconds).toString); props.setProperty("tcpKeepAlive", "true")
      Class.forName("org.postgresql.Driver")
      var connection: Connection = null
      try {
        connection = DriverManager.getConnection(config.jdbcUrl, props); connection.setAutoCommit(true)
        val acquired = scala.util.Using.resource(connection.prepareStatement("SELECT pg_try_advisory_lock(hashtext(?)),pg_backend_pid()")) { statement =>
          statement.setString(1, coordinatorLock)
          scala.util.Using.resource(statement.executeQuery()) { result => Check(result.next(), "coordinator-unavailable", "coordinator lock result missing"); (result.getBoolean(1), result.getInt(2)) }
        }
        if (!acquired._1) { connection.close(); throw DomainError("coordinator-already-active", "another Rites coordinator owns this database") }
        coordinator = Some((connection, acquired._2))
      } catch {
        case error: DomainError => throw error
        case scala.util.control.NonFatal(_) => if (connection != null) connection.close(); throw DomainError("coordinator-unavailable", "cannot acquire coordinator ownership")
      }
    }
  }
  def coordinatorBackendId: Option[Int] = coordinator.map(_._2)
  private def migration(name: String): String = {
    val stream = getClass.getResourceAsStream("/" + name); Check(stream != null, "config", "migration resource missing")
    Using.resource(scala.io.Source.fromInputStream(stream))(_.mkString)
  }
  def initialize(): Unit = {
    db.migrate("rites", List(Migration(1, "control", migration("001_control.sql"))))
    tx { c =>
      Sql.exec(c, "SELECT pg_advisory_xact_lock(82308191)")
      Sql.exec(c, "UPDATE rt_users SET enabled=false")
      config.users.foreach { u =>
        val credential = config.password(u)
        Sql.exec(c, "DELETE FROM rt_sessions WHERE owner=? AND EXISTS(SELECT 1 FROM rt_users WHERE id=? AND credential<>?)", u.id, u.id, credential)
        Sql.exec(c, "INSERT INTO rt_users(id,login,enabled,credential) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,enabled=excluded.enabled,credential=excluded.credential", u.id, u.login, u.enabled, credential)
      }
      Sql.exec(c, "DELETE FROM rt_sessions WHERE expires<=clock_timestamp() OR owner IN(SELECT id FROM rt_users WHERE NOT enabled)" )
    }
  }
  def close(): Unit = synchronized {
    val lease = coordinator; coordinator = None
    lease.foreach { case (connection, _) => connection.synchronized(connection.close()) }
    db.close()
  }
  private def currentTx(c: Connection, identity: Identity): Identity = Sql.one(c, "SELECT u.id,u.login FROM rt_sessions s JOIN rt_users u ON u.id=s.owner WHERE s.hash=? AND s.owner=? AND s.expires>clock_timestamp() AND u.enabled FOR UPDATE OF s", identity.sessionHash, identity.userId)(r => Identity(r.getString(1), r.getString(2), identity.sessionHash)).getOrElse(throw DomainError("unauthorized", "session expired or revoked"))
  def login(login: String, password: String, ttlSeconds: Int): (Identity, String) = tx { c =>
    Check(Valid.text(login, 128) && password.nonEmpty && password.length <= 1024, "invalid", "invalid login")
    val configured = config.users.find(_.login == login)
    val credential = configured.map(config.password).orElse(config.users.headOption.map(config.password)).getOrElse(Password.hash("invalid".toCharArray))
    val valid = configured.exists(_.enabled) && Password.verify(password.toCharArray, credential)
    Check(valid, "unauthorized", "invalid credentials")
    val user = configured.get; val secret = Hash.secret(); val hash = Hash.sha256(secret)
    Sql.exec(c, "INSERT INTO rt_users(id,login,enabled,credential) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,enabled=excluded.enabled,credential=excluded.credential", user.id, user.login, user.enabled, credential)
    Sql.exec(c, "INSERT INTO rt_sessions(hash,owner,expires) VALUES(?,?,clock_timestamp()+make_interval(secs=>?))", hash, user.id, ttlSeconds)
    (Identity(user.id, user.login, hash), secret)
  }
  def authenticate(secret: String): Identity = tx { c =>
    Check(secret.nonEmpty && secret.length <= 128, "unauthorized", "session required")
    val hash = Hash.sha256(secret)
    Sql.one(c, "SELECT u.id,u.login FROM rt_sessions s JOIN rt_users u ON u.id=s.owner WHERE s.hash=? AND s.expires>clock_timestamp() AND u.enabled", hash)(r => Identity(r.getString(1), r.getString(2), hash)).getOrElse(throw DomainError("unauthorized", "session expired or revoked"))
  }
  def current(identity: Identity): Identity = tx(currentTx(_, identity))
  def logout(identity: Identity): Unit = tx { c => currentTx(c, identity); Sql.exec(c, "DELETE FROM rt_sessions WHERE hash=?", identity.sessionHash); () }
  def users(identity: Identity): List[UserInfo] = tx { c => currentTx(c, identity); Sql.rows(c, "SELECT id,login FROM rt_users WHERE enabled ORDER BY login LIMIT 1000")(r => UserInfo(r.getString(1), r.getString(2))) }
  def beginTokenUse(credentialId: UUID, now: Instant, leadSeconds: String => Int): TokenDecision = tx { c =>
    Sql.one(c, "SELECT * FROM rt_credentials WHERE id=? FOR UPDATE", credentialId) { r =>
      val mode = RitesStore.credentialMode(r.getString("mode")); val owner = r.getString("owner"); val access = VaultCiphertext(r.getString("key_id"), r.getBytes("nonce"), r.getBytes("ciphertext"))
      if (mode == CredentialMode.Token) AccessGrant(owner, credentialId, access) else {
        val health = RitesStore.refreshHealth(r.getString("refresh_health"))
        Check(health != RefreshHealth.Uncertain && health != RefreshHealth.Failed && !r.getBoolean("refresh_intent"), "refresh-uncertain", "OAuth credential requires owner replacement")
        val expiry = Sql.instant(r, "expires_at")
        if (!r.getBoolean("refresh_intent") && !expiry.isAfter(now.plusSeconds(leadSeconds(r.getString("oauth_client_id")).toLong))) {
          val ticket = RefreshTicket(owner, credentialId, RitesStore.forge(r.getString("forge")), r.getString("host"), r.getString("oauth_client_id"), r.getInt("revision"), r.getLong("generation"), VaultCiphertext(r.getString("refresh_key_id"), r.getBytes("refresh_nonce"), r.getBytes("refresh_ciphertext")))
          Sql.exec(c, "UPDATE rt_credentials SET refresh_intent=true,refresh_health='Due' WHERE id=? AND revision=? AND generation=?", credentialId, ticket.revision, ticket.generation); ticket
        } else AccessGrant(owner, credentialId, access)
      }
    }.getOrElse(throw DomainError("credential-unavailable", "credential not found"))
  }
  def finishRefresh(ticket: RefreshTicket, access: VaultCiphertext, refresh: VaultCiphertext, expiresAt: Instant): Unit = tx { c =>
    val count = Sql.exec(c, "UPDATE rt_credentials SET key_id=?,nonce=?,ciphertext=?,refresh_key_id=?,refresh_nonce=?,refresh_ciphertext=?,expires_at=?,refresh_health='Healthy',refresh_intent=false,generation=generation+1 WHERE id=? AND owner=? AND revision=? AND generation=? AND refresh_intent", access.keyId, access.nonce, access.data, refresh.keyId, refresh.nonce, refresh.data, expiresAt, ticket.credentialId, ticket.owner, ticket.revision, ticket.generation)
    Check(count == 1, "credential-replaced", "credential changed during OAuth refresh")
  }
  def failRefresh(ticket: RefreshTicket, uncertain: Boolean): Unit = tx { c =>
    Sql.exec(c, "UPDATE rt_credentials SET refresh_health=?,refresh_intent=? WHERE id=? AND owner=? AND revision=? AND generation=?", if (uncertain) "Uncertain" else "Failed", uncertain, ticket.credentialId, ticket.owner, ticket.revision, ticket.generation); ()
  }
  private def credential(r: ResultSet): CredentialInfo = { val mode = RitesStore.credentialMode(r.getString("mode")); CredentialInfo(Sql.uuid(r, "id"), r.getString("name"), RitesStore.forge(r.getString("forge")), r.getString("host"), r.getInt("revision"), Sql.instant(r, "created_at").toString, Sql.instant(r, "updated_at").toString, mode, Sql.option(r, "oauth_client_id", _.getString(_)), Sql.option(r, "expires_at", Sql.instant).map(_.toString), if (mode == CredentialMode.Oauth) Some(RitesStore.refreshHealth(r.getString("refresh_health"))) else None) }
  def credentials(identity: Identity): List[CredentialInfo] = tx { c => currentTx(c, identity); Sql.rows(c, "SELECT * FROM rt_credentials WHERE owner=? ORDER BY name,id LIMIT 1000", identity.userId)(credential) }
  def saveCredential(identity: Identity, request: SaveCredentialRequest, material: (String, UUID, ForgeKind, String, Int) => EncryptedPair): CredentialInfo = tx { c =>
    currentTx(c, identity)
    Check(Valid.text(request.name, 128) && Valid.host(request.host) && request.secret.nonEmpty && request.secret.length <= 16384, "invalid", "invalid credential")
    config.forge(request.forge, request.host)
    request.id match {
      case None =>
        Check(request.expectedRevision == 0, "conflict", "new credential revision must be zero")
        val now = Instant.now(); val id = UUID.randomUUID(); val encrypted = material(identity.userId, id, request.forge, request.host, 1); val refresh = encrypted.refresh
        Sql.exec(c, "INSERT INTO rt_credentials(id,owner,name,forge,host,revision,created_at,updated_at,key_id,nonce,ciphertext,mode,oauth_client_id,expires_at,refresh_health,refresh_key_id,refresh_nonce,refresh_ciphertext) VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?)", id, identity.userId, request.name, request.forge.toString, request.host, now, now, encrypted.access.keyId, encrypted.access.nonce, encrypted.access.data, request.mode.toString, request.oauthClientId.orNull, request.expiresAt.map(Instant.parse).orNull, if (request.mode == CredentialMode.Oauth) "Healthy" else "Healthy", refresh.map(_.keyId).orNull, refresh.map(_.nonce).orNull, refresh.map(_.data).orNull)
        CredentialInfo(id, request.name, request.forge, request.host, 1, now.toString, now.toString, request.mode, request.oauthClientId, request.expiresAt, if (request.mode == CredentialMode.Oauth) Some(RefreshHealth.Healthy) else None)
      case Some(id) =>
        val old = Sql.one(c, "SELECT * FROM rt_credentials WHERE id=? AND owner=? FOR UPDATE", id, identity.userId)(credential).getOrElse(throw DomainError("not-found", "credential not found"))
        RitesStore.requireRevision(request.expectedRevision, old.revision)
        Check(old.forge == request.forge && old.host == request.host, "conflict", "credential forge identity is immutable")
        Check(old.mode == request.mode, "conflict", "credential mode is immutable")
        val next = old.revision + 1; val encrypted = material(identity.userId, id, request.forge, request.host, next); val now = Instant.now(); val refresh = encrypted.refresh
        Sql.exec(c, "UPDATE rt_credentials SET name=?,revision=?,updated_at=?,key_id=?,nonce=?,ciphertext=?,oauth_client_id=?,expires_at=?,refresh_health='Healthy',generation=generation+1,refresh_key_id=?,refresh_nonce=?,refresh_ciphertext=?,refresh_intent=false WHERE id=? AND owner=?", request.name, next, now, encrypted.access.keyId, encrypted.access.nonce, encrypted.access.data, request.oauthClientId.orNull, request.expiresAt.map(Instant.parse).orNull, refresh.map(_.keyId).orNull, refresh.map(_.nonce).orNull, refresh.map(_.data).orNull, id, identity.userId)
        old.copy(name = request.name, revision = next, updatedAt = now.toString, oauthClientId = request.oauthClientId, expiresAt = request.expiresAt, refreshHealth = if (request.mode == CredentialMode.Oauth) Some(RefreshHealth.Healthy) else None)
    }
  }
  def deleteCredential(identity: Identity, request: DeleteCredentialRequest): Unit = tx { c =>
    currentTx(c, identity)
    val old = Sql.one(c, "SELECT revision FROM rt_credentials WHERE id=? AND owner=? FOR UPDATE", request.id, identity.userId)(_.getInt(1)).getOrElse(throw DomainError("not-found", "credential not found"))
    RitesStore.requireRevision(request.expectedRevision, old)
    Check(!Sql.one(c, "SELECT 1 FROM rt_repositories WHERE credential_id=? LIMIT 1", request.id)(_ => true).contains(true), "conflict", "credential is bound to a repository")
    Sql.exec(c, "DELETE FROM rt_credentials WHERE id=? AND owner=?", request.id, identity.userId); ()
  }
  private def grantRows(c: Connection, repositoryId: String, owner: String): List[GrantInfo] = {
    val own = Sql.one(c, "SELECT login FROM rt_users WHERE id=?", owner)(r => GrantInfo(owner, r.getString(1), GrantRole.Owner)).toList
    own ++ Sql.rows(c, "SELECT g.user_id,u.login,g.role FROM rt_grants g JOIN rt_users u ON u.id=g.user_id WHERE g.repository_id=? ORDER BY u.login", repositoryId)(r => GrantInfo(r.getString(1), r.getString(2), RitesStore.grant(r.getString(3))))
  }
  private def repositoryRow(c: Connection, r: ResultSet): RepositoryInfo = {
    val owner = r.getString("owner"); RepositoryInfo(r.getString("id"), owner, RitesStore.forge(r.getString("forge")), r.getString("host"), r.getString("project"), r.getString("base_branch"), Sql.uuid(r, "credential_id"), r.getInt("revision"), grantRows(c, r.getString("id"), owner))
  }
  private val visible = "(r.owner=? OR EXISTS(SELECT 1 FROM rt_grants g JOIN rt_users gu ON gu.id=g.user_id WHERE g.repository_id=r.id AND g.user_id=? AND gu.enabled))"
  private def requireRepo(c: Connection, identity: Identity, id: String, minimum: GrantRole): RepositoryInfo = {
    val repo = Sql.one(c, s"SELECT r.* FROM rt_repositories r WHERE r.id=? AND $visible", id, identity.userId, identity.userId)(repositoryRow(c, _)).getOrElse(throw DomainError("not-found", "repository not found"))
    if (minimum == GrantRole.Owner) Check(repo.owner == identity.userId, "not-found", "repository not found")
    if (minimum == GrantRole.Editor) Check(repo.owner == identity.userId || repo.grants.exists(g => g.userId == identity.userId && g.role == GrantRole.Editor), "not-found", "repository not found")
    repo
  }
  def repositories(identity: Identity): List[RepositoryInfo] = tx { c => currentTx(c, identity); Sql.rows(c, s"SELECT r.* FROM rt_repositories r WHERE $visible ORDER BY r.id LIMIT 1000", identity.userId, identity.userId)(repositoryRow(c, _)) }
  def repository(identity: Identity, id: String): RepositoryInfo = tx { c => currentTx(c, identity); requireRepo(c, identity, id, GrantRole.Viewer) }
  def saveRepository(identity: Identity, request: SaveRepositoryRequest): RepositoryInfo = tx { c =>
    currentTx(c, identity)
    Check(Valid.repository(request.id) && Valid.project(request.project) && Valid.branch(request.baseBranch), "invalid", "invalid repository")
    config.forge(request.forge, request.host)
    val credentialOwner = Sql.one(c, "SELECT owner FROM rt_credentials WHERE id=? AND forge=? AND host=? AND owner=?", request.credentialId, request.forge.toString, request.host, identity.userId)(_.getString(1)).getOrElse(throw DomainError("forbidden", "credential must be owned by repository owner and exactly match forge"))
    Check(credentialOwner == identity.userId, "forbidden", "credential ownership mismatch")
    val existing = Sql.one(c, "SELECT owner,revision FROM rt_repositories WHERE id=? FOR UPDATE", request.id)(r => (r.getString(1), r.getInt(2)))
    existing match {
      case None =>
        Check(request.expectedRevision == 0, "conflict", "new repository revision must be zero")
        Sql.exec(c, "INSERT INTO rt_repositories(id,owner,forge,host,project,base_branch,credential_id,revision) VALUES(?,?,?,?,?,?,?,1)", request.id, identity.userId, request.forge.toString, request.host, request.project, request.baseBranch, request.credentialId)
      case Some((owner, revision)) =>
        Check(owner == identity.userId, "not-found", "repository not found"); RitesStore.requireRevision(request.expectedRevision, revision)
        val next = revision + 1
        if (Sql.one(c, "SELECT active_run FROM rt_rites WHERE repository_id=? AND active_run IS NOT NULL LIMIT 1", request.id)(_ => true).contains(true)) {
          Sql.exec(c, "UPDATE rt_runs SET state='Failed',failure_code='authorization-revoked',finished_at=clock_timestamp() WHERE repository_id=? AND state='Queued'", request.id)
          Sql.exec(c, "UPDATE rt_rites SET active_run=NULL WHERE repository_id=? AND active_run IN(SELECT id FROM rt_runs WHERE state='Failed')", request.id)
        }
        Sql.exec(c, "UPDATE rt_repositories SET forge=?,host=?,project=?,base_branch=?,credential_id=?,revision=? WHERE id=?", request.forge.toString, request.host, request.project, request.baseBranch, request.credentialId, next, request.id)
    }
    requireRepo(c, identity, request.id, GrantRole.Owner)
  }
  def deleteRepository(identity: Identity, request: DeleteRepositoryRequest): Unit = tx { c =>
    currentTx(c, identity); val repo = requireRepo(c, identity, request.id, GrantRole.Owner)
    Sql.one(c, "SELECT revision FROM rt_repositories WHERE id=? FOR UPDATE", request.id)(_.getInt(1)).foreach(RitesStore.requireRevision(request.expectedRevision, _))
    Sql.exec(c, "UPDATE rt_runs SET state='Failed',failure_code='authorization-revoked',finished_at=clock_timestamp() WHERE repository_id=? AND state IN('Queued','Running')", request.id)
    Sql.exec(c, "DELETE FROM rt_repositories WHERE id=? AND owner=?", request.id, identity.userId); ()
  }
  def setGrant(identity: Identity, request: SetGrantRequest): RepositoryInfo = tx { c =>
    currentTx(c, identity); val repo = requireRepo(c, identity, request.repositoryId, GrantRole.Owner)
    Sql.one(c, "SELECT revision FROM rt_repositories WHERE id=? FOR UPDATE", request.repositoryId)(_.getInt(1)).foreach(RitesStore.requireRevision(request.expectedRevision, _))
    Check(request.userId != repo.owner && !request.role.contains(GrantRole.Owner), "forbidden", "repository owner grant is immutable")
    Check(Sql.one(c, "SELECT 1 FROM rt_users WHERE id=? AND enabled", request.userId)(_ => true).contains(true), "not-found", "user not found")
    request.role match {
      case None => Sql.exec(c, "DELETE FROM rt_grants WHERE repository_id=? AND user_id=?", request.repositoryId, request.userId)
      case Some(role) => Sql.exec(c, "INSERT INTO rt_grants(repository_id,user_id,role) VALUES(?,?,?) ON CONFLICT(repository_id,user_id) DO UPDATE SET role=excluded.role", request.repositoryId, request.userId, role.toString)
    }
    Sql.exec(c, "UPDATE rt_runs SET state='Failed',failure_code='authorization-revoked',finished_at=clock_timestamp() WHERE repository_id=? AND state='Queued' AND actor=?", request.repositoryId, request.userId)
    Sql.exec(c, "UPDATE rt_rites t SET active_run=NULL FROM rt_runs r WHERE t.active_run=r.id AND t.repository_id=? AND r.actor=? AND r.state='Failed'", request.repositoryId, request.userId)
    Sql.exec(c, "UPDATE rt_repositories SET revision=revision+1 WHERE id=?", request.repositoryId)
    requireRepo(c, identity, request.repositoryId, GrantRole.Owner)
  }
  private def rite(r: ResultSet): RiteInfo = RiteInfo(r.getString("repository_id"), r.getString("id"), r.getString("schedule"), r.getString("prompt_path"), r.getString("model_id"), r.getBoolean("enabled"), r.getInt("revision"))
  def rites(identity: Identity, repositoryId: String): List[RiteInfo] = tx { c => currentTx(c, identity); requireRepo(c, identity, repositoryId, GrantRole.Viewer); Sql.rows(c, "SELECT * FROM rt_rites WHERE repository_id=? ORDER BY id LIMIT 1000", repositoryId)(rite) }
  def saveRite(identity: Identity, request: SaveRiteRequest, validModel: String => Boolean): RiteInfo = tx { c =>
    currentTx(c, identity); requireRepo(c, identity, request.repositoryId, GrantRole.Editor)
    Check(Valid.rite(request.id) && Valid.prompt(request.promptPath) && validModel(request.modelId), "invalid", "invalid rite")
    Cron(request.schedule)
    val old = Sql.one(c, "SELECT revision FROM rt_rites WHERE repository_id=? AND id=? FOR UPDATE", request.repositoryId, request.id)(_.getInt(1))
    old match {
      case None =>
        Check(request.expectedRevision == 0, "conflict", "new rite revision must be zero")
        Sql.exec(c, "INSERT INTO rt_rites(repository_id,id,schedule,prompt_path,model_id,enabled,revision,cursor) VALUES(?,?,?,?,?,?,1,date_trunc('minute',clock_timestamp()))", request.repositoryId, request.id, request.schedule, request.promptPath, request.modelId, request.enabled)
      case Some(revision) =>
        RitesStore.requireRevision(request.expectedRevision, revision)
        Sql.exec(c, "UPDATE rt_runs SET state='Failed',failure_code='authorization-revoked',finished_at=clock_timestamp() WHERE repository_id=? AND rite_id=? AND state='Queued'", request.repositoryId, request.id)
        Sql.exec(c, "UPDATE rt_rites SET schedule=?,prompt_path=?,model_id=?,enabled=?,revision=revision+1 WHERE repository_id=? AND id=?", request.schedule, request.promptPath, request.modelId, request.enabled, request.repositoryId, request.id)
        Sql.exec(c, "UPDATE rt_rites SET active_run=NULL WHERE repository_id=? AND id=? AND active_run IN(SELECT id FROM rt_runs WHERE repository_id=? AND rite_id=? AND state='Failed')", request.repositoryId, request.id, request.repositoryId, request.id)
    }
    Sql.one(c, "SELECT * FROM rt_rites WHERE repository_id=? AND id=?", request.repositoryId, request.id)(rite).get
  }
  def deleteRite(identity: Identity, request: DeleteRiteRequest): Unit = tx { c =>
    currentTx(c, identity); requireRepo(c, identity, request.repositoryId, GrantRole.Editor)
    Sql.one(c, "SELECT revision FROM rt_rites WHERE repository_id=? AND id=? FOR UPDATE", request.repositoryId, request.id)(_.getInt(1)).foreach(RitesStore.requireRevision(request.expectedRevision, _))
    Sql.exec(c, "UPDATE rt_runs SET state='Failed',failure_code='authorization-revoked',finished_at=clock_timestamp() WHERE repository_id=? AND rite_id=? AND state IN('Queued','Running')", request.repositoryId, request.id)
    Sql.exec(c, "DELETE FROM rt_rites WHERE repository_id=? AND id=?", request.repositoryId, request.id); ()
  }
  private val runColumns = "id,repository_id,rite_id,trigger_kind,scheduled_for,created_at,started_at,finished_at,state,failure_code,base_revision,prompt_digest,branch,proposal_url"
  private def runInfo(r: ResultSet): RunInfo = RunInfo(Sql.uuid(r, "id"), r.getString("repository_id"), r.getString("rite_id"), RitesStore.trigger(r.getString("trigger_kind")), Sql.instant(r, "scheduled_for").toString, Sql.instant(r, "created_at").toString, Sql.option(r, "started_at", Sql.instant).map(_.toString), Sql.option(r, "finished_at", Sql.instant).map(_.toString), RitesStore.runState(r.getString("state")), Sql.option(r, "failure_code", _.getString(_)), Sql.option(r, "base_revision", _.getString(_)), Sql.option(r, "prompt_digest", _.getString(_)), Sql.option(r, "branch", _.getString(_)), Sql.option(r, "proposal_url", _.getString(_)))
  private def requireRunVisible(c: Connection, identity: Identity, runId: UUID): RunInfo = Sql.one(c, s"SELECT rr.* FROM rt_runs rr JOIN rt_repositories r ON r.id=rr.repository_id WHERE rr.id=? AND $visible", runId, identity.userId, identity.userId)(runInfo).getOrElse(throw DomainError("not-found", "run not found"))
  def manualRun(identity: Identity, request: ManualRunRequest): RunAdmission = tx { c =>
    currentTx(c, identity); Sql.exec(c, "SELECT pg_advisory_xact_lock(hashtext('rites-run-admission'))"); requireRepo(c, identity, request.repositoryId, GrantRole.Viewer)
    val digest = Hash.sha256(List(request.repositoryId, request.riteId, request.requestId.toString).mkString("\u0000"))
    val old = Sql.one(c, s"SELECT rr.* FROM rt_runs rr WHERE rr.actor=? AND rr.request_id=? AND rr.trigger_kind='Manual'", identity.userId, request.requestId)(runInfo)
    old.foreach(r => Check(Hash.sha256(List(r.repositoryId, r.riteId, request.requestId.toString).mkString("\u0000")) == digest, "conflict", "request ID bound to different payload"))
    old.map(r => RunAdmission(r, false)).getOrElse {
      requireRepo(c, identity, request.repositoryId, GrantRole.Editor)
      val riteRow = Sql.one(c, "SELECT t.*,r.revision AS repo_revision,r.credential_id,c.revision AS credential_revision FROM rt_rites t JOIN rt_repositories r ON r.id=t.repository_id JOIN rt_credentials c ON c.id=r.credential_id WHERE t.repository_id=? AND t.id=? AND t.enabled FOR UPDATE OF t", request.repositoryId, request.riteId)(r => (rite(r), r.getInt("repo_revision"), Sql.uuid(r, "credential_id"), r.getInt("credential_revision"))).getOrElse(throw DomainError("not-found", "rite not found"))
      Sql.one(c, "SELECT active_run FROM rt_rites WHERE repository_id=? AND id=?", request.repositoryId, request.riteId)(r => Sql.uuid(r, "active_run")).foreach(id => Check(id == null, "conflict", "rite already has an active run"))
      val queue = Sql.one(c, "SELECT count(*) FROM rt_runs WHERE state IN('Queued','Running')")(_.getInt(1)).get
      Check(queue < config.scheduler.queueBound, "unavailable", "run queue is full")
      val id = UUID.randomUUID(); val now = Instant.now()
      try Sql.exec(c, s"INSERT INTO rt_runs($runColumns,actor,request_id,request_digest,repository_revision,rite_revision,credential_id,credential_revision,intent_persisted,supersession_pending) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,false,false)", id, request.repositoryId, request.riteId, "Manual", now, now, null, null, "Queued", null, null, null, null, null, identity.userId, request.requestId, digest, riteRow._2, riteRow._1.revision, riteRow._3, riteRow._4)
      catch { case e: java.sql.SQLException if e.getSQLState == "23505" => throw DomainError("conflict", "rite already has an active run or duplicate request") }
      Sql.exec(c, "UPDATE rt_runs SET target_branch=(SELECT base_branch FROM rt_repositories WHERE id=?) WHERE id=?", request.repositoryId, id)
      Sql.exec(c, "UPDATE rt_rites SET active_run=? WHERE repository_id=? AND id=? AND active_run IS NULL", id, request.repositoryId, request.riteId)
      RunAdmission(Sql.one(c, s"SELECT $runColumns FROM rt_runs WHERE id=?", id)(runInfo).get, true)
    }
  }
  def run(identity: Identity, id: UUID): RunInfo = tx { c => currentTx(c, identity); requireRunVisible(c, identity, id) }
  def runs(identity: Identity, repositoryId: String, riteId: String): List[RunInfo] = tx { c => currentTx(c, identity); requireRepo(c, identity, repositoryId, GrantRole.Viewer); Sql.rows(c, s"SELECT $runColumns FROM rt_runs WHERE repository_id=? AND rite_id=? ORDER BY created_at DESC,id LIMIT 100", repositoryId, riteId)(runInfo) }
  def status(identity: Identity): StatusInfo = tx { c => currentTx(c, identity); def count(state: String): Long = Sql.one(c, s"SELECT count(*) FROM rt_runs rr JOIN rt_repositories r ON r.id=rr.repository_id WHERE rr.state=? AND $visible", state, identity.userId, identity.userId)(_.getLong(1)).get; StatusInfo(count("Queued"), count("Running"), true) }
  private def latestDue(cron: Cron, cursor: Instant, now: Instant): Option[Instant] = {
    val latest = cron.previousOrCurrent(now); if (latest.isAfter(cursor)) Some(latest) else None
  }
  def admitScheduled(now: Instant, maximum: Int): Int = tx { c =>
    Sql.exec(c, "SELECT pg_advisory_xact_lock(hashtext('rites-run-admission'))")
    Sql.exec(c, "LOCK TABLE rt_runs IN SHARE ROW EXCLUSIVE MODE")
    val queued = Sql.one(c, "SELECT count(*) FROM rt_runs WHERE state IN('Queued','Running')")(_.getInt(1)).get
    val candidates = Sql.rows(c, "SELECT t.*,r.revision AS repo_revision,r.credential_id,cr.revision AS credential_revision,r.owner FROM rt_rites t JOIN rt_repositories r ON r.id=t.repository_id JOIN rt_credentials cr ON cr.id=r.credential_id JOIN rt_users u ON u.id=r.owner WHERE t.enabled AND t.active_run IS NULL AND u.enabled ORDER BY t.repository_id,t.id LIMIT 1000 FOR UPDATE OF t")(r => (rite(r), Sql.option(r, "cursor", Sql.instant), r.getInt("repo_revision"), Sql.uuid(r, "credential_id"), r.getInt("credential_revision"), r.getString("owner")))
    var admitted = 0
    candidates.iterator.takeWhile(_ => queued + admitted < maximum).foreach { case (r, cursor, repoRevision, credentialId, credentialRevision, owner) =>
      val due = latestDue(Cron(r.schedule), cursor.getOrElse(now), now)
      due.foreach { scheduled =>
        val id = UUID.randomUUID()
        val inserted = Sql.exec(c, "INSERT INTO rt_runs(id,repository_id,rite_id,trigger_kind,scheduled_for,actor,state,repository_revision,rite_revision,credential_id,credential_revision,created_at) VALUES(?,?,?,?,?,?,'Queued',?,?,?,?,?) ON CONFLICT DO NOTHING", id, r.repositoryId, r.id, "Schedule", scheduled, owner, repoRevision, r.revision, credentialId, credentialRevision, now)
        if (inserted == 1) { Sql.exec(c, "UPDATE rt_runs SET target_branch=(SELECT base_branch FROM rt_repositories WHERE id=?) WHERE id=?", r.repositoryId, id); Sql.exec(c, "UPDATE rt_rites SET active_run=?,cursor=? WHERE repository_id=? AND id=?", id, scheduled, r.repositoryId, r.id); admitted += 1 }
      }
    }
    admitted
  }
  private def authorityRow(c: Connection, r: ResultSet): Authority = {
    val run = runInfo(r)
    val repo = RepositoryInfo(r.getString("repo_key"), r.getString("repo_owner"), RitesStore.forge(r.getString("repo_forge")), r.getString("repo_host"), r.getString("repo_project"), r.getString("repo_base_branch"), Sql.uuid(r, "repo_credential_id"), r.getInt("repo_current_revision"), grantRows(c, r.getString("repo_key"), r.getString("repo_owner")))
    val riteInfo = RiteInfo(r.getString("rite_repo_key"), r.getString("rite_key"), r.getString("rite_schedule"), r.getString("rite_prompt_path"), r.getString("rite_model_id"), r.getBoolean("rite_enabled"), r.getInt("current_rite_revision"))
    Authority(run, r.getString("repo_owner"), repo, riteInfo, r.getString("credential_owner"), RitesStore.forge(r.getString("repo_forge")), r.getString("repo_host"), r.getString("repo_project"), r.getString("repo_base_branch"), VaultCiphertext(r.getString("key_id"), r.getBytes("nonce"), r.getBytes("ciphertext")))
  }
  private val authorityFrom = "FROM rt_runs rr JOIN rt_repositories r ON r.id=rr.repository_id JOIN rt_rites t ON t.repository_id=rr.repository_id AND t.id=rr.rite_id JOIN rt_credentials c ON c.id=rr.credential_id JOIN rt_users u ON u.id=rr.actor"
  private val joinedColumns = "rr.*,r.id AS repo_key,r.owner AS repo_owner,r.forge AS repo_forge,r.host AS repo_host,r.project AS repo_project,r.base_branch AS repo_base_branch,r.credential_id AS repo_credential_id,r.revision AS repo_current_revision,t.repository_id AS rite_repo_key,t.id AS rite_key,t.schedule AS rite_schedule,t.prompt_path AS rite_prompt_path,t.model_id AS rite_model_id,t.enabled AS rite_enabled,t.revision AS current_rite_revision,c.owner AS credential_owner,c.revision AS credential_current_revision,c.key_id,c.nonce,c.ciphertext,u.enabled AS site_enabled,g.role AS actor_role"
  private def validAuthority(r: ResultSet): Boolean = {
    r.getInt("repository_revision") == r.getInt("repo_current_revision") && r.getInt("rite_revision") == r.getInt("current_rite_revision") && r.getInt("credential_revision") == r.getInt("credential_current_revision") && r.getBoolean("rite_enabled") && r.getBoolean("site_enabled") && (r.getString("actor") == r.getString("repo_owner") || (r.getString("actor_role") != null && r.getString("actor_role") == "Editor"))
  }
  def claimNext(now: Instant): Option[Authority] = tx { c =>
    val selected = Sql.one(c, "SELECT id FROM rt_runs WHERE state='Queued' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED")(r => Sql.uuid(r, "id"))
    selected.flatMap { id =>
      val row = Sql.one(c, s"SELECT $joinedColumns $authorityFrom LEFT JOIN rt_grants g ON g.repository_id=r.id AND g.user_id=rr.actor WHERE rr.id=? FOR UPDATE OF rr", id)(r => if (validAuthority(r)) Right(authorityRow(c, r)) else Left(()))
      row match {
        case Some(Right(authority)) => Sql.exec(c, "UPDATE rt_runs SET state='Running',started_at=? WHERE id=?", now, id); Some(authority.copy(run = authority.run.copy(state = RunState.Running, startedAt = Some(now.toString))))
        case _ => completeTx(c, id, RunCompletion(RunState.Failed, Some("authorization-revoked"))); None
      }
    }
  }
  def recoverInterrupted(): Unit = tx { c =>
    Sql.exec(c, "UPDATE rt_runs SET state='Failed',failure_code='interrupted-agent',finished_at=clock_timestamp() WHERE state='Running' AND NOT intent_persisted")
    Sql.exec(c, "UPDATE rt_rites t SET active_run=NULL FROM rt_runs r WHERE t.active_run=r.id AND r.state='Failed'")
    Sql.exec(c, "UPDATE rt_runs SET state='PublicationUncertain',failure_code='publication-reconciliation-required' WHERE state='Running' AND intent_persisted")
  }
  private def completeTx(c: Connection, id: UUID, completion: RunCompletion): Unit = {
    Sql.exec(c, "UPDATE rt_runs SET state=?,failure_code=?,finished_at=clock_timestamp(),base_revision=COALESCE(?,base_revision),prompt_digest=COALESCE(?,prompt_digest),branch=COALESCE(?,branch),proposal_url=COALESCE(?,proposal_url) WHERE id=?", completion.state.toString, completion.failureCode.orNull, completion.baseRevision.orNull, completion.promptDigest.orNull, completion.branch.orNull, completion.proposalUrl.orNull, id)
    Sql.exec(c, "UPDATE rt_rites SET active_run=NULL WHERE active_run=?", id)
  }
  def complete(id: UUID, completion: RunCompletion): Unit = tx { c => completeTx(c, id, completion) }
  def authority(id: UUID): Option[Authority] = tx { c =>
    Sql.one(c, s"SELECT $joinedColumns $authorityFrom LEFT JOIN rt_grants g ON g.repository_id=r.id AND g.user_id=rr.actor WHERE rr.id=? AND rr.state IN('Running','PublicationUncertain','SupersessionPending')", id)(r => if (validAuthority(r)) Some(authorityRow(c, r)) else None).getOrElse(None)
  }
  def recordPrepared(id: UUID, baseRevision: String, promptDigest: String): Unit = tx { c =>
    Check(baseRevision.matches("[0-9a-f]{40,64}") && promptDigest.nonEmpty && promptDigest.length <= 256, "invalid", "invalid prepared metadata")
    Sql.exec(c, "UPDATE rt_runs SET base_revision=?,prompt_digest=? WHERE id=? AND state='Running'", baseRevision, promptDigest, id); ()
  }
  def persistIntent(id: UUID, branch: String, marker: String, expectedHead: String): Unit = {
    Check(expectedHead.matches("[0-9a-f]{40,64}"), "invalid", "expected publication head must be a Git object id")
    val accepted = tx { c =>
    val ids = Sql.one(c, "SELECT repository_id,rite_id,credential_id FROM rt_runs WHERE id=?", id)(r => (r.getString(1), r.getString(2), Sql.uuid(r, "credential_id"))).getOrElse(throw DomainError("conflict", "run is not publication eligible"))
    Sql.one(c, "SELECT id FROM rt_repositories WHERE id=? FOR UPDATE", ids._1)(_.getString(1)).getOrElse(throw DomainError("authorization-revoked", "repository authority removed"))
    Sql.one(c, "SELECT id FROM rt_rites WHERE repository_id=? AND id=? FOR UPDATE", ids._1, ids._2)(_.getString(1)).getOrElse(throw DomainError("authorization-revoked", "rite authority removed"))
    Sql.one(c, "SELECT id FROM rt_credentials WHERE id=? FOR UPDATE", ids._3)(r => Sql.uuid(r, "id")).getOrElse(throw DomainError("authorization-revoked", "credential authority removed"))
    Sql.one(c, "SELECT id FROM rt_runs WHERE id=? FOR UPDATE", id)(r => Sql.uuid(r, "id")).getOrElse(throw DomainError("authorization-revoked", "run authority removed"))
    val valid = Sql.one(c, s"SELECT $joinedColumns $authorityFrom LEFT JOIN rt_grants g ON g.repository_id=r.id AND g.user_id=rr.actor WHERE rr.id=?", id)(r => r.getString("state") == "Running" && validAuthority(r)).contains(true)
    if (!valid) completeTx(c, id, RunCompletion(RunState.Failed, Some("authorization-revoked")))
    else Sql.exec(c, "UPDATE rt_runs SET branch=?,marker=?,expected_head=?,intent_persisted=true,publication_stage='Intent',state='PublicationUncertain',failure_code='publication-in-progress' WHERE id=?", branch, marker, expectedHead, id)
    valid
    }
    Check(accepted, "authorization-revoked", "run authority changed")
  }
  def abandonUndelivered(id: UUID): Unit = tx { c =>
    val changed = Sql.exec(c, "UPDATE rt_runs SET state='Failed',failure_code='authorization-revoked',finished_at=clock_timestamp(),publication_stage='None' WHERE id=? AND state='PublicationUncertain' AND publication_stage IN('Intent','Pushed')", id)
    if (changed == 1) Sql.exec(c, "UPDATE rt_rites SET active_run=NULL WHERE active_run=?", id)
    ()
  }
  def publicationHead(id: UUID): Option[String] = tx { c => Sql.one(c, "SELECT expected_head FROM rt_runs WHERE id=?", id)(r => Sql.option(r, "expected_head", _.getString(_))).getOrElse(None) }
  def publicationStage(id: UUID): String = tx { c => Sql.one(c, "SELECT publication_stage FROM rt_runs WHERE id=?", id)(_.getString(1)).getOrElse("None") }
  def markPushed(id: UUID): Unit = tx { c => Sql.exec(c, "UPDATE rt_runs SET publication_stage='Pushed' WHERE id=? AND intent_persisted", id); () }
  def markCreateDispatched(id: UUID): Unit = tx { c => Sql.exec(c, "UPDATE rt_runs SET publication_stage='CreateDispatched' WHERE id=? AND intent_persisted", id); () }
  def markPublication(id: UUID, remoteId: String, url: String, author: String, predecessors: List[String]): Unit = tx { c =>
    Sql.exec(c, "UPDATE rt_runs SET remote_id=?,remote_author=?,proposal_url=?,publication_stage='Created' WHERE id=?", remoteId, author, url, id)
    predecessors.foreach(p => Sql.exec(c, "INSERT INTO rt_publication_predecessors(run_id,remote_id) VALUES(?,?) ON CONFLICT DO NOTHING", id, p))
    if (predecessors.isEmpty) completeTx(c, id, RunCompletion(RunState.Published, None)) else Sql.exec(c, "UPDATE rt_runs SET state='SupersessionPending',failure_code='supersession-pending',finished_at=clock_timestamp() WHERE id=?", id)
  }
  def knownMarker(repositoryId: String, riteId: String, marker: String, source: String, target: String, author: String, remoteId: String, url: String): Boolean = tx { c => Sql.one(c, "SELECT 1 FROM rt_runs WHERE repository_id=? AND rite_id=? AND marker=? AND branch=? AND target_branch=? AND remote_author=? AND remote_id=? AND proposal_url=?", repositoryId, riteId, marker, source, target, author, remoteId, url)(_ => true).contains(true) }
  def predecessorClosed(id: UUID, remoteId: String): Unit = tx { c =>
    Sql.exec(c, "UPDATE rt_publication_predecessors SET closed=true WHERE run_id=? AND remote_id=?", id, remoteId)
    val open = Sql.one(c, "SELECT count(*) FROM rt_publication_predecessors WHERE run_id=? AND NOT closed", id)(_.getInt(1)).get
    if (open == 0) completeTx(c, id, RunCompletion(RunState.Published, None))
  }
  def pendingPublication(limit: Int): List[UUID] = tx { c => Sql.rows(c, "SELECT id FROM rt_runs WHERE intent_persisted AND state IN('PublicationUncertain','SupersessionPending') ORDER BY created_at,id LIMIT ?", limit)(r => Sql.uuid(r, "id")) }
  def markUncertain(id: UUID, code: String): Unit = tx { c => Sql.exec(c, "UPDATE rt_runs SET state='PublicationUncertain',failure_code=?,finished_at=clock_timestamp() WHERE id=?", code, id); () }
  def markSupersessionPending(id: UUID): Unit = tx { c => Sql.exec(c, "UPDATE rt_runs SET state='SupersessionPending',failure_code='supersession-pending',finished_at=clock_timestamp() WHERE id=?", id); () }
}
