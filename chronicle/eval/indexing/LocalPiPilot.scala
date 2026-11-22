package chronicle

import cats.effect.{ExitCode,IO,IOApp,Ref,Resource}
import cats.syntax.all.*
import chronicle.api.Message
import io.circe.Json
import org.http4s.{HttpApp,Response}
import org.http4s.client.Client
import ponygirls.retrieval.JsonHttp
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files,LinkOption,Path}
import java.nio.file.attribute.{BasicFileAttributes,PosixFilePermissions}
import java.time.Clock
import java.util.{Locale,UUID}
import scala.concurrent.duration.*
import ProblemPassages.*

/** Opt-in Test/runMain. No service config, database, archive, uploader or external adapter. */
object LocalPiPilot extends IOApp {
  private val schema = "local-pi-pilot-v1"
  private val endpoint = "http://127.0.0.1:11435/v1/chat/completions"
  private val timeoutSeconds = 600
  private val wholeLeg = 30.minutes
  private val maxResponseBytes = 1024*1024
  private val responseTokens = 8192
  private val sessionCount = 5
  private val maximumWindowsPerSession = 10
  private val maximumWindows = 40
  private val maximumInputBytes = 4*1024*1024
  private val privateFile = PosixFilePermissions.fromString("rw-------")
  private val privateDirectory = PosixFilePermissions.fromString("rwx------")
  private val noFollow = LinkOption.NOFOLLOW_LINKS
  private val callContext = ModelCallContext("local-pi-pilot",ModelWorkload.IndexAnnotation)
  private def config(auth: Path): ModelConfig = ModelConfig(endpoint,"qwen3.8-27b-q4","local-pilot",auth.toString,
    timeoutSeconds,maxResponseBytes,AnnotationRequestPolicy.StrictJsonSchema)

  private def requirePilot(test: Boolean): Unit = Check(test,"pilot-invariant","local pilot precondition failed")
  private case class Query(messagePosition: Int,terms: Set[String])
  private case class Ranked(score: Int,piece: Long,messagePosition: Int)
  private case class Sample(source: Source, input: Vector[Array[Byte]], windows: Vector[Window], user: Set[Int],
    substantive: Set[Int], queries: Vector[Query])
  private val words = "[\\p{L}\\p{N}]{4,}".r
  private def tokens(text: String): Iterator[String] = words.findAllIn(text.toLowerCase(Locale.ROOT))
  private def looksSubstantive(text: String): Boolean = {
    val trimmed = text.strip()
    !trimmed.startsWith("/") && trimmed.codePoints().filter(cp => !Character.isWhitespace(cp)).limit(24).count()==24
  }
  private def sample(rows: Vector[(String,String)]): Sample = {
    requirePilot(rows.nonEmpty && rows.size<=256)
    val messages=rows.zipWithIndex.map { case ((role,text),i) => Message(s"m$i",None,role,text,None,i) }
    val source=Source(messages.toList)
    val input=messages.map(_.text.getBytes(UTF_8))
    requirePilot(input.map(_.length).sum>=256 && input.map(_.length).sum<=96*1024)
    val windows=Iterator.unfold(SourceCursor.start)(cursor => source.next(cursor).map(w => (w,w.next))).take(maximumWindowsPerSession+1).toVector
    val user=messages.indices.filter(i => messages(i).role=="user").toSet
    requirePilot(windows.nonEmpty && windows.size<=maximumWindowsPerSession && user.nonEmpty)
    val substantive=user.filter(i => looksSubstantive(messages(i).text))
    val queries=substantive.toVector.sorted.iterator.map { i => Query(i,tokens(messages(i).text).take(32).toVector.distinct.take(8).toSet) }
      .filter(_.terms.size>=3).take(3).toVector
    Sample(source,input,windows,user,substantive,queries)
  }
  private def load(path: Path): Vector[Sample] = {
    requirePilot(path.isAbsolute && path.normalize()==path && path.toRealPath()==path)
    val parent=path.getParent
    val owner=Files.getOwner(path,noFollow)
    requirePilot(Files.isDirectory(parent,noFollow) && Files.getOwner(parent,noFollow)==owner &&
      owner.getName==System.getProperty("user.name") && Files.getPosixFilePermissions(parent,noFollow)==privateDirectory &&
      Files.getPosixFilePermissions(path,noFollow)==privateFile)
    def attributes = Files.readAttributes(path,classOf[BasicFileAttributes],noFollow)
    val before=attributes
    requirePilot(before.isRegularFile && before.size()>0 && before.size()<=maximumInputBytes)
    val stream=Files.newInputStream(path,noFollow)
    val raw=try stream.readNBytes(maximumInputBytes+1) finally stream.close()
    val after=attributes
    requirePilot(raw.length==before.size() && after.size()==before.size() && after.fileKey()!=null &&
      after.fileKey()==before.fileKey() && after.lastModifiedTime()==before.lastModifiedTime())
    val json=io.circe.parser.parse(UTF_8.newDecoder().decode(ByteBuffer.wrap(raw)).toString)
      .fold(_ => throw DomainError("pilot-input","invalid normalized input"),value => value)
    val c=json.hcursor
    requirePilot(c.get[String]("schema").toOption.contains(schema))
    val rows=c.get[Vector[Vector[(String,String)]]]("sessions").toOption.get
    requirePilot(rows.size==sessionCount)
    val samples=rows.map(sample)
    requirePilot(samples.map(_.windows.size).sum<=maximumWindows)
    samples
  }
  private def request(cfg: ModelConfig,w: Window,previous: Option[Carry]): Json = {
    val payload=ProblemPassageHttp.request(cfg,w,previous).mapObject(_.add("max_tokens",Json.fromInt(responseTokens))
      .add("chat_template_kwargs",Json.obj("enable_thinking"->Json.False)))
    val size=payload.noSpaces.getBytes(UTF_8).length
    requirePilot(size<=maximumRequestBytes && size-w.encodedSourceContentBytes<=requestReserveBytes)
    payload
  }
  private def failure(error: Throwable): String = ModelRejection.classify(error).map(_.reason.value).getOrElse(error match {
    case DomainError(code,_) if Set("model-timeout","model-http","model-transport","config","pilot-invariant").contains(code) => code
    case _ => "pilot-failure"
  })
  private case class Coverage(problemBytes: Long=0, contextBytes: Long=0, problemScalars: Long=0, contextScalars: Long=0) {
    def +(other: Coverage): Coverage = Coverage(problemBytes+other.problemBytes,contextBytes+other.contextBytes,
      problemScalars+other.problemScalars,contextScalars+other.contextScalars)
    def json: Json = Json.obj("problemBytes"->number(problemBytes),"contextBytes"->number(contextBytes),
      "problemScalars"->number(problemScalars),"contextScalars"->number(contextScalars))
  }
  private case class Observation(status: String,reason: Option[String]=None,elapsed: Option[Long]=None,coverage: Coverage=Coverage(),
    startedAt: Option[Long]=None) {
    def json(index: Int): Json = Json.obj("window"->number(index+1),"status"->Json.fromString(status),
      "reason"->reason.fold(Json.Null)(Json.fromString),"elapsedMillis"->elapsed.fold(Json.Null)(number),"coverage"->coverage.json)
  }
  private case class Progress(state: State,observations: Vector[Observation],userRetained: Map[Int,Long],ranked: Vector[Vector[Ranked]],
    sessionError: Option[String]=None)
  private def initial(sample: Sample): Progress = Progress(State.start(UUID.randomUUID(),UUID.randomUUID()),Vector.empty,Map.empty,sample.queries.map(_ => Vector.empty))

  /** Score accepted production spans, not just a successful response. Compare exact byte intervals
    * independently with the planned window. Joining only touching ranges detects gaps and overlap. */
  private def acceptAndScore(s: Sample,w: Window,decision: Decision,p: Progress,elapsed: Long): Progress = {
    validate(w,p.state.carry.nonEmpty,decision)
    val delta=accept(p.state,w,decision)
    type Interval = (Int,Int,Int)
    def joined(xs: Vector[Interval]): Vector[Interval] = xs.sorted.foldLeft(Vector.empty[Interval]) { case (acc,(i,start,end)) =>
      requirePilot(start>=0 && end>start && end<=s.input(i).length)
      acc.lastOption match {
        case Some((j,first,last)) if i==j && last==start => acc.init :+ ((j,first,end))
        case Some((j,_,last)) if i==j && last>start => requirePilot(false); acc
        case _ => acc :+ ((i,start,end))
      }
    }
    val problem=delta.pieces.map(_.sourceSpan)
    requirePilot(joined((problem++delta.context).map(x => (x.messagePosition,x.start,x.end)))==
      joined(w.fragments.map(f => (f.messagePosition,f.byteStart,f.byteEnd))))
    def sizes(spans: Vector[SourceSpan]): (Long,Long) = spans.foldLeft((0L,0L)) { case ((bytes,scalars),span) =>
      val n=span.end-span.start
      val text=new String(s.input(span.messagePosition),span.start,n,UTF_8)
      (bytes+n,scalars+text.codePointCount(0,text.length))
    }
    val (pb,ps)=sizes(problem); val (cb,cs)=sizes(delta.context)
    requirePilot(ps+cs==w.scalarCount)
    val retained=problem.filter(span => s.user(span.messagePosition)).foldLeft(p.userRetained) { (acc,span) =>
      acc.updated(span.messagePosition,acc.getOrElse(span.messagePosition,0L)+span.end-span.start)
    }
    // At most three same-source lexical witness queries, eight terms each; stream the top five.
    // Only accepted Problem-piece text (no metadata, embeddings, persistence, or production ranking).
    val ranked=delta.pieces.foldLeft(p.ranked) { (all,piece) =>
      val terms=tokens(piece.chunk.text).toSet
      all.zip(s.queries).map { (best,query) =>
        val hits=query.terms.count(terms)
        if(hits<2) best
        else (best :+ Ranked(hits,piece.ordinal,piece.sourceSpan.messagePosition)).sortBy(r => (-r.score,r.piece)).take(5)
      }
    }
    val accepted=Observation("accepted",elapsed=Some(elapsed),coverage=Coverage(pb,cb,ps,cs))
    p.copy(state=delta.state,observations=p.observations.updated(p.observations.size-1,accepted),userRetained=retained,ranked=ranked)
  }

  private def session(s: Sample,i: Int,rows: Ref[IO,Vector[Progress]],http: ModelHttp,cfg: ModelConfig): IO[Unit] = {
    def update(f: Progress => Progress): IO[Unit] = rows.update(v => v.updated(i,f(v(i))))
    def go(index: Int): IO[Unit] = rows.get.map(_(i)).flatMap { p =>
      if(index==s.windows.size) IO(finish(p.state,s.source)).flatMap(d => update(_.copy(state=d.state)))
      else {
        val w=s.windows(index)
        for {
          payload <- IO(request(cfg,w,p.state.carry))
          started <- IO.monotonic.map(_.toMillis)
          _ <- update(_.copy(observations=p.observations :+ Observation("running",startedAt=Some(started))))
          outcome <- http.postDecoded(callContext,endpoint,cfg.credentialFile,timeoutSeconds,maxResponseBytes,payload)(
            ProblemPassageHttp.response(w,p.state.carry.nonEmpty,_)).attempt.timed
          (elapsed,decision)=outcome
          state <- rows.get.map(_(i))
          accepted <- IO(decision.fold(throw _,d => acceptAndScore(s,w,d,state,elapsed.toMillis))).attempt
          _ <- accepted match {
            case Right(updated) => update(_ => updated) *> go(index+1)
            case Left(error) =>
              val reason=failure(error)
              val rejected=Observation(if(reason=="model-timeout") "request-timeout" else "rejected",Some(reason),Some(elapsed.toMillis))
              update(current => current.copy(observations=current.observations.updated(index,rejected)))
          }
        } yield ()
      }
    }
    go(0).handleErrorWith(error => update { p =>
      val reason=failure(error)
      val at=p.observations.lastIndexWhere(_.status=="running")
      val observation=Observation("pilot-error",Some(reason))
      val windows=if(at>=0) p.observations.updated(at,observation)
        else if(p.observations.size<s.windows.size) p.observations :+ observation else p.observations
      p.copy(observations=windows,sessionError=Some(reason))
    })
  }
  private def number(n: Long): Json = Json.fromLong(n)
  private def fraction(n: Long,d: Long): Json = if(d==0) Json.Null else Json.fromDoubleOrNull(n.toDouble/d)
  private def report(s: Sample,p: Progress,i: Int,deadline: Boolean,now: Long): Json = {
    val attempted=p.observations.take(s.windows.size).map { o =>
      if(o.status=="running") o.copy(status="whole-leg-timeout",reason=Some("whole-leg-timeout"),elapsed=o.startedAt.map(t => now-t)) else o
    }
    val rows=attempted.padTo(s.windows.size,Observation("blocked",Some(if(attempted.nonEmpty && attempted.last.status!="whole-leg-timeout")
      "previous-window-failed" else if(deadline) "whole-leg-timeout" else "not-attempted")))
    val covered=rows.map(_.coverage).foldLeft(Coverage())(_+_)
    val allBytes=s.input.map(_.length.toLong).sum
    val allScalars=s.windows.map(_.scalarCount.toLong).sum
    val fullyRetained=s.substantive.count(j => p.userRetained.getOrElse(j,0L)==s.input(j).length)
    val witnesses=p.ranked.zip(s.queries).count((rank,query) => rank.exists(_.messagePosition==query.messagePosition))
    val userBytes=s.user.toVector.map(j => s.input(j).length.toLong).sum
    val retainedBytes=p.userRetained.values.sum
    Json.obj("session"->number(i+1),"plannedWindows"->number(s.windows.size),"acceptedWindows"->number(rows.count(_.status=="accepted")),
      "elapsedRequestMillis"->number(rows.flatMap(_.elapsed).sum),"finished"->Json.fromBoolean(p.state.finished),
      "sessionError"->p.sessionError.fold(Json.Null)(Json.fromString),
      "sourceBytes"->number(allBytes),"sourceScalars"->number(allScalars),"coverage"->covered.json,
      "coveredBytesFraction"->fraction(covered.problemBytes+covered.contextBytes,allBytes),
      "coveredScalarsFraction"->fraction(covered.problemScalars+covered.contextScalars,allScalars),
      "problemPassages"->number(p.state.nextPassageOrdinal),"problemPieces"->number(p.state.nextPieceOrdinal),
      "userBytes"->number(userBytes),"userBytesInProblem"->number(retainedBytes),"userBytesInProblemFraction"->fraction(retainedBytes,userBytes),
      "heuristicSubstantiveUserMessages"->number(s.substantive.size),"heuristicFullyRetainedInProblem"->number(fullyRetained),
      "heuristicFullyRetainedFraction"->fraction(fullyRetained,s.substantive.size),"sameSourceLexicalWitnessQueries"->number(s.queries.size),
      "sameSourceLexicalWitnessHitsAt5"->number(witnesses),"windows"->Json.arr(rows.zipWithIndex.map((o,j) => o.json(j))*))
  }
  private def evaluate(samples: Vector[Sample],cfg: ModelConfig,client: Resource[IO,Client[IO]],deadline: FiniteDuration): IO[(Json,Boolean)] = for {
    rows <- Ref.of[IO,Vector[Progress]](samples.map(initial))
    admission <- ModelAdmission.make(IndexingCapacity(1,1,1))
    telemetry <- ModelTelemetry.make(new JavaModelTelemetryClock(Clock.systemUTC(),cats.effect.Clock[IO]))
    result <- client.use { c =>
      val http=new ModelHttp(c,telemetry,admission)
      samples.zipWithIndex.traverse_ { (s,i) => admission.annotationSession.use(_ => session(s,i,rows,http,cfg)) }
    }.as(false).timeoutTo(deadline,IO.pure(true)).timed
    (elapsed,timedOut)=result
    now <- IO.monotonic.map(_.toMillis)
    finalState <- rows.get
    reports=samples.zip(finalState).zipWithIndex.map { case ((s,p),i) => report(s,p,i,timedOut,now) }
    planned=samples.map(_.windows.size).sum
    accepted=finalState.map(_.observations.count(_.status=="accepted")).sum
    json=Json.obj("schema"->Json.fromString(schema),"requestTimeoutSeconds"->number(timeoutSeconds),"wholeLegSeconds"->number(deadline.toSeconds),
      "elapsedMillis"->number(elapsed.toMillis),"wholeLegTimedOut"->Json.fromBoolean(timedOut),"maxResponseTokens"->number(responseTokens),
      "plannedWindows"->number(planned),"acceptedWindows"->number(accepted),"requestTimeouts"->number(finalState.flatMap(_.observations).count(_.status=="request-timeout")),
      "sessions"->Json.arr(reports*))
  } yield (json,!timedOut && accepted==planned && finalState.forall(_.state.finished))

  // ModelHttp takes a file reference: provide a scoped, empty private file (no Authorization header).
  private def noAuth(dir: Path): Resource[IO,Path] = Resource.make(IO.blocking {
    Files.createTempFile(dir,"empty-auth-",null,PosixFilePermissions.asFileAttribute(privateFile))
  })(p => IO.blocking(Files.deleteIfExists(p)).void)

  private def selfTest: IO[Unit] = Resource.make(IO.blocking(Files.createTempDirectory("local-pi-fixture-")))(p => IO.blocking(Files.delete(p))).use { dir =>
    val rows=Vector.tabulate(65)(i => (if(i%2==0) "user" else "assistant",s"Synthetic maple queue café 🐎 validation record $i."))
    val s=sample(rows)
    val w=s.windows.head
    val valid=Json.obj("parts"->Json.arr(Json.obj("kind"->Json.fromString("Problem"),"start"->point(0),"end"->point(w.terminal.fragmentIndex),
      "continuePrevious"->Json.False,"summary"->Json.fromString("Synthetic queue verification"),"tags"->Json.arr())))
    val bad=valid.mapObject(_.add("parts",Json.arr()))
    def envelope(content: Json) = Json.obj("choices"->Json.arr(Json.obj("finish_reason"->Json.fromString("stop"),
      "message"->Json.obj("content"->Json.fromString(content.noSpaces)))))
    val staged=Resource.make(IO.blocking(Files.createTempFile(dir,"synthetic-normalized-",null,PosixFilePermissions.asFileAttribute(privateFile))))(
      p => IO.blocking(Files.deleteIfExists(p)).void)
    val checkHandoff=staged.use { path => IO.blocking {
      val record=Json.arr(rows.map((role,text) => Json.arr(Json.fromString(role),Json.fromString(text)))*)
      Files.writeString(path,Json.obj("schema"->Json.fromString(schema),"sessions"->Json.arr(Vector.fill(sessionCount)(record)*)).noSpaces)
      assert(load(path).map(_.source.messages.map(m => (m.role,m.text)))==Vector.fill(sessionCount)(rows))
      Files.setPosixFilePermissions(path,PosixFilePermissions.fromString("rw-r--r--"))
      assert(scala.util.Try(load(path)).isFailure)
    }}
    checkHandoff *> noAuth(dir).use { auth =>
      val cfg=config(auth)
      for {
        invocations <- Ref.of[IO,Int](0)
        client=Client.fromHttpApp(HttpApp[IO](req => for {
          _ <- IO(assert(req.uri.renderString==endpoint && !req.headers.headers.exists(_.name.toString.equalsIgnoreCase("Authorization"))))
          body <- req.as[String]
          payload <- IO(io.circe.parser.parse(body).toOption.get)
          n <- invocations.getAndUpdate(_+1)
          _ <- IO {
            assert(payload.hcursor.get[Int]("max_tokens").toOption.contains(8192))
            assert(payload.hcursor.downField("chat_template_kwargs").get[Boolean]("enable_thinking").toOption.contains(false))
            assert(payload.hcursor.downField("response_format").get[String]("type").toOption.contains("json_schema"))
          }
        } yield Response[IO]().withEntity(envelope(if(n==0) valid else bad).noSpaces)))
        result <- evaluate(Vector(s),cfg,Resource.pure[IO,Client[IO]](client),wholeLeg)
        _ <- IO {
          val (json,ok)=result
          val row=json.hcursor.downField("sessions").downN(0)
          assert(!ok && json.hcursor.get[Int]("acceptedWindows").toOption.contains(1))
          assert(row.downField("coverage").get[Int]("problemBytes").toOption.contains(s.input.take(64).map(_.length).sum))
          assert(row.get[Int]("heuristicFullyRetainedInProblem").toOption.contains(32))
          assert(row.get[Int]("sameSourceLexicalWitnessHitsAt5").toOption.contains(3))
          assert(row.downField("windows").downN(1).get[String]("status").toOption.contains("rejected"))
          assert(!json.noSpaces.contains("Synthetic") && !json.noSpaces.contains(endpoint))
          val decision=ProblemPassageHttp.response(w,false,envelope(valid))
          val p=initial(s).copy(observations=Vector(Observation("running")))
          val after=acceptAndScore(s,w,decision,p,0)
          val last=s.windows.last
          val finalDecision=Decision(Vector(Part.context(Point(0,0),last.terminal)))
          val covered=acceptAndScore(s,last,finalDecision,after.copy(observations=after.observations :+ Observation("running")),0)
          assert(finish(covered.state,s.source).state.finished)
        }
      } yield ()
    }
  }
  private def point(i: Int): Json = Json.obj("fragmentIndex"->number(i),"scalarOffset"->number(0))
  def run(args: List[String]): IO[ExitCode] = {
    val task=args match {
      case List("--self-test") => selfTest *> IO.println("Local Pi pilot Scala self-test passed").as(ExitCode.Success)
      case List(input) => for {
        path <- IO(Path.of(input))
        samples <- IO.blocking(load(path))
        // Leave the per-request timer in ModelHttp below the transport idle timeout.
        result <- noAuth(path.getParent).use(auth => evaluate(samples,config(auth),JsonHttp.client((timeoutSeconds+10).seconds),wholeLeg))
        (json,ok)=result
        _ <- IO.println(json.noSpaces)
      } yield if(ok) ExitCode.Success else ExitCode.Error
      case _ => IO.raiseError(DomainError("pilot-usage","expected one private normalized input file"))
    }
    task.handleErrorWith(_ => IO.println("Local Pi pilot failed (input, setup or runtime)").as(ExitCode.Error))
  }
}
