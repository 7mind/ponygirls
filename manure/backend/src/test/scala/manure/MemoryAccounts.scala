package manure

import ponygirls.auth.{AccountCredential,AccountFailure,AccountIssued,AccountSession,AccountToken,AccountUser,Password}

private[manure] final case class MemoryAccountRow(credential: AccountCredential,metadata: Option[AccountToken])
private[manure] final case class MemoryAccountState(users: Vector[AccountUser],rows: Vector[MemoryAccountRow])
private[manure] object MemoryAccountState:
  val empty = MemoryAccountState(Vector.empty,Vector.empty)

/** Contract dummy: immutable transaction snapshots, not a PostgreSQL lock model. */
private[manure] final class MemoryAuthTxn(initial: MemoryAccountState) extends AuthTxn:
  var state: MemoryAccountState = initial
  private def require(value: Boolean,code: String): Unit = if !value then throw AccountFailure(code)
  private def eligible(users: Vector[AccountUser],id: String): Boolean = users.exists(u => u.id == id && u.enabled && u.userType == "human")
  private def active(row: MemoryAccountRow): Boolean = !row.metadata.exists(_.revoked)
  private def principal(users: Vector[AccountUser],session: AccountCredential): Unit =
    require(session.browser && eligible(users,session.userId) && state.rows.exists(r => r.credential == session && active(r)),"unauthorized")
  def initialize(): Unit = ()
  def reconcile(users: Vector[AccountUser]): Unit =
    val prior = state.users.map(u => u.id -> u).toMap
    state = MemoryAccountState(users,state.rows.flatMap { row =>
      val current = users.find(_.id == row.credential.userId)
      if row.credential.browser then
        Option.when(current.exists(u => u.enabled && u.userType == "human" && u.passwordHash.nonEmpty &&
          prior.get(u.id).exists(old => old.passwordHash == u.passwordHash)))(row)
      else if current.exists(_.enabled) then Some(row)
      else Some(row.copy(metadata=row.metadata.map(_.copy(revoked=true))))
    })
  def login(users: Vector[AccountUser],login: String,password: String): AccountSession =
    val matches = users.filter(u => u.enabled && u.userType == "human" && u.login.contains(login) &&
      u.passwordHash.exists(Password.verify(password.toCharArray,_)))
    require(matches.size == 1,"unauthorized")
    val user = matches.head
    val secret = SecretCodec.token()
    val credential = AccountCredential(user.id,user.userType,"session-" + java.util.UUID.randomUUID().toString,SecretCodec.sha256(secret),true)
    state = state.copy(rows=state.rows :+ MemoryAccountRow(credential,None))
    AccountSession(credential,secret)
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
