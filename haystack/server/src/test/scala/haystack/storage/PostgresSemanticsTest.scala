package haystack.storage

import cats.effect.{Deferred, IO}
import cats.syntax.all.*
import haystack.domain.*
import ponygirls.runtime.{JdbcDatabase, JdbcFailure}
import java.util.concurrent.{CountDownLatch, TimeUnit}
import scala.concurrent.duration.*
import TestSupport.*

/** Behavioral-Active / Blackbox-GoodCommunication plus Effectual checks of
  * atomic projections. These exercise real locks/transactions, not a simulated DB.
  */
class PostgresSemanticsTest extends ContractSuite {
  def check(name: String)(body: (JdbcDatabase, PostgresItemRepository) => IO[Unit]): Unit = test(name) {
    run(initializedDatabase.use(db => body(db, new PostgresItemRepository(db))))
  }
  private def counts(db: JdbcDatabase): IO[Vector[Long]] = db.transaction { c =>
    Vector("items", "item_revisions", "item_links", "item_search", "write_requests").map(table => Sql.rows(c, "SELECT count(*) FROM " + table)(_.getLong(1)).head)
  }
  private def failures(results: Vector[Either[Throwable, CommitSuccess]], code: String): Unit =
    results.collect { case Left(error) => error }.foreach {
      case f: Fault => assertEquals(f.code, code)
      case other => fail("expected " + code + ", got " + other.getClass.getName)
    }
  private def race(tasks: Vector[IO[CommitSuccess]]): IO[Vector[Either[Throwable, CommitSuccess]]] = for {
    gate <- Deferred[IO, Unit]
    fibers <- tasks.traverse(task => (gate.get *> task.attempt).start)
    _ <- gate.complete(())
    results <- fibers.traverse(_.joinWithNever)
  } yield results

  check("ten racing absent-key creates elect one winner and persist every terminal conflict") { (db, repo) => for {
    raw <- IO(doc(fields = "{\"note\":\"searchable\"}").replace("\"links\":[]", "\"links\":[[\"ref\",\"other:missing\"]]"))
    operations <- IO(Vector.fill(10)(op(key = "p:race", document = raw)))
    results <- race(operations.map(repo.commit(_, Alice, Now)))
    _ = assertEquals(results.count(_.isRight), 1); _ = assertEquals(results.count(_.isLeft), 9); _ = failures(results, "conflict")
    beforeCounts <- counts(db); _ = assertEquals(beforeCounts, Vector(1L, 1L, 1L, 1L, 10L))
    projection <- db.transaction(c => Sql.rows(c, "SELECT words,segments FROM item_search") { r =>
      (r.getArray(1).getArray.asInstanceOf[Array[AnyRef]].toVector.map(_.toString), r.getArray(2).getArray.asInstanceOf[Array[AnyRef]].toVector.map(_.toString))
    }.head)
    _ = assert(projection._1.contains("searchable")); _ = assert(projection._2.contains("searchable"))
    replays <- operations.traverse(repo.commit(_, Alice, Later).attempt)
    _ = assertEquals(replays.count(_.isRight), 1); _ = failures(replays, "conflict")
    after <- counts(db); _ = assertEquals(after, beforeCounts)
  } yield () }

  check("eight simultaneous identical request IDs converge on one acknowledgement") { (db, repo) => for {
    operation <- IO(op())
    results <- race(Vector.fill(8)(repo.commit(operation, Alice, Now)))
    successes = results.collect { case Right(value) => value }
    _ = assertEquals(successes.size, 8); _ = assertEquals(successes.count(!_.replayed), 1)
    _ = assertEquals(successes.map(_.revision).distinct, Vector(1L))
    _ = assertEquals(successes.map(_.metadata).distinct, Vector(ItemMetadata(Now, "alice", Now, "alice")))
    count <- counts(db); _ = assertEquals(count, Vector(1L, 1L, 0L, 1L, 1L))
  } yield () }

  check("same request ID with competing payloads yields one winner and three replay conflicts") { (db, repo) => for {
    id <- IO(requestId()); operations <- IO(Vector("v1", "v2", "v3", "v4").map(title => op(document = doc(title), id = id)))
    results <- race(operations.map(repo.commit(_, Alice, Now)))
    _ = assertEquals(results.count(_.isRight), 1); _ = assertEquals(results.count(_.isLeft), 3); _ = failures(results, "replay-conflict")
    winner = operations.zip(results).collectFirst { case (operation, Right(_)) => operation }.get
    current <- repo.current(winner.key); _ = assertEquals(current.get.documentCanonical, winner.documentCanonical)
    count <- counts(db); _ = assertEquals(count, Vector(1L, 1L, 0L, 1L, 1L))
  } yield () }

  check("racing CAS updates keep exactly one complete revision and gap-free history") { (db, repo) => for {
    _ <- repo.commit(op(), Alice, Now)
    operations <- IO(Vector.tabulate(6)(i => op(revision = 1L, document = doc(s"v$i"))))
    results <- race(operations.map(repo.commit(_, Bot, Later)))
    _ = assertEquals(results.count(_.isRight), 1); _ = assertEquals(results.count(_.isLeft), 5); _ = failures(results, "conflict")
    history <- repo.history(ItemKey("p", "a")); _ = assertEquals(history.map(_.revision), Vector(2L, 1L))
    _ = assertEquals(history.map(_.tokenId), Vector("t2", "t1"))
    count <- counts(db); _ = assertEquals(count, Vector(1L, 2L, 0L, 1L, 7L))
  } yield () }

  check("simultaneous identical invalid documents atomically persist one terminal outcome") { (db, repo) => for {
    operation <- IO(op(document = "{}"))
    results <- race(Vector.fill(8)(repo.commit(operation, Alice, Now)))
    _ = assertEquals(results.count(_.isLeft), 8); _ = failures(results, "invalid-document")
    _ = assertEquals(results.collect { case Left(f: Fault) => (f.code, f.message, f.currentRevision) }.distinct.size, 1)
    count <- counts(db); _ = assertEquals(count, Vector(0L, 0L, 0L, 0L, 1L))
  } yield () }

  check("invalid/valid competitors for one request identity cannot commit both outcomes") { (db, repo) => for {
    id <- IO(requestId()); invalid <- IO(op(document = "{}", id = id)); valid <- IO(op(id = id))
    results <- race(Vector(repo.commit(invalid, Alice, Now), repo.commit(valid, Alice, Now)))
    _ = assertEquals(results.collect { case Left(f: Fault) if f.code == "replay-conflict" => f }.size, 1)
    count <- counts(db); _ = assertEquals(count(4), 1L)
    _ = assertEquals(count(0), results.count(_.isRight).toLong)
    _ = assertEquals(count(1), count(0)); _ = assertEquals(count(3), count(0))
    retryInvalid <- repo.commit(invalid, Alice, Later).attempt; retryValid <- repo.commit(valid, Alice, Later).attempt
    _ = assertEquals(retryInvalid.left.toOption.collect { case f: Fault => f.code }, results(0).left.toOption.collect { case f: Fault => f.code })
    _ = assertEquals(retryValid.isRight, results(1).isRight)
  } yield () }

  check("not-found retry remains terminal after racing creator introduces the item") { (db, repo) => for {
    missing <- IO(op(revision = 1L)); _ <- expectFault(repo.commit(missing, Alice, Now), "not-found")
    _ <- repo.commit(op(), Bot, Later)
    results <- race(Vector.fill(8)(repo.commit(missing, Alice, Later)))
    _ = assertEquals(results.count(_.isLeft), 8); _ = failures(results, "not-found")
    count <- counts(db); _ = assertEquals(count, Vector(1L, 1L, 0L, 1L, 2L))
  } yield () }

  check("absent item advisory lock really blocks a competing transaction until release") { (db, repo) =>
    val held = new CountDownLatch(1); val release = new CountDownLatch(1)
    val holder = db.transaction { c =>
      Sql.lock(c, "haystack/item/", Vector("p", "a")); held.countDown()
      if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("synthetic lock holder timed out")
    }
    (for {
      lockFiber <- holder.start
      _ <- IO.blocking(assert(held.await(5, TimeUnit.SECONDS), "lock holder did not acquire real DB lock"))
      done <- Deferred[IO, Either[Throwable, CommitSuccess]]
      commitFiber <- repo.commit(op(), Alice, Now).attempt.flatTap(done.complete).start
      _ <- IO.sleep(200.millis)
      before <- done.tryGet; _ = assertEquals(before, None, "competing commit bypassed absent-key advisory lock")
      _ <- IO(release.countDown())
      _ <- lockFiber.joinWithNever
      result <- commitFiber.joinWithNever
      _ = assert(result.isRight)
    } yield ()).guarantee(IO(release.countDown()))
  }

  check("injected revision failure rolls back current row, history and replay, then same ID can succeed") { (db, repo) => for {
    operation <- IO(op(key = "p:failed"))
    _ <- db.transaction { c =>
      Sql.update(c, "CREATE FUNCTION reject_test_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic revision failure'; END $$")
      Sql.update(c, "CREATE TRIGGER reject_test_revision BEFORE INSERT ON item_revisions FOR EACH ROW EXECUTE FUNCTION reject_test_revision()")
    }
    _ <- (for {
      failure <- repo.commit(operation, Alice, Now).attempt
      _ = assert(failure.left.toOption.exists(_.isInstanceOf[JdbcFailure]))
      count <- counts(db); _ = assertEquals(count, Vector.fill(5)(0L))
    } yield ()).guarantee(db.transaction { c => Sql.update(c, "DROP TRIGGER reject_test_revision ON item_revisions"); Sql.update(c, "DROP FUNCTION reject_test_revision()"); () })
    success <- repo.commit(operation, Alice, Later); _ = assertEquals(success.revision, 1L); _ = assert(!success.replayed)
    healthy <- repo.commit(op(key = "p:healthy"), Alice, Later); _ = assertEquals(healthy.revision, 1L)
  } yield () }

  Vector(false, true).foreach { updating =>
    check("late replay-ledger SQL failure atomically rolls back " + (if (updating) "update/projection replacement" else "create/projections")) { (db, repo) => for {
      _ <- if (updating) repo.commit(op(document = doc("original", "{\"leaf\":\"original\"}").replace("\"links\":[]", "\"links\":[[\"old\",\"p:old\"]]")), Alice, Now).void else IO.unit
      before <- counts(db)
      original <- repo.current(ItemKey("p", "a"))
      operation <- IO(op(revision = if (updating) 1L else 0L, document = doc("new", "{\"leaf\":\"replacement\"}").replace("\"links\":[]", "\"links\":[[\"new\",\"p:new\"]]")))
      _ <- db.transaction { c =>
        Sql.update(c, "CREATE FUNCTION reject_test_replay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic late ledger failure'; END $$")
        Sql.update(c, "CREATE TRIGGER reject_test_replay BEFORE INSERT ON write_requests FOR EACH ROW EXECUTE FUNCTION reject_test_replay()")
      }
      _ <- (for {
        failure <- repo.commit(operation, Bot, Later).attempt; _ = assert(failure.left.toOption.exists(_.isInstanceOf[JdbcFailure]))
        after <- counts(db); _ = assertEquals(after, before)
        current <- repo.current(ItemKey("p", "a")); _ = assertEquals(current.map(_.documentCanonical), original.map(_.documentCanonical))
        _ = assertEquals(current.map(_.metadata), original.map(_.metadata))
        targets <- db.transaction(c => Sql.rows(c, "SELECT target_item_id FROM item_links")(_.getString(1)))
        _ = assertEquals(targets, if (updating) Vector("old") else Vector.empty)
        segments <- db.transaction(c => Sql.rows(c, "SELECT segments::text FROM item_search")(_.getString(1)))
        _ = assert(!segments.exists(_.contains("replacement")))
      } yield ()).guarantee(db.transaction { c => Sql.update(c, "DROP TRIGGER reject_test_replay ON write_requests"); Sql.update(c, "DROP FUNCTION reject_test_replay()"); () })
      success <- repo.commit(operation, Bot, Later); _ = assert(!success.replayed); _ = assertEquals(success.revision, if (updating) 2L else 1L)
    } yield () }
  }

  test("database resource close/reopen preserves exact success, terminal and digest identities") {
    val first = op(document = doc("first", "{\"n\":9007199254740993,\"d\":0.10}"))
    val invalid = op(key = "p:invalid", document = "{}")
    val committed = run(initializedDatabase.use { db =>
      val repo = new PostgresItemRepository(db)
      for {
        success <- repo.commit(first, Alice, Now)
        _ <- expectFault(repo.commit(invalid, Alice, Now), "invalid-document")
      } yield success
    })
    run(database.use { db =>
      val repo = new PostgresItemRepository(db)
      for {
        _ <- Migrations.initialize(db, Activity)
        replay <- repo.commit(first, Alice, Later); _ = assertEquals(replay, committed.copy(replayed = true))
        terminal <- expectFault(repo.commit(invalid, Alice, Later), "invalid-document")
        _ = assertEquals(terminal, invalid.document.swap.toOption.get)
        stored <- repo.current(first.key); _ = assertEquals(stored.get.documentCanonical, first.documentCanonical)
        ledger <- db.transaction(c => Sql.rows(c, "SELECT digest_format,digest FROM write_requests WHERE request_id=?::uuid", Seq(first.requestId))(r => (r.getString(1), r.getString(2))).head)
        _ = assertEquals(ledger, first.digest.format -> first.digest.hex)
      } yield ()
    })
  }

  check("admitted numeric PostgreSQL edge values preserve authoritative tokens") { (_, repo) =>
    Vector("1e131071", "1e-16383", "-0", "1.2300E+00004", "9007199254740993").zipWithIndex.traverse_ { case (number, i) => for {
      operation <- IO(op(key = s"p:number-$i", document = doc(fields = number)))
      _ <- repo.commit(operation, Alice, Now)
      current <- repo.current(operation.key); snapshot <- repo.revision(operation.key, 1L)
      _ = assertEquals(current.get.documentCanonical, operation.documentCanonical)
      _ = assertEquals(snapshot.get.documentCanonical, operation.documentCanonical)
    } yield () }
  }

  check("revision storage ceiling is a durable conflict, not SQL integer overflow") { (db, repo) => for {
    _ <- repo.commit(op(), Alice, Now)
    _ <- db.transaction(c => Sql.update(c, "UPDATE items SET revision=?", Int.MaxValue))
    operation <- IO(op(revision = Int.MaxValue.toLong))
    first <- expectFault(repo.commit(operation, Bot, Later), "conflict", Some(Int.MaxValue.toLong))
    replay <- expectFault(repo.commit(operation, Bot, Later), "conflict", Some(Int.MaxValue.toLong))
    _ = assertEquals(replay, first)
    current <- repo.current(operation.key); _ = assertEquals(current.get.revision, Int.MaxValue.toLong)
    history <- repo.history(operation.key); _ = assertEquals(history.map(_.revision), Vector(1L))
  } yield () }
}
