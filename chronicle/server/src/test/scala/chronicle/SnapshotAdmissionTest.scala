package chronicle

import chronicle.api.*
import cats.effect.{Deferred,IO,Ref}
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import distage.*
import izumi.logstage.api.Log
import org.http4s.{Http as _,Message as _,*}
import org.http4s.client.Client
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString
import java.util.UUID
import scala.concurrent.duration.*

final class SnapshotAdmissionGraph(val services: RuntimeServices,val admission: SnapshotAdmission)

final class SnapshotAdmissionTest extends munit.FunSuite {
  test("Effectual GoodCommunication: large ingests and indexing claims decode one snapshot at a time while smaller ingests pass") {
    (for {
      ingestWaits <- Deferred[IO,Unit]
      logger=logstage.IzLogger(Log.Level.Info,List(new izumi.logstage.api.logger.LogSink {
        def flush(entry: Log.Entry): Unit = if(entry.message.template.parts.head.startsWith("large ingest waits for admission")) { ingestWaits.complete(()).unsafeRunSync(); () }
      }))
      _ <- SnapshotAdmission.resource(logger,SnapshotAdmission.ingestWait).use { admission => for {
        inside <- Ref.of[IO,Int](0)
        most <- Ref.of[IO,Int](0)
        tracked=(work: IO[Unit]) => inside.updateAndGet(_+1).flatMap(n => most.update(_.max(n))) *> work *> inside.update(_-1)
        firstIn <- Deferred[IO,Unit]
        releaseFirst <- Deferred[IO,Unit]
        first <- admission.ingest(Some(SnapshotAdmission.largeBodyBytes+1L))(tracked(firstIn.complete(()) *> releaseFirst.get)).start
        _ <- firstIn.get.timeout(5.seconds)
        secondIn <- Deferred[IO,Unit]
        second <- admission.ingest(Some(SnapshotAdmission.largeBodyBytes+1L))(tracked(secondIn.complete(()).void)).start
        claimIn <- Deferred[IO,Unit]
        claim <- admission.claim(tracked(claimIn.complete(()).void)).start
        _ <- admission.ingest(Some(SnapshotAdmission.largeBodyBytes.toLong))(IO.unit).timeout(5.seconds)
        _ <- ingestWaits.get.timeout(5.seconds)
        _ <- (IO.cede *> admission.waiting).iterateUntil(_==2L).timeout(5.seconds)
        early <- (secondIn.tryGet,claimIn.tryGet).tupled
        _ <- IO(assertEquals(early,(None,None),"the second large ingest and the claim wait while the first is admitted"))
        _ <- releaseFirst.complete(())
        _ <- first.joinWithNever.timeout(5.seconds) *> second.joinWithNever.timeout(5.seconds) *> claim.joinWithNever.timeout(5.seconds)
        maximum <- most.get
      } yield assertEquals(maximum,1) }
    } yield ()).unsafeRunSync()
  }
  test("Effectual GoodCommunication: a large ingest that is not admitted within its bound is refused as unavailable") {
    SnapshotAdmission.resource(logstage.IzLogger(Log.Level.Info,Nil),50.millis).use { admission => for {
      inside <- Deferred[IO,Unit]
      release <- Deferred[IO,Unit]
      claim <- admission.claim(inside.complete(()) *> release.get).start
      _ <- inside.get.timeout(5.seconds)
      refused <- admission.ingest(Some(SnapshotAdmission.largeBodyBytes+1L))(IO.unit).attempt
      _ <- release.complete(()) *> claim.joinWithNever.timeout(5.seconds)
    } yield assertEquals(refused.left.map { case error: DomainError => error.code; case error => error.toString },Left("unavailable")) }.unsafeRunSync()
  }
  test("Effectual GoodCommunication regression: a large ingest waits for admission before its body is read") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped") }
    val c=Fixtures.config().copy(maxBodyBytes=2*SnapshotAdmission.largeBodyBytes); @volatile var read=false
    SnapshotAdmission.resource(logstage.IzLogger(Log.Level.Info,Nil),100.millis).use { admission =>
      val production: Module=_root_.chronicle.plugins.ChroniclePlugin
      val module=production.overriddenBy(new ModuleDef {
        make[Config].fromValue(c); make[Client[IO]].fromValue(Client.fromHttpApp[IO](HttpApp.notFound[IO]))
        make[SnapshotAdmission].fromValue(admission); make[SnapshotAdmissionGraph]
      })
      ChronicleInjector().produceGet[SnapshotAdmissionGraph](module).use { graph => for {
        token <- IO.blocking {
          graph.services.database.initialize()
          graph.services.database.transaction(x => { Sql.exec(x,"TRUNCATE ch_tokens,ch_mutations CASCADE"); () })
          val auth=new Auth(graph.services.database,c); val (_,cookie)=auth.login(LoginRequest("a","synthetic"))
          auth.mutate(auth.browser(cookie),ClientEnvelope(UUID.randomUUID(),Operation.MintToken("test",List(Scope.Ingest)))).asInstanceOf[Result.Token].result.secret.get
        }
        ws <- WebSocketBuilder2[IO]
        gate <- Semaphore[IO](2)
        inside <- Deferred[IO,Unit]
        release <- Deferred[IO,Unit]
        holder <- admission.claim(inside.complete(()) *> release.get).start
        _ <- inside.get.timeout(5.seconds)
        body=fs2.Stream.eval(IO { read=true }).drain ++ fs2.Stream.emits(Array.fill[Byte](16)(32)).covary[IO]
        request=Request[IO](Method.POST,Uri.unsafeFromString("/api/ingest")).withBodyStream(body)
          .putHeaders(Header.Raw(CIString("Authorization"),s"Bearer $token"),Header.Raw(CIString("Content-Length"),(SnapshotAdmission.largeBodyBytes+1).toString))
        response <- graph.services.http.routes(ws,gate).orNotFound(request)
        _ <- release.complete(()) *> holder.joinWithNever.timeout(5.seconds)
      } yield { assertEquals(response.status,Status.ServiceUnavailable); assert(!read,"the body of a waiting ingest is not read") } }
    }.unsafeRunSync()
  }
}
