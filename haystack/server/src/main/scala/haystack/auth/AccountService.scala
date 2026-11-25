package haystack.auth

import cats.effect.{IO,Resource}
import haystack.domain.{Fault,Principal}
import io.circe.Json
import ponygirls.auth.{AccountCredential,AccountFailure,AccountIssued,AccountJson,AccountReply,AccountRequest,AccountSql,AccountToken,AccountUser,AttemptLimiter,CredentialGate,DeclarativeLogin,IdentityHistory,IndexingAccountTransactions,IndexingPolicy,IndexingPreferenceSql,IndexingPreferences,IndexingService,ImperativeAccountApi,ImperativeAccountSql,ImperativeAccounts,ImperativeSettings,ImperativeTransactions,PasswordHasher,AccountEndpoint,SharedAccountSessions,SignedIn}
import ponygirls.runtime.JdbcDatabase
import java.sql.Connection
import java.time.Clock
import scala.util.Using

final case class AccountView(user:AccountUser,tokens:Vector[AccountToken])

/** Long-lived parts of imperative accounts: the shared dispatcher with its in-memory windows and credential
  * gate, and the clock and password hasher of the imperative core. */
final class ImperativeRuntime private(val api:ImperativeAccountApi,val clock:Clock,val hasher:PasswordHasher)
object ImperativeRuntime {
  def resource(clock:Clock,hasher:PasswordHasher):Resource[IO,ImperativeRuntime]=
    CredentialGate.resource.map(gate=>new ImperativeRuntime(new ImperativeAccountApi(new AttemptLimiter(AttemptLimiter.Capacity,clock),gate),clock,hasher))
}

/** Retained identities (design §4.1.3 rule 3): fingerprint rows, live or tombstoned, and every author or
  * replay identity stored in Haystack data, compared ASCII case-insensitively like the fingerprints. */
private final class HaystackIdentityHistory(c:Connection,fingerprints:IdentityHistory) extends IdentityHistory {
  private val Fold="translate(%s,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=?"
  private val Columns=Vector("items"->"created_by","items"->"modified_by","item_revisions"->"modified_by","write_requests"->"principal_user")
  private val Retained=Columns.map((table,column)=>s"EXISTS(SELECT 1 FROM $table WHERE ${Fold.format(column)})").mkString("SELECT ", " OR ", "")
  def retained(username:String):Boolean=fingerprints.retained(username) || Using.resource(c.prepareStatement(Retained)) { statement=>
    Columns.indices.foreach(index=>statement.setString(index+1,username))
    Using.resource(statement.executeQuery())(result=>result.next() && result.getBoolean(1))
  }
}

/** Reuses the application's connection admission and transaction owner. SQL
  * callbacks never acquire another connection or run an effect synchronously.
  * Every account decision uses the merged directory: the declared users plus,
  * while `auth.accounts.enabled` is on, the active imperative users. */
final class AccountService(database:JdbcDatabase,getAuth:()=>Auth,imperative:ImperativeRuntime,indexingPolicy:IndexingPolicy=IndexingPolicy.defaults) {
  private def directory(c:Connection,auth:Auth):Vector[AccountUser]=ImperativeAccountSql.directory(c,auth.imperative,auth.declared)
  /** Startup and every reload (design §4.8.5): under the directory lock, a declared id or login equal to an
    * active or disabled imperative account fails closed before the declared directory is reconciled. */
  def install(auth:Auth):IO[Unit]=database.transaction(c=>ImperativeAccountSql.installDeclared(c,auth.declared)(AccountSql.reconcile(c,auth.users)))
  /** One reload: the next configuration is published only once installed, otherwise its failure is published
    * and every request fails closed until the configuration is repaired. */
  def reloaded(next:IO[Auth]):IO[Either[Throwable,Auth]]=next.flatTap(install).attempt
  /** Active imperative accounts that the master switch being off suspends. */
  def suspended(auth:Auth):IO[Int]=
    if(auth.imperative.nonEmpty)IO.pure(0)
    else database.transaction(c=>Using.resource(c.prepareStatement("SELECT count(*) FROM ponygirls_imperative_users WHERE status='active'")) { statement=>
      Using.resource(statement.executeQuery()) { result=>result.next();result.getInt(1) }
    })
  private def principal(c:AccountCredential):Principal=Principal(c.userId,c.userType,c.tokenId)
  private def user(users:Vector[AccountUser],id:String):AccountUser=users.find(u=>u.id==id && u.enabled).getOrElse(throw Fault("unauthorized","invalid credentials"))
  private def authenticate(auth:Auth,token:String,cookie:Boolean):IO[Option[Principal]]={
    if(cookie)database.transaction(c=>AccountSql.browser(c,directory(c,auth),token).map(principal))
    else auth.authenticate(token) match {
      case Some(value)=>IO.pure(Some(value))
      case None=>database.transaction(c=>AccountSql.bearer(c,directory(c,auth),token).map(principal))
    }
  }
  def resolve(headers:RequestHeaders,mutate:Boolean=false,mcp:Boolean=false):IO[Authenticated]=IO.defer {
    val auth=getAuth();val selected=Sessions.resolve(auth.config,headers,mutate,mcp)
    authenticate(auth,selected.token,selected.cookie).map { value=>
      Authenticated(value.getOrElse(throw Fault("unauthorized","invalid credentials")),selected.token,selected.cookie,selected.secureCookie)
    }
  }
  def live(captured:Authenticated):IO[Boolean]=IO.defer {
    authenticate(getAuth(),captured.token,captured.cookie).map(_.contains(captured.principal))
  }
  private def browser(c:Connection,auth:Auth,captured:Authenticated):AccountCredential={
    if(!captured.cookie)throw Fault("unauthorized","browser session required")
    val current=AccountSql.browser(c,directory(c,auth),captured.token).getOrElse(throw Fault("unauthorized","invalid credentials"))
    if(principal(current)!=captured.principal)throw Fault("unauthorized","request authority changed")
    current
  }
  /** The declarative password login; a refusal is raised, because it persists nothing (design D27). */
  private val declarativeLogin:DeclarativeLogin=(login,password,previous)=>database.transaction { c=>
    val users=directory(c,getAuth())
    val result=AccountSql.loginReplacing(c,users,login,password,previous)
    SignedIn(user(users,result.session.credential.userId),result.session)
  }
  def login(login:String,password:String,previous:Option[String]):IO[SignedIn]=declarativeLogin.login(login,password,previous)
  /** One database transaction per imperative operation; it commits whatever the operation returns, so rejections
    * keep their failure counters (design D27). The configuration is read inside the transaction, never taken from
    * the request: a reload published while the request waited (for its body or the credential gate) decides it —
    * suspension, creation flags and admin flags take effect, and a failed reload fails it closed. */
  private val transactions:ImperativeTransactions=new ImperativeTransactions {
    def run[A](work:ImperativeAccounts=>A):IO[A]=database.transaction { c=>
      val auth=getAuth()
      work(accountCore(c,auth,()=>directory(c,auth)))
    }
  }
  private def accountCore(c:Connection,auth:Auth,liveDirectory:()=>Vector[AccountUser]):ImperativeAccounts={
    val sessions=new SharedAccountSessions(c,identity,liveDirectory)
    ImperativeAccountSql.accounts(c,auth.imperative,auth.declared,sessions,new HaystackIdentityHistory(c,sessions),imperative.hasher,imperative.clock)
  }
  /** `POST /login` while the master switch is on: declared logins take `declarativeLogin`, every other login
    * the imperative decision; the reply is decided after commit. `auth` is the snapshot taken after the body
    * was read; it routes the request, and each transaction rereads the configuration. */
  def imperativeLogin(auth:Auth,settings:ImperativeSettings,body:Json,presented:Option[String],clientAddress:String):IO[AccountReply]=
    imperative.api.login(settings,auth.declared,transactions,declarativeLogin,
      AccountRequest(AccountEndpoint.Post,AccountService.LoginPath,Some(body),Vector.empty,None,presented,clientAddress))
  /** Every account path other than the five existing endpoints. The presented cookie is resolved under the
    * merged directory; the dispatcher revalidates it under its owner's lock before any effect. */
  def imperativeRequest(auth:Auth,settings:ImperativeSettings,method:String,path:String,body:Option[Json],actor:Vector[String],presented:Option[String],clientAddress:String):IO[AccountReply]={
    accountRequest(auth,method,path,body,actor,presented,clientAddress)
      .flatMap(imperative.api.handle(Some(settings),auth.declared,transactions,_))
  }
  def indexingRequest(auth:Auth,method:String,path:String,body:Option[Json],actor:Vector[String],presented:Option[String],clientAddress:String):IO[AccountReply]={
    val indexing=new IndexingAccountTransactions {
      def run[A](work:(ImperativeAccounts,IndexingPreferences)=>A):IO[A]=database.transaction { c=>
        // Called with the account owner locks held, after any wait for a proof slot or those locks. A
        // role-only reload need not change a session fingerprint, so check the admitted snapshot too.
        def liveDirectory():Vector[AccountUser]={
          val current=getAuth()
          if((current ne auth) && (current.config!=auth.config || current.declared!=auth.declared)) throw AccountFailure("conflict")
          directory(c,current)
        }
        work(accountCore(c,auth,liveDirectory),IndexingPreferenceSql.store(c,IndexingService.Haystack,indexingPolicy))
      }
    }
    accountRequest(auth,method,path,body,actor,presented,clientAddress)
      .flatMap(imperative.api.handleIndexing(indexingPolicy,auth.declared,indexing,_))
  }
  private def accountRequest(auth:Auth,method:String,path:String,body:Option[Json],actor:Vector[String],presented:Option[String],clientAddress:String):IO[AccountRequest]={
    val session=presented.filter(Tokens.canonical) match {
      case None=>IO.pure(None)
      case Some(token)=>database.transaction(c=>AccountSql.browser(c,directory(c,auth),token))
    }
    session.map(found=>AccountRequest(method,path,body,actor,found,presented,clientAddress))
  }
  def logoutLegacy(captured:Authenticated):IO[Unit]=logoutSession(captured,None)
  def logout(captured:Authenticated,actor:Vector[String]):IO[Unit]=logoutSession(captured,Some(actor))
  private def logoutSession(captured:Authenticated,actor:Option[Vector[String]]):IO[Unit]=IO.defer {
    val auth=getAuth()
    database.transaction { c=>
      val current=browser(c,auth,captured)
      actor.foreach(AccountJson.requireActor(_,current.userId))
      AccountSql.logout(c,directory(c,auth),captured.token)
    }
  }
  def account(captured:Authenticated):IO[AccountView]=IO.defer {
    val auth=getAuth()
    database.transaction { c=>
      val current=browser(c,auth,captured)
      AccountView(user(directory(c,auth),current.userId),auth.configuredTokens(current.userId)++AccountSql.tokens(c,current.userId))
    }
  }
  def issue(captured:Authenticated,name:String,scopes:Vector[String],actor:Vector[String]):IO[AccountIssued]=IO.defer {
    if(scopes!=Vector("api"))throw Fault("forbidden","invalid token scopes")
    val auth=getAuth()
    database.transaction { c=>
      val current=browser(c,auth,captured)
      AccountJson.requireActor(actor,current.userId)
      AccountSql.issue(c,directory(c,auth),current,name)
    }
  }
  def revoke(captured:Authenticated,id:String,actor:Vector[String]):IO[Unit]=IO.defer {
    val auth=getAuth()
    database.transaction { c=>
      val current=browser(c,auth,captured)
      AccountJson.requireActor(actor,current.userId)
      if(auth.configuredTokens(current.userId).exists(_.id==id))throw Fault("forbidden","configured tokens are immutable")
      AccountSql.revoke(c,directory(c,auth),current,id)
    }
  }
}
object AccountService {
  /** `POST /login` relative to `/api/account/v1`. */
  private val LoginPath="/login"
}
