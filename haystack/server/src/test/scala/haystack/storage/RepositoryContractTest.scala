package haystack.storage

import cats.effect.IO
import cats.syntax.all.*
import haystack.domain.*
import TestSupport.*

/** One specified-origin blackbox contract, run against the handwritten atomic
  * adapter (BA/BG) and the production PostgreSQL adapter (GoodCommunication).
  */
abstract class RepositoryContract(adapter: RepositoryAdapter) extends ContractSuite {
  def check(name: String)(body: ItemRepository => IO[Unit]): Unit = test(name + " [" + adapter.label + "]") { run(adapter.resource.use(body)) }

  check("create stamps revision and exact authenticated metadata") { repo => for {
    operation <- IO(op())
    committed <- repo.commit(operation, Alice, Now)
    _ = assertEquals(committed, CommitSuccess(1L, ItemMetadata(Now, "alice", Now, "alice"), false))
    current <- repo.current(operation.key)
    _ = assertEquals(current.map(_.revision), Some(1L))
    _ = assertEquals(current.map(_.document.title), Some("t"))
    _ = assertEquals(current.map(_.documentCanonical), Some(operation.documentCanonical))
    _ = assertEquals(current.map(_.metadata), Some(committed.metadata))
  } yield () }

  check("microsecond receipts, current rows, snapshots, history and replay agree without JDBC rounding drift") { repo => for {
    operation <- IO(op())
    nanoFirst = Now.plusNanos(123456789L)
    nanoSecond = Later.plusNanos(999999999L)
    firstMicros = Now.plusNanos(123456000L)
    secondMicros = Later.plusNanos(999999000L)
    first <- repo.commit(operation, Alice, nanoFirst)
    _ = assertEquals(first.metadata, ItemMetadata(firstMicros, "alice", firstMicros, "alice"))
    second <- repo.commit(op(revision = 1L, document = doc("new")), Bot, nanoSecond)
    _ = assertEquals(second.metadata, ItemMetadata(firstMicros, "alice", secondMicros, "bot"))
    current <- repo.current(operation.key); old <- repo.revision(operation.key, 1L)
    _ = assertEquals(current.get.metadata, second.metadata); _ = assertEquals(old.get.metadata, first.metadata)
    history <- repo.history(operation.key)
    _ = assertEquals(history.map(_.modifiedAt), Vector(secondMicros, firstMicros))
    replay <- repo.commit(operation, Alice, Later.plusSeconds(5L))
    _ = assertEquals(replay, first.copy(replayed = true))
  } yield () }

  check("absent current/revision/history/allCurrent are empty") { repo => for {
    current <- repo.current(ItemKey("p", "absent")); revision <- repo.revision(ItemKey("p", "absent"), 1L)
    history <- repo.history(ItemKey("p", "absent")); all <- repo.allCurrent()
    _ = assertEquals(current, None); _ = assertEquals(revision, None); _ = assertEquals(history, Vector.empty); _ = assertEquals(all, Vector.empty)
  } yield () }

  check("CAS update preserves creation and immutable exact snapshots and token labels") { repo => for {
    first <- IO(op(document = doc("v1", "{\"n\":9007199254740993,\"d\":0.10}")))
    _ <- repo.commit(first, Alice, Now)
    second <- IO(op(revision = 1L, document = doc("v2", "null")))
    out <- repo.commit(second, Bot, Later)
    _ = assertEquals(out.metadata, ItemMetadata(Now, "alice", Later, "bot"))
    history <- repo.history(first.key)
    _ = assertEquals(history, Vector(RevisionMeta(2L, Later, "bot", "t2"), RevisionMeta(1L, Now, "alice", "t1")))
    old <- repo.revision(first.key, 1L); current <- repo.current(first.key)
    _ = assertEquals(old.map(_.documentCanonical), Some(first.documentCanonical))
    _ = assertEquals(old.map(_.metadata), Some(ItemMetadata(Now, "alice", Now, "alice")))
    _ = assertEquals(current.map(_.documentCanonical), Some(second.documentCanonical))
    missing <- repo.revision(first.key, 3L); _ = assertEquals(missing, None)
  } yield () }

  check("duplicate create terminal conflict replays original outcome") { repo => for {
    _ <- repo.commit(op(), Alice, Now)
    duplicate <- IO(op())
    first <- expectFault(repo.commit(duplicate, Alice, Later), "conflict", Some(1L))
    second <- expectFault(repo.commit(duplicate, Alice, Later.plusSeconds(1)), "conflict", Some(1L))
    _ = assertEquals(second, first)
    history <- repo.history(duplicate.key); _ = assertEquals(history.size, 1)
  } yield () }

  check("stale CAS includes observed revision and its replay survives later writes") { repo => for {
    _ <- repo.commit(op(), Alice, Now)
    stale <- IO(op(revision = 5L, document = doc("stale")))
    original <- expectFault(repo.commit(stale, Alice, Later), "conflict", Some(1L))
    _ <- repo.commit(op(revision = 1L, document = doc("v2")), Bot, Later)
    replay <- expectFault(repo.commit(stale, Alice, Later), "conflict", Some(1L))
    _ = assertEquals(replay, original)
    current <- repo.current(stale.key); _ = assertEquals(current.map(_.revision), Some(2L))
  } yield () }

  check("missing update is terminal and remains not-found after another writer creates") { repo => for {
    missing <- IO(op(revision = 1L))
    original <- expectFault(repo.commit(missing, Alice, Now), "not-found")
    _ <- repo.commit(op(), Bot, Later)
    replay <- expectFault(repo.commit(missing, Alice, Later), "not-found")
    _ = assertEquals(replay, original)
    history <- repo.history(missing.key); _ = assertEquals(history.map(_.revision), Vector(1L))
  } yield () }

  check("successful retry returns original metadata/revision even after newer revisions") { repo => for {
    first <- IO(op())
    created <- repo.commit(first, Alice, Now)
    _ <- repo.commit(op(revision = 1L, document = doc("changed")), Bot, Later)
    replay <- repo.commit(first, Alice, Later.plusSeconds(1))
    _ = assertEquals(replay, created.copy(replayed = true))
    history <- repo.history(first.key); _ = assertEquals(history.map(_.revision), Vector(2L, 1L))
  } yield () }

  Vector("document", "key", "revision", "format").foreach { changed =>
    check("reused request ID binds " + changed) { repo => for {
      first <- IO(op())
      _ <- repo.commit(first, Alice, Now)
      different <- IO(changed match {
        case "document" => op(document = doc("changed"), id = first.requestId)
        case "key" => op(key = "else:other", id = first.requestId)
        case "revision" => op(revision = 1L, id = first.requestId)
        case _ => first.copy(digest = first.digest.copy(format = "retired-format"))
      })
      _ <- expectFault(repo.commit(different, Alice, Later), "replay-conflict")
      history <- repo.history(first.key); _ = assertEquals(history.size, 1)
    } yield () }
  }

  Vector("{}", "null", doc(fields = "1e999999"), doc().replace("\"links\":[]", "\"links\":[[\"ref\",\"not-qualified\"]]")).zipWithIndex.foreach { case (raw, i) =>
    check(s"accepted invalid-document terminal $i persists original fault and blocks reuse") { repo => for {
      invalid <- IO(op(document = raw))
      _ = assert(invalid.document.isLeft)
      first <- expectFault(repo.commit(invalid, Alice, Now), "invalid-document")
      replay <- expectFault(repo.commit(invalid, Alice, Later), "invalid-document")
      _ = assertEquals(replay, first)
      _ <- expectFault(repo.commit(op(id = invalid.requestId), Alice, Later), "replay-conflict")
      current <- repo.current(invalid.key); history <- repo.history(invalid.key); all <- repo.allCurrent()
      _ = assertEquals(current, None); _ = assertEquals(history, Vector.empty); _ = assertEquals(all, Vector.empty)
    } yield () }
  }

  check("same request ID is independently scoped by both user and token") { repo => for {
    id <- IO(requestId())
    _ <- repo.commit(op(key = "p:one", id = id), Alice, Now)
    _ <- repo.commit(op(key = "p:two", id = id), Alice.copy(tokenId = "rotated"), Now)
    _ <- repo.commit(op(key = "p:three", id = id), Alice.copy(userId = "bob"), Now)
    all <- repo.allCurrent(); _ = assertEquals(all.map(_.key.item).toSet, Set("one", "two", "three"))
  } yield () }

  check("user type is attribution only and does not split replay identity") { repo => for {
    first <- IO(op())
    _ <- repo.commit(first, Alice, Now)
    replay <- repo.commit(first, Alice.copy(userType = "agent"), Later)
    _ = assert(replay.replayed)
    _ = assertEquals(replay.metadata.modifiedBy, "alice")
  } yield () }

  check("tuple keys and replay identities never alias delimiter-containing components") { repo => for {
    key1 <- IO(ItemKey("a:b", "c")); key2 <- IO(ItemKey("a", "b:c"))
    id <- IO(requestId())
    _ <- repo.commit(op(key = key1.qualified, document = doc("one"), id = id), Principal("a:b", "human", "c"), Now)
    _ <- repo.commit(op(key = key2.qualified, document = doc("two"), id = id), Principal("a", "agent", "b:c"), Later)
    one <- repo.current(key1); two <- repo.current(key2)
    _ = assertEquals(one.map(_.document.title), Some("one")); _ = assertEquals(two.map(_.document.title), Some("two"))
  } yield () }

  check("cross-project bare IDs are distinct and allCurrent contains latest only") { repo => for {
    _ <- repo.commit(op(key = "p1:same", document = doc("one")), Alice, Now)
    _ <- repo.commit(op(key = "p2:same", document = doc("two")), Alice, Now)
    _ <- repo.commit(op(key = "p1:same", revision = 1L, document = doc("new-one")), Bot, Later)
    all <- repo.allCurrent()
    _ = assertEquals(all.map(s => s.key -> s.document.title).toMap, Map(ItemKey("p1", "same") -> "new-one", ItemKey("p2", "same") -> "two"))
  } yield () }

  check("new request no-op creates a revision; restore is a new immutable snapshot") { repo => for {
    original <- IO(op())
    _ <- repo.commit(original, Alice, Now)
    _ <- repo.commit(op(revision = 1L), Bot, Later)
    _ <- repo.commit(op(revision = 2L, document = doc("different")), Bot, Later)
    saved <- repo.revision(original.key, 1L)
    _ <- repo.commit(op(revision = 3L, document = saved.get.documentCanonical), Alice, Later)
    history <- repo.history(original.key)
    _ = assertEquals(history.map(_.revision), Vector(4L, 3L, 2L, 1L))
    current <- repo.current(original.key); _ = assertEquals(current.map(_.documentCanonical), Some(original.documentCanonical))
    revision3 <- repo.revision(original.key, 3L); _ = assertEquals(revision3.map(_.document.title), Some("different"))
  } yield () }

  check("ordered repeated dangling cyclic links and tags remain in old snapshots") { repo => for {
    raw <- IO(doc(extra = ",\"tags\":[\"A\",\"b\",\"A\"]").replace("\"links\":[]", "\"links\":[[\"self\",\"p:a\"],[\"missing\",\"other:ghost\"],[\"self\",\"p:a\"]]"))
    first <- IO(op(document = raw)); _ <- repo.commit(first, Alice, Now)
    _ <- repo.commit(op(revision = 1L), Bot, Later)
    old <- repo.revision(first.key, 1L); current <- repo.current(first.key)
    _ = assertEquals(old.get.document.tags, Vector("A", "b", "A"))
    _ = assertEquals(old.get.document.links, Vector("self" -> "p:a", "missing" -> "other:ghost", "self" -> "p:a"))
    _ = assertEquals(current.get.document.links, Vector.empty); _ = assertEquals(current.get.document.tags, Vector.empty)
  } yield () }
}

class MemoryRepositoryContractTest extends RepositoryContract(MemoryAdapter)
class PostgresRepositoryContractTest extends RepositoryContract(PostgresAdapter)
