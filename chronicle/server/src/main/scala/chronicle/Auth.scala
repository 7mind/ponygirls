package chronicle
import chronicle.api.*
import java.util.UUID
import java.time.Instant
import java.sql.{Connection,SQLException}
import java.nio.file.Path
import cats.effect.{IO,Resource}
import ponygirls.auth.{AccountOrigin,AccountUser,AccountToken,AccountIssued,AccountJson,AccountCredential,AccountSession,AccountSessions,AccountFailure,AccountOutcome,AccountRejection,AttemptLimiter,CredentialGate,DeclaredDirectory,FailurePath,IdentityHistory,ImperativeAccountApi,ImperativeAccountSql,ImperativeAccounts,ImperativeSettings,ImperativeTransactions,LoginDecision,PasswordHasher,SignedIn,TotpVault}

/** Outcome of a password login. A rejection of an imperative account is a value: the transaction that counted
  * the failed attempt commits before the caller answers or raises it. */
enum LoginOutcome[+A] {
  case Established(value: A)
  case Rejected(reason: AccountRejection,locked: Option[FailurePath])
}
/** Imperative accounts as configured; exists exactly while the master switch `accounts.enabled` is on. Holds the
  * settings with the TOTP key and the configured users, static until restart like the rest of the configuration. */
final class ImperativeAccess private (val settings: ImperativeSettings,val declared: DeclaredDirectory)
object ImperativeAccess {
  private def settings(config: Config,accounts: AccountsConfig): ImperativeSettings =
    try {
      val keyFile=accounts.keyFile.getOrElse(throw AccountFailure("config"))
      val issuer=accounts.issuer.getOrElse(s"Chronicle (${java.net.URI.create(config.allowedOrigin).getHost})")
      ImperativeSettings(AccountsConfig.service,accounts.signup.enabled,accounts.signup.requireApproval,accounts.enrollment.enabled,accounts.signup.maxUsers,
        java.time.Duration.ofSeconds(accounts.enrollment.ttlSeconds.toLong),issuer,accounts.reservedUsernames.toSet,TotpVault.load(Path.of(keyFile),AccountsConfig.service))
    } catch { case AccountFailure(_) => throw DomainError("config","invalid accounts settings or key file") }
  /** Reads the key file and the password-hash files. */
  def load(config: Config): Option[ImperativeAccess] =
    config.accounts.filter(_.enabled).map(accounts => new ImperativeAccess(settings(config,accounts),DeclaredUsers.directory(DeclaredUsers.load(config))))
}
/** The account plane of imperative accounts: their configuration and the in-memory limits of the
  * unauthenticated account endpoints. */
final class AccountPlane private (val access: ImperativeAccess,val limiter: AttemptLimiter,val gate: CredentialGate) {
  val api = new ImperativeAccountApi(limiter,gate)
}
object AccountPlane {
  def resource(access: Option[ImperativeAccess]): Resource[IO,Option[AccountPlane]] = access match {
    case None => Resource.pure(None)
    case Some(configured) => CredentialGate.resource.map(gate => Some(new AccountPlane(configured,new AttemptLimiter(AttemptLimiter.Capacity,java.time.Clock.systemUTC()),gate)))
  }
}
object DeclaredUsers {
  /** The configured users with the password hashes of their hash files. */
  def load(config: Config): List[(UserConfig,String)] = config.users.map { user =>
    val credential = Config.credential(user.passwordHashFile)
    Check(ponygirls.auth.Password.validHash(credential),"config","invalid password hash")
    user -> credential
  }
  def directory(configured: List[(UserConfig,String)]): DeclaredDirectory = DeclaredDirectory(
    configured.map { case (user,credential) => AccountUser(user.id,"human",user.login,Some(user.login),Some(credential),user.enabled,AccountOrigin.Declarative) }.toVector,
    configured.collect { case (user,_) if user.admin => user.id }.toSet)
}

/** Chronicle's ports of the shared imperative-account core, on the caller's transaction. `ch_sessions` holds the
  * browser sessions; `ch_users` is the effective directory, so an imperative account that has been active has a
  * projection row there, and every row of it — configured, disabled or removed from configuration — is a
  * retained identity that no new account may take. */
private final class AccountStore(c: Connection,profile: String) extends AccountSessions with IdentityHistory {
  import AccountStore.*
  def lockOwners(declarative: Vector[String],imperative: Vector[String]): Unit =
    (declarative.sorted++imperative.sorted).foreach(owner => Sql.lock(c,s"mutation:$owner"))
  def sessionOwner(secret: String): Option[String] = Sql.one(c,"SELECT owner FROM ch_sessions WHERE hash=?",Wire.hash(secret))(_.getString(1))
  def live(session: AccountCredential): Boolean =
    Sql.one(c,s"SELECT 1 FROM ch_sessions s JOIN ch_users u ON u.id=s.owner WHERE s.hash=? AND s.owner=? AND $liveSession",session.digest,session.userId)(_ => true).nonEmpty
  def establish(user: AccountUser,replaced: Option[String]): AccountSession = {
    val secret=Wire.secret(); val hash=Wire.hash(secret)
    exactlyOne(Sql.exec(c,"INSERT INTO ch_sessions(hash,owner) SELECT ?,id FROM ch_users WHERE id=? AND enabled",hash,user.id))
    replaced.foreach(previous => Sql.exec(c,s"DELETE FROM ch_sessions s USING ch_users u WHERE s.hash=? AND u.id=s.owner AND $liveSession",Wire.hash(previous)))
    AccountSession(AccountStore.credential(user.id,hash),secret)
  }
  // Startup takes `ch_users` rows before `ch_sessions` rows; so does every deletion here.
  private def lockUser(id: String): Option[String] = Sql.one(c,"SELECT credential FROM ch_users WHERE id=? FOR NO KEY UPDATE",id)(_.getString(1))
  def revokeSessions(userId: String,keep: Option[AccountCredential]): Unit = {
    lockUser(userId)
    keep.filter(_.userId==userId) match {
      case Some(kept) => Sql.exec(c,"DELETE FROM ch_sessions WHERE owner=? AND hash<>?",userId,kept.digest)
      case None => Sql.exec(c,"DELETE FROM ch_sessions WHERE owner=?",userId)
    }
    ()
  }
  /** Issued tokens are kept: a disabled owner's tokens are refused by the `ch_users.enabled` gate. */
  def revokeTokens(userId: String): Unit = ()
  /** Insert only, never an upsert: an existing id or login aborts the transaction, so nothing is ever adopted. */
  def activated(user: AccountUser): Unit = {
    try Sql.exec(c,"INSERT INTO ch_users(id,login,enabled,credential) VALUES(?,?,true,?)",user.id,required(user.login),required(user.passwordHash))
    catch { case failure: SQLException if failure.getSQLState==uniqueViolation => throw AccountFailure("username-unavailable") }
    Sql.exec(c,"INSERT INTO ch_owner_targets(owner,profile) VALUES(?,?)",user.id,profile)
    ()
  }
  /** Update only, exactly the projection row; a changed credential or a disabled account loses its sessions. */
  def updated(user: AccountUser): Unit = {
    val credential=required(user.passwordHash)
    val previous=required(lockUser(user.id))
    if(!user.enabled || previous!=credential) Sql.exec(c,"DELETE FROM ch_sessions WHERE owner=?",user.id)
    exactlyOne(Sql.exec(c,"UPDATE ch_users SET credential=?,enabled=? WHERE id=?",credential,user.enabled,user.id))
  }
  def retained(username: String): Boolean =
    Sql.one(c,s"SELECT 1 FROM ch_users WHERE ${asciiLower("id")}=? OR ${asciiLower("login")}=? LIMIT 1",username,username)(_ => true).nonEmpty
}
private object AccountStore {
  val uniqueViolation = "23505"
  val liveSession = "(s.expires IS NULL OR s.expires>clock_timestamp()) AND u.enabled"
  // ASCII folding independent of the database locale, as `ImperativePolicy.fold` compares names.
  def asciiLower(column: String): String = s"translate($column,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')"
  def credential(owner: String,hash: String): AccountCredential = AccountCredential(owner,"human",hash,hash,true)
  def required[A](value: Option[A]): A = value.getOrElse(throw AccountFailure("unavailable"))
  def exactlyOne(count: Int): Unit = if(count!=1) throw AccountFailure("unavailable")
}

final class Auth(db: Database, config: Config) {
  private val allScopes = List(Scope.Ingest,Scope.Read,Scope.Raw)
  /** Present exactly while the master switch is on. */
  val accounts: Option[ImperativeAccess] = ImperativeAccess.load(config)
  /** A configured login takes the unchanged statement; while imperative accounts are on, any other login is
    * decided by the imperative core, without a TOTP code. */
  private def decide[A](c: Connection,loginName: String,password: String,previous: Option[String])(configured: => A)(imperativeUser: SignedIn => A): LoginOutcome[A] =
    accounts.fold(LoginDecision.NotImperative)(access => imperative(c,access).login(loginName,password,None,previous)) match {
      case LoginDecision.NotImperative => LoginOutcome.Established(configured)
      case LoginDecision.Imperative(AccountOutcome.Completed(signedIn)) => LoginOutcome.Established(imperativeUser(signedIn))
      case LoginDecision.Imperative(AccountOutcome.Rejected(reason,locked)) => LoginOutcome.Rejected(reason,locked)
    }
  /** The legacy request cannot carry a TOTP code, so an account that requires one is refused. `previous` is the
    * presented session, which an imperative login replaces. */
  def legacyLogin(r: LoginRequest,previous: Option[String]): LoginOutcome[(LoginResponse,String)] = db.transaction { c =>
    decide(c,r.login,r.password,previous)(login(c,r)) { signedIn =>
      (LoginResponse(UserInfo(signedIn.user.id,signedIn.user.login.getOrElse(signedIn.user.id),allScopes),Wire.versions),signedIn.session.secret)
    }
  } match {
    case LoginOutcome.Rejected(AccountRejection.TotpRequired,_) => LoginOutcome.Rejected(AccountRejection.Unauthorized,None)
    case outcome => outcome
  }
  def login(r: LoginRequest): (LoginResponse,String) = Auth.established(legacyLogin(r,None))
  private def login(c: Connection,r: LoginRequest): (LoginResponse,String) = {
    Check.text(r.login,128); Check.text(r.password,1024)
    // An account that has been active imperatively is authenticated by the imperative core only (password counters, TOTP).
    val user = Sql.one(c,"SELECT id,credential FROM ch_users WHERE login=? AND enabled AND NOT EXISTS(SELECT 1 FROM ponygirls_imperative_users i WHERE i.id=ch_users.id AND i.status<>'pending')",r.login)(x => (x.getString(1),x.getString(2)))
    val valid = user.exists(u => Password.verify(r.password.toCharArray,u._2))
    if(user.isEmpty) Password.verify(r.password.toCharArray,Password.hash("dummy".toCharArray))
    Check(valid,"unauthorized","invalid credentials")
    val secret = Wire.secret(); val id = user.get._1
    Sql.exec(c,"INSERT INTO ch_sessions(hash,owner) VALUES(?,?)",Wire.hash(secret),id)
    (LoginResponse(UserInfo(id,r.login,allScopes),Wire.versions),secret)
  }
  private def configuredAccountLogin(c: Connection,loginName: String,password: String): (AccountUser,String) = {
    val (response,secret)=login(c,LoginRequest(loginName,password))
    (accountUser(c,Identity(response.user,true,Wire.hash(secret))),secret)
  }
  /** Configured logins only: the fallback of the shared dispatcher, which decides every other login itself. */
  def configuredAccountLogin(loginName: String,password: String): (AccountUser,String) = db.transaction(c => configuredAccountLogin(c,loginName,password))
  def accountLogin(loginName: String,password: String): (AccountUser,String) = Auth.established(db.transaction { c =>
    decide(c,loginName,password,None)(configuredAccountLogin(c,loginName,password))(signedIn => (signedIn.user,signedIn.session.secret))
  })
  private def imperative(c: Connection,access: ImperativeAccess): ImperativeAccounts = {
    val store=new AccountStore(c,db.profiles.preferred.profile)
    ImperativeAccountSql.accounts(c,Some(access.settings),access.declared,store,store,PasswordHasher.Pbkdf2,java.time.Clock.systemUTC())
  }
  /** One transaction per call, committed whatever `work` returns: a rejection may carry a failure counter. */
  def imperative(access: ImperativeAccess): ImperativeTransactions = new ImperativeTransactions {
    def run[A](work: ImperativeAccounts => A): IO[A] = IO.blocking(db.transaction(c => work(imperative(c,access))))
  }
  /** The live browser session of the presented cookie, as the account plane names it. */
  def accountSession(secret: String): Option[AccountCredential] =
    if(secret.isEmpty) None else db.transaction(c => liveBrowser(c,Wire.hash(secret))).map(identity => AccountStore.credential(identity.user.id,identity.credentialHash))
  private def liveBrowser(c: Connection,hash: String): Option[Identity] =
    Sql.one(c,s"SELECT u.id,u.login FROM ch_sessions s JOIN ch_users u ON u.id=s.owner WHERE s.hash=? AND ${AccountStore.liveSession}",hash)(r => Identity(UserInfo(r.getString(1),r.getString(2),allScopes),true,hash))
  private def browserHash(c: Connection,hash: String): Identity = liveBrowser(c,hash).getOrElse(throw DomainError("unauthorized","session expired or revoked"))
  def browser(secret: String): Identity = db.transaction(c => browserHash(c,Wire.hash(secret)))
  def refreshBrowser(secret: String): UserInfo = db.transaction { c =>
    val hash=Wire.hash(secret)
    // Revalidate after the row lock; a concurrent logout must never recreate a session.
    Sql.one(c,"SELECT hash FROM ch_sessions WHERE hash=? FOR UPDATE",hash)(_.getString(1))
    browserHash(c,hash).user
  }
  private[chronicle] def currentBrowser(c: Connection,identity: Identity): Identity = {
    identity.requireBrowser()
    val current=browserHash(c,identity.credentialHash)
    Check(current.user.id==identity.user.id,"unauthorized","session expired or revoked")
    current
  }
  def bearer(secret: String): Identity = db.transaction { c =>
    Sql.one(c,"SELECT u.id,u.login,t.info FROM ch_tokens t JOIN ch_users u ON u.id=t.owner WHERE t.hash=? AND NOT t.revoked AND u.enabled",Wire.hash(secret)) { r =>
      val t = Wire.decode(TokenInfo.codecJson,Sql.json(r,"info")); Identity(UserInfo(r.getString(1),r.getString(2),t.scopes),false,Wire.hash(secret))
    }.getOrElse(throw DomainError("unauthorized","invalid agent credential"))
  }
  def logout(i: Identity): Unit = db.transaction { c => lockBrowser(c,i); Sql.exec(c,"DELETE FROM ch_sessions WHERE hash=? AND owner=?",i.credentialHash,i.user.id); () }
  def accountLogout(i: Identity,actors: Vector[String]): Unit = db.transaction { c =>
    lockBrowser(c,i)
    AccountJson.requireActor(actors,i.user.id)
    Sql.exec(c,"DELETE FROM ch_sessions WHERE hash=? AND owner=?",i.credentialHash,i.user.id)
    ()
  }
  private def listedTokens(c: Connection,owner: String): List[ListedToken] =
    Sql.rows(c,s"SELECT info,revoked,static_config FROM ch_tokens WHERE owner=? ORDER BY revoked,static_config DESC,id LIMIT ${TokenPolicy.maximumPerOwner}",owner)(r => ListedToken(Wire.decode(TokenInfo.codecJson,Sql.json(r,"info")).copy(revoked=r.getBoolean("revoked")),if(r.getBoolean("static_config")) TokenSource.StaticConfig else TokenSource.Issued))
  def tokens(i: Identity): TokensResult = { i.requireBrowser(); db.transaction { c => currentBrowser(c,i); TokensResult(listedTokens(c,i.user.id)) } }
  private def accountUser(c: Connection,i: Identity): AccountUser = {
    val hash=Sql.one(c,"SELECT credential FROM ch_users WHERE id=? AND enabled",i.user.id)(_.getString(1)).getOrElse(throw DomainError("unauthorized","session revoked"))
    AccountUser(i.user.id,"human",i.user.login,Some(i.user.login),Some(hash),true,if(config.users.exists(_.id==i.user.id)) AccountOrigin.Declarative else AccountOrigin.Imperative)
  }
  private def accountToken(token: ListedToken): AccountToken = {
    val t=token.info
    AccountToken(t.id.toString,t.name,if(token.source==TokenSource.StaticConfig) "configured" else "issued",Some(t.createdAt),t.revoked,t.scopes.map(_.toString).toVector)
  }
  def account(i: Identity): (AccountUser,Vector[AccountToken]) = db.transaction { c =>
    val current=currentBrowser(c,i)
    val user=accountUser(c,current)
    val tokens=listedTokens(c,current.user.id).map(accountToken).toVector
    currentBrowser(c,i)
    (user,tokens)
  }
  private def lockBrowser(c: Connection,i: Identity): Unit = {
    i.requireBrowser()
    Check(Sql.one(c,"SELECT id FROM ch_users WHERE id=? AND enabled FOR SHARE",i.user.id)(_.getString(1)).nonEmpty,"unauthorized","session revoked")
    Sql.one(c,"SELECT hash FROM ch_sessions WHERE hash=? AND owner=? FOR UPDATE",i.credentialHash,i.user.id)(_.getString(1))
    currentBrowser(c,i)
    ()
  }
  private def mintToken(c: Connection,i: Identity,name: String,scopes: List[Scope]): TokenResult = {
    lockBrowser(c,i)
    Check.text(name,128); Check(scopes.nonEmpty && scopes.distinct.size==scopes.size && (!scopes.contains(Scope.Raw)||scopes.contains(Scope.Read)),"invalid","invalid scopes")
    Sql.exec(c,"LOCK TABLE ch_tokens IN ROW EXCLUSIVE MODE")
    Check(Sql.one(c,"SELECT count(*) FROM ch_tokens WHERE owner=? AND NOT revoked",i.user.id)(_.getInt(1)).get < TokenPolicy.maximumPerOwner,"invalid","token limit")
    val secret=Wire.secret(); val token=TokenInfo(UUID.randomUUID(),name,scopes,Instant.now().toString,false)
    Sql.exec(c,"INSERT INTO ch_tokens(id,owner,hash,info) VALUES(?,?,?,?::jsonb)",token.id,i.user.id,Wire.hash(secret),Wire.encode(TokenInfo.codecJson,token).noSpaces)
    TokenResult(token,Some(secret))
  }
  private def revokeToken(c: Connection,i: Identity,id: UUID): Unit = {
    lockBrowser(c,i)
    Sql.exec(c,"LOCK TABLE ch_tokens IN ROW EXCLUSIVE MODE")
    Sql.one(c,"SELECT static_config FROM ch_tokens WHERE id=? AND owner=? FOR UPDATE",id,i.user.id)(_.getBoolean(1)).foreach(managed => Check(!managed,"forbidden","configuration-managed token is immutable"))
    Check(Sql.exec(c,"UPDATE ch_tokens SET revoked=true WHERE id=? AND owner=?",id,i.user.id)==1,"not-found","token not found")
  }
  def issueAccountToken(i: Identity,name: String,scopes: Vector[String],actors: Vector[String]): AccountIssued = db.transaction { c =>
    Sql.lock(c,s"mutation:${i.user.id}")
    lockBrowser(c,i)
    AccountJson.requireActor(actors,i.user.id)
    val parsed=scopes.map(scope => Scope.parse(scope).getOrElse(throw DomainError("invalid","invalid scopes"))).toList
    val issued=mintToken(c,i,name,parsed)
    AccountIssued(accountToken(ListedToken(issued.token,TokenSource.Issued)),issued.secret.get)
  }
  def revokeAccountToken(i: Identity,id: String,actors: Vector[String]): Unit = db.transaction { c =>
    Sql.lock(c,s"mutation:${i.user.id}")
    lockBrowser(c,i)
    AccountJson.requireActor(actors,i.user.id)
    val parsed=scala.util.Try(UUID.fromString(id)).getOrElse(throw DomainError("not-found","token not found"))
    revokeToken(c,i,parsed)
  }
  def groups(i: Identity): GroupsResult = { i.requireBrowser(); db.transaction { c =>
    val gs = Sql.rows(c,"SELECT g.* FROM ch_groups g JOIN ch_members m ON m.group_id=g.id WHERE m.user_id=? ORDER BY g.id LIMIT 100",i.user.id) { r => val id = r.getObject("id",classOf[UUID]); GroupInfo(id,r.getString("name"),r.getString("owner"),Sql.rows(c,"SELECT user_id FROM ch_members WHERE group_id=? ORDER BY user_id LIMIT 100",id)(_.getString(1))) }
    val invites = Sql.rows(c,"SELECT id,group_id,target,expires FROM ch_invites WHERE target=? AND NOT accepted AND expires>now() ORDER BY id LIMIT 100",i.user.id)(r => InviteInfo(r.getObject(1,classOf[UUID]),r.getObject(2,classOf[UUID]),r.getString(3),r.getTimestamp(4).toInstant.toString))
    GroupsResult(gs,invites)
  }}
  def receipt(i: Identity,id: UUID): Result = { i.requireBrowser(); db.transaction(c => Sql.one(c,"SELECT result FROM ch_mutations WHERE owner=? AND request_id=?",i.user.id,id)(r => Wire.decode(Result.codecJson,Sql.json(r,"result"))).getOrElse(throw DomainError("not-found","receipt not found"))) }
  def previewRetryFailed(i: Identity): RetryFailedPlan = {
    i.requireBrowser(); i.requireScope(Scope.Read)
    db.transaction { c =>
      c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
      db.profiles.resolve(OwnerTargets.read(c,i.user.id,false).profile)
      RetryFailedJobs.preview(c,i.user.id)
    }
  }
  def previewOwnerReindex(i: Identity): OwnerReindexPlan = {
    i.requireBrowser(); i.requireScope(Scope.Read)
    db.transaction { c =>
      c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
      currentBrowser(c,i)
      val plan=OwnerReindex.preview(c,i.user.id,db.profiles)
      OwnerReindexPlan(plan.currentTargetProfile,plan.targetProfile,plan.selectionHash,plan.heads,plan.alreadyCurrent,plan.replacements)
    }
  }
  def reindexStatus(i: Identity,id: UUID): ReindexStatusResult = {
    i.requireBrowser(); i.requireScope(Scope.Read)
    db.transaction { c => c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ); currentBrowser(c,i); ReindexCohort.status(c,i.user.id,id) }
  }
  def mutate(i: Identity,e: ClientEnvelope): Result = { i.requireBrowser()
    e.operation match { case _: Operation.ApplyRetryFailed | _: Operation.ApplyOwnerReindex => i.requireScope(Scope.Read); case _ => () }
    db.transaction { c =>
    Sql.lock(c,s"mutation:${i.user.id}")
    e.operation match { case _: Operation.ApplyOwnerReindex => currentBrowser(c,i); case _ => () }
    val digest = Wire.hash(Wire.canonical(Wire.encode(Operation.codecJson,e.operation)))
    Sql.one(c,"SELECT digest,result FROM ch_mutations WHERE owner=? AND request_id=?",i.user.id,e.requestId) { r => Check(r.getString(1)==digest,"conflict","request ID bound to different payload"); Wire.decode(Result.codecJson,Sql.json(r,"result")) } match {
      case Some(r) => r
      case None =>
        val response = mutationResult(c,i,e)
        val stored = response match { case Result.Token(r) => Result.Token(r.copy(secret=None)); case other => other }
        Sql.exec(c,"INSERT INTO ch_mutations VALUES(?,?,?,?::jsonb)",i.user.id,e.requestId,digest,Wire.encode(Result.codecJson,stored).noSpaces)
        response
    }
  }}
  private def mutationResult(c: Connection,i: Identity,e: ClientEnvelope): Result = e.operation match {
    case _: Operation.ApplyRetryFailed | _: Operation.ApplyOwnerReindex =>
      // Eligibility can return A→AB→A; a rejected request ID must never become executable again.
      val detail=if(e.operation.isInstanceOf[Operation.ApplyRetryFailed]) "retry selection changed; preview again" else "owner reindex selection changed; preview again"
      val savepoint=c.setSavepoint()
      val result=try mutation(c,i,e) catch {
        case failure: DomainError if failure.code=="conflict" =>
          c.rollback(savepoint)
          Result.Error(Failure("conflict",detail))
      }
      c.releaseSavepoint(savepoint)
      result
    case _ => mutation(c,i,e)
  }
  private def mutation(c: Connection,i: Identity,e: ClientEnvelope): Result = {
    val owner = i.user.id
    def receipt(op: String,id: Option[UUID]): Result = Result.Mutation(MutationReceipt(e.requestId,op,id))
    def groupOwner(id: UUID): Unit = Check(Sql.one(c,"SELECT 1 FROM ch_groups WHERE id=? AND owner=? FOR UPDATE",id,owner)(_ => true).contains(true),"not-found","group not found")
    e.operation match {
      case Operation.MintToken(name,scopes) => Result.Token(mintToken(c,i,name,scopes))
      case Operation.RevokeToken(id) => revokeToken(c,i,id); receipt("RevokeToken",Some(id))
      case Operation.CreateGroup(name) =>
        Check.text(name,128)
        Check(Sql.one(c,"SELECT count(*) FROM ch_members WHERE user_id=?",owner)(_.getInt(1)).get < 100,"invalid","group limit")
        val id = UUID.randomUUID(); Sql.exec(c,"INSERT INTO ch_groups VALUES(?,?,?)",id,owner,name); Sql.exec(c,"INSERT INTO ch_members VALUES(?,?)",id,owner); receipt("CreateGroup",Some(id))
      case Operation.Invite(id,target) =>
        groupOwner(id)
        Check(Sql.one(c,"SELECT 1 FROM ch_users WHERE id=? AND enabled",target)(_ => true).contains(true),"not-found","user not found")
        Check(Sql.one(c,"SELECT count(*) FROM ch_members WHERE group_id=?",id)(_.getInt(1)).get < 100,"invalid","member limit")
        Check(Sql.one(c,"SELECT count(*) FROM ch_invites WHERE group_id=? AND NOT accepted AND expires>now()",id)(_.getInt(1)).get < 100,"invalid","invitation limit")
        val invitation = UUID.randomUUID(); Sql.exec(c,"INSERT INTO ch_invites(id,group_id,target,expires) VALUES(?,?,?,now()+interval '24 hours')",invitation,id,target); receipt("Invite",Some(invitation))
      case Operation.AcceptInvite(id,confirm) =>
        Check(confirm,"invalid","explicit sharing confirmation required")
        val group = Sql.one(c,"SELECT group_id FROM ch_invites WHERE id=? AND target=? AND NOT accepted AND expires>now() FOR UPDATE",id,owner)(_.getObject(1,classOf[UUID])).getOrElse(throw DomainError("not-found","invitation not found"))
        Check(Sql.one(c,"SELECT count(*) FROM ch_members WHERE user_id=?",owner)(_.getInt(1)).get < 100,"invalid","group limit")
        Sql.exec(c,"INSERT INTO ch_members VALUES(?,?) ON CONFLICT DO NOTHING",group,owner); Sql.exec(c,"UPDATE ch_invites SET accepted=true WHERE id=?",id); receipt("AcceptInvite",Some(group))
      case Operation.RemoveMember(id,user) => groupOwner(id); Check(user!=owner,"invalid","owner cannot be removed"); Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id=?",id,user); receipt("RemoveMember",Some(id))
      case Operation.LeaveGroup(id) =>
        Check(!Sql.one(c,"SELECT 1 FROM ch_groups WHERE id=? AND owner=?",id,owner)(_ => true).contains(true),"invalid","owner must delete group")
        Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id=?",id,owner); receipt("LeaveGroup",Some(id))
      case Operation.DeleteGroup(id) => groupOwner(id); Sql.exec(c,"DELETE FROM ch_groups WHERE id=?",id); receipt("DeleteGroup",Some(id))
      case Operation.ApplyRetryFailed(targetProfile,selectionHash,confirm) =>
        db.profiles.resolve(OwnerTargets.read(c,owner,true).profile)
        Result.RetryFailed(RetryFailedJobs(c,owner,e.requestId,targetProfile,selectionHash,confirm))
      case Operation.ApplyOwnerReindex(targetProfile,selectionHash,confirm) =>
        val result=OwnerReindex(c,owner,e.requestId,targetProfile,selectionHash,confirm,db.profiles)
        Result.OwnerReindexed(OwnerReindexResult(result.requestId,result.targetProfile,result.heads,result.queued,result.alreadyCurrent,result.invalidatedClaims))
      case Operation.RetryJob(id) =>
        db.profiles.resolve(OwnerTargets.read(c,owner,true).profile)
        Jobs.retry(c,owner,id); receipt("RetryJob",Some(id))
      case Operation.Purge(id) =>
        // First the source's live upload, in the writers' lock order (attempt row, then source row): it waits for a part
        // or commit in flight, which then ends; a later part or commit finds the attempt aborted (gone).
        Sql.exec(c,"UPDATE ch_uploads SET phase='Aborted',failure=?,terminal_at=clock_timestamp() WHERE owner=? AND source_key=(SELECT source_key FROM ch_sources WHERE id=? AND owner=?) AND phase='Open'",Uploads.purged,owner,id,owner)
        Check(Sql.exec(c,"UPDATE ch_sources SET tombstone=true,published=NULL WHERE id=? AND owner=?",id,owner)==1,"not-found","session not found")
        Sql.exec(c,"DELETE FROM ch_chunks WHERE generation IN(SELECT id FROM ch_generations WHERE session_id=?)",id); Sql.exec(c,"DELETE FROM ch_generations WHERE session_id=?",id); Sql.exec(c,"DELETE FROM ch_jobs WHERE session_id=?",id); Sql.exec(c,"DELETE FROM ch_revisions WHERE session_id=?",id)
        receipt("Purge",Some(id))
      case Operation.Logout() => lockBrowser(c,i); Sql.exec(c,"DELETE FROM ch_sessions WHERE hash=? AND owner=?",i.credentialHash,owner); receipt("Logout",None)
      case _ => throw DomainError("invalid","not a mutation")
    }
  }
}
object Auth {
  /** The failure a rejected login is reported as. Unknown, disabled and wrong-password logins read exactly
    * like a configured login with a wrong password. */
  def rejection(reason: AccountRejection): DomainError = reason match {
    case AccountRejection.Unauthorized => DomainError(reason.code,"invalid credentials")
    case AccountRejection.Invalid => DomainError(reason.code,"invalid text length")
    case _ => DomainError(reason.code,"login rejected")
  }
  /** For the callers that take a login as a value or a raised failure; called after the login transaction ended. */
  def established[A](outcome: LoginOutcome[A]): A = outcome match {
    case LoginOutcome.Established(value) => value
    case LoginOutcome.Rejected(reason,_) => throw rejection(reason)
  }
}
