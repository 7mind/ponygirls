package haystack.domain

/** BA, specified-origin: frozen synthetic identity fixtures, never live GitHub. */
class GithubIdentityTest extends munit.FunSuite {
  import DomainFixtures.*
  private val record = GithubRecordFields("issue", "I_example123", "https://github.com/o/r/issues/1?tracking=x#fragment", "Example defect", "Sanitized public summary.")

  test("frozen issue/pr digest vectors preserve opaque complete identity") {
    assertEquals(GithubIdentity.digestFor("issue", "I_example123"), "0f0471cc3cbdb2a4495cf96e0a8289679a161dc9efbb07865a85f4f21683821b")
    assertEquals(GithubIdentity.digestFor("pr", "PR_example456"), "9b2b3a5640113ffd8e8bbee2a33dc270fe0870d2cc17d0633916eb3dd179f098")
    assertNotEquals(GithubIdentity.digestFor("issue", "X"), GithubIdentity.digestFor("pr", "X"))
    assertNotEquals(GithubIdentity.digestFor("issue", "X"), GithubIdentity.digestFor("issue", "X "))
    assertEquals(intercept[Fault](GithubIdentity.digestFor("issue", "")).code, "invalid-document")
    assertEquals(intercept[Fault](GithubIdentity.digestFor("issue", "\uD800")).code, "invalid-document")
    assertEquals(intercept[Fault](GithubIdentity.digestFor("issue", "\u0000")).code, "invalid-document")
    assertEquals(intercept[Fault](GithubIdentity.digestFor("Issue", "X")).code, "invalid-document")
  }
  test("complete key is authoritative activity namespace plus full hash") {
    val key = GithubIdentity.accountingKey("agent:activity", "issue", record.nodeId)
    assertEquals(key, "agent%3Aactivity:github-issue-0f0471cc3cbdb2a4495cf96e0a8289679a161dc9efbb07865a85f4f21683821b")
    assertEquals(QualifiedId.decodeKey(key).project, "agent:activity")
    assertEquals(GithubIdentity.kindFromTypename("Issue"), "issue")
    assertEquals(GithubIdentity.kindFromTypename("PullRequest"), "pr")
    assertEquals(intercept[Fault](GithubIdentity.kindFromTypename("Repository")).code, "invalid-document")
  }
  test("trusted canonical display URL strips query/fragment, never feeds identity") {
    assertEquals(GithubIdentity.canonicalUrl(record.url), "https://github.com/o/r/issues/1")
    assertEquals(GithubIdentity.canonicalUrl("https://github.com/o/r/pull/2/"), "https://github.com/o/r/pull/2")
    assertEquals(GithubIdentity.canonicalUrl("https://GITHUB.COM:443/o/r/pull/2/"), "https://github.com/o/r/pull/2")
    val original = GithubIdentity.accountingDocument(record, "low")
    val renamed = GithubIdentity.accountingDocument(record.copy(url = "https://github.com/renamed/new-repo/issues/99"), "low")
    GithubIdentity.checkStoredIdentity(original, record.kind, record.nodeId)
    GithubIdentity.checkStoredIdentity(renamed, record.kind, record.nodeId)
  }
  Vector("http://github.com/o/r/issues/1", "https://evil.com/o/r/issues/1", "https://github.com.evil/o/r/issues/1",
    "https://github.com/o/r", "https://github.com/o/r/issues", "not a url", "https://user:pass@github.com/o/r/issues/1",
    "https://github.com:444/o/r/issues/1", "https://github.com/o/r/issues/1/other", "https://github.com/../r/issues/1",
    "https://github.com/o%2fr/r/issues/1", "https://github.com/o/r/issues/1%2f", "https://github.com/o/r/issues/-1").zipWithIndex.foreach { case (url, i) =>
    test(s"reject untrusted/malformed provenance URL $i") {
      assertEquals(intercept[Fault](GithubIdentity.canonicalUrl(url)).code, "invalid-document")
    }
  }
  test("accounting document is complete validated data; importance never default-high") {
    val doc = GithubIdentity.accountingDocument(record.copy(affected = Some("commit-123")), "evidence-specific")
    assertEquals(doc.docType, "github-issue")
    assertEquals(doc.status, "actual")
    assertEquals(doc.humanAttention, "required")
    assertEquals(doc.importance, "evidence-specific")
    val canonical = DocumentCodec.canonical(doc)
    assert(canonical.contains("\"identity_format\":\"github-artifact-v1\""))
    assert(canonical.contains("\"affected\":\"commit-123\""))
    assert(!canonical.contains("tracking"))
    assertEquals(GithubIdentity.accountingDocument(record.copy(kind = "pr"), "low").docType, "github-pr")
    assertEquals(intercept[Fault](GithubIdentity.accountingDocument(record.copy(title = ""), "low")).code, "invalid-document")
    assertEquals(intercept[Fault](GithubIdentity.accountingDocument(record.copy(summary = ""), "low")).code, "invalid-document")
  }
  test("stored identity including format must agree before adapter CAS") {
    val doc = GithubIdentity.accountingDocument(record, "low")
    GithubIdentity.checkStoredIdentity(doc, "issue", record.nodeId)
    Vector(
      () => GithubIdentity.checkStoredIdentity(doc, "pr", record.nodeId),
      () => GithubIdentity.checkStoredIdentity(doc, "issue", "I_other"),
      () => GithubIdentity.checkStoredIdentity(doc.copy(docType = "fact"), "issue", record.nodeId),
      () => GithubIdentity.checkStoredIdentity(doc.copy(fields = DocumentCodec.parseRaw("{}")), "issue", record.nodeId),
      () => GithubIdentity.checkStoredIdentity(doc.copy(fields = DocumentCodec.parseRaw("{\"github\":{\"kind\":\"issue\",\"node_id\":\"I_example123\",\"identity_format\":\"legacy\"}}")), "issue", record.nodeId)
    ).foreach { check =>
      val fault = intercept[Fault](check())
      assertEquals(fault.code, "invalid-document")
      assert(fault.message.contains("collision"))
    }
  }
  test("opt-in retry policy preserves human edits and cleared attention") {
    val doc = GithubIdentity.accountingDocument(record, "low").copy(humanAttention = "cleared")
    ProtectedFields.validateAccountingUpdate(Agent, doc, doc, "human")
    val changed = doc.copy(title = "overwritten")
    assertEquals(intercept[Fault](ProtectedFields.validateAccountingUpdate(Agent, doc, changed, "human")).code, "invalid-document")
    assertEquals(intercept[Fault](ProtectedFields.validateAccountingUpdate(Agent, doc, doc.copy(humanAttention = "required"), "agent")).code, "invalid-document")
    assertEquals(intercept[Fault](ProtectedFields.validateAccountingUpdate(Agent, doc, doc.copy(humanAttention = "required"), "agent", Some(" \n"))).code, "invalid-document")
    ProtectedFields.validateAccountingUpdate(Agent, doc, doc.copy(humanAttention = "required"), "agent", Some("new material development"))
    ProtectedFields.validateAccountingUpdate(Human, doc, changed, "human")
    val skill = doc.copy(docType = "skill-draft")
    assertEquals(intercept[Fault](ProtectedFields.validateAccountingUpdate(Agent, skill, skill.copy(title = "clobber"), "human")).code, "invalid-document")
  }
  test("user type is attribution, never generic write authorization") {
    val ordinary = DocumentCodec.parse(document())
    ProtectedFields.validateAccountingUpdate(Agent, ordinary, ordinary.copy(title = "new title", humanAttention = "required"), "human")
    val accepted = OperationEnvelope.accept("p:i", DocumentCodec.canonical(ordinary.copy(humanAttention = "cleared")), 1L, RequestId)
    assert(accepted.document.isRight)
  }
}
