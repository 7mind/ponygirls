package ontology

import cats.effect.IO
import cats.effect.unsafe.IORuntime
import cats.syntax.all.*
import java.util.UUID
import scala.util.Using
import munit.FunSuite
import ontology.api.*
import ontology.domain.*
import ponygirls.runtime.JdbcDatabase

final class PostgresCommandControls extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  private def check(work: (JdbcDatabase, GraphRepository) => IO[Unit]): Unit =
    RepositoryReproductionDatabase.resource.use(db => RepositoryReproductionDatabase.store(db).flatMap(repo => work(db, repo))).unsafeRunSync()(using runtime)
  private def request: ApplyRequest = ApplyRequest("command-control-" + UUID.randomUUID(), UUID.randomUUID(), 0L,
    List(Operation.Create("claim", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Statement("Controlled command", Modality.Assertion), Nil)), None)
  private def admission(r: ApplyRequest): Admission = Admission(TestContexts.principal(r.scope, Actor("command-writer", ActorKind.Agent)),
    Actor("command-service", ActorKind.Service), r.requestId, "2026-11-11T00:00:00Z", TestContexts.trace("command-control"), Nil)
  private def ddl(db: JdbcDatabase, statements: List[String]): IO[Unit] = db.transaction(c =>
    Using.resource(c.createStatement())(s => statements.foreach(sql => { s.execute(sql); () })))
  private def counts(db: JdbcDatabase, scope: String): IO[List[Long]] = db.transaction { c =>
    List("ontology_scopes", "ontology_revisions", "ontology_inputs", "ontology_captures", "ontology_mutations", "ontology_outbox").map { table =>
      Using.resource(c.prepareStatement(s"SELECT count(*) FROM $table WHERE scope = ?")) { p =>
        p.setString(1, scope); Using.resource(p.executeQuery()) { row => Require(row.next(), "fixture", "count missing"); row.getLong(1) }
      }
    }
  }
  private def resultBytes(db: JdbcDatabase, r: ApplyRequest): IO[String] = db.transaction { c =>
    Using.resource(c.prepareStatement("SELECT result FROM ontology_mutations WHERE scope = ? AND request_id = ?")) { p =>
      p.setString(1, r.scope); p.setObject(2, r.requestId)
      Using.resource(p.executeQuery()) { row => Require(row.next(), "fixture", "command index missing"); row.getString(1) }
    }
  }
  private def replaceResult(db: JdbcDatabase, r: ApplyRequest, value: String): IO[Unit] = db.transaction { c =>
    Using.resource(c.prepareStatement("UPDATE ontology_mutations SET result = ? WHERE scope = ? AND request_id = ?")) { p =>
      p.setString(1, value); p.setString(2, r.scope); p.setObject(3, r.requestId)
      Require(p.executeUpdate() == 1, "fixture", "expected one command index")
    }
  }
  private def snapshots(db: JdbcDatabase, graph: GraphSnapshot): IO[Unit] = db.transaction { c =>
    List("ontology_scopes", "ontology_revisions").foreach { table =>
      Using.resource(c.prepareStatement(s"UPDATE $table SET snapshot = ? WHERE scope = ? AND generation = ?")) { p =>
        p.setString(1, StoredJson.encode(GraphSnapshot.codecJson, graph)); p.setString(2, graph.scope); p.setLong(3, graph.generation)
        Require(p.executeUpdate() == 1, "fixture", "expected one owned snapshot")
      }
    }
  }
  for (extra <- List(false, true); later <- List(false, true)) test(s"changed or extra command output is rejected at publication and later cuts: extra=$extra later=$later") { check { (db, repo) =>
    val r = request; val a = admission(r)
    for {
      first <- repo.apply(r, a)
      next = request.copy(scope = r.scope, expectedGeneration = first.generation)
      _ <- if (later) repo.apply(next, admission(next)).void else IO.unit
      graph <- repo.read(r.scope)
      original = Graph.node(graph, first.created.head.ref)
      altered = if (extra) graph.copy(definitions = graph.definitions :+ original.copy(ref = Ref(UUID.randomUUID(), 1)))
        else graph.copy(definitions = graph.definitions.map(value => if (value.ref == original.ref) value.copy(content = Content.Statement("Not the retained command output", Modality.Assertion)) else value))
      probes = List(repo.read(r.scope).void, repo.history(r.scope, graph.generation).void, repo.sources(SourceRequest(r.scope, 0L, 10)).void,
        repo.input(r.scope, Ref(a.provenance.input, 1)).void, repo.apply(r, a).void, repo.outboxSnapshots(100000).void)
      observed <- (snapshots(db, altered) *> probes.traverse(_.attempt)).guarantee(snapshots(db, graph))
      _ = observed.foreach(value => assertEquals(value.left.toOption.collect { case e: Fault => e.code }, Some("corrupt")))
      restored <- repo.read(r.scope)
      _ = assertEquals(restored, graph)
    } yield ()
  } }
  for (relabel <- List(false, true)) test(s"later capture cannot lose or relabel a command actor: relabel=$relabel") { check { (db, repo) =>
    val r = request; val a = admission(r)
    val principal = Principal("capturer", Actor("capturer", ActorKind.Agent), Set(r.scope), Set(Capability.Capture))
    val input = IngestRequest(r.scope, UUID.randomUUID(), UUID.randomUUID(), None, None, EventOrigin.WorkerMessage,
      CaptureMetadata("later", None, None, SourceRepresentation.Text, Nil, Nil), "Later captured account", Observation.None())
    for {
      first <- repo.apply(r, a)
      publication <- repo.read(r.scope)
      _ <- repo.ingest(input, principal, a.recorder, "2026-11-11T00:01:00Z", TestContexts.trace("capture"))
      graph <- repo.read(r.scope)
      actors = if (relabel) graph.actors.map(value => if (value.value == a.actor) value.copy(value = a.actor.copy(id = "relabeled")) else value)
        else graph.actors.filterNot(_.value == a.actor)
      probes = List(repo.read(r.scope).void, repo.history(r.scope, graph.generation).void, repo.sources(SourceRequest(r.scope, 0L, 10)).void,
        repo.input(r.scope, Ref(a.provenance.input, 1)).void, repo.apply(r, a).void, repo.outboxSnapshots(100000).void)
      observed <- (snapshots(db, graph.copy(actors = actors)) *> probes.traverse(_.attempt).flatMap { values =>
        repo.history(r.scope, first.generation).map(older => (values, older))
      }).guarantee(snapshots(db, graph))
      _ = observed._1.foreach(value => assertEquals(value.left.toOption.collect { case e: Fault => e.code }, Some("corrupt")))
      _ = assertEquals(observed._2, publication)
      restored <- repo.read(r.scope)
      _ = assertEquals(restored, graph)
    } yield ()
  } }
  test("command migration refuses retained pre-command mutation data without inventing frontiers") { check { (db, _) =>
    val stream = Option(getClass.getResourceAsStream("/004_graph_commands.sql")).getOrElse(throw Fault("fixture", "command migration missing"))
    val migration = Using.resource(stream)(value => new String(value.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8))
    db.transaction { c => Using.resource(c.createStatement()) { statement =>
      statement.execute("CREATE TEMP TABLE ontology_mutations (marker integer) ON COMMIT DROP")
      statement.execute("CREATE TEMP TABLE ontology_captures (input_kind text CONSTRAINT ontology_captures_kind CHECK (input_kind IN ('Capture', 'Judgment'))) ON COMMIT DROP")
      statement.execute("INSERT INTO ontology_mutations VALUES (1)")
      statement.execute(migration)
      ()
    } }.attempt.map(result => assert(result.left.toOption.exists {
      case failure: ponygirls.runtime.JdbcFailure => failure.sqlState.contains("P0001")
      case _ => false
    }))
  } }
  test("late command-index failure rolls back Source frontier receipt history and outbox") { check { (db, repo) =>
    val r = request; val a = admission(r); val tag = "command_fail_" + UUID.randomUUID().toString.replace("-", "")
    val install = ddl(db, List(
      s"CREATE FUNCTION $tag() RETURNS trigger LANGUAGE plpgsql AS $$$$ BEGIN IF NEW.scope = '${r.scope}' THEN RAISE EXCEPTION 'owned-$tag' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$$$",
      s"CREATE TRIGGER $tag BEFORE INSERT ON ontology_mutations FOR EACH ROW EXECUTE FUNCTION $tag()"))
    val cleanup = ddl(db, List(s"DROP TRIGGER IF EXISTS $tag ON ontology_mutations", s"DROP FUNCTION IF EXISTS $tag()"))
    for {
      before <- counts(db, r.scope)
      failed <- (install *> repo.apply(r, a).attempt).guarantee(cleanup)
      _ = assert(failed.left.toOption.exists { case e: ponygirls.runtime.JdbcFailure => e.sqlState.contains("P0001"); case _ => false })
      after <- counts(db, r.scope)
      graph <- repo.read(r.scope)
      _ = assertEquals(after, before)
      _ = assertEquals(graph, Graph.empty(r.scope))
      result <- repo.apply(r, a)
      committed <- repo.read(r.scope)
      _ = assertEquals((result.generation, committed.sourceFrontier), (1L, 1L))
    } yield ()
  } }
  test("discarded successful response replays the original command through a reconstructed adapter") { check { (db, repo) =>
    val r = request; val a = admission(r)
    for {
      lost <- repo.apply(r, a).flatMap(_ => IO.raiseError[Unit](new java.io.IOException("controlled post-commit response loss"))).attempt
      _ = assert(lost.isLeft)
      before <- repo.read(r.scope)
      events <- repo.sources(SourceRequest(r.scope, 0L, 10))
      original <- counts(db, r.scope)
      restarted <- RepositoryReproductionDatabase.store(db)
      result <- restarted.apply(r, a.copy(principal = a.principal.copy(credentialId = "rotated"), recordedAt = "2026-11-11T01:00:00Z", ingress = TestContexts.trace("retry")))
      after <- restarted.read(r.scope)
      retained <- restarted.sources(SourceRequest(r.scope, 0L, 10))
      finalCounts <- counts(db, r.scope)
      _ = assert(result.replayed)
      _ = assertEquals((after.generation, after.sourceFrontier), (1L, 1L))
      _ = assertEquals(after, before)
      _ = assertEquals(retained, events)
      _ = assertEquals(finalCounts, original)
    } yield ()
  } }
  test("an altered command replay index is rejected at every public correspondence boundary") { check { (db, repo) =>
    val r = request; val a = admission(r)
    for {
      result <- repo.apply(r, a)
      graph <- repo.read(r.scope)
      original <- resultBytes(db, r)
      altered = StoredJson.encode(ApplyResult.codecJson, result.copy(created = Nil))
      probes = List(repo.read(r.scope).void, repo.history(r.scope, result.generation).void, repo.sources(SourceRequest(r.scope, 0L, 10)).void,
        repo.input(r.scope, Ref(a.provenance.input, 1)).void, repo.apply(r, a).void, repo.outboxSnapshots(100000).void)
      observed <- (replaceResult(db, r, altered) *> probes.traverse(_.attempt)).guarantee(replaceResult(db, r, original))
      _ = observed.foreach(value => assertEquals(value.left.toOption.collect { case e: Fault => e.code }, Some("corrupt")))
      restored <- repo.read(r.scope)
      _ = assertEquals(restored, graph)
    } yield ()
  } }
}
