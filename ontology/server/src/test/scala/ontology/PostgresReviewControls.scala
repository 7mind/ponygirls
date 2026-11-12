package ontology

import cats.effect.IO
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import ontology.api.*
import ontology.domain.*
import ponygirls.runtime.JdbcDatabase
import java.sql.SQLException
import java.util.UUID
import scala.util.Using
import munit.FunSuite

final class PostgresReviewControls extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private val at = "2026-11-11T00:00:00Z"
  private val service = Actor("synthetic-review-service", ActorKind.Service)
  private final case class Fixture(scope: String, call: ReviewCall, presentation: Presentation, request: JudgmentRequest)
  private def check(work: (JdbcDatabase, GraphRepository) => IO[Unit]): Unit =
    RepositoryReproductionDatabase.resource.use(db => RepositoryReproductionDatabase.store(db).flatMap(repo => work(db, repo))).unsafeRunSync()(using runtime)
  private def seed(repo: GraphRepository): IO[Fixture] = {
    val scope = "review-control-" + UUID.randomUUID()
    val principal = Principal("synthetic-human-credential", Actor("synthetic-human", ActorKind.Human), Set(scope), Set(Capability.Read, Capability.Review))
    val call = ReviewCall.from(ServiceCall.authenticated(Authenticated(principal, true, "fixture", Some("fixture")), "synthetic-review", UUID.randomUUID()), scope)
    val input = ApplyRequest(scope, UUID.randomUUID(), 0L, List(Operation.Create("q", TestAuthoring.applicability(TestApplicability.unresolved),
      ContentInput.Question("Which?", List("A", "B"), None, Escalation.Unresolved), Nil)), None)
    val admission = Admission(TestContexts.principal(scope, Actor("writer", ActorKind.Agent)), service, input.requestId, at, TestContexts.trace("fixture-apply"), Nil)
    for {
      result <- repo.apply(input, admission)
      p <- repo.prepare(PresentRequest(scope, List(result.created.head.ref), result.generation), call, UUID.randomUUID(), at)
    } yield Fixture(scope, call, p, JudgmentRequest(scope, UUID.randomUUID(), p.id, ReviewAction.Review(JudgmentKind.Accept), "Synthetic control"))
  }
  private def counts(db: JdbcDatabase, scope: String): IO[List[Long]] = db.transaction { c =>
    List("ontology_scopes", "ontology_revisions", "ontology_inputs", "ontology_captures", "ontology_judgments", "ontology_outbox", "ontology_presentations").map { table =>
      Using.resource(c.prepareStatement(s"SELECT count(*) FROM $table WHERE scope = ?")) { s =>
        s.setString(1, scope)
        Using.resource(s.executeQuery()) { r => r.next(); r.getLong(1) }
      }
    }
  }
  private def ddl(db: JdbcDatabase, statements: List[String]): IO[Unit] = db.transaction { c =>
    Using.resource(c.createStatement()) { s => statements.foreach(sql => { s.execute(sql); () }) }
  }
  private def bytes(db: JdbcDatabase, scope: String, id: UUID): IO[String] = db.transaction { c =>
    Using.resource(c.prepareStatement("SELECT payload FROM ontology_inputs WHERE scope = ? AND input_id = ?")) { s =>
      s.setString(1, scope); s.setObject(2, id)
      Using.resource(s.executeQuery()) { r => Require(r.next(), "fixture", "owned receipt missing"); r.getString(1) }
    }
  }
  private def replace(db: JdbcDatabase, scope: String, id: UUID, value: String): IO[Unit] = db.transaction { c =>
    Using.resource(c.prepareStatement("UPDATE ontology_inputs SET payload = ? WHERE scope = ? AND input_id = ?")) { s =>
      s.setString(1, value); s.setString(2, scope); s.setObject(3, id)
      Require(s.executeUpdate() == 1, "fixture", "expected one owned receipt")
    }
  }
  private def triggered(error: Throwable): Boolean = error match {
    case failure: ponygirls.runtime.JdbcFailure => failure.sqlState.contains("P0001")
    case _ => false
  }

  private enum Corruption { case Kind, Namespace, Link, Publication, Manifest, GraphSource }
  private final case class Change(install: IO[Unit], restore: IO[Unit])
  private def primary(db: JdbcDatabase, f: Fixture, event: CapturedEvent, kind: String): IO[Unit] = db.transaction { c =>
    Using.resource(c.prepareStatement("UPDATE ontology_captures SET input_kind = ?, source_namespace = ?, fingerprint = ?, payload = ? WHERE scope = ? AND capture_id = ?")) { s =>
      s.setString(1, kind); s.setString(2, event.sourceNamespace); s.setString(3, CaptureIdentity.fingerprint(event, f.request.requestId))
      s.setString(4, StoredJson.encode(CapturedEvent.codecJson, event)); s.setString(5, f.scope); s.setObject(6, event.id)
      Require(s.executeUpdate() == 1, "fixture", "expected one primary row")
    }
  }
  private def presentation(db: JdbcDatabase, value: Presentation): IO[Unit] = db.transaction { c =>
    Using.resource(c.prepareStatement("UPDATE ontology_presentations SET payload = ?, payload_digest = ? WHERE scope = ? AND presentation_id = ?")) { s =>
      s.setString(1, StoredJson.encode(Presentation.codecJson, value)); s.setString(2, value.payloadDigest); s.setString(3, value.payload.scope); s.setObject(4, value.id)
      Require(s.executeUpdate() == 1, "fixture", "expected one presentation row")
    }
  }
  private def snapshots(db: JdbcDatabase, graph: GraphSnapshot): IO[Unit] = db.transaction { c =>
    List("ontology_scopes", "ontology_revisions").foreach { table =>
      Using.resource(c.prepareStatement(s"UPDATE $table SET snapshot = ? WHERE scope = ? AND generation = ?")) { s =>
        s.setString(1, StoredJson.encode(GraphSnapshot.codecJson, graph)); s.setString(2, graph.scope); s.setLong(3, graph.generation)
        Require(s.executeUpdate() == 1, "fixture", "expected one graph row")
      }
    }
  }

  test("late judgment-index insertion failure rolls back every publication component") { check { (db, repo) => for {
    f <- seed(repo)
    before <- repo.read(f.scope)
    originalCounts <- counts(db, f.scope)
    tag = "review_fail_" + UUID.randomUUID().toString.replace("-", "")
    install = ddl(db, List(
      s"CREATE FUNCTION $tag() RETURNS trigger LANGUAGE plpgsql AS $$$$ BEGIN IF NEW.scope = '${f.scope}' THEN RAISE EXCEPTION 'owned-$tag' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$$$",
      s"CREATE TRIGGER $tag BEFORE INSERT ON ontology_judgments FOR EACH ROW EXECUTE FUNCTION $tag()"))
    cleanup = ddl(db, List(s"DROP TRIGGER IF EXISTS $tag ON ontology_judgments", s"DROP FUNCTION IF EXISTS $tag()"))
    failed <- (install *> repo.judge(f.request, f.call, service, at).attempt).guarantee(cleanup)
    after <- repo.read(f.scope)
    history <- repo.history(f.scope, before.generation)
    afterCounts <- counts(db, f.scope)
    missing <- repo.history(f.scope, before.generation + 1L).attempt
    _ = assert(failed.left.toOption.exists(triggered), failed.fold(error => error match {
      case sql: SQLException => s"${sql.getClass.getName}: SQLState=${sql.getSQLState}"
      case other => other.getClass.getName
    }, _ => "unexpected successful publication"))
    _ = assertEquals(after, before)
    _ = assertEquals(history, before)
    _ = assertEquals(afterCounts, originalCounts)
    _ = assertEquals(missing.left.toOption.collect { case e: Fault => e.code }, Some("not-found"))
    judgment <- repo.judge(f.request, f.call, service, at)
    committed <- repo.read(f.scope)
    _ = assertEquals(committed.generation, before.generation + 1L)
    _ = assertEquals(committed.sourceFrontier, before.sourceFrontier + 1L)
    _ = assertEquals(committed.coveredFrontier, before.coveredFrontier)
    _ = assert(Graph.exists(committed, judgment.source))
    _ = assert(Graph.exists(committed, f.presentation.reservedSourceRef))
  } yield () } }

  test("individually valid changed canonical action and digest cannot detach a receipt from its act") { check { (db, repo) => for {
    f <- seed(repo)
    a <- repo.judge(f.request, f.call, service, at)
    actionB = ReviewAction.Review(JudgmentKind.NeedEvidence)
    b <- repo.judge(f.request.copy(requestId = UUID.randomUUID(), action = actionB), f.call, service, at)
    original <- bytes(db, f.scope, a.input.id)
    receipt = StoredJson.decode(InputReceipt.codecJson, original)
    contentB = StoredJson.encode(JudgmentRequest.codecJson, f.request.copy(action = actionB))
    altered = receipt.copy(content = contentB, digest = Digests.text(contentB))
    _ = InputReceipts.validateContext(altered)
    probes = List(repo.read(f.scope).void, repo.history(f.scope, receipt.generation).void, repo.sources(SourceRequest(f.scope, 0L, 10)).void,
      repo.judgment(f.call.principal, f.scope, a.id).void, repo.judgments(f.call.principal, f.scope).void, repo.input(f.scope, a.input).void)
    observed <- (replace(db, f.scope, a.input.id, StoredJson.encode(InputReceipt.codecJson, altered)) *> probes.traverse(_.attempt)).guarantee(replace(db, f.scope, a.input.id, original))
    restored <- bytes(db, f.scope, a.input.id)
    healthy <- repo.judgment(f.call.principal, f.scope, a.id)
    _ = assertEquals(restored, original)
    _ = assertEquals(b.action, actionB)
    _ = observed.foreach(result => assertEquals(result.left.toOption.collect { case e: Fault => e.code }, Some("corrupt")))
    _ = assertEquals(healthy, a)
  } yield () } }

  List("listing", "lookup").foreach { boundary => test(s"$boundary stays on its pinned cut when a judgment commits before the final query") { check { (db, repo) =>
    seed(repo).flatMap { f =>
      val prefix = if (boundary == "listing") "SELECT c.* FROM ontology_judgments" else "SELECT capture_id FROM ontology_judgments WHERE scope ="
      val url = sys.env.getOrElse("ONTOLOGY_TEST_JDBC_URL", throw new IllegalStateException("owned PostgreSQL required"))
      PostgresQueryBarrier.resource(url, prefix).use { barrier =>
        import ponygirls.runtime.{JdbcConfig, JdbcLimits}
        import scala.concurrent.duration.*
        val password = java.nio.file.Path.of(sys.env.getOrElse("ONTOLOGY_TEST_PASSWORD_FILE", throw new IllegalStateException("owned PostgreSQL password file required")))
        val config = JdbcConfig(barrier.jdbcUrl, "postgres", password, JdbcLimits(4, 16, 10.seconds, 10.seconds, 30.seconds, 35.seconds, 60.seconds, 35.seconds))
        JdbcDatabase.resource(config).use { readerDb =>
          val reader = new PostgresGraphRepository(readerDb, new AdmissionEngine, TestReview.domain, TestCuration.settings(Set("curation-fixture")))
          val read = if (boundary == "listing") reader.judgments(f.call.principal, f.scope).map(values => assertEquals(values, Nil))
            else reader.judgment(f.call.principal, f.scope, ReviewIdentity.judgment(f.scope, f.call.principal.actor, f.request.requestId)).attempt.map(result =>
              assertEquals(result.left.toOption.collect { case error: Fault => error.code }, Some("not-found")))
          for {
            fiber <- read.attempt.start
            result <- (barrier.awaitQuery *> repo.judge(f.request, f.call, service, at) *> barrier.release *> fiber.joinWithNever)
              .guarantee(barrier.release *> fiber.cancel)
            _ = assert(result.isRight, result.left.toOption.map(_.toString).getOrElse(""))
            current <- repo.judgments(f.call.principal, f.scope)
            _ = assertEquals(current.size, 1)
          } yield ()
        }
      }
    }
  } } }

  test("a reverse judgment index cannot promote a generic capture into a review record") { check { (db, repo) => for {
    f <- seed(repo)
    principal = f.call.principal.copy(capabilities = f.call.principal.capabilities + Capability.Capture)
    capture = IngestRequest(f.scope, UUID.randomUUID(), UUID.randomUUID(), None, None, EventOrigin.UserMessage,
      CaptureMetadata("raw", None, None, SourceRepresentation.Text, Nil, Nil), "Raw Human account", Observation.None())
    ingested <- repo.ingest(capture, principal, service, at, f.call.ingress)
    graph <- repo.read(f.scope)
    inputRef = Ref(Graph.node(graph, ingested.source).provenance.input, 1)
    fakeId = ReviewIdentity.judgment(f.scope, principal.actor, f.request.requestId)
    insert = db.transaction { c => Using.resource(c.prepareStatement("INSERT INTO ontology_judgments(scope, actor_id, actor_kind, request_id, judgment_id, presentation_id, capture_id, payload_digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")) { s =>
      s.setString(1, f.scope); s.setString(2, principal.actor.id); s.setString(3, principal.actor.kind.toString); s.setObject(4, f.request.requestId)
      s.setObject(5, fakeId); s.setObject(6, f.presentation.id); s.setObject(7, ingested.source.id); s.setString(8, Digests.text(Wire.encode(JudgmentRequest.codecJson, f.request).noSpaces))
      Require(s.executeUpdate() == 1, "fixture", "expected one owned index")
    } }
    remove = db.transaction { c => Using.resource(c.prepareStatement("DELETE FROM ontology_judgments WHERE scope = ? AND judgment_id = ?")) { s =>
      s.setString(1, f.scope); s.setObject(2, fakeId); Require(s.executeUpdate() == 1, "fixture", "expected one owned index")
    } }
    probes = List(repo.read(f.scope).void, repo.history(f.scope, graph.generation).void, repo.outboxSnapshots(100000).void,
      repo.sources(SourceRequest(f.scope, 0L, 10)).void, repo.input(f.scope, inputRef).void,
      repo.judgments(principal, f.scope).void, repo.judgment(principal, f.scope, fakeId).void)
    results <- (insert *> probes.traverse(_.attempt)).guarantee(remove)
    restored <- repo.read(f.scope)
    _ = assertEquals(restored, graph)
    _ = results.foreach(result => assertEquals(result.left.toOption.collect { case fault: Fault => fault.code }, Some("corrupt")))
  } yield () } }

  test("extra noncanonical CapturedAction edges cannot turn a generic review into an explicit choice") { check { (db, repo) => for {
    f <- seed(repo)
    judgment <- repo.judge(f.request, f.call, service, at)
    graph <- repo.read(f.scope)
    selected = f.presentation.payload.manifest.choices.head
    target = selected match { case value: PresentedSelection.Whole => value.target; case value: PresentedSelection.Alternative => value.target }
    unbacked = Relation(Ref(UUID.randomUUID(), 1), f.scope, Applicability.Captured(judgment.source), RelationKind.Chooses,
      List(judgment.source), List(target), RelationDetail.Adoption(f.presentation.id, AdoptionOrigin.CapturedAction, judgment.source, selected),
      "A generic review did not choose this alternative", Standing.Active, Graph.node(graph, judgment.source).provenance)
    altered = graph.copy(relations = graph.relations :+ unbacked)
    probes = List(repo.read(f.scope).void, repo.history(f.scope, graph.generation).void, repo.outboxSnapshots(100000).void,
      repo.input(f.scope, judgment.input).void, repo.judgments(f.call.principal, f.scope).void, repo.judgment(f.call.principal, f.scope, judgment.id).void)
    results <- (snapshots(db, altered) *> probes.traverse(_.attempt)).guarantee(snapshots(db, graph))
    restored <- repo.read(f.scope)
    _ = assertEquals(restored, graph)
    _ = results.foreach(result => assertEquals(result.left.toOption.collect { case fault: Fault => fault.code }, Some("corrupt")))
  } yield () } }

  Corruption.values.foreach { kind => test(s"$kind corruption cannot be exposed as a consistent retained judgment") { check { (db, repo) => for {
    f <- seed(repo)
    other <- repo.prepare(PresentRequest(f.scope, f.presentation.payload.targets, f.presentation.payload.generation), f.call, UUID.randomUUID(), at)
    judgment <- repo.judge(f.request, f.call, service, at)
    graph <- repo.read(f.scope)
    sources <- repo.sources(SourceRequest(f.scope, 0L, 10))
    event = sources.events.find(_.id == judgment.source.id).get
    derived = Graph.node(graph, f.presentation.reservedSourceRef)
    pubBytes <- bytes(db, f.scope, derived.provenance.input)
    pub = StoredJson.decode(InputReceipt.codecJson, pubBytes)
    change = kind match {
      case Corruption.Kind => Change(primary(db, f, event, "Capture"), primary(db, f, event, "Judgment"))
      case Corruption.Namespace => Change(primary(db, f, event.copy(sourceNamespace = "another-valid-credential"), "Judgment"), primary(db, f, event, "Judgment"))
      case Corruption.Link => Change(primary(db, f, event.copy(reviewResponse = Some(event.reviewResponse.get.copy(presentationId = other.id))), "Judgment"), primary(db, f, event, "Judgment"))
      case Corruption.Publication =>
        val content = StoredJson.encode(PresentationPublication.codecJson, PresentationPublication(other.id, other.reservedSourceRef, other.payloadDigest))
        val altered = pub.copy(content = content, digest = Digests.text(content))
        Change(replace(db, f.scope, pub.ref.id, StoredJson.encode(InputReceipt.codecJson, altered)), replace(db, f.scope, pub.ref.id, pubBytes))
      case Corruption.Manifest =>
        val payload = f.presentation.payload.copy(manifest = f.presentation.payload.manifest.copy(adoptionTargets = f.presentation.payload.targets))
        val altered = f.presentation.copy(payload = payload, payloadDigest = Digests.bytes(PresentationEngine.canonical(payload)))
        Change(presentation(db, altered), presentation(db, f.presentation))
      case Corruption.GraphSource =>
        val source = Graph.node(graph, judgment.source)
        val content = source.content.asInstanceOf[Content.Source].copy(text = "Another account", rawDigest = Digests.text("Another account"))
        val altered = graph.copy(definitions = graph.definitions.map(value => if (value.ref == source.ref) value.copy(content = content) else value))
        Change(snapshots(db, altered), snapshots(db, graph))
    }
    probes = List(repo.read(f.scope).void, repo.history(f.scope, graph.generation).void, repo.sources(SourceRequest(f.scope, 0L, 10)).void,
      repo.input(f.scope, judgment.input).void, repo.input(f.scope, pub.ref).void, repo.judgment(f.call.principal, f.scope, judgment.id).void,
      repo.judgments(f.call.principal, f.scope).void, repo.outboxSnapshots(100000).void) ++
      (if (kind == Corruption.Manifest) List(repo.presentation(f.call.principal, f.scope, f.presentation.id).void) else Nil)
    observed <- (change.install *> probes.traverse(_.attempt)).guarantee(change.restore)
    healthy <- repo.read(f.scope)
    _ = assertEquals(healthy, graph)
    _ = observed.foreach(result => assertEquals(result.left.toOption.collect { case fault: Fault => fault.code }, Some("corrupt")))
  } yield () } } }
}
