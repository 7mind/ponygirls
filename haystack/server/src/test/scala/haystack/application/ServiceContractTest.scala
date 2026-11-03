package haystack.application

import cats.effect.{IO, Ref}
import cats.syntax.all.*
import haystack.domain.*
import haystack.query.{SearchInput, SearchSort}
import haystack.storage.*
import haystack.storage.TestSupport.*
import java.time.Instant

final case class ServiceFixture(service: ItemService, repo: ItemRepository, clock: Ref[IO, Instant], changed: Ref[IO, Vector[(String, Long)]]) {
  def put(key: String = "p:a", document: String = doc(), expected: Long = 0L, id: String = requestId(), principal: Principal = Alice): IO[CommitSuccess] =
    service.put(key, document, expected, id, principal)
}

/** One application-level characterization, composed over both real and memory
  * repositories. Same assertions, no mock-specific expectations or fake PG leg.
  */
abstract class ServiceContract(adapter: RepositoryAdapter) extends ContractSuite {
  def check(name: String)(body: ServiceFixture => IO[Unit]): Unit = test(name + " [" + adapter.label + "]") {
    run(adapter.resource.use { repo => for {
      clock <- Ref.of[IO, Instant](Now)
      changes <- Ref.of[IO, Vector[(String, Long)]](Vector.empty)
      service = new ItemService(repo, (key, revision) => changes.update(_ :+ (key -> revision)), clock.get)
      _ <- body(ServiceFixture(service, repo, clock, changes))
    } yield () })
  }
  check("exact big integers/decimals/prototype keys and all JSON roots survive service") { f =>
    Vector("9007199254740993", "0.123456789012345678901", "null", "true", "[null,1.00e2]", "{\"__proto__\":9007199254740993,\"constructor\":{\"prototype\":-0}}").zipWithIndex.traverse_ { case (fields, i) => for {
      raw <- IO(doc(fields = fields)); _ <- f.put(key = s"p:kind-$i", document = raw)
      got <- f.service.get(s"p:kind-$i")
      _ = assertEquals(ponygirls.losslessjson.LosslessJson.encode(got.document.fields), fields)
      _ = assertEquals(got.documentCanonical, OperationEnvelope.accept(s"p:kind-$i", raw, 0L, requestId()).documentCanonical)
    } yield () }
  }
  check("authorship comes only from principal and clock across human/agent writers") { f => for {
    _ <- f.put(principal = Bot); _ <- f.clock.set(Later)
    _ <- f.put(document = doc("human-edit"), expected = 1L, principal = Alice)
    _ <- f.clock.set(Later.plusSeconds(1))
    _ <- f.put(document = doc("agent-edit"), expected = 2L, principal = Bot)
    got <- f.service.get("p:a"); history <- f.service.history("p:a")
    _ = assertEquals(got.metadata, ItemMetadata(Now, "bot", Later.plusSeconds(1), "bot"))
    _ = assertEquals(history.map(h => (h.revision, h.modifiedBy, h.tokenId)), Vector((3L, "bot", "t2"), (2L, "alice", "t1"), (1L, "bot", "t2")))
    old <- f.service.get("p:a", Some(2L)); _ = assertEquals(old.document.title, "human-edit")
  } yield () }
  check("nanosecond server clocks yield durable microsecond receipt/get/history/replay equality") { f => for {
    id <- IO(requestId())
    _ <- f.clock.set(Now.plusNanos(123456789L))
    first <- f.put(id = id)
    _ = assertEquals(first.metadata.modifiedAt, Now.plusNanos(123456000L))
    _ <- f.clock.set(Later.plusNanos(999999999L))
    second <- f.put(document = doc("changed"), expected = 1L)
    _ = assertEquals(second.metadata.modifiedAt, Later.plusNanos(999999000L))
    got <- f.service.get("p:a"); _ = assertEquals(got.metadata, second.metadata)
    old <- f.service.get("p:a", Some(1L)); _ = assertEquals(old.metadata, first.metadata)
    history <- f.service.history("p:a")
    _ = assertEquals(history.map(_.modifiedAt), Vector(second.metadata.modifiedAt, first.metadata.modifiedAt))
    replay <- f.put(id = id); _ = assertEquals(replay, first.copy(replayed = true))
    changes <- f.changed.get; _ = assertEquals(changes, Vector("p:a" -> 1L, "p:a" -> 2L))
  } yield () }
  check("identical replay returns original acknowledgement and publishes no second notification") { f => for {
    id <- IO(requestId()); first <- f.put(id = id); _ <- f.clock.set(Later)
    replay <- f.put(id = id)
    _ = assertEquals(replay, first.copy(replayed = true))
    changed <- f.changed.get; _ = assertEquals(changed, Vector("p:a" -> 1L))
    history <- f.service.history("p:a"); _ = assertEquals(history.size, 1)
  } yield () }
  check("terminal CAS, missing and validation outcomes never notify") { f => for {
    _ <- f.put()
    _ <- expectFault(f.put(), "conflict", Some(1L))
    _ <- expectFault(f.put(expected = 9L), "conflict", Some(1L))
    _ <- expectFault(f.put(key = "p:absent", expected = 1L), "not-found")
    _ <- expectFault(f.put(key = "p:bad", document = "{}"), "invalid-document")
    changed <- f.changed.get; _ = assertEquals(changed, Vector("p:a" -> 1L))
  } yield () }
  check("accepted invalid-document identity remains terminal, not reusable after correction") { f => for {
    id <- IO(requestId())
    first <- expectFault(f.put(document = "{}", id = id), "invalid-document")
    retry <- expectFault(f.put(document = "{}", id = id), "invalid-document")
    _ = assertEquals(retry, first)
    _ <- expectFault(f.put(id = id), "replay-conflict")
    _ <- expectFault(f.service.get("p:a"), "not-found")
    history <- f.service.history("p:a"); _ = assertEquals(history, Vector.empty)
  } yield () }
  Vector("malformed-json", "duplicate-key", "nul", "id", "revision", "uuid").foreach { kind =>
    check("unaccepted envelope " + kind + " does not consume replay identity") { f => for {
      id <- IO(requestId())
      invalid = kind match {
        case "malformed-json" => f.put(document = "{", id = id)
        case "duplicate-key" => f.put(document = "{\"a\":1,\"a\":2}", id = id)
        case "nul" => f.put(document = doc(fields = "\"\\u0000\""), id = id)
        case "id" => f.put(key = "p:%61", id = id)
        case "revision" => f.put(expected = -1L, id = id)
        case _ => f.put(id = id.replace("-7a1b-", "-4a1b-"))
      }
      _ <- expectFault(invalid, if (kind == "id") "invalid-id" else "bad-envelope")
      valid <- f.put(id = id); _ = assertEquals(valid.revision, 1L); _ = assert(!valid.replayed)
    } yield () }
  }
  check("Unicode qualified keys are canonical and never decoded twice") { f => for {
    key <- IO(ItemKey("a:b", "café 🐎%3A").qualified)
    _ <- f.put(key = key)
    got <- f.service.get(key); _ = assertEquals(got.key, ItemKey("a:b", "café 🐎%3A"))
    _ <- expectFault(f.service.get("p:%61"), "invalid-id")
  } yield () }
  check("get revision bounds and absent revision faults are typed") { f => for {
    _ <- f.put()
    _ <- expectFault(f.service.get("p:a", Some(0L)), "bad-envelope")
    _ <- expectFault(f.service.get("p:a", Some(-1L)), "bad-envelope")
    _ <- expectFault(f.service.get("p:a", Some(Int.MaxValue.toLong + 1)), "bad-envelope")
    _ <- expectFault(f.service.get("p:a", Some(2L)), "not-found")
    _ <- expectFault(f.service.get("p:missing"), "not-found")
  } yield () }
  check("archive excluded by default, readable/history intact; unarchive is CAS write") { f => for {
    _ <- f.put(); _ <- f.put(document = doc().replace("\"actual\"", "\"archived\""), expected = 1L)
    hidden <- f.service.search(SearchInput("")); _ = assertEquals(hidden.items, Vector.empty)
    explicit <- f.service.search(SearchInput("status:archived")); _ = assertEquals(explicit.items.map(_.item), Vector("a"))
    archived <- f.service.get("p:a"); _ = assertEquals(archived.document.status, "archived")
    old <- f.service.get("p:a", Some(1L)); _ = assertEquals(old.document.status, "actual")
    _ <- f.put(expected = 2L)
    visible <- f.service.search(SearchInput("")); _ = assertEquals(visible.items.map(_.revision), Vector(3L))
  } yield () }
  check("tags default empty, preserve order/duplicates, search and restore snapshots") { f => for {
    _ <- f.put(document = doc(extra = ",\"tags\":[\"mcp\",\"Machine Learning\",\"mcp\"]"))
    tagged <- f.service.search(SearchInput("tag:mcp")); _ = assertEquals(tagged.items.map(_.item), Vector("a"))
    _ <- f.put(expected = 1L)
    current <- f.service.get("p:a"); _ = assertEquals(current.document.tags, Vector.empty)
    saved <- f.service.get("p:a", Some(1L)); _ = assertEquals(saved.document.tags, Vector("mcp", "Machine Learning", "mcp"))
    _ <- f.put(document = saved.documentCanonical, expected = 2L)
    restored <- f.service.search(SearchInput("tag:mcp")); _ = assertEquals(restored.items.map(_.revision), Vector(3L))
  } yield () }
  check("search covers complete current set before sort/page and cursor continuation") { f => for {
    _ <- f.put(key = "p:a", document = doc("Zulu")); _ <- f.put(key = "p:b", document = doc("Alpha"))
    _ <- f.put(key = "p:c", document = doc("Middle")); _ <- f.put(key = "other:d", document = doc("Earlier"))
    input = SearchInput("", project = Some("p"), limit = 1, sort = SearchSort("title", "asc"))
    page1 <- f.service.search(input); _ = assertEquals(page1.items.map(_.item), Vector("b")); _ = assert(page1.cursor.nonEmpty)
    page2 <- f.service.search(input.copy(cursor = page1.cursor)); _ = assertEquals(page2.items.map(_.item), Vector("c")); _ = assert(page2.cursor.nonEmpty)
    page3 <- f.service.search(input.copy(cursor = page2.cursor)); _ = assertEquals(page3.items.map(_.item), Vector("a")); _ = assertEquals(page3.cursor, None)
  } yield () }
  check("complete/values observe latest current documents, deduplicate and validate names") { f => for {
    _ <- f.put(document = doc(extra = ",\"tags\":[\"mcp\",\"mcp\",\"auth\"]"))
    _ <- f.put(key = "p:b", document = doc().replace("\"fact\"", "\"future-type\""))
    tags <- f.service.values("tags"); _ = assertEquals(tags, Vector("auth", "mcp"))
    types <- f.service.values("type"); _ = assertEquals(types, Vector("fact", "future-type"))
    statuses <- f.service.values("status"); _ = assertEquals(statuses, Vector("actual"))
    importance <- f.service.values("importance"); _ = assertEquals(importance, Vector("low"))
    _ <- expectFault(f.service.values("secret"), "not-found")
    suggestions <- f.service.complete("type:f"); _ = assert(suggestions.contains("type:fact")); _ = assert(suggestions.contains("type:future-type"))
    _ <- f.put(expected = 1L)
    noTags <- f.service.values("tags"); _ = assertEquals(noTags, Vector.empty)
  } yield () }
  check("notification failure cannot undo acknowledged commit or trigger duplicate replay") { f => for {
    service <- IO(new ItemService(f.repo, (_, _) => IO.raiseError(new IllegalStateException("synthetic notification outage")), f.clock.get))
    id <- IO(requestId())
    first <- service.put("p:a", doc(), 0L, id, Alice); _ = assertEquals(first.revision, 1L)
    replay <- service.put("p:a", doc(), 0L, id, Alice); _ = assert(replay.replayed)
    got <- service.get("p:a"); _ = assertEquals(got.revision, 1L)
    history <- service.history("p:a"); _ = assertEquals(history.size, 1)
  } yield () }
}
class MemoryServiceContractTest extends ServiceContract(MemoryAdapter)
class PostgresServiceContractTest extends ServiceContract(PostgresAdapter)
