package haystack.auth

import cats.effect.IO
import haystack.domain.{Fault,Principal}
import ponygirls.auth.{AccountCredential,AccountIssued,AccountJson,AccountSession,AccountSql,AccountToken,AccountUser}
import ponygirls.runtime.JdbcDatabase
import java.sql.Connection

final case class AccountView(user:AccountUser,tokens:Vector[AccountToken])
final case class SignedIn(user:AccountUser,session:AccountSession)

/** Reuses the application's connection admission and transaction owner. SQL
  * callbacks never acquire another connection or run an effect synchronously. */
final class AccountService(database:JdbcDatabase,getAuth:()=>Auth) {
  def reconcile(auth:Auth):IO[Unit]=database.transaction(c=>AccountSql.reconcile(c,auth.users))
  private def principal(c:AccountCredential):Principal=Principal(c.userId,c.userType,c.tokenId)
  private def authenticate(auth:Auth,token:String,cookie:Boolean):IO[Option[Principal]]={
    if(cookie)database.transaction(c=>AccountSql.browser(c,auth.users,token).map(principal))
    else auth.authenticate(token) match {
      case Some(value)=>IO.pure(Some(value))
      case None=>database.transaction(c=>AccountSql.bearer(c,auth.users,token).map(principal))
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
    val current=AccountSql.browser(c,auth.users,captured.token).getOrElse(throw Fault("unauthorized","invalid credentials"))
    if(principal(current)!=captured.principal)throw Fault("unauthorized","request authority changed")
    current
  }
  def login(login:String,password:String,previous:Option[String]):IO[SignedIn]=IO.defer {
    val auth=getAuth()
    database.transaction { c=>
      val result=AccountSql.loginReplacing(c,auth.users,login,password,previous)
      SignedIn(auth.user(result.session.credential.userId),result.session)
    }
  }
  def logoutLegacy(captured:Authenticated):IO[Unit]=logoutSession(captured,None)
  def logout(captured:Authenticated,actor:Vector[String]):IO[Unit]=logoutSession(captured,Some(actor))
  private def logoutSession(captured:Authenticated,actor:Option[Vector[String]]):IO[Unit]=IO.defer {
    val auth=getAuth()
    database.transaction { c=>
      val current=browser(c,auth,captured)
      actor.foreach(AccountJson.requireActor(_,current.userId))
      AccountSql.logout(c,auth.users,captured.token)
    }
  }
  def account(captured:Authenticated):IO[AccountView]=IO.defer {
    val auth=getAuth()
    database.transaction { c=>
      val current=browser(c,auth,captured)
      AccountView(auth.user(current.userId),auth.configuredTokens(current.userId)++AccountSql.tokens(c,current.userId))
    }
  }
  def issue(captured:Authenticated,name:String,scopes:Vector[String],actor:Vector[String]):IO[AccountIssued]=IO.defer {
    if(scopes!=Vector("api"))throw Fault("forbidden","invalid token scopes")
    val auth=getAuth()
    database.transaction { c=>
      val current=browser(c,auth,captured)
      AccountJson.requireActor(actor,current.userId)
      AccountSql.issue(c,auth.users,current,name)
    }
  }
  def revoke(captured:Authenticated,id:String,actor:Vector[String]):IO[Unit]=IO.defer {
    val auth=getAuth()
    database.transaction { c=>
      val current=browser(c,auth,captured)
      AccountJson.requireActor(actor,current.userId)
      if(auth.configuredTokens(current.userId).exists(_.id==id))throw Fault("forbidden","configured tokens are immutable")
      AccountSql.revoke(c,auth.users,current,id)
    }
  }
}
