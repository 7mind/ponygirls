package chronicle

import cats.effect.{IO,Ref}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import scala.concurrent.duration.*
import chronicle.api.*
import java.util.UUID

trait RunAuthorizationFixture {
  def authorization: RunAuthorization
  def identity: Identity
  def revokeSession(): IO[Unit]
  def revokeSharing(): IO[Unit]
  def restoreSharing(): IO[Unit]
  def truncateSharing(): IO[Unit]
  def disableReader(): IO[Unit]
  def purgeSource(): IO[Unit]
  def updateSource(): IO[Unit]
}

abstract class RunAuthorizationContract extends munit.FunSuite {
  def withFixture(f: RunAuthorizationFixture => IO[Unit]): Unit

  test("BG/GoodCommunication: captured authority is rechecked without retaining an original browser secret") { withFixture { f =>
    for {
      stamp <- f.authorization.capture(f.identity)
      current <- f.authorization.verify(stamp)
      _ <- IO {
        assertEquals(current.user.id,f.identity.user.id)
        assert(!stamp.toString.contains(f.identity.credentialHash))
      }
    } yield ()
  }}
  test("BG/GoodCommunication: new source data does not revoke immutable prior views") { withFixture { f =>
    for {
      stamp <- f.authorization.capture(f.identity)
      _ <- f.updateSource()
      current <- f.authorization.verify(stamp)
      _ <- IO(assertEquals(current.user.id,f.identity.user.id))
    } yield ()
  }}
  List[(String,RunAuthorizationFixture => IO[Unit])](
    "session revocation" -> (_.revokeSession()),
    "sharing revocation" -> (_.revokeSharing()),
    "sharing truncation" -> (_.truncateSharing()),
    "disabled reader" -> (_.disableReader()),
    "source purge" -> (_.purgeSource())
  ).foreach { case (label,change) =>
    test(s"BG/GoodCommunication: $label invalidates previously captured run authority") { withFixture { f =>
      for {
        stamp <- f.authorization.capture(f.identity)
        _ <- change(f)
        outcome <- f.authorization.verify(stamp).attempt
        _ <- IO(outcome match {
          case Left(error: DomainError) => assert(Set("unauthorized","authorization-changed").contains(error.code))
          case other => fail(s"expected authority invalidation, obtained ${other.map(_ => "accepted").left.map(_.getClass.getName)}")
        })
      } yield ()
    }}
  }
  test("BG/GoodCommunication: restoring sharing cannot revive a superseded authority stamp") { withFixture { f =>
    for {
      stamp <- f.authorization.capture(f.identity)
      _ <- f.revokeSharing()
      _ <- f.restoreSharing()
      fresh <- f.authorization.capture(f.identity)
      _ <- f.authorization.verify(fresh)
      old <- f.authorization.verify(stamp).attempt
      _ <- IO(old match {
        case Left(error: DomainError) => assertEquals(error.code,"authorization-changed")
        case _ => fail("obsolete authority revived after sharing returned to its prior state")
      })
    } yield ()
  }}
  test("BG/GoodCommunication: browser and Read scopes are prerequisites") { withFixture { f =>
    val identities=List(f.identity.copy(browser=false),f.identity.copy(user=f.identity.user.copy(scopes=Nil)))
    IO.traverse(identities)(i => f.authorization.capture(i).attempt).flatMap { outcomes => IO {
      outcomes.foreach {
        case Left(error: DomainError) => assertEquals(error.code,"forbidden")
        case _ => fail("unauthorized capture accepted")
      }
    }}
  }}
}

final class DummyRunAuthorizationTest extends RunAuthorizationContract {
  private final case class State(valid: Boolean,revision: Long)
  def withFixture(f: RunAuthorizationFixture => IO[Unit]): Unit = {
    val reader=Identity(UserInfo("b","b",List(Scope.Read)),true,Wire.hash(Wire.secret()))
    val program=for {
      state <- Ref.of[IO,State](State(true,0L))
      guard=new RunAuthorization {
        def capture(i: Identity): IO[RunAuthority] = IO {
          i.requireBrowser(); i.requireScope(Scope.Read)
        } *> state.get.flatMap { current => IO {
          Check(current.valid && i.credentialHash==reader.credentialHash && i.user.id==reader.user.id,"unauthorized","session revoked")
          RunAuthority(reader,current.revision)
        }}
        def verify(authority: RunAuthority): IO[Identity] = capture(authority.identity).map { current =>
          Check(current.revision==authority.revision,"authorization-changed","access changed")
          current.identity
        }
      }
      fixture=new RunAuthorizationFixture {
        def authorization: RunAuthorization = guard
        def identity: Identity = reader
        def revokeSession(): IO[Unit] = state.update(_.copy(valid=false))
        def revokeSharing(): IO[Unit] = state.update(s => s.copy(revision=s.revision+1))
        def restoreSharing(): IO[Unit] = state.update(s => s.copy(revision=s.revision+1))
        def truncateSharing(): IO[Unit] = state.update(s => s.copy(revision=s.revision+1))
        def disableReader(): IO[Unit] = state.update(_.copy(valid=false))
        def purgeSource(): IO[Unit] = state.update(s => s.copy(revision=s.revision+1))
        def updateSource(): IO[Unit] = IO.unit
      }
      _ <- f(fixture)
    } yield ()
    program.unsafeRunSync()
  }
}

final class PostgresRunAuthorizationTest extends RunAuthorizationContract {
  def withFixture(f: RunAuthorizationFixture => IO[Unit]): Unit = withDatabaseFixture((fixture,_) => f(fixture))
  private def withDatabaseFixture(f: (RunAuthorizationFixture,Database) => IO[Unit]): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) {
      Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required")
      assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh")
    }
    val config=Fixtures.config()
    val db=new Database(config,IndexProfileCatalog.legacyOnly(config))
    db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_sources,ch_groups,ch_sessions CASCADE")
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile)
      config.users.foreach(user => Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0 WHERE owner=?",config.profile,user.id))
    }
    val auth=new Auth(db,config)
    val archive=new PostgresArchive(db,config)
    val original=Fixtures.snapshot()
    val source=archive.ingest("a",original)
    assert(archive.publish(archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get,Nil))
    val group=UUID.randomUUID()
    db.transaction { c =>
      Sql.exec(c,"INSERT INTO ch_groups VALUES(?,?,?)",group,"a","synthetic sharing")
      Sql.exec(c,"INSERT INTO ch_members VALUES(?,?),(?,?)",group,"a",group,"b")
    }
    val reader=auth.browser(auth.login(LoginRequest("b","synthetic"))._2)
    val owner=auth.browser(auth.login(LoginRequest("a","synthetic"))._2)
    assertEquals(archive.session("b",source.sessionId).ownerId,"a")
    val authority=new PostgresRunAuthorization(db,auth)
    val fixture=new RunAuthorizationFixture {
      def authorization: RunAuthorization = authority
      def identity: Identity = reader
      def revokeSession(): IO[Unit] = IO.blocking(auth.logout(reader))
      def revokeSharing(): IO[Unit] = IO.blocking(db.transaction { c =>
        Sql.exec(c,"DELETE FROM ch_members WHERE group_id=? AND user_id=?",group,"b"); ()
      })
      def restoreSharing(): IO[Unit] = IO.blocking(db.transaction { c =>
        Sql.exec(c,"INSERT INTO ch_members VALUES(?,?)",group,"b"); ()
      })
      def truncateSharing(): IO[Unit] = IO.blocking(db.transaction { c =>
        Sql.exec(c,"TRUNCATE ch_members"); ()
      })
      def disableReader(): IO[Unit] = IO.blocking(db.transaction { c =>
        Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id=?","b"); ()
      })
      def purgeSource(): IO[Unit] = IO.blocking {
        auth.mutate(owner,ClientEnvelope(UUID.randomUUID(),Operation.Purge(source.sessionId))); ()
      }
      def updateSource(): IO[Unit] = IO.blocking {
        archive.ingest("a",original.copy(requestId=UUID.randomUUID(),expectedRevision=1,metadata=original.metadata.copy(title="new synthetic head"))); ()
      }
    }
    f(fixture,db).unsafeRunSync()
  }

  test("GoodCommunication: ordinary database startup registers the authorization epoch migration") { withDatabaseFixture { (_,db) =>
    IO.blocking(db.transaction { c =>
      assert(SecurityEpoch.current(c)>=0L)
      List(9,14).foreach(version => assertEquals(Sql.one(c,"SELECT version FROM ch_schema_migrations WHERE version=?",version)(_.getInt(1)),Some(version)))
    })
  }}

  List("hash change","owner change","expiry reduction","expired revival").foreach { change =>
    test(s"BG GoodCommunication specified: $change on an unrelated session invalidates captured authority") { withDatabaseFixture { (f,db) =>
      val hash=Wire.hash(Wire.secret())
      for {
        _ <- IO.blocking(db.transaction { c =>
          val lifetime=if(change=="expired revival") "-interval '1 second'" else "+interval '1 day'"
          Sql.exec(c,s"INSERT INTO ch_sessions VALUES(?,?,clock_timestamp()$lifetime)",hash,"a")
        })
        stamp <- f.authorization.capture(f.identity)
        _ <- IO.blocking(db.transaction { c => change match {
          case "hash change" => Sql.exec(c,"UPDATE ch_sessions SET hash=? WHERE hash=?",Wire.hash(Wire.secret()),hash)
          case "owner change" => Sql.exec(c,"UPDATE ch_sessions SET owner=? WHERE hash=?","c",hash)
          case "expiry reduction" => Sql.exec(c,"UPDATE ch_sessions SET expires=clock_timestamp()+interval '1 hour' WHERE hash=?",hash)
          case "expired revival" => Sql.exec(c,"UPDATE ch_sessions SET expires=clock_timestamp()+interval '1 day' WHERE hash=?",hash)
        }})
        rejected <- f.authorization.verify(stamp).attempt
        _ <- IO(rejected match {
          case Left(error: DomainError) => assertEquals(error.code,"authorization-changed")
          case _ => fail("security-relevant session update failed to invalidate unrelated authority")
        })
        fresh <- f.authorization.capture(f.identity)
        _ <- f.authorization.verify(fresh)
      } yield ()
    }}
  }

  test("GoodCommunication: natural session expiry is checked even when the security epoch is unchanged") { withDatabaseFixture { (f,db) =>
    for {
      _ <- IO.blocking(db.transaction(c => Sql.exec(c,"UPDATE ch_sessions SET expires=now()+interval '500 milliseconds' WHERE hash=?",f.identity.credentialHash)))
      stamp <- f.authorization.capture(f.identity)
      _ <- IO.sleep(600.millis)
      unchanged <- IO.blocking(db.transaction(SecurityEpoch.current))
      expired <- f.authorization.verify(stamp).attempt
      _ <- IO {
        assertEquals(unchanged,stamp.revision)
        expired match {
          case Left(error: DomainError) => assertEquals(error.code,"unauthorized")
          case _ => fail("expired browser authority accepted")
        }
      }
    } yield ()
  }}

  test("GoodCommunication: reassigning a stored session hash cannot change a run's principal") { withDatabaseFixture { (f,db) =>
    for {
      _ <- IO.blocking(db.transaction(c => Sql.exec(c,"UPDATE ch_sessions SET owner=? WHERE hash=?","c",f.identity.credentialHash)))
      result <- f.authorization.capture(f.identity).attempt
      _ <- IO(result match {
        case Left(error: DomainError) => assertEquals(error.code,"unauthorized")
        case _ => fail("session principal changed during authority refresh")
      })
    } yield ()
  }}
}
