package chronicle

import chronicle.api.*
import cats.effect.IO
import cats.effect.std.Semaphore
import cats.effect.unsafe.implicits.global
import com.comcast.ip4s.*
import distage.*
import org.http4s.ember.client.EmberClientBuilder
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.implicits.*
import java.net.URI
import java.net.http.{HttpClient,WebSocket}
import java.nio.charset.StandardCharsets.UTF_8
import java.time.Clock
import java.util.UUID
import java.util.concurrent.{CompletableFuture,CompletionStage,LinkedBlockingQueue,TimeUnit}
import scala.concurrent.duration.*

final class CursorWebSocketTest extends munit.FunSuite {
  import ApplicationFixture.{call,database,ingest}
  override val munitTimeout=45.seconds
  test("BG GoodCommunication regression: long-title Archive and Activity continuations pass the unchanged real WebSocket frame guard") {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) {
      Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required")
      assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh")
    }
    val config=Fixtures.config()
    EmberClientBuilder.default[IO].build.use { client =>
      val module=new ModuleDef {
        include(_root_.chronicle.plugins.ChroniclePlugin)
        make[Config].fromValue(config)
        make[org.http4s.client.Client[IO]].fromValue(client)
      }
      ChronicleInjector().produceGet[RuntimeServices](module).use { services =>
        IO.blocking {
          services.database.initialize()
          services.database.transaction { c =>
            Sql.exec(c,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks,ch_groups,ch_invites,ch_members,ch_tokens,ch_sessions,ch_mutations,ch_collector_progress CASCADE")
            Sql.exec(c,"UPDATE ch_profile SET active=?,target=?,maintenance=false",config.profile,config.profile); Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
          }
          (1 to 2).foreach { n =>
            val request=Fixtures.snapshot()
            services.archive.ingest("a",request.copy(metadata=request.metadata.copy(title="x"*50000+n)))
          }
        } *> Semaphore[IO](2).flatMap { gate =>
          EmberServerBuilder.default[IO].withHost(Host.fromString("127.0.0.1").get).withPort(Port.fromInt(0).get)
            .withHttpWebSocketApp(ws => services.http.routes(ws,gate).orNotFound).build.use { server => IO.blocking {
              val (_,secret)=new Auth(services.database,config).login(LoginRequest("a","synthetic"))
              val client=HttpClient.newHttpClient()
              val inbox=new LinkedBlockingQueue[ServerEnvelope]()
              val listener=new WebSocket.Listener {
                private val text=new java.lang.StringBuilder()
                override def onOpen(socket: WebSocket): Unit=socket.request(1)
                override def onText(socket: WebSocket,part: CharSequence,last: Boolean): CompletionStage[?] = {
                  text.append(part)
                  if(last) {
                    val message=Wire.decode(ServerEnvelope.codecJson,Wire.parse(text.toString))
                    text.setLength(0)
                    message.result match {
                      case Result.Ping(nonce) => socket.sendText(Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(message.requestId,Operation.Pong(nonce))).noSpaces,true)
                      case _ => inbox.offer(message)
                    }
                  }
                  socket.request(1)
                  CompletableFuture.completedFuture(null)
                }
                override def onClose(socket: WebSocket,code: Int,reason: String): CompletionStage[?] = {
                  inbox.offer(ServerEnvelope(new UUID(0,0),Result.Error(Failure("transport-closed",code.toString))))
                  CompletableFuture.completedFuture(null)
                }
              }
              val socket=client.newWebSocketBuilder().header("Origin",config.allowedOrigin).header("Cookie",s"chronicle_session=$secret")
                .buildAsync(URI.create(s"ws://127.0.0.1:${server.address.getPort}/api/ws"),listener).get(10,TimeUnit.SECONDS)
              def request(operation: Operation): Result = {
                val id=UUID.randomUUID()
                val payload=Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(id,operation)).noSpaces
                assert(payload.getBytes(UTF_8).length<=Http.socketFrameBytes)
                socket.sendText(payload,true).get(10,TimeUnit.SECONDS)
                val reply=inbox.poll(10,TimeUnit.SECONDS)
                assert(reply!=null,"correlated WebSocket response required")
                assertEquals(reply.requestId,id)
                reply.result
              }
              try {
                assert(request(Operation.Hello(List(Wire.versions.current))).isInstanceOf[Result.Hello])
                List(SortDirection.Asc,SortDirection.Desc).foreach { direction =>
                  val archive=ArchiveQuery("mode:lexical",ArchiveSort.Title,direction,None,1,false)
                  val first=request(Operation.Archive(archive)).asInstanceOf[Result.Archive].result
                  assertEquals(first.rows.head.head.metadata.title.length,50001)
                  assert(first.nextCursor.nonEmpty)
                  val second=request(Operation.Archive(archive.copy(cursor=first.nextCursor))).asInstanceOf[Result.Archive].result
                  assertEquals(second.rows.size,1)
                  assert(first.rows.head.head.id!=second.rows.head.head.id)
                  val jobs=ActivityJobsQuery(None,ActivityJobScope.All,"",ActivityJobSort.Title,direction,None,1)
                  val firstJobs=request(Operation.ActivityJobs(jobs)).asInstanceOf[Result.ActivityJobs].result
                  assert(firstJobs.nextCursor.nonEmpty)
                  val secondJobs=request(Operation.ActivityJobs(jobs.copy(cursor=firstJobs.nextCursor))).asInstanceOf[Result.ActivityJobs].result
                  assertEquals(secondJobs.jobs.size,1)
                  assert(firstJobs.jobs.head.job.id!=secondJobs.jobs.head.job.id)
                }
              } finally { socket.abort(); client.close() }
            }}
        }
      }
    }.unsafeRunSync()
  }
  private final case class UnboundedArchiveField(sort: ArchiveSort,update: (Metadata,String) => Metadata)
  private val unboundedArchiveFields=List(
    UnboundedArchiveField(ArchiveSort.Title,(metadata,value) => metadata.copy(title=value)),
    UnboundedArchiveField(ArchiveSort.Project,(metadata,value) => metadata.copy(project=Some(value))),
    UnboundedArchiveField(ArchiveSort.Branch,(metadata,value) => metadata.copy(gitBranch=Some(value))),
    UnboundedArchiveField(ArchiveSort.Producer,(metadata,value) => metadata.copy(producer=value)),
    UnboundedArchiveField(ArchiveSort.Model,(metadata,value) => metadata.copy(model=Some(value))))
  private def continuationBytes(operation: Operation): Int = Wire.encode(ClientEnvelope.codecJson,ClientEnvelope(UUID.randomUUID(),operation)).noSpaces.getBytes(java.nio.charset.StandardCharsets.UTF_8).length
  unboundedArchiveFields.foreach { field =>
    test(s"Behavioral-Blackbox GoodCommunication regression: actual valid ${field.sort} ingestion yields an Archive continuation within the WebSocket frame bound") { database { c =>
      (1 to 2).foreach { n =>
        val source=Fixtures.snapshot(); val metadata=field.update(source.metadata,"x"*50000+n)
        c.archive.ingest("a",source.copy(metadata=metadata))
      }
      val query=ArchiveQuery("mode:lexical",field.sort,SortDirection.Asc,None,1,false)
      val first=call(c,c.owner,Operation.Archive(query)).asInstanceOf[Result.Archive].result
      val next=query.copy(cursor=first.nextCursor)
      assert(next.cursor.nonEmpty)
      val bytes=continuationBytes(Operation.Archive(next))
      println(s"ARCHIVE ${field.sort} actual-ingestion cursor bytes=$bytes existingFrameLimit=${Http.socketFrameBytes}")
      assert(bytes<=Http.socketFrameBytes,s"server-produced ${field.sort} continuation $bytes exceeds ${Http.socketFrameBytes}")
      val second=call(c,c.owner,Operation.Archive(next)).asInstanceOf[Result.Archive].result
      assertEquals(second.rows.size,1); assert(first.rows.head.head.id!=second.rows.head.head.id)
    }}
  }
  test("Behavioral-Blackbox GoodCommunication regression: admitted long owner identities do not expand cursor context beyond the WebSocket frame bound") { database { c =>
    val owner="x"*50000
    val configured=c.config.copy(users=c.config.users:+UserConfig(owner,"long-owner",c.config.users.head.passwordHashFile,true,false))
    configured.validate()
    val db=Fixtures.database(configured,IndexProfileCatalog.legacyOnly(configured)); db.initialize()
    val auth=new Auth(db,configured)
    val (_,cookie)=auth.login(LoginRequest("long-owner","synthetic")); val identity=auth.browser(cookie)
    assertEquals(identity.user.id.length,owner.length)
    val archive=new PostgresArchive(db,configured)
    (1 to 2).foreach { n => val source=Fixtures.snapshot(); archive.ingest(owner,source.copy(metadata=source.metadata.copy(title=s"bounded-$n"))) }
    val activity=new PostgresActivity(db,Clock.systemUTC())
    val jobQuery=ActivityJobsQuery(None,ActivityJobScope.All,"",ActivityJobSort.JobId,SortDirection.Asc,None,1)
    val jobs=activity.jobs(owner,jobQuery)
    val collectorQuery=ActivityQuery("",ActivityCollectorSort.CollectorId,SortDirection.Asc,None,1)
    val collectors=activity.summary(identity.user,collectorQuery)
    val archiveQuery=ArchiveQuery("mode:lexical",ArchiveSort.Owner,SortDirection.Asc,None,1,false)
    val index=new PostgresArchiveIndex(db,archive,configured)
    val result=index.browse(owner,archiveQuery,ArchiveExpression.parse(archiveQuery.expression),Nil)
    val frames=List(
      "ActivityJobs"->continuationBytes(Operation.ActivityJobs(jobQuery.copy(cursor=jobs.nextCursor))),
      "ActivityCollectors"->continuationBytes(Operation.Activity(collectorQuery.copy(cursor=collectors.nextCursor))),
      "ArchiveOwner"->continuationBytes(Operation.Archive(archiveQuery.copy(cursor=result.nextCursor))))
    frames.foreach { case (family,bytes) => println(s"$family actual-admitted-owner cursor bytes=$bytes existingFrameLimit=${Http.socketFrameBytes}") }
    assert(frames.forall(_._2<=Http.socketFrameBytes),s"admitted owner continuation sizes ${frames.map { case (family,bytes) => s"$family=$bytes" }.mkString(",")} exceed ${Http.socketFrameBytes}")
  }}
  test("Behavioral-Blackbox GoodCommunication regression: admitted mutable failure reasons use bounded guarded cursor positions") { database { c =>
    (1 to 2).foreach { n =>
      ingest(c,"a",s"reason-$n")
      (1 to 5).foreach { _ => val claim=c.archive.claim(Set(c.config.profile),ClaimScope.AllOwners,300).get; c.archive.fail(claim,"x"*50000+n) }
    }
    val query=ActivityJobsQuery(None,ActivityJobScope.All,"",ActivityJobSort.Reason,SortDirection.Asc,None,1)
    val first=call(c,c.owner,Operation.ActivityJobs(query)).asInstanceOf[Result.ActivityJobs].result
    val next=query.copy(cursor=first.nextCursor)
    val bytes=continuationBytes(Operation.ActivityJobs(next))
    println(s"ACTIVITY Reason actual-admitted-code cursor bytes=$bytes existingFrameLimit=${Http.socketFrameBytes}")
    assert(bytes<=Http.socketFrameBytes,s"admitted Reason continuation $bytes exceeds ${Http.socketFrameBytes}")
    val second=call(c,c.owner,Operation.ActivityJobs(next)).asInstanceOf[Result.ActivityJobs].result
    assertEquals(second.jobs.size,1); assert(first.jobs.head.job.id!=second.jobs.head.job.id)
  }}
}
