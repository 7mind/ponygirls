package chronicle

import cats.effect.{IO,Ref}
import cats.effect.unsafe.implicits.global
import io.circe.Json
import java.util.UUID

class MessageContextFailureTest extends munit.FunSuite {
  import McpTestFixtures.*
  List("deadline","indexed-view-retired").foreach { code =>
    test(s"BG specified: context $code remains attributed, terminal and sanitized in the one-shot run") {
      (for {
        auth <- authorization
        time <- clock
        calls <- Ref.of[IO,Vector[(String,Json)]](Vector.empty)
        contextTools=new BehavioralTools(List(McpRunToolDefinition("read_message_context","synthetic bounded context",schema,true)),calls,(_,_,_,_) => IO.raiseError(DomainError(code,"PRIVATE_POISON")))
        llm <- model(_ => IO.pure(toolReply(List(("context-read","read_message_context",Json.obj())),None)))
        _ <- McpTestRuns.resource(contextTools,llm,auth,time,Set("a"),encoding,IO(UUID.randomUUID())).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
          for {
            catalog <- runner.catalog(identity)
            id <- IO(UUID.randomUUID())
            _ <- runner.start(identity,connection,catalog.instanceId,id,"synthetic context failure")
            result <- settled(runner,identity,catalog.instanceId,id)
            invocations <- calls.get
            requests <- llm.requests.get
            _ <- IO {
              assertEquals(result.state,McpRunState.Failed)
              assertEquals(result.failure.map(_.code),Some(code))
              assertEquals(result.failure.map(_.message),Some("one-shot test failed; no automatic retry was performed"))
              assertEquals(invocations.size,1); assertEquals(requests.size,1)
              assert(!frame(result).noSpaces.contains("PRIVATE_POISON"))
            }
          } yield ()
        }}
      } yield ()).unsafeRunSync()
    }
  }
}
