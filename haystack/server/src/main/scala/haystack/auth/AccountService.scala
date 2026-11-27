package haystack.auth

import cats.effect.IO
import haystack.domain.{Fault,Principal}
import io.circe.Json
import ponygirls.auth.{AccountIssued,AccountRefusal,AccountRefused,AccountReply,Authority,Captured,ConnectionTransactions,DeclarativeAccountService,IdentityHistory,IndexingPolicy,IndexingService,ImperativeSettings,SharedAccountStorage,SignedIn}
import ponygirls.auth.boundary
import ponygirls.runtime.JdbcDatabase
import java.sql.Connection
import scala.util.Using

type AccountView=ponygirls.auth.AccountView
val AccountView=ponygirls.auth.AccountView
type ImperativeRuntime=ponygirls.auth.ImperativeRuntime
val ImperativeRuntime=ponygirls.auth.ImperativeRuntime

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

/** Haystack's account service: the shared `DeclarativeAccountService` over the shared tables in Haystack's
  * transactions, with Haystack's retained identities and `Fault`s. Reuses the application's connection admission
  * and transaction owner. Every account decision uses the merged directory: the declared users plus, while
  * `auth.accounts.enabled` is on, the active imperative users. */
final class AccountService(database:JdbcDatabase,getAuth:()=>Auth,imperative:ImperativeRuntime,indexingPolicy:IndexingPolicy=IndexingPolicy.defaults) {
  private val transactions=new ConnectionTransactions { def transaction[A](work:Connection=>A):IO[A]=database.transaction(work) }
  private[haystack] val shared=new DeclarativeAccountService[Auth](new SharedAccountStorage(transactions,(c,sessions)=>new HaystackIdentityHistory(c,sessions)),
    getAuth,imperative,IndexingService.Haystack,indexingPolicy)
  private def faults[A](operation:IO[A]):IO[A]=operation.adaptError { case refused:AccountRefused=>AccountService.translated(refused) }
  def install(auth:Auth):IO[Unit]=faults(shared.install(auth))
  def reloaded(next:IO[Auth]):IO[Either[Throwable,Auth]]=shared.reloaded(next)
  def suspended(auth:Auth):IO[Int]=faults(shared.suspended(auth))
  def resolve(headers:RequestHeaders,mutate:Boolean=false,mcp:Boolean=false):IO[Authenticated]=
    faults(shared.resolve(auth=>Sessions.select(auth.config,headers,mutate,mcp))).map(AccountService.authenticated)
  def live(captured:Authenticated):IO[Boolean]=faults(shared.live(AccountService.captured(captured)))
  def login(login:String,password:String,previous:Option[String]):IO[SignedIn]=faults(shared.login(login,password,previous))
  def imperativeLogin(auth:Auth,settings:ImperativeSettings,body:Json,presented:Option[String],clientAddress:String):IO[AccountReply]=
    faults(shared.imperativeLogin(auth,settings,body,presented,clientAddress))
  def imperativeRequest(auth:Auth,settings:ImperativeSettings,method:String,path:String,body:Option[Json],actor:Vector[String],presented:Option[String],clientAddress:String):IO[AccountReply]=
    faults(shared.imperativeRequest(auth,settings,method,path,body,actor,presented,clientAddress))
  def indexingRequest(auth:Auth,method:String,path:String,body:Option[Json],actor:Vector[String],presented:Option[String],clientAddress:String):IO[AccountReply]=
    faults(shared.indexingRequest(auth,method,path,body,actor,presented,clientAddress))
  def logoutLegacy(captured:Authenticated):IO[Unit]=faults(shared.logout(AccountService.captured(captured),None))
  def logout(captured:Authenticated,actor:Vector[String]):IO[Unit]=faults(shared.logout(AccountService.captured(captured),Some(actor)))
  def account(captured:Authenticated):IO[AccountView]=faults(shared.account(AccountService.captured(captured)))
  def issue(captured:Authenticated,name:String,scopes:Vector[String],actor:Vector[String]):IO[AccountIssued]=faults(shared.issue(AccountService.captured(captured),name,scopes,actor))
  def revoke(captured:Authenticated,id:String,actor:Vector[String]):IO[Unit]=faults(shared.revoke(AccountService.captured(captured),id,actor))
}
object AccountService {
  /** Haystack's failure codes and messages for the refusals of the shared account service. */
  def fault(refusal:AccountRefusal):Fault=refusal match {
    case AccountRefusal.InvalidCredentials=>Fault("unauthorized","invalid credentials")
    case AccountRefusal.BrowserSessionRequired=>Fault("unauthorized","browser session required")
    case AccountRefusal.AuthorityChanged=>Fault("unauthorized","request authority changed")
    case AccountRefusal.InvalidTokenScopes=>Fault("forbidden","invalid token scopes")
    case AccountRefusal.ConfiguredTokenImmutable=>Fault("forbidden","configured tokens are immutable")
  }
  /** Haystack's `Fault` for a refusal of the shared account service. */
  def translated(refused:AccountRefused):Fault={
    val translated=fault(refused.refusal)
    refused.getSuppressed.foreach(translated.addSuppressed)
    translated
  }
  def principal(authority:Authority):Principal=Principal(authority.userId,authority.userType,authority.tokenId)
  def authenticated(captured:Captured):Authenticated=
    Authenticated(principal(captured.authority),captured.presented.secret,captured.presented.cookie,captured.presented.secureCookie)
  def captured(authenticated:Authenticated):Captured=Captured(Authority(authenticated.principal.userId,authenticated.principal.userType,authenticated.principal.tokenId),
    boundary.Presented(authenticated.token,authenticated.cookie,authenticated.secureCookie))
}
