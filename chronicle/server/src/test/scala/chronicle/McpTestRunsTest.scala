package chronicle

import cats.effect.{IO,Deferred,Ref,Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.Json
import java.util.UUID
import scala.concurrent.duration.*

class McpTestRunsTest extends munit.FunSuite {
  import McpTestFixtures.*
  override val munitTimeout = 120.seconds

  private def runtime(tools: McpRunTools,model: McpTestModel,auth: RunAuthorization,clock: McpRunClock): Resource[IO,McpTestRuns] =
    McpTestRuns.resource(tools,model,auth,clock,Set("a","b"),encoding,IO(UUID.randomUUID()))
  private def code(result: Either[Throwable,?]): String = result.left.toOption match {
    case Some(error: DomainError) => error.code
    case Some(error) => throw error
    case None => fail("expected a domain error")
  }

  test("BG: valid empty-owner deployments allocate an inert runner without broadening read authorization") {
    (for {
      _ <- IO(Fixtures.config().copy(users=Nil).validate())
      auth <- authorization; time <- clock; tools <- ordinaryTools
      llm <- model(_ => IO.pure(finalReply("not callable")))
      _ <- McpTestRuns.resource(tools,llm,auth,time,Set.empty,encoding,IO(UUID.randomUUID())).use { runner =>
        runner.catalog(identity).attempt.map(result => assertEquals(code(result),"unauthorized"))
      }
      requests <- llm.requests.get
      _ <- IO(assertEquals(requests.size,0))
    } yield ()).unsafeRunSync()
  }

  test("BG: search, use found ID, follow up, final; next run has no carry-over or hidden-reasoning trace") {
    (for {
      auth <- authorization
      time <- clock
      tools <- ordinaryTools
      llm <- model { request =>
        val messages=request.hcursor.get[Vector[Json]]("messages").toOption.get
        val results=messages.filter(_.hcursor.get[String]("role").toOption.contains("tool"))
        IO.pure(results.size match {
          case 0 => toolReply(List(("call-search","search",Json.obj())),Some("hidden synthetic reasoning"))
          case 1 =>
            val id=Wire.parse(results.head.hcursor.get[String]("content").toOption.get).hcursor.get[String]("sessionId").toOption.get
            toolReply(List(("call-read","read",Json.obj("sessionId"->Json.fromString(id)))),Some("follow-up reasoning"))
          case _ => finalReply("source-grounded final answer")
        })
      }
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity)
          id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"synthetic prompt one")
          complete <- settled(runner,identity,catalog.instanceId,id)
          _ <- IO {
            assertEquals(complete.state,McpRunState.Complete)
            assertEquals(complete.events.map(_.sequence),List(1L,2L,3L,4L,5L))
            assert(!frame(complete).noSpaces.contains("hidden synthetic reasoning"))
            assert(!frame(complete).noSpaces.contains("follow-up reasoning"))
          }
          firstRequests <- llm.requests.get
          _ <- IO(assert(firstRequests(1).noSpaces.contains("hidden synthetic reasoning")))
          second <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,second,"synthetic prompt two")
          _ <- settled(runner,identity,catalog.instanceId,second)
          requests <- llm.requests.get
          _ <- IO {
            assertEquals(requests.size,6)
            val fresh=requests(3).hcursor.get[Vector[Json]]("messages").toOption.get
            assertEquals(fresh.size,2)
            assert(!requests(3).noSpaces.contains("prompt one"))
            assert(!requests(3).noSpaces.contains("call-search"))
          }
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG regression: caller cancellation cannot split state erasure from local fiber cancellation handoff") {
    (for {
      stopped <- Deferred[IO,Unit]
      worker <- IO.never[Unit].onCancel(stopped.complete(()).void).start
      handle <- Ref.of[IO,List[cats.effect.FiberIO[Unit]]](List(worker))
      committed <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]
      transition=handle.getAndSet(Nil).flatTap(_ => committed.complete(()).void *> release.get)
      caller <- McpRunCancellation.handoff(transition,_.cancel).start
      _ <- committed.get
      cancellation <- caller.cancel.start
      _ <- IO.sleep(10.millis)
      _ <- release.complete(())
      _ <- cancellation.joinWithNever
      erased <- handle.get
      didStop <- stopped.tryGet
      _ <- worker.cancel
      _ <- IO { assertEquals(erased,Nil); assertEquals(didStop,Some(())) }
    } yield ()).unsafeRunSync()
  }

  test("BG regression: race winner consumption adopts loser ownership before caller cancellation") {
    (for {
      stopped <- Deferred[IO,Unit]
      workerStarted <- Deferred[IO,Unit]; deadline <- Deferred[IO,Unit]
      adopted <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]
      cleanup <- Ref.of[IO,Option[cats.effect.FiberIO[Unit]]](None)
      caller <- McpRunCancellation.race(workerStarted.complete(()).void *> IO.never[Unit].onCancel(stopped.complete(()).void),deadline.get) { (_,_,loser) =>
        cleanup.set(Some(loser)) *> adopted.complete(()).void *> release.get *> loser.cancel
      }.start
      _ <- workerStarted.get; _ <- deadline.complete(()); _ <- adopted.get
      cancellation <- caller.cancel.start
      _ <- IO.sleep(10.millis); _ <- release.complete(())
      _ <- cancellation.joinWithNever
      didStop <- stopped.tryGet
      _ <- cleanup.get.flatMap(_.traverse_(_.cancel))
      _ <- IO(assertEquals(didStop,Some(())))
    } yield ()).unsafeRunSync()
  }

  test("BG regression: a self-cancelled provider cannot leave a permanently Running record") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      timerOnly=new McpRunClock {
        def now: IO[java.time.Instant] = time.now
        def monotonic: IO[FiniteDuration] = time.monotonic
        def sleep(duration: FiniteDuration): IO[Unit] = IO.never
      }
      llm <- model(_ => IO.canceled *> IO.never)
      _ <- runtime(tools,llm,auth,timerOnly).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"self-cancel")
          cancelled <- settled(runner,identity,catalog.instanceId,id)
          _ <- IO { assertEquals(cancelled.state,McpRunState.Cancelled); assertEquals(cancelled.events,Nil) }
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BA: source admission is shared, checked before materialization, and thread safe") {
    (for {
      admission <- ReadAdmission.limited(64L)
      _ <- IO(admission.consume(32L))
      _ <- IO(admission.consume(32L))
      tooMuch <- IO(admission.consume(1L)).attempt
      negative <- IO(admission.consume(-1L)).attempt
      huge <- IO(admission.consume(Long.MaxValue)).attempt
      _ <- IO { assertEquals(code(tooMuch),"read-budget"); assertEquals(code(negative),"read-budget"); assertEquals(code(huge),"read-budget") }
      concurrent <- ReadAdmission.limited(100L)
      results <- List.fill(200)(IO(concurrent.consume(1L)).attempt).parSequence
      _ <- IO(assertEquals(results.count(_.isRight),100))
      _ <- IO(ReadAdmission.unlimited.consume(Long.MaxValue))
    } yield ()).unsafeRunSync()
  }

  test("BG: detached start, duplicate observation, changed prompt conflict, owner-wide concurrent admission") {
    (for {
      auth <- authorization
      time <- clock
      tools <- ordinaryTools
      entered <- Deferred[IO,Unit]
      release <- Deferred[IO,Unit]
      llm <- model(_ => entered.complete(()).void *> release.get.as(finalReply("done")))
      _ <- runtime(tools,llm,auth,time).use { runner => (runner.connection(UUID.randomUUID()),runner.connection(UUID.randomUUID())).tupled.use { case (one,two) =>
        for {
          catalog <- runner.catalog(identity)
          id <- IO(UUID.randomUUID())
          start <- runner.start(identity,one,catalog.instanceId,id,"same prompt").timeout(1.second)
          _ <- entered.get
          duplicate <- runner.start(identity,two,catalog.instanceId,id,"same prompt")
          conflict <- runner.start(identity,two,catalog.instanceId,id,"changed prompt").attempt
          concurrent <- runner.start(otherCookie,two,catalog.instanceId,UUID.randomUUID(),"other cookie").attempt
          unknown <- runner.read(identity,catalog.instanceId,UUID.randomUUID(),0L,1).attempt
          oldInstance <- runner.start(identity,two,UUID.randomUUID(),UUID.randomUUID(),"uncertain old start").attempt
          requests <- llm.requests.get
          _ <- IO {
            assertEquals(start.runId,duplicate.runId)
            assertEquals(requests.size,1)
            assertEquals(code(conflict),"conflict")
            assertEquals(code(concurrent),"mcp-active-run")
            assertEquals(code(unknown),"mcp-run-uncertain")
            assertEquals(code(oldInstance),"mcp-run-uncertain")
          }
          _ <- release.complete(())
          _ <- settled(runner,identity,catalog.instanceId,id)
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: simultaneous starts admit exactly one active run per owner, including separate cookies") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      llm <- model(_ => IO.never)
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity)
          results <- List(identity,otherCookie).parTraverse(i => runner.start(i,connection,catalog.instanceId,UUID.randomUUID(),"parallel").attempt)
          _ <- IO {
            assertEquals(results.count(_.isRight),1)
            assertEquals(results.filter(_.isLeft).map(code),List("mcp-active-run"))
          }
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: cancel during provider call erases, forbids late completion, and does not claim zero provider cost") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      entered <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]
      llm <- model(_ => entered.complete(()).void *> IO.uncancelable(_ => release.get).as(finalReply("late private completion")))
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"private prompt")
          _ <- entered.get
          cancelled <- runner.cancel(identity,catalog.instanceId,id).timeout(1.second)
          _ <- release.complete(())
          _ <- IO.sleep(10.millis)
          after <- runner.read(identity,catalog.instanceId,id,0L,256)
          _ <- IO {
            assertEquals(cancelled.state,McpRunState.Cancelled)
            assertEquals(after.state,McpRunState.Cancelled)
            assertEquals(after.events,Nil)
          }
          requests <- llm.requests.get
          _ <- IO(assertEquals(requests.size,1))
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: disconnect cancels only originating socket; same-cookie other tab can inspect erased metadata") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      entered <- Deferred[IO,Unit]
      llm <- model(_ => entered.complete(()).void *> IO.never)
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { otherTab =>
        for {
          allocated <- runner.connection(UUID.randomUUID()).allocated
          (origin,closeOrigin)=allocated
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,origin,catalog.instanceId,id,"socket-bound")
          _ <- entered.get
          _ <- otherTab.connectionId.pure[IO]
          before <- runner.read(identity,catalog.instanceId,id,0L,1)
          _ <- IO(assert(before.state.active))
          _ <- closeOrigin
          after <- runner.read(identity,catalog.instanceId,id,0L,1)
          _ <- IO { assertEquals(after.state,McpRunState.Cancelled); assertEquals(after.events,Nil) }
          restart <- runner.start(identity,origin,catalog.instanceId,UUID.randomUUID(),"closed socket").attempt
          _ <- IO(assertEquals(code(restart),"mcp-disconnected"))
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: closing an unrelated tab does not cancel active run; start waiting on authorization cannot resurrect closed socket") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      llm <- model(_ => IO.never)
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { origin =>
        for {
          other <- runner.connection(UUID.randomUUID()).allocated
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,origin,catalog.instanceId,id,"origin")
          _ <- other._2
          current <- runner.read(identity,catalog.instanceId,id,0L,1)
          _ <- IO(assert(current.state.active))
          _ <- runner.cancel(identity,catalog.instanceId,id)
          allocated <- runner.connection(UUID.randomUUID()).allocated
          entered <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]
          _ <- auth.captureWait(entered.complete(()).void *> release.get)
          starting <- runner.start(identity,allocated._1,catalog.instanceId,UUID.randomUUID(),"starting").attempt.start
          _ <- entered.get; _ <- allocated._2; _ <- release.complete(())
          result <- starting.joinWithNever
          _ <- auth.captureWait(IO.unit)
          _ <- IO(assertEquals(code(result),"mcp-disconnected"))
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: whole deadline and retention use local monotonic time; terminal expiry never authorizes replay") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      llm <- model(_ => IO.never)
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"deadline")
          _ <- time.advance(900.seconds); _ <- runner.maintain
          expired <- runner.read(identity,catalog.instanceId,id,0L,1)
          duplicate <- runner.start(identity,connection,catalog.instanceId,id,"deadline").attempt
          _ <- IO {
            assertEquals(expired.state,McpRunState.Expired)
            assertEquals(expired.events,Nil)
            assertEquals(expired.failure.map(_.code),Some("mcp-deadline"))
            assertEquals(code(duplicate),"mcp-run-uncertain")
          }
        } yield ()
      }}
      done <- model(_ => IO.pure(finalReply("retained")))
      _ <- runtime(tools,done,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"retention")
          _ <- settled(runner,identity,catalog.instanceId,id)
          _ <- time.advance(599.seconds); _ <- runner.maintain
          retained <- runner.read(identity,catalog.instanceId,id,0L,256)
          _ <- IO(assertEquals(retained.state,McpRunState.Complete))
          _ <- time.advance(1.second); _ <- runner.maintain
          expired <- runner.read(identity,catalog.instanceId,id,0L,256)
          _ <- IO { assertEquals(expired.state,McpRunState.Expired); assertEquals(expired.events,Nil) }
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG regression: whole-run timer publishes Expired without awaiting a cancellation-resistant provider") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      entered <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]
      timerOnly=new McpRunClock {
        def now: IO[java.time.Instant] = time.now
        def monotonic: IO[FiniteDuration] = time.monotonic
        def sleep(duration: FiniteDuration): IO[Unit] = if(duration==1.second) IO.never else time.sleep(duration)
      }
      llm <- model(_ => entered.complete(()).void *> IO.uncancelable(_ => release.get).as(finalReply("late")))
      _ <- runtime(tools,llm,auth,timerOnly).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        (for {
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"timer")
          _ <- entered.get
          _ <- time.advance(900.seconds)
          expired <- settled(runner,identity,catalog.instanceId,id)
          _ <- IO { assertEquals(expired.state,McpRunState.Expired); assertEquals(expired.events,Nil) }
        } yield ()).guarantee(release.complete(()).void)
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG regression: disconnect cannot relabel Expired into a replay-observable Cancelled run") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      llm <- model(_ => IO.pure(finalReply("done")))
      _ <- runtime(tools,llm,auth,time).use { runner =>
        for {
          socket <- runner.connection(UUID.randomUUID()).allocated
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,socket._1,catalog.instanceId,id,"expire then disconnect")
          _ <- settled(runner,identity,catalog.instanceId,id)
          _ <- time.advance(600.seconds); _ <- runner.maintain
          cancelledExpired <- runner.cancel(identity,catalog.instanceId,id)
          _ <- IO(assertEquals(cancelledExpired.state,McpRunState.Expired))
          _ <- socket._2
          _ <- runner.connection(UUID.randomUUID()).use { connection => runner.start(identity,connection,catalog.instanceId,id,"expire then disconnect").attempt.map { result => assertEquals(code(result),"mcp-run-uncertain") } }
        } yield ()
      }
    } yield ()).unsafeRunSync()
  }

  test("BG regression: repeated authorization loss does not restart terminal retention") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      llm <- model(_ => IO.pure(finalReply("done")))
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"retention under revocation")
          _ <- settled(runner,identity,catalog.instanceId,id)
          _ <- auth.revision(2L); _ <- runner.maintain
          _ <- time.advance(599.seconds); _ <- runner.maintain
          _ <- time.advance(1.second); _ <- runner.maintain
          _ <- auth.revision(1L)
          expired <- runner.read(identity,catalog.instanceId,id,0L,1)
          _ <- IO { assertEquals(expired.state,McpRunState.Expired); assertEquals(expired.events,Nil) }
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: complete and failed traces are reauthorized; ACL ABA and cookie expiry erase permanently") {
    List(false,true).foreach { failed =>
      (for {
        auth <- authorization; time <- clock; tools <- ordinaryTools
        llm <- model { request =>
          if(!failed) IO.pure(finalReply("private terminal response"))
          else if(request.hcursor.get[Vector[Json]]("messages").toOption.get.size==2) IO.pure(toolReply(List(("failed-trace","search",Json.obj())),None))
          else IO.raiseError(new RuntimeException("private exception / credential / prompt"))
        }
        _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
          for {
            catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
            _ <- runner.start(identity,connection,catalog.instanceId,id,"private")
            before <- settled(runner,identity,catalog.instanceId,id)
            _ <- IO {
              assertEquals(before.state,if(failed) McpRunState.Failed else McpRunState.Complete)
              assert(before.events.nonEmpty)
              assert(!frame(before).noSpaces.contains("private exception"))
            }
            _ <- auth.revision(3L)
            denied <- runner.read(identity,catalog.instanceId,id,0L,256).attempt
            _ <- IO(assertEquals(code(denied),"authorization-changed"))
            _ <- auth.revision(1L)
            after <- runner.read(identity,catalog.instanceId,id,0L,256)
            _ <- IO { assertEquals(after.state,McpRunState.AuthorizationLost); assertEquals(after.events,Nil) }
            _ <- auth.expired
            cookie <- runner.read(identity,catalog.instanceId,id,0L,1).attempt
            _ <- IO(assertEquals(code(cookie),"unauthorized"))
          } yield ()
        }}
      } yield ()).unsafeRunSync()
    }
  }

  test("BG: stale authorization verification cannot return private trace after cancellation") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      llm <- model(_ => IO.pure(finalReply("must not escape")))
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"fenced")
          _ <- settled(runner,identity,catalog.instanceId,id)
          entered <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]
          _ <- auth.nextVerifyWait(entered,release)
          reading <- runner.read(identity,catalog.instanceId,id,0L,256).attempt.start
          _ <- entered.get
          _ <- runner.cancel(identity,catalog.instanceId,id)
          _ <- release.complete(())
          result <- reading.joinWithNever
          _ <- IO(assertEquals(code(result),"mcp-run-changed"))
          empty <- runner.read(identity,catalog.instanceId,id,0L,1)
          _ <- IO(assertEquals(empty.events,Nil))
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG regression: cancel verification racing normal completion still erases the newly terminal trace") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      providerEntered <- Deferred[IO,Unit]; providerRelease <- Deferred[IO,Unit]
      llm <- model(_ => providerEntered.complete(()).void *> providerRelease.get.as(finalReply("must be erased")))
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"cancel race")
          _ <- providerEntered.get
          entered <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]
          _ <- auth.nextVerifyWait(entered,release)
          cancelling <- runner.cancel(identity,catalog.instanceId,id).start
          _ <- entered.get; _ <- providerRelease.complete(())
          completed <- settled(runner,identity,catalog.instanceId,id)
          _ <- IO(assertEquals(completed.state,McpRunState.Complete))
          _ <- release.complete(())
          cancelled <- cancelling.joinWithNever
          _ <- IO { assertEquals(cancelled.state,McpRunState.Cancelled); assertEquals(cancelled.events,Nil) }
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: nested tool await rechecks authority; security failures abort instead of entering model context") {
    (for {
      auth <- authorization; time <- clock
      entered <- Deferred[IO,Unit]; release <- Deferred[IO,Unit]
      tools <- McpTestFixtures.tools { (access,_,_,admission) =>
        access.fresh *> entered.complete(()).void *> release.get *> access.fresh *> IO { admission.consume(8L); Json.obj("secret"->Json.True) }
      }
      llm <- model(_ => IO.pure(toolReply(List(("call","search",Json.obj())),None)))
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"fresh nested")
          _ <- entered.get; _ <- auth.revision(2L); _ <- release.complete(())
          _ <- IO.sleep(20.millis)
          _ <- auth.revision(1L)
          after <- runner.read(identity,catalog.instanceId,id,0L,256)
          requests <- llm.requests.get
          _ <- IO {
            assertEquals(after.state,McpRunState.AuthorizationLost)
            assertEquals(after.events,Nil)
            assertEquals(requests.size,1)
          }
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: complete logical tool arguments/results/final text reconstruct exactly from escaped scalar-safe bounded pages") {
    val payload="\"\\\n🙂"*7000
    val result=Json.obj("text"->Json.fromString(payload))
    val args=Json.obj("q"->Json.fromString("\"\\🙂"*1000))
    (for {
      auth <- authorization; time <- clock
      tools <- McpTestFixtures.tools((access,_,_,admission) => access.fresh *> IO { admission.consume(64L); result })
      llm <- model { request => IO.pure {
        val messages=request.hcursor.get[Vector[Json]]("messages").toOption.get
        if(messages.size==2) toolReply(List(("parts","search",args)),None) else finalReply(payload)
      }}
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity); id <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,catalog.instanceId,id,"parts")
          _ <- settled(runner,identity,catalog.instanceId,id)
          all <- {
            def page(after: Long,acc: List[McpRunEvent]): IO[List[McpRunEvent]] = runner.read(identity,catalog.instanceId,id,after,2).flatMap { snapshot =>
              IO(assert(encoding.bytes(snapshot)<=McpRunLimits.pageBytes)) *>
                (if(snapshot.hasMore) { assert(snapshot.events.nonEmpty); page(snapshot.events.last.sequence,acc++snapshot.events) }
                 else IO.pure(acc++snapshot.events))
            }
            page(0L,Nil)
          }
          _ <- IO {
            val argumentParts=all.collect { case McpRunEvent(_,_,McpRunItem.ToolCall(_,_,i,n,part)) => (i,n,part) }
            val resultParts=all.collect { case McpRunEvent(_,_,McpRunItem.ToolResult(_,i,n,part)) => (i,n,part) }
            val responseParts=all.collect { case McpRunEvent(_,_,McpRunItem.Response(i,n,part)) => (i,n,part) }
            List(argumentParts,resultParts,responseParts).foreach { parts =>
              assertEquals(parts.map(_._1),parts.indices.toList)
              assert(parts.forall(_._2==parts.size))
              assert(parts.forall(p => java.nio.charset.StandardCharsets.UTF_8.newEncoder().canEncode(p._3)))
            }
            assertEquals(Wire.parse(argumentParts.map(_._3).mkString),args)
            assertEquals(Wire.parse(resultParts.map(_._3).mkString),result)
            assertEquals(responseParts.map(_._3).mkString,payload)
            assertEquals(all.map(_.sequence),all.indices.map(_.toLong+1).toList)
          }
          invalid <- List((-1L,1),(0L,0),(0L,257),(Long.MaxValue,1)).traverse { case (after,limit) => runner.read(identity,catalog.instanceId,id,after,limit).attempt }
          _ <- IO(assert(invalid.forall(result => code(result)=="invalid")))
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: current-incarnation eviction remains uncertain; owner and credential bindings cannot be substituted") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      llm <- model(_ => IO.pure(finalReply("done")))
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity)
          ids <- IO(List.fill(McpRunLimits.terminalRecordsPerOwner+1)(UUID.randomUUID()))
          _ <- ids.traverse_(id => runner.start(identity,connection,catalog.instanceId,id,"bound").void *> settled(runner,identity,catalog.instanceId,id).void)
          evicted <- runner.start(identity,connection,catalog.instanceId,ids.head,"bound").attempt
          substituted <- List(otherCookie,otherOwner).traverse { caller =>
            (runner.read(caller,catalog.instanceId,ids.last,0L,1).attempt,runner.cancel(caller,catalog.instanceId,ids.last).attempt,runner.start(caller,connection,catalog.instanceId,ids.last,"bound").attempt).tupled
          }
          _ <- IO {
            assertEquals(code(evicted),"mcp-run-uncertain")
            assert(substituted.forall { case (read,cancel,start) => List(read,cancel,start).forall(result => code(result)=="mcp-run-uncertain") })
          }
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: admission-incarnation rotation preserves older active runs and their cancellation authority") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      entered <- Deferred[IO,Unit]
      llm <- model { request =>
        val prompt=request.hcursor.get[Vector[Json]]("messages").toOption.get(1).hcursor.get[String]("content").toOption.get
        if(prompt=="hold older incarnation") entered.complete(()).void *> IO.never else IO.pure(finalReply("done"))
      }
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          initial <- runner.catalog(identity); held <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,initial.instanceId,held,"hold older incarnation")
          _ <- entered.get
          _ <- (1 until McpRunLimits.maximumSeenRuns).toList.traverse_ { _ =>
            val id=UUID.randomUUID()
            runner.start(otherOwner,connection,initial.instanceId,id,"completed by b").void *> settled(runner,otherOwner,initial.instanceId,id).void
          }
          next <- runner.catalog(identity)
          old <- runner.start(identity,connection,initial.instanceId,held,"hold older incarnation")
          _ <- IO { assertNotEquals(next.instanceId,initial.instanceId); assert(old.state.active) }
          cancelled <- runner.cancel(identity,initial.instanceId,held)
          _ <- IO { assertEquals(cancelled.instanceId,initial.instanceId); assertEquals(cancelled.state,McpRunState.Cancelled); assertEquals(cancelled.events,Nil) }
          fresh <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,next.instanceId,fresh,"fresh by a")
          done <- settled(runner,identity,next.instanceId,fresh)
          _ <- IO(assertEquals(done.state,McpRunState.Complete))
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }

  test("BG: current-incarnation tombstones and rollover preserve uncertainty without permanent saturation") {
    (for {
      auth <- authorization; time <- clock; tools <- ordinaryTools
      llm <- model(_ => IO.pure(finalReply("done")))
      _ <- runtime(tools,llm,auth,time).use { runner => runner.connection(UUID.randomUUID()).use { connection =>
        for {
          catalog <- runner.catalog(identity)
          ids <- IO(List.fill(McpRunLimits.maximumSeenRuns)(UUID.randomUUID()))
          _ <- ids.traverse_ { id => runner.start(identity,connection,catalog.instanceId,id,"same").void *> settled(runner,identity,catalog.instanceId,id).void }
          next <- runner.catalog(identity)
          _ <- IO(assertNotEquals(next.instanceId,catalog.instanceId))
          known <- runner.start(identity,connection,catalog.instanceId,ids.last,"same")
          old <- runner.start(identity,connection,catalog.instanceId,ids.head,"same").attempt
          unknown <- runner.start(identity,connection,catalog.instanceId,UUID.randomUUID(),"same").attempt
          fresh <- IO(UUID.randomUUID())
          _ <- runner.start(identity,connection,next.instanceId,fresh,"new incarnation")
          complete <- settled(runner,identity,next.instanceId,fresh)
          _ <- IO {
            assertEquals(known.state,McpRunState.Complete)
            assertEquals(code(old),"mcp-run-uncertain")
            assertEquals(code(unknown),"mcp-run-uncertain")
            assertEquals(complete.state,McpRunState.Complete)
          }
        } yield ()
      }}
    } yield ()).unsafeRunSync()
  }
}
