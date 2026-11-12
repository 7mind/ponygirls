package ontology

import cats.effect.unsafe.IORuntime
import munit.FunSuite
import ontology.api.*
import ontology.domain.*
import java.util.UUID
import scala.util.Using

final class ReceiptContextIntegritySuite extends FunSuite {
  private val runtime = IORuntime.builder().build()
  override def afterAll(): Unit = runtime.shutdown()
  List(InputKind.GraphMutation, InputKind.Capture).foreach { kind =>
    test(s"$kind receipt context must agree with the retained canonical contribution") {
      RepositoryReproductionDatabase.resource.use { db => RepositoryReproductionDatabase.store(db).flatMap { repo =>
        val scope = "receipt-context-" + UUID.randomUUID(); val requestId = UUID.randomUUID()
        val actor = Actor("fixture", ActorKind.Agent); val host = Actor("host", ActorKind.Service)
        val principal = Principal("fixture", actor, Set(scope), Set(Capability.Read, Capability.Mutate, Capability.Capture))
        val ingress = TestContexts.trace("fixture-receipt")
        val input = ApplyRequest(scope, requestId, 0L, List(Operation.Create("claim", TestAuthoring.applicability(TestApplicability.unresolved), ContentInput.Statement("Controlled input", Modality.Assertion), Nil)), None)
        val receiptId = if (kind == InputKind.GraphMutation) InputReceipts.graphId(actor, requestId) else InputReceipts.id(InputKind.Capture, principal.credentialId, requestId)
        val publication = if (kind == InputKind.GraphMutation) repo.apply(input, Admission(principal, host, requestId, "fixture", ingress, Nil)).void
          else repo.ingest(IngestRequest(scope, requestId, UUID.randomUUID(), None, None, EventOrigin.WorkerMessage, CaptureMetadata("fixture", None, None, SourceRepresentation.Text, Nil, Nil), "Controlled input", Observation.None()), principal, host, "fixture", ingress).void
        def store(value: InputReceipt) = db.transaction { connection =>
          Using.resource(connection.prepareStatement("UPDATE ontology_inputs SET payload = ? WHERE scope = ? AND input_id = ?")) { statement =>
            statement.setString(1, StoredJson.encode(InputReceipt.codecJson, value)); statement.setString(2, scope); statement.setObject(3, receiptId)
            assertEquals(statement.executeUpdate(), 1)
          }
        }
        for {
          _ <- publication
          original <- repo.input(scope, Ref(receiptId, 1))
          altered = original.copy(contributionContext = TestContexts.reported(CaptureContext("unestablished-session", None, None, LineageStatus.Unknown, "branch", UUID.randomUUID())))
          _ <- store(altered)
          result <- repo.input(scope, original.ref).attempt.guarantee(store(original))
          _ = assertEquals(result.left.toOption.collect { case f: Fault => f.code }, Some("corrupt"))
          restored <- repo.input(scope, original.ref)
          _ = assertEquals(restored, original)
        } yield ()
      } }.unsafeRunSync()(using runtime)
    }
  }
}
