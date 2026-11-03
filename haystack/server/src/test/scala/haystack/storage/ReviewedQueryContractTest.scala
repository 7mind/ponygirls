package haystack.storage

import cats.effect.IO
import cats.syntax.all.*
import haystack.domain.*
import haystack.query.*
import io.circe.Json
import java.util.Locale
import TestSupport.*

/** Regression: reviewer reproduced pre-prefix tag truncation and year-zero
  * timestamp divergence. One contract runs against memory and real PostgreSQL.
  */
abstract class ReviewedQueryContract(adapter: RepositoryAdapter) extends ContractSuite {
  private val early = Vector.tabulate(128)(i => f"aa$i%03d")
  private val special = Vector("zzneedle", "0zero", "-minus", "Ibis", "İzmir", "ΟΣ", "ΟΣΑ", "ＺＺwide", "ﬁxture", "fixture", "écho", "e\u0301cho", "𐐀name")
  private def seeded(body: (ItemRepository, Vector[StoredItem]) => IO[Unit]): Unit = run(adapter.resource.use { repo =>
    (early ++ special).grouped(64).toVector.zipWithIndex.traverse_ { case (tags, index) =>
      val raw = doc(extra = ",\"tags\":" + Json.arr(tags.map(Json.fromString)*).noSpaces)
      repo.commit(op(key = s"review:tags-$index", document = raw), Alice, Now).void
    } *> repo.allCurrent().flatMap(items => body(repo, items))
  })
  Vector("tag:zz", "tags:zz", "TAG:ZZ").foreach { fragment =>
    test(s"${adapter.label}: prefix eligibility precedes catalog bound for $fragment") { seeded { (repo, items) => for {
      actual <- repo.complete(fragment)
      _ = assertEquals(actual, Search.complete(items, fragment))
      _ = assertEquals(actual, Vector(fragment.takeWhile(_ != ':') + ":zzneedle"))
      bounded <- repo.observedValues("tags")
      _ = assertEquals(bounded.size, 100)
      _ = assert(!bounded.contains("zzneedle"), "bounded values catalog remains distinct from prefix completion")
    } yield () } }
  }
  Vector("tag:", "tags:", "tag:0", "tag:-", "tag:no-match", "", "tag:fi", "tag:é", "tag:e\u0301", "tag:ＺＺ").foreach { fragment =>
    test(s"${adapter.label}: exact completion grammar/prefix semantics for [$fragment]") { seeded { (repo, items) => for {
      actual <- repo.complete(fragment)
      _ = assertEquals(actual, Search.complete(items, fragment))
      _ = assert(actual.size <= 20)
    } yield () } }
  }
  Vector("tag:i", "tag:İ", "tag:ΟΣ", "tags:𐐀").foreach { fragment =>
    test(s"${adapter.label}: ROOT Unicode folding is not locale SQL lower or NFKC for $fragment") { seeded { (repo, items) =>
      // The pure oracle and JDBC acquisition both use explicit ROOT, even when
      // the ambient JVM locale would turn ASCII I into dotless i.
      val previous = Locale.getDefault
      IO(Locale.setDefault(Locale.forLanguageTag("tr-TR"))) *>
        (for {
          actual <- repo.complete(fragment)
          _ = assertEquals(actual, Search.complete(items, fragment))
          _ = assert(actual.nonEmpty)
        } yield ()).guarantee(IO(Locale.setDefault(previous)))
    } }
  }
  Vector("created-at", "modified-at").foreach { field =>
    Vector(":", " = ", " != ", " < ", " <= ", " > ", " >= ").foreach { operator =>
      val query = field + operator + "\"0000-01-01T00:00:00Z\""
      test(s"${adapter.label}: unsupported UTC year0000 is typed invalid-query: $query") { seeded { (repo, _) => for {
        result <- repo.search(SearchInput(query)).attempt
        _ = assert(result.left.toOption.exists(_.isInstanceOf[InvalidQuery]), "must reject at parser boundary, not return matches or JDBC failure")
        error = result.swap.toOption.get.asInstanceOf[InvalidQuery]
        _ = assertEquals(error.code, "invalid-query")
        _ = assert(error.diagnostics.nonEmpty)
        _ = assert(error.diagnostics.forall(d => d.span.start >= 0 && d.span.end <= query.length && d.span.start < d.span.end))
      } yield () } }
    }
  }
  Vector("0001-01-01T00:00:00Z", "9999-12-31T23:59:59.999999Z").foreach { instant =>
    test(s"${adapter.label}: supported UTC year boundary $instant agrees with reference") { seeded { (repo, items) =>
      val query = s"created-at >= \"$instant\" OR modified-at <= \"$instant\""
      repo.search(SearchInput(query)).map(result => assertEquals(result, Search.search(items, SearchInput(query))))
    } }
  }
}
class MemoryReviewedQueryTest extends ReviewedQueryContract(MemoryAdapter)
class PostgresReviewedQueryTest extends ReviewedQueryContract(PostgresAdapter)
