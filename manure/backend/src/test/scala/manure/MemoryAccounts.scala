package manure

import ponygirls.auth.{AccountCredential,AccountFailure,AccountIssued,AccountLogin,AccountOrigin,AccountSession,AccountSessions,AccountToken,AccountUser,DeclaredDirectory,IdentityHistory,ImperativeAccounts,ImperativeSettings,MemoryImperativeUsers,Password,PasswordHasher}

private[manure] final case class MemoryAccountRow(credential: AccountCredential,metadata: Option[AccountToken])
/** `fingerprints` are the ids ever reconciled, kept as tombstones after removal: the reconcile scope. */
private[manure] final case class MemoryAccountState(users: Vector[AccountUser],rows: Vector[MemoryAccountRow],fingerprints: Set[String])
private[manure] object MemoryAccountState:
  val empty = MemoryAccountState(Vector.empty,Vector.empty,Set.empty)

/** Contract dummy: immutable transaction snapshots, not a PostgreSQL lock model. Imperative accounts use the
  * shared handwritten store `imperative` (the caller undoes its writes when the transaction fails); `creators`
  * tells whether an artifact records the user id as its creator.
  */
private[manure] final class MemoryAuthTxn(initial: MemoryAccountState,imperativeUsers: MemoryImperativeUsers,creators: String => Boolean) extends AuthTxn:
  var state: MemoryAccountState = initial
  private def require(value: Boolean,code: String): Unit = if !value then throw AccountFailure(code)
  private def eligible(users: Vector[AccountUser],id: String): Boolean = users.exists(u => u.id == id && u.enabled && u.userType == "human")
  private def active(row: MemoryAccountRow): Boolean = !row.metadata.exists(_.revoked)
  private def principal(users: Vector[AccountUser],session: AccountCredential): Unit =
    require(session.browser && eligible(users,session.userId) && state.rows.exists(r => r.credential == session && active(r)),"unauthorized")
  def initialize(): Unit = ()
  def reconcile(users: Vector[AccountUser]): Unit =
    require(users.forall(_.origin == AccountOrigin.Declarative),"config")
    val prior = state.users.map(u => u.id -> u).toMap
    val scope = state.fingerprints ++ users.map(_.id)
    state = MemoryAccountState(users,state.rows.flatMap { row =>
      val current = users.find(_.id == row.credential.userId)
      if !scope(row.credential.userId) then Some(row)
      else if row.credential.browser then
        Option.when(current.exists(u => u.enabled && u.userType == "human" && u.passwordHash.nonEmpty &&
          prior.get(u.id).exists(old => old.passwordHash == u.passwordHash)))(row)
      else if current.exists(_.enabled) then Some(row)
      else Some(row.copy(metadata=row.metadata.map(_.copy(revoked=true))))
    },scope)
  private def login(users: Vector[AccountUser],login: String,password: String): AccountSession =
    val matches = users.filter(u => u.origin == AccountOrigin.Declarative && u.enabled && u.userType == "human" && u.login.contains(login) &&
      u.passwordHash.exists(Password.verify(password.toCharArray,_)))
    require(matches.size == 1,"unauthorized")
    establish(matches.head)
  private def establish(user: AccountUser): AccountSession =
    val secret = SecretCodec.token()
    val credential = AccountCredential(user.id,user.userType,"session-" + java.util.UUID.randomUUID().toString,SecretCodec.sha256(secret),true)
    state = state.copy(rows=state.rows :+ MemoryAccountRow(credential,None))
    AccountSession(credential,secret)
  def loginReplacing(users: Vector[AccountUser],loginName: String,password: String,previous: Option[String]): AccountLogin =
    val session = login(users,loginName,password)
    val replaced = previous.flatMap { secret =>
      val prior = browser(users,secret)
      prior.foreach(_ => logout(users,secret))
      prior
    }
    AccountLogin(session,replaced)
  private def resolve(users: Vector[AccountUser],secret: String,browser: Boolean): Option[AccountCredential] =
    if !SecretCodec.canonical(secret) then None
    else state.rows.filter(r => r.credential.browser == browser && active(r) && eligible(users,r.credential.userId) &&
      SecretCodec.verify(secret,r.credential.digest)).map(_.credential).headOption
  def browser(users: Vector[AccountUser],secret: String): Option[AccountCredential] = resolve(users,secret,true)
  def bearer(users: Vector[AccountUser],secret: String): Option[AccountCredential] = resolve(users,secret,false)
  def live(users: Vector[AccountUser],user: String,token: String,digest: String): Boolean =
    eligible(users,user) && state.rows.exists(r => active(r) && r.credential.userId == user && r.credential.tokenId == token && r.credential.digest == digest)
  def logout(users: Vector[AccountUser],secret: String): Unit =
    val found = browser(users,secret).getOrElse(throw AccountFailure("unauthorized"))
    state = state.copy(rows=state.rows.filterNot(_.credential == found))
  def tokens(owner: String): Vector[AccountToken] = state.rows.filter(_.credential.userId == owner).flatMap(_.metadata)
  def issue(users: Vector[AccountUser],session: AccountCredential,name: String): AccountIssued =
    principal(users,session)
    require(name.nonEmpty && name.length <= 128,"bad-envelope")
    require(tokens(session.userId).count(!_.revoked) < 100,"invalid")
    val secret = SecretCodec.token()
    val id = "issued-" + java.util.UUID.randomUUID().toString
    val metadata = AccountToken(id,name,"issued",Some(java.time.Instant.now().toString),false,Vector("api"))
    val credential = AccountCredential(session.userId,session.userType,id,SecretCodec.sha256(secret),false)
    state = state.copy(rows=state.rows :+ MemoryAccountRow(credential,Some(metadata)))
    AccountIssued(metadata,secret)
  def revoke(users: Vector[AccountUser],session: AccountCredential,id: String): Unit =
    principal(users,session)
    require(state.rows.exists(r => !r.credential.browser && r.credential.userId == session.userId && r.credential.tokenId == id),"not-found")
    state = state.copy(rows=state.rows.map { r =>
      if r.credential.userId == session.userId && r.credential.tokenId == id then r.copy(metadata=r.metadata.map(_.copy(revoked=true))) else r
    })
  def directory(settings: Option[ImperativeSettings],declared: DeclaredDirectory): Vector[AccountUser] =
    imperative(settings,declared,PasswordHasher.Pbkdf2,java.time.Clock.systemUTC()).directory
  def installDeclared(declared: DeclaredDirectory)(reconcile: => Unit): Unit =
    directory(None,declared)
    reconcile
  def imperative(settings: Option[ImperativeSettings],declared: DeclaredDirectory,hasher: PasswordHasher,clock: java.time.Clock): ImperativeAccounts =
    val history = new IdentityHistory:
      def retained(username: String): Boolean = state.fingerprints(username) || creators(username)
    imperativeUsers.accounts(settings,declared,new MemorySessions(() => directory(settings,declared)),history,hasher,clock)
  /** Sessions and tokens of the imperative core over this snapshot; locks are meaningless here. */
  private final class MemorySessions(directory: () => Vector[AccountUser]) extends AccountSessions:
    def lockOwners(declarative: Vector[String],imperative: Vector[String]): Unit = ()
    def sessionOwner(secret: String): Option[String] =
      if !SecretCodec.canonical(secret) then None
      else state.rows.find(r => r.credential.browser && SecretCodec.verify(secret,r.credential.digest)).map(_.credential.userId)
    def live(session: AccountCredential): Boolean = eligible(directory(),session.userId) && state.rows.exists(_.credential == session)
    def establish(user: AccountUser,replaced: Option[String]): AccountSession =
      val session = MemoryAuthTxn.this.establish(user)
      replaced.flatMap(browser(directory(),_)).foreach(prior => state = state.copy(rows=state.rows.filterNot(_.credential == prior)))
      session
    def revokeSessions(userId: String,keep: Option[AccountCredential]): Unit =
      state = state.copy(rows=state.rows.filterNot(r => r.credential.browser && r.credential.userId == userId && !keep.contains(r.credential)))
    def revokeTokens(userId: String): Unit =
      state = state.copy(rows=state.rows.map(r => if r.credential.userId == userId then r.copy(metadata=r.metadata.map(_.copy(revoked=true))) else r))
    def activated(user: AccountUser): Unit = ()
    def updated(user: AccountUser): Unit = ()
