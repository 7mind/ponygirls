package haystack.query

/** BA regression: Java supports astronomical year zero; the current query
  * subset deliberately does not. PostgreSQL timestamp text has no year zero.
  */
class TimestampSubsetTest extends munit.FunSuite {
  Vector("0000-01-01T00:00:00Z", "0000-02-29T23:59:59.999999Z", "-0001-01-01T00:00:00Z", "+10000-01-01T00:00:00Z", "10000-01-01T00:00:00Z").foreach { value =>
    test("UTC query subset rejects out-of-range year: " + value) {
      assert(!Parser.isUtcInstant(value))
      val query = "modified-at >= \"" + value + "\""
      val error = intercept[InvalidQuery](Parser.parseQuery(query))
      assertEquals(error.code, "invalid-query")
      assertEquals(error.diagnostics.head.span, Span("modified-at >= ".length, query.length))
      assertEquals(Search.analyze(query), error.diagnostics)
    }
  }
  Vector("0001-01-01T00:00:00Z", "0001-12-31T23:59:59.000001Z", "9999-12-31T23:59:59.999999Z", "2000-02-29T00:00:00Z").foreach { value =>
    test("UTC query subset retains supported year and microsecond boundary: " + value) {
      assert(Parser.isUtcInstant(value))
      val query = "created-at:\"" + value + "\""
      assert(Parser.parseQuery(query).nonEmpty)
      assertEquals(Search.analyze(query), Vector.empty)
    }
  }
}
