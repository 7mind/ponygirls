package manure

import cats.effect.IO
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import java.nio.file.Files
import munit.FunSuite
import ponygirls.auth.{AccountFailure,AccountRequest,CredentialGate,FastPasswordHasher,Password,Secrets,Totp}

/** Specified-origin behavioral blackbox contract; same cases against the
  * handwritten metadata dummy and production PostgreSQL/root/FS adapter.
  */
abstract class AccountsContract(postgres: Boolean) extends FunSuite:
  private def run(body: BackendFixture => IO[Unit]): Unit = BackendFixture.resource(postgres).use(body).unsafeRunSync()
  private def code(error: Throwable): String = error match
    case e: DomainError => e.code
    case e: AccountFailure => e.code
    case e => throw e
  private def rejected[A](work: IO[A],expected: String): IO[Unit] = work.attempt.map { result =>
    assertEquals(result.left.map(code),Left(expected))
  }
  private def changed(f: BackendFixture,users: Vector[UserConfig]): Accounts = new Accounts(f.metadata,new Auth(users))

  test("password sessions are independent durable credentials, never bearer tokens, with no clock deadline") { run { f =>
    val accounts = new Accounts(f.metadata,f.auth)
    for
      (_,first) <- accounts.login("owner","fixture-password",None)
      (_,second) <- accounts.login("owner","fixture-password",None)
      _ <- IO { assert(first.secret != second.secret); assert(first.secret != f.token) }
      cookie <- accounts.browser(first.secret)
      _ <- IO(assertEquals(cookie.map(_.userId),Some(f.identity.userId)))
      sessionBearer <- accounts.bearer(first.secret)
      bearerCookie <- accounts.browser(f.token)
      _ <- IO { assertEquals(sessionBearer,None); assertEquals(bearerCookie,None) }
      _ <- IO { f.clock.now += 1000.0*366*86400 }
      restart = changed(f,f.config.users)
      _ <- restart.initialize()
      persistent <- restart.browser(first.secret)
      _ <- IO(assert(persistent.nonEmpty))
      _ <- restart.logout(first.secret)
      replay <- restart.browser(first.secret)
      independent <- restart.browser(second.secret)
      configured <- restart.bearer(f.token)
      _ <- IO { assertEquals(replay,None); assert(independent.nonEmpty); assertEquals(configured,Some(f.identity)) }
      _ <- rejected(restart.logout(first.secret),"unauthorized")
    yield ()
  }}
  test("password reauthentication replaces only a live prior session and failed login leaves it valid") { run { f =>
    val accounts = new Accounts(f.metadata,f.auth)
    for
      (_,prior) <- accounts.login("owner","fixture-password",None)
      _ <- rejected(accounts.login("owner","wrong-password",Some(prior.secret)),"unauthorized")
      preserved <- accounts.browser(prior.secret)
      _ <- IO(assert(preserved.nonEmpty))
      (_,replacement) <- accounts.login("owner","fixture-password",Some(prior.secret))
      old <- accounts.browser(prior.secret)
      current <- accounts.browser(replacement.secret)
      _ <- IO { assertEquals(old,None); assert(current.nonEmpty) }
      (_,staleRecovery) <- accounts.login("owner","fixture-password",Some(prior.secret))
      recovered <- accounts.browser(staleRecovery.secret)
      _ <- IO(assert(recovered.nonEmpty))
      _ <- Vector("invalid-cookie",SecretCodec.token(),f.token).traverse_ { previous => for
        (_,ignored) <- accounts.login("owner","fixture-password",Some(previous))
        valid <- accounts.browser(ignored.secret)
        independent <- accounts.browser(staleRecovery.secret)
        bearer <- accounts.bearer(f.token)
        _ <- IO { assert(valid.nonEmpty); assert(independent.nonEmpty); assertEquals(bearer,Some(f.identity)) }
      yield () }
    yield ()
  }}
  test("cross-owner password replacement preserves public identities and deletes only the prior session grants") { run { f =>
    val original = f.config.users.find(_.id == f.identity.userId).get
    val target = original.copy(id="replacement-owner\u0000馬",tokens=Vector.empty,login=Some("replacement-owner"))
    val auth = new Auth(f.config.users :+ target)
    val accounts = new Accounts(f.metadata,auth)
    for
      _ <- accounts.initialize()
      gate <- Semaphore[IO](1L)
      service = new Artifacts(f.metadata,f.payloads,f.config.limits,f.clock,auth,f.lease,gate,f.faults)
      (_,prior) <- accounts.login("owner","fixture-password",None)
      priorIdentity <- accounts.browser(prior.secret).map(_.get)
      initialized <- service.init(priorIdentity,InitUpload("replacement grants",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,Vector.empty,None,None))
      id = initialized.artifact.id
      _ <- service.finish(priorIdentity,id)
      pending <- service.createGrant(priorIdentity,id)
      handoff <- service.createGrant(priorIdentity,id)
      (content,_) <- service.redeem(id,handoff)
      (_,independent) <- accounts.login("replacement-owner","fixture-password",None)
      independentIdentity <- accounts.browser(independent.secret).map(_.get)
      independentHandoff <- service.createGrant(independentIdentity,id)
      (independentContent,_) <- service.redeem(id,independentHandoff)
      _ <- rejected(accounts.login("replacement-owner","wrong-password",Some(prior.secret)),"unauthorized")
      preserved <- accounts.browser(prior.secret)
      _ <- service.contentInfo(id,Some(content),None,None)
      _ <- f.metadata.transaction { tx =>
        assertEquals(preserved,Some(priorIdentity))
        assertEquals(tx.oneTime(SecretCodec.sha256(pending)).flatMap(_.userId),Some(original.id))
        assertEquals(tx.content(SecretCodec.sha256(content)).flatMap(_.userId),Some(original.id))
      }
      (user,replacement) <- accounts.login("replacement-owner","fixture-password",Some(prior.secret))
      current <- accounts.browser(replacement.secret)
      old <- accounts.browser(prior.secret)
      other <- accounts.browser(independent.secret)
      _ <- IO {
        assertEquals(user.id,target.id)
        assertEquals(replacement.credential.userId,target.id)
        assertEquals(current.map(_.userId),Some(target.id))
        assertEquals(old,None)
        assertEquals(other,Some(independentIdentity))
      }
      _ <- f.metadata.transaction { tx =>
        assertEquals(tx.oneTime(SecretCodec.sha256(pending)),None)
        assertEquals(tx.oneTime(SecretCodec.sha256(handoff)),None)
        assertEquals(tx.content(SecretCodec.sha256(content)),None)
        assertEquals(tx.content(SecretCodec.sha256(independentContent)).flatMap(_.userId),Some(target.id))
      }
      _ <- rejected(service.redeem(id,pending),"grant-invalid")
      _ <- rejected(service.contentInfo(id,Some(content),None,None),"grant-required")
      _ <- service.contentInfo(id,Some(independentContent),None,None)
      grant <- service.createGrant(current.get,id)
      _ <- IO(assert(SecretCodec.canonical(grant)))
    yield ()
  }}
  test("cookie-only issue/list/revoke preserve configured tokens, ownership, and one-time disclosure") { run { f =>
    val owner = f.config.users.find(_.id == f.identity.userId).get
    val users = f.config.users :+ owner.copy(id="second-human",tokens=Vector.empty,login=Some("second-human"))
    val accounts = changed(f,users)
    val other = changed(f,users)
    for
      _ <- other.initialize()
      (_,session) <- accounts.login("owner","fixture-password",None)
      (_,otherSession) <- other.login("second-human","fixture-password",None)
      issued <- accounts.issue(session.secret,"terminal",Vector(ponygirls.auth.AccountJson.actor(session.credential.userId)))
      before <- accounts.read(session.secret)
      _ <- IO {
        assertEquals(before._2.filter(_.source == "configured").map(_.id),Vector("primary"))
        assertEquals(before._2.find(_.id == issued.token.id),Some(issued.token))
        assert(!before.toString.contains(issued.secret))
      }
      principal <- accounts.bearer(issued.secret)
      _ <- IO { assertEquals(principal.map(_.tokenId),Some(issued.token.id)); assertEquals(issued.token.scopes,Vector("api")) }
      cookie <- accounts.browser(issued.secret)
      _ <- IO(assertEquals(cookie,None))
      _ <- rejected(accounts.read(issued.secret),"unauthorized")
      _ <- rejected(accounts.revoke(session.secret,"primary",Vector(ponygirls.auth.AccountJson.actor(session.credential.userId))),"forbidden")
      _ <- rejected(other.revoke(otherSession.secret,issued.token.id,Vector(ponygirls.auth.AccountJson.actor(otherSession.credential.userId))),"not-found")
      stillLive <- accounts.bearer(issued.secret)
      _ <- IO(assert(stillLive.nonEmpty))
      _ <- accounts.revoke(session.secret,issued.token.id,Vector(ponygirls.auth.AccountJson.actor(session.credential.userId)))
      replay <- accounts.bearer(issued.secret)
      after <- accounts.read(session.secret)
      configured <- accounts.bearer(f.token)
      _ <- IO { assertEquals(replay,None); assert(after._2.find(_.id == issued.token.id).get.revoked); assertEquals(configured,Some(f.identity)) }
    yield ()
  }}
  test("disabled/removed owners invalidate sessions and issued tokens durably across reenable") { run { f =>
    val accounts = new Accounts(f.metadata,f.auth)
    for
      (_,session) <- accounts.login("owner","fixture-password",None)
      issued <- accounts.issue(session.secret,"revoked-by-disable",Vector(ponygirls.auth.AccountJson.actor(session.credential.userId)))
      disabled = changed(f,f.config.users.map(u => if u.id == f.identity.userId then u.copy(enabled=false) else u))
      _ <- disabled.initialize()
      deniedSession <- disabled.browser(session.secret)
      deniedToken <- disabled.bearer(issued.secret)
      _ <- IO { assertEquals(deniedSession,None); assertEquals(deniedToken,None) }
      restored = changed(f,f.config.users)
      _ <- restored.initialize()
      sessionReplay <- restored.browser(session.secret)
      tokenReplay <- restored.bearer(issued.secret)
      _ <- IO { assertEquals(sessionReplay,None); assertEquals(tokenReplay,None) }
      (_,fresh) <- restored.login("owner","fixture-password",None)
      freshToken <- restored.issue(fresh.secret,"revoked-by-remove",Vector(ponygirls.auth.AccountJson.actor(fresh.credential.userId)))
      removed = changed(f,f.config.users.filterNot(_.id == f.identity.userId))
      _ <- removed.initialize()
      _ <- restored.initialize()
      removedSession <- restored.browser(fresh.secret)
      removedToken <- restored.bearer(freshToken.secret)
      _ <- IO { assertEquals(removedSession,None); assertEquals(removedToken,None) }
    yield ()
  }}
  test("password replacement invalidates sessions, not API tokens; malformed password files fail unavailable") { run { f =>
    val accounts = new Accounts(f.metadata,f.auth)
    val file = f.config.users.find(_.id == f.identity.userId).get.passwordHashFile.get
    for
      (_,session) <- accounts.login("owner","fixture-password",None)
      issued <- accounts.issue(session.secret,"survives-password-change",Vector(ponygirls.auth.AccountJson.actor(session.credential.userId)))
      original <- IO.blocking(Files.readString(file))
      _ <- IO.blocking(Files.writeString(file,Password.hash("replacement-password".toCharArray)+"\n"))
      expired <- accounts.browser(session.secret)
      token <- accounts.bearer(issued.secret)
      _ <- IO { assertEquals(expired,None); assert(token.nonEmpty) }
      _ <- rejected(accounts.login("owner","fixture-password",None),"unauthorized")
      (_,fresh) <- accounts.login("owner","replacement-password",None)
      _ <- IO.blocking(Files.writeString(file,original))
      replay <- accounts.browser(session.secret)
      _ <- IO(assertEquals(replay,None))
      _ <- IO.blocking(Files.writeString(file,"malformed\n"))
      _ <- rejected(accounts.browser(fresh.secret),"unavailable")
    yield ()
  }}
  test("publication intent revalidates credentials revoked after the initial finish lookup") { run { f =>
    val accounts = new Accounts(f.metadata,f.auth)
    for
      (_,session) <- accounts.login("owner","fixture-password",None)
      issued <- accounts.issue(session.secret,"publication",Vector(ponygirls.auth.AccountJson.actor(session.credential.userId)))
      principal <- accounts.bearer(issued.secret).map(_.get)
      initialized <- f.artifacts.init(principal,InitUpload("publication race",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,Vector.empty,None,None))
      fired = new java.util.concurrent.atomic.AtomicBoolean(false)
      metadata = new Metadata:
        def transaction[A](body: MetadataTxn => A): IO[A] = f.metadata.transaction(body).flatTap { _ =>
          if fired.compareAndSet(false,true) then accounts.revoke(session.secret,issued.token.id,Vector(ponygirls.auth.AccountJson.actor(session.credential.userId))) else IO.unit
        }
      gate <- Semaphore[IO](1L)
      service = new Artifacts(metadata,f.payloads,f.config.limits,f.clock,f.auth,f.lease,gate,f.faults)
      _ <- rejected(service.finish(principal,initialized.artifact.id),"unauthorized")
      current <- f.artifacts.info(f.identity,initialized.artifact.id)
      _ <- IO(assertEquals(current.state,UploadState.Uploading))
    yield ()
  }}
  test("runtime token revocation prevents grant redemption, metadata access and content reopening") { run { f =>
    val accounts = new Accounts(f.metadata,f.auth)
    for
      (_,session) <- accounts.login("owner","fixture-password",None)
      issued <- accounts.issue(session.secret,"content-authority",Vector(ponygirls.auth.AccountJson.actor(session.credential.userId)))
      principal <- accounts.bearer(issued.secret).map(_.get)
      initialized <- f.artifacts.init(principal,InitUpload("runtime grant",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,Vector.empty,None,None))
      id = initialized.artifact.id
      _ <- f.artifacts.finish(principal,id)
      pending <- f.artifacts.createGrant(principal,id)
      handoff <- f.artifacts.createGrant(principal,id)
      (content,_) <- f.artifacts.redeem(id,handoff)
      _ <- f.artifacts.contentInfo(id,Some(content),None,None)
      _ <- accounts.revoke(session.secret,issued.token.id,Vector(ponygirls.auth.AccountJson.actor(session.credential.userId)))
      _ <- rejected(f.artifacts.redeem(id,pending),"grant-invalid")
      _ <- rejected(f.artifacts.info(principal,id),"unauthorized")
      _ <- rejected(f.artifacts.contentInfo(id,Some(content),None,None),"grant-required")
      _ <- rejected(f.artifacts.openContent(id,"index.html",Some(content),None,None).use(_ => IO.unit),"grant-required")
    yield ()
  }}

  test("imperative names exclude artifact creators and retired ids; a declaration colliding with an account fails startup") { run { f =>
    val key = Files.writeString(f.rootPath.resolveSibling("accounts.key"),Secrets.generate())
    val settings = AccountsConfig(true,Some(key),AccountSignupConfig(true,false,100),AccountsConfig.defaultEnrollment,"Manure (fixture)",Vector.empty)
    val users = f.config.users.filterNot(_.id == "other").map(u => if u.id == "loginonly" then u.copy(admin=true) else u)
    val auth = new Auth(users,Some(settings))
    val accounts = new Accounts(f.metadata,auth)
    val secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    val code = Totp.code(Totp.decodeSecret(secret).get,Totp.stepAt(java.time.Instant.ofEpochSecond(f.clock.now.toLong)))
    def signup(plane: AccountPlane,name: String): IO[Int] = plane.handle(AccountRequest("POST","/signup",Some(io.circe.parser.parse(
      s"""{"username":"$name","email":"$name@example.test","password":"synthetic account password","totpSecret":"$secret","totpCode":"$code","requireTotp":false}""").toOption.get),
      Vector.empty,None,None,"192.0.2.1")).map(_.status)
    CredentialGate.resource.use { gate =>
      val plane = new AccountPlane(f.metadata,auth,accounts,gate,FastPasswordHasher,f.clock)
      for
        initialized <- f.artifacts.init(f.identity,InitUpload("creator",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None,Vector.empty,None,None))
        _ <- f.metadata.transaction(_.put(initialized.artifact.copy(id=SecretCodec.artifactId(),createdByUser="carol")))
        _ <- accounts.initialize()
        statuses <- Vector("carol","other","dave").traverse(signup(plane,_))
        _ <- IO(assertEquals(statuses,Vector(409,409,200)))
        dave = UserConfig("dave","human",Vector.empty,"",login=Some("dave-login"),passwordHashFile=users.head.passwordHashFile)
        _ <- rejected(new Accounts(f.metadata,new Auth(users :+ dave,Some(settings))).initialize(),"config")
        _ <- rejected(new Accounts(f.metadata,new Auth(users :+ dave)).initialize(),"config")
      yield ()
    }
  }}

final class AccountsMemorySuite extends AccountsContract(false)
final class AccountsPostgresSuite extends AccountsContract(true)
