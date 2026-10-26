package chronicle

import cats.effect.{IO,Ref,Deferred,Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.Json
import java.util.UUID
import scala.concurrent.duration.*

class McpTestLimitsTest extends munit.FunSuite {
  import McpTestFixtures.*
  override val munitTimeout = 120.seconds
  private def runtime(tools: McpRunTools,model: McpTestModel,auth: RunAuthorization,clock: McpRunClock,encoder: McpRunPageEncoding): Resource[IO,McpTestRuns] =
    McpTestRuns.resource(tools,model,auth,clock,Set("a","b"),encoder,IO(UUID.randomUUID()))
  private def code(result: Either[Throwable,?]): String = result.left.toOption match {
    case Some(error: DomainError) => error.code
    case Some(error) => throw error
    case None => fail("expected failure")
  }

  test("BG: prompt admission is scalar-safe and UTF8-byte exact before any provider request") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      llm <- model(_ => IO.pure(finalReply("done")))
      _ <- runtime(tools,llm,auth,time,encoding).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity)
          invalid <- List("", "  ", "🙂"*(McpRunLimits.maximumPromptBytes/4)+"a", "\ud800").traverse { prompt =>
            runner.start(identity,connection,catalog.instanceId,UUID.randomUUID(),prompt).attempt
          }
          calls <- llm.requests.get
          _ <- IO { assert(invalid.forall(result => code(result)=="invalid")); assertEquals(calls.size,0) }
          id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"🙂"*(McpRunLimits.maximumPromptBytes/4))
          done <- settled(runner,identity,catalog.instanceId,id)
          _ <- IO(assertEquals(done.state,McpRunState.Complete))
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: per-invocation source admission rejects before synthetic payload materialization; no partial model result") {
    (for {
      auth <- authorization; time <- clock
      fetched <- Ref.of[IO,Boolean](false)
      tools <- McpTestFixtures.tools { (access,_,_,admission) => access.fresh *> IO {
        admission.consume(McpRunLimits.maximumSourceBytes.toLong)
        admission.consume(1L)
      } *> fetched.set(true).as(Json.obj("payload"->Json.True)) }
      llm <- model(_ => IO.pure(toolReply(List(("source","search",Json.obj())),None)))
      _ <- runtime(tools,llm,auth,time,encoding).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"read source")
          failed <- settled(runner,identity,catalog.instanceId,id)
          materialized <- fetched.get; requests <- llm.requests.get
          _ <- IO {
            assertEquals(failed.failure.map(_.code),Some("read-budget"))
            assertEquals(materialized,false)
            assertEquals(requests.size,1)
            assert(failed.events.forall(_.item.isInstanceOf[McpRunItem.ToolCall]))
          }
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: complete escaped result bytes and JSON depth reject whole logical items, never partial prefixes") {
    val huge=Json.obj("escaped"->Json.fromString("\n"*(McpRunLimits.maximumResultBytes/2)))
    val deep=(1 to McpRunLimits.maximumJsonDepth).foldLeft(Json.obj())((json,_) => Json.obj("nested"->json))
    List(huge,deep).foreach { result =>
      (for {
        auth <- authorization; time <- clock
        tools <- McpTestFixtures.tools((access,_,_,admission) => access.fresh *> IO { admission.consume(1L); result })
        llm <- model(_ => IO.pure(toolReply(List(("result","search",Json.obj())),None)))
        _ <- runtime(tools,llm,auth,time,encoding).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
          for {
            catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
            _ <- runner.start(identity,connection,catalog.instanceId,id,"bounded result")
            failed <- settled(runner,identity,catalog.instanceId,id)
            requests <- llm.requests.get
            _ <- IO {
              assertEquals(failed.state,McpRunState.Failed)
              assertEquals(failed.failure.map(_.code),Some("mcp-result-limit"))
              assertEquals(requests.size,1)
              assert(failed.events.forall(_.item.isInstanceOf[McpRunItem.ToolCall]))
            }
          } yield ()
        }}
      } yield ()).unsafeRunSync()
    }
  }

  test("BG: hidden reasoning and complete tool strings count toward context; neither is truncated or retried") {
    List(550000,450000).foreach { reasoningBytes =>
      (for {
        auth <- authorization; time <- clock
        tools <- McpTestFixtures.tools((access,_,_,admission) => access.fresh *> IO { admission.consume(1L); Json.obj("text"->Json.fromString("x"*100000)) })
        llm <- model(_ => IO.pure(toolReply(List(("context","search",Json.obj())),Some("r"*reasoningBytes))))
        _ <- runtime(tools,llm,auth,time,encoding).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
          for {
            catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
            _ <- runner.start(identity,connection,catalog.instanceId,id,"context")
            failed <- settled(runner,identity,catalog.instanceId,id)
            requests <- llm.requests.get; invocations <- tools.calls.get
            _ <- IO {
              assertEquals(failed.failure.map(_.code),Some("mcp-context-limit"))
              assertEquals(requests.size,1)
              assertEquals(invocations.size,if(reasoningBytes>500000) 0 else 1)
              assert(!frame(failed).noSpaces.contains("rrrrrrrr"))
              assert(!failed.events.exists(_.item.isInstanceOf[McpRunItem.ToolResult]))
            }
          } yield ()
        }}
      } yield ()).unsafeRunSync()
    }
  }

  test("BG: maximum model rounds and total tool calls are hard admissions, with sequential execution") {
    List(1,4).foreach { callsPerRound =>
      (for {
        auth <- authorization; time <- clock
        serial <- Ref.of[IO,(Int,Int)]((0,0))
        tools <- McpTestFixtures.tools { (access,_,_,admission) => access.fresh *> Resource.make(serial.update { case (active,maximum) => (active+1,maximum.max(active+1)) })(_ => serial.update { case (active,maximum) => (active-1,maximum) }).use(_ => IO { admission.consume(1L); Json.obj() }) }
        llm <- model { request => IO.pure {
          val round=request.hcursor.get[Vector[Json]]("messages").toOption.get.count(_.hcursor.get[String]("role").toOption.contains("assistant"))
          toolReply((0 until callsPerRound).map(index => (s"$round-$index","search",Json.obj())).toList,None)
        }}
        _ <- runtime(tools,llm,auth,time,encoding).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
          for {
            catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
            _ <- runner.start(identity,connection,catalog.instanceId,id,"limits")
            failed <- settled(runner,identity,catalog.instanceId,id)
            requests <- llm.requests.get; invocations <- tools.calls.get; counts <- serial.get
            _ <- IO {
              assertEquals(failed.failure.map(_.code),Some(if(callsPerRound==1) "mcp-round-limit" else "mcp-call-limit"))
              assertEquals(requests.size,if(callsPerRound==1) 4 else 3)
              assertEquals(invocations.size,if(callsPerRound==1) 3 else 8)
              assertEquals(counts,(0,1))
            }
          } yield ()
        }}
      } yield ()).unsafeRunSync()
    }
  }

  test("BG: trace bytes and event counts are atomic caps measured by complete encoded frames") {
    List(40000,47500).foreach { overhead =>
      val largeEnvelope=new McpRunPageEncoding {
        def bytes(snapshot: McpRunSnapshot): Long = McpRunJson.bytes(Json.obj("syntheticProtocolMetadata"->Json.fromString("x"*overhead),"payload"->frame(snapshot)).noSpaces).toLong
      }
      (for {
        auth <- authorization; time <- clock; tools <- ordinaryTools
        llm <- model(_ => IO.pure(finalReply("x"*200000)))
        _ <- runtime(tools,llm,auth,time,largeEnvelope).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
          for {
            catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
            _ <- runner.start(identity,connection,catalog.instanceId,id,"bounded trace")
            failed <- settled(runner,identity,catalog.instanceId,id)
            _ <- IO {
              assertEquals(failed.failure.map(_.code),Some("mcp-trace-limit"))
              assertEquals(failed.events,Nil)
              assert(largeEnvelope.bytes(failed)<=McpRunLimits.pageBytes)
            }
          } yield ()
        }}
      } yield ()).unsafeRunSync()
    }
  }

  test("BG: a frame that cannot fit a scalar fails explicitly, never empty hasMore pagination") {
    val impossible=new McpRunPageEncoding {
      def bytes(snapshot: McpRunSnapshot): Long = encoding.bytes(snapshot)+(if(snapshot.events.nonEmpty) McpRunLimits.pageBytes.toLong else 0L)
    }
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      llm <- model(_ => IO.pure(finalReply("🙂")))
      _ <- runtime(tools,llm,auth,time,impossible).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"impossible page")
          failed <- settled(runner,identity,catalog.instanceId,id)
          _ <- IO { assertEquals(failed.failure.map(_.code),Some("mcp-page-invariant")); assertEquals(failed.events,Nil); assertEquals(failed.hasMore,false) }
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: cancellation during nested tool await stops local orchestration and erases admitted call trace") {
    (for {
      auth <- authorization; time <- clock
      entered <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]
      tools <- McpTestFixtures.tools((access,_,_,_) => access.fresh *> entered.complete(()).void *> IO.uncancelable(_ => release.get).as(Json.obj("private"->Json.True)))
      llm <- model(_ => IO.pure(toolReply(List(("wait","search",Json.obj())),None)))
      _ <- runtime(tools,llm,auth,time,encoding).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"tool wait")
          _ <- entered.get
          before <- runner.read(identity,catalog.instanceId,id,0L,1)
          _ <- IO(assert(before.events.nonEmpty))
          cancelled <- runner.cancel(identity,catalog.instanceId,id).timeout(1.second)
          _ <- release.complete(())
          _ <- IO.sleep(10.millis)
          after <- runner.read(identity,catalog.instanceId,id,0L,256)
          requests <- llm.requests.get
          _ <- IO {
            assertEquals(cancelled.state,McpRunState.Cancelled)
            assertEquals(after.events,Nil)
            assertEquals(requests.size,1)
          }
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }
}
