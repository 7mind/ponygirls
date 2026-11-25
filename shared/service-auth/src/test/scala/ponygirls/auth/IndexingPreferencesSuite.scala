package ponygirls.auth

import java.sql.{Connection, DriverManager}
import java.util.UUID
import java.util.concurrent.{Callable, Executors, TimeUnit}
import scala.concurrent.duration.*
import scala.util.Using

abstract class IndexingPreferencesContract extends munit.FunSuite {
  import IndexingChoice.*
  protected def withStores(test: (IndexingPreferences, IndexingPreferences) => Unit): Unit
  private val policy = IndexingPolicy.defaults

  test("preferences are per exact account id and per service") {
    withStores { (manure, haystack) =>
      val owner = "A\u0000é"
      assertEquals(manure.get(owner), IndexingPreference.inherited)
      assertEquals(manure.setChoice(owner, Disable), IndexingPreference(Disable, Inherit, 1))
      assertEquals(manure.get(owner), IndexingPreference(Disable, Inherit, 1))
      assertEquals(manure.get("a\u0000é"), IndexingPreference.inherited)
      assertEquals(manure.get("A\u0000e\u0301"), IndexingPreference.inherited)
      assertEquals(haystack.get(owner), IndexingPreference.inherited)
    }
  }

  test("explicit choices survive an override and disabling then enabling advances the fence") {
    withStores { (store, _) =>
      val owner = "test-owner"
      assertEquals(store.setChoice(owner, Enable), IndexingPreference(Enable, Inherit, 0))
      val disabled = store.setOverride(owner, Disable)
      assertEquals(disabled, IndexingPreference(Enable, Disable, 1))
      assert(!disabled.enabled(policy))
      assertEquals(store.setOverride(owner, Disable), disabled)
      val restored = store.setOverride(owner, Inherit)
      assertEquals(restored, IndexingPreference(Enable, Inherit, 2))
      assert(restored.enabled(policy))
      assertEquals(store.setChoice(owner, Inherit), IndexingPreference(Inherit, Inherit, 2))
      assertEquals(store.get(owner), IndexingPreference(Inherit, Inherit, 2))
    }
  }
}

final class MemoryIndexingPreferencesSuite extends IndexingPreferencesContract {
  protected def withStores(test: (IndexingPreferences, IndexingPreferences) => Unit): Unit = {
    def fresh(): IndexingPreferences = new IndexingPreferences {
      private var values = Map.empty[String, IndexingPreference]
      def lock(owner: String): Unit = ()
      def get(owner: String): IndexingPreference = values.getOrElse(owner, IndexingPreference.inherited)
      private def save(owner: String, wanted: IndexingPreference): IndexingPreference = {
        val previous = get(owner)
        val policy = IndexingPolicy.defaults
        val saved = if (previous.enabled(policy) == wanted.enabled(policy)) wanted else wanted.copy(epoch = wanted.epoch + 1)
        values += owner -> saved
        saved
      }
      def setChoice(owner: String, choice: IndexingChoice): IndexingPreference = save(owner, get(owner).copy(choice = choice))
      def setOverride(owner: String, overrideChoice: IndexingChoice): IndexingPreference = save(owner, get(owner).copy(overrideChoice = overrideChoice))
    }
    test(fresh(), fresh())
  }
}

final class PostgresIndexingPreferencesSuite extends IndexingPreferencesContract {
  private def connection(): Connection = {
    val jdbc = sys.env.get("ACCOUNT_TEST_JDBC")
    if (jdbc.isEmpty) {
      assert(!sys.env.contains("ACCOUNT_REQUIRE_POSTGRES"), "PostgreSQL required")
      assume(false, "PostgreSQL explicitly skipped: use shared/service-auth/scripts/test-postgres.sh")
    }
    val c = DriverManager.getConnection(jdbc.get, "account_test", "synthetic-test-password")
    c.setAutoCommit(false)
    c
  }
  private def database[A](run: Connection => A): A = Using.resource(connection()) { c =>
    IndexingPreferenceSql.initialize(c)
    c.commit()
    try run(c) finally c.rollback()
  }
  protected def withStores(test: (IndexingPreferences, IndexingPreferences) => Unit): Unit = database { c =>
    test(IndexingPreferenceSql.store(c, IndexingService.Manure, IndexingPolicy.defaults),
      IndexingPreferenceSql.store(c, IndexingService.Haystack, IndexingPolicy.defaults))
  }

  test("SQL eligibility and generation fences use all producers; changes survive commit and not rollback") {
    import IndexingChoice.*
    import IndexingPreferenceSql.*
    val service = IndexingService.Haystack
    val editor = UUID.randomUUID().toString
    val creator = UUID.randomUUID().toString
    def state(c: Connection, default: Boolean): (Boolean, Long) = {
      val keys = s"ARRAY[${ownerKeySql("?::text")},?::text]"
      val eligible = allowsAllSql(service, default, "v.owner_keys")
      val epoch = epochSql(service, "v.owner_keys")
      Using.resource(c.prepareStatement(s"SELECT $eligible,$epoch FROM (SELECT $keys AS owner_keys) v")) { p =>
        p.setString(1, editor)
        p.setString(2, ownerKey(creator))
        Using.resource(p.executeQuery()) { result =>
          assert(result.next())
          (result.getBoolean(1), result.getLong(2))
        }
      }
    }
    database { c =>
      val settings = store(c, service, IndexingPolicy.defaults)
      assertEquals(state(c, true), (true, 0L))
      assertEquals(state(c, false), (false, 0L))
      settings.setChoice(creator, Enable)
      settings.setChoice(editor, Disable)
      assertEquals(state(c, true), (false, 1L))
      c.commit()
      assertEquals(state(c, true), (false, 1L))
      settings.setOverride(editor, Enable)
      assertEquals(state(c, true), (true, 2L))
      assertEquals(state(c, false), (true, 2L))
      c.rollback()
      assertEquals(state(c, true), (false, 1L))
      c.rollback()
      settings.setChoice(creator, Inherit)
      settings.setChoice(editor, Inherit)
      assertEquals(state(c, true), (true, 2L))
      // The committed decision is isolated by test id; the outer runner owns the disposable database.
    }
  }

  test("a write waits for admitted work's DB transaction without holding up other owners") {
    import IndexingChoice.*
    import IndexingPreferenceSql.*
    val service = IndexingService.Chronicle
    val owner = UUID.randomUUID().toString
    val other = UUID.randomUUID().toString
    def scalar(c: Connection, sql: String): Int = Using.resource(c.createStatement()) { statement =>
      Using.resource(statement.executeQuery(sql)) { r => assert(r.next()); r.getInt(1) }
    }
    database { worker =>
      val workerPid = scalar(worker, "SELECT pg_backend_pid()")
      lockRead(worker, service, List(ownerKey(owner)))
      val pool = Executors.newFixedThreadPool(2)
      def disable(id: String) = pool.submit(new Callable[IndexingPreference] {
        def call(): IndexingPreference = Using.resource(connection()) { writer =>
          val result = store(writer, service, IndexingPolicy.defaults).setOverride(id, Disable)
          writer.commit()
          result
        }
      })
      try {
        val sameOwner = disable(owner)
        Using.resource(connection()) { observer =>
          val blockers = s"SELECT count(*) FROM pg_stat_activity WHERE $workerPid=ANY(pg_blocking_pids(pid))"
          val deadline = System.nanoTime() + 10.seconds.toNanos
          while (scalar(observer, blockers) == 0 && System.nanoTime() < deadline) Thread.sleep(10)
          assertEquals(scalar(observer, blockers), 1)
          assertEquals(disable(other).get(10, TimeUnit.SECONDS).overrideChoice, Disable)
          assertEquals(store(observer, service, IndexingPolicy.defaults).get(owner), IndexingPreference.inherited)
          worker.commit()
          assertEquals(sameOwner.get(10, TimeUnit.SECONDS), IndexingPreference(Inherit, Disable, 1))
          assertEquals(store(observer, service, IndexingPolicy.defaults).get(owner).overrideChoice, Disable)
        }
      } finally pool.shutdownNow()
    }
  }
}
