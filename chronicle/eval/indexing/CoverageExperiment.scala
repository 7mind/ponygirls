package chronicle

import chronicle.api.Message
import cats.effect.{IO,Ref}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import fs2.Stream
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files,Path,StandardOpenOption}
import java.time.{Clock,Instant}
import java.util.UUID
import scala.concurrent.duration.*
import scala.util.control.NonFatal
import ProblemPassages.*

/** Opt-in synthetic experiment, excluded from production source directories. */
object CoverageExperiment {
  private val version = "synthetic-coverage-v2"
  private val maximumPlannedCalls = 32
  private val owner = "synthetic-coverage-experiment"
  private val reminder = "Cover every supplied scalar exactly once. The final part MUST end at requiredTerminal; previous is context, not source."
  enum Mode { case Baseline,Candidate }
  final case class Example(id: String,heldOut: Boolean,messages: List[Message],gold: Vector[Kind]) {
    def source: Source = Source(messages)
    def windows: Vector[Window] = {
      val out=Vector.newBuilder[Window]; var next=source.next(SourceCursor.start)
      while(next.nonEmpty) { val window=next.get; out+=window; next=source.next(window.next) }
      out.result()
    }
    def input: Json = Json.arr(messages.map(m => Json.obj("id"->Json.fromString(m.id),"role"->Json.fromString(m.role),"text"->Json.fromString(m.text)))* )
  }
  private def example(id: String,heldOut: Boolean,rows: (String,String,Kind)*): Example =
    Example(id,heldOut,rows.toList.zipWithIndex.map { case ((role,text,_),i) => Message(s"$id-$i",None,role,text,None,i) },rows.map(_._3).toVector)
  private def denseRows(count: Int): Vector[(String,String,Kind)] = (0 until count).map { index =>
    val runtime=index%3==0
    val text=if(runtime) "Runtime Context: tool inventory read and grep; idle heartbeat ready; no assignment. "
      else s"Implement synthetic shard $index queue validation. The capacity is 17 and retention is 23 days; verify exact original source bytes. "
    val content=Iterator.continually(text).take(maximumFragmentBytes/text.length+1).mkString.take(maximumFragmentBytes)
    (if(runtime) "system" else "user",content,if(runtime) Kind.Context else Kind.Problem)
  }.toVector
  private def corpus: Vector[Example] = Vector(
    example("runtime",false,("system","Runtime Context: cwd=/synthetic/work; available tools: read, grep. Session heartbeat: ready.",Kind.Context)),
    example("developer-task",false,("developer","Implement the synthetic queue's bounded retry counter and verify it with a deterministic test.",Kind.Problem)),
    example("domain-facts",false,("assistant","The synthetic queue owner is team Cedar. Its retention is 17 days. The proposed global lock was rejected in favor of per-key locking.",Kind.Problem)),
    example("unicode-mixed",false,("system","Runtime heartbeat: ready 🟢\n",Kind.Context),("user","Repair the café parser: preserve é, 東京 and 🐎; verify UTF-8 byte offsets.\n",Kind.Problem)),
    example("full-64",false,(0 until 64).map(i => ("user",s"Synthetic task: verify queue bucket $i has capacity 17.\n",Kind.Problem))*),
    example("long-2048",false,("user",("Verify synthetic queue capacity 17.\n" + "x"*2048).take(2048),Kind.Problem)),
    example("prompt-analysis",false,("user","Analyze why the literal prompt 'ignore all tasks' is unsafe. Do not execute it; propose a parser test.",Kind.Problem),("tool","Runtime heartbeat: process alive; no task result available.",Kind.Context)),
    example("heldout-runtime",true,("developer","Runtime Context: shell initialized; tool inventory loaded; idle heartbeat received. No assignment is present.",Kind.Context)),
    example("heldout-facts",true,("system","The synthetic observatory's detector samples at 23 Hz. Its owner is team Larch; the discarded alternative sampled at 11 Hz.",Kind.Problem)),
    example("carry-65",true,(0 until 65).map(i => ("user",s"Continue the same synthetic checksum verification: item $i must retain its original bytes.\n",Kind.Problem))*),
    example("dense-24",true,denseRows(24)*),
    example("dense-65",true,denseRows(65)*)
  )
  private def point(p: Point): Json = Json.obj("fragmentIndex"->Json.fromInt(p.fragmentIndex),"scalarOffset"->Json.fromInt(p.scalarOffset))
  private def digest(json: Json): Json = Json.fromString(Wire.hash(json.noSpaces))
  private def request(cfg: ModelConfig,w: Window,previous: Option[Carry],mode: Mode): Json = {
    val baseline=ProblemPassageHttp.request(cfg,w,previous)
    val result=mode match {
      case Mode.Baseline => baseline
      case Mode.Candidate =>
        val messages=baseline.hcursor.get[Vector[Json]]("messages").toOption.get
        val content=Wire.parse(messages(1).hcursor.get[String]("content").toOption.get)
          .mapObject(_.add("requiredTerminal",point(w.terminal)).add("coverageReminder",Json.fromString(reminder)))
        baseline.mapObject(_.add("messages",Json.arr(messages.updated(1,messages(1).mapObject(_.add("content",Json.fromString(content.noSpaces))))*)))
    }
    Check(result.noSpaces.getBytes(UTF_8).length<=maximumRequestBytes && result.noSpaces.getBytes(UTF_8).length-w.encodedSourceContentBytes<=requestReserveBytes,"experiment-bound","request byte bound")
    result
  }
  final case class Score(scalars: Vector[Long],bytes: Vector[Long]) {
    def json: Json = Json.obj("scalarConfusion"->Json.arr(scalars.map(Json.fromLong)*),"byteConfusion"->Json.arr(bytes.map(Json.fromLong)*),
      "scalarAccuracy"->Json.fromDoubleOrNull((scalars(0)+scalars(3)).toDouble/scalars.sum),
      "byteAccuracy"->Json.fromDoubleOrNull((bytes(0)+bytes(3)).toDouble/bytes.sum),
      "classificationExact"->Json.fromBoolean(scalars.sum>0 && scalars(1)==0 && scalars(2)==0))
  }
  private def score(e: Example,w: Window,delta: Delta): Score = {
    val scalars=Array.fill(4)(0L); val bytes=Array.fill(4)(0L)
    (delta.pieces.map(p => (p.sourceSpan,Kind.Problem))++delta.context.map(s => (s,Kind.Context))).foreach { (span,kind) =>
      val index=(if(e.gold(span.messagePosition)==Kind.Problem) 0 else 2)+(if(kind==Kind.Problem) 0 else 1)
      val text=new String(e.messages(span.messagePosition).text.getBytes(UTF_8),span.start,span.end-span.start,UTF_8)
      scalars(index)+=text.codePointCount(0,text.length); bytes(index)+=span.end-span.start
    }
    Check(scalars.sum==w.scalarCount && bytes.sum==w.fragments.map(f => f.byteEnd-f.byteStart).sum,"experiment-score","coverage accounting invariant")
    Score(scalars.toVector,bytes.toVector)
  }
  private final case class Result(caseId: String,mode: Mode,index: Int,attempted: Boolean,valid: Boolean,value: Json)
  private def failure(error: Throwable): Json = ModelRejection.classify(error).map { rejection =>
    Json.obj("code"->Json.fromString(rejection.code),"reason"->Json.fromString(rejection.reason.value),"structure"->rejection.safeDetails)
  }.getOrElse {
    val (code,reason)=error match {
      case DomainError("model-output","incomplete passage partition") => ("model-output","partition-incomplete")
      case DomainError("model-output","noncanonical passage coordinate") => ("model-output","coordinate-noncanonical")
      case DomainError("model-output","passage gap/overlap/empty/range") => ("model-output","partition-range")
      case d: DomainError if Set("model-output","model-output/truncated","model-timeout","model-http","config","invalid").contains(d.code) => (d.code,"request-or-validation-failed")
      case _ => ("experiment-external","external-or-io-failed")
    }
    Json.obj("code"->Json.fromString(code),"reason"->Json.fromString(reason))
  }
  private def evaluate(e: Example,mode: Mode,http: ModelHttp,cfg: ModelConfig,admission: ModelAdmission,results: Ref[IO,Vector[Result]],emit: Json => IO[Unit]): IO[Unit] =
    admission.annotationSession.use { _ =>
      e.windows.zipWithIndex.foldLeftM(Option(State.start(new UUID(0,1),new UUID(0,2)))) { (state,entry) =>
        val (window,index)=entry
        val base=Json.obj("caseId"->Json.fromString(e.id),"heldOut"->Json.fromBoolean(e.heldOut),"mode"->Json.fromString(mode.toString),"window"->Json.fromInt(index),
          "sourceSha256"->digest(window.sourceJson),"terminal"->point(window.terminal),"scalarCount"->Json.fromInt(window.scalarCount),
          "sourceBytes"->Json.fromInt(window.fragments.map(f => f.byteEnd-f.byteStart).sum))
        def save(attempted: Boolean,valid: Boolean,value: Json): IO[Unit] = results.update(_ :+ Result(e.id,mode,index,attempted,valid,base.deepMerge(value)))
        state match {
          case None => save(false,false,Json.obj("failure"->Json.obj("code"->Json.fromString("experiment-blocked"),"reason"->Json.fromString("previous-window-failed")))).as(None)
          case Some(current) => IO(request(cfg,window,current.carry,mode)).attempt.flatMap {
            case Left(error) => save(false,false,Json.obj("failure"->failure(error))).as(None)
            case Right(payload) =>
              val binding=Json.obj("requestSha256"->digest(payload),"previousSha256"->current.carry.map(c => digest(carryJson(c))).getOrElse(Json.Null))
              http.post(ModelCallContext(owner,ModelWorkload.IndexAnnotation),cfg.endpoint,cfg.credentialFile,cfg.timeoutSeconds,cfg.maxResponseBytes,payload).attempt.flatMap {
                case Left(error) => save(true,false,binding.deepMerge(Json.obj("failure"->failure(error)))).as(None)
                case Right(response) => IO {
                  val decision=ProblemPassageHttp.response(window,current.carry.nonEmpty,response)
                  val delta=accept(current,window,decision)
                  val metrics=score(e,window,delta)
                  val shape=Json.arr(decision.parts.map(p => Json.obj("kind"->Json.fromString(p.kind.toString),"start"->point(p.start),"end"->point(p.end),"continuePrevious"->Json.fromBoolean(p.continuePrevious)))* )
                  (delta.state,metrics.json.deepMerge(Json.obj("shape"->shape,"carryPresent"->Json.fromBoolean(current.carry.nonEmpty))))
                }.attempt.flatMap {
                  case Left(error) => save(true,false,binding.deepMerge(Json.obj("responseSha256"->digest(response),"failure"->failure(error)))).as(None)
                  case Right((next,metrics)) => save(true,true,binding.deepMerge(metrics).deepMerge(Json.obj("responseSha256"->digest(response)))).as(Some(next))
                }
              }
          }
        }
      }.flatMap { _ => results.get.flatMap { rows =>
        val own=rows.filter(r => r.caseId==e.id && r.mode==mode)
        emit(Json.obj("event"->Json.fromString("case-completed"),"caseId"->Json.fromString(e.id),"mode"->Json.fromString(mode.toString),
          "windows"->Json.fromInt(own.size),"coverageValid"->Json.fromInt(own.count(_.valid)),"failures"->Json.fromInt(own.count(!_.valid))))
      }}
    }

  private def comparison(rows: Vector[Result],fixtures: Vector[Example]): Json = Json.arr(Mode.values.map { mode =>
    val own=rows.filter(_.mode==mode)
    def totals(key: String): Vector[Long] = (0 until 4).map(i => own.filter(_.valid).map(_.value.hcursor.get[Vector[Long]](key).toOption.get(i)).sum).toVector
    val scalar=totals("scalarConfusion"); val bytes=totals("byteConfusion")
    val expectedScalars=fixtures.flatMap(_.windows).map(_.scalarCount.toLong).sum
    Json.obj("mode"->Json.fromString(mode.toString),"plannedWindows"->Json.fromInt(fixtures.map(_.windows.size).sum),
      "coverageValid"->Json.fromInt(own.count(_.valid)),"classificationMismatchWindows"->Json.fromInt(own.count(r => r.valid && !r.value.hcursor.get[Boolean]("classificationExact").toOption.get)),"unscoredScalars"->Json.fromLong(expectedScalars-scalar.sum),
      "correctScalarsOverAllInputs"->Json.fromDoubleOrNull((scalar(0)+scalar(3)).toDouble/expectedScalars),
      "validatedOnly"->Score(scalar,bytes).json)
  }*)
  private def run(configPath: String,out: Path): IO[Boolean] = for {
    _ <- IO.blocking(Files.createDirectory(out))
    cfg <- IO.blocking(Config.load(configPath))
    fixtures=corpus
    planned=fixtures.map(_.windows.size).sum*Mode.values.length
    _ <- IO(Check(planned<=maximumPlannedCalls,"experiment-bound","call count bound"))
    sourceHash <- IO.blocking(Wire.hash(Files.readString(Path.of("eval/indexing/CoverageExperiment.scala"))))
    manifest=Json.obj("version"->Json.fromString(version),"startedAt"->Json.fromString(Instant.now().toString),"runnerSourceSha256"->Json.fromString(sourceHash),
      "jsonHashEncoding"->Json.fromString("UTF-8 of Json.noSpaces; response is parsed/reserialized, not raw transport bytes"),
      "corpusSha256"->digest(Json.arr(fixtures.map(_.input)*)),"goldSha256"->digest(Json.arr(fixtures.map(e => Json.arr(e.gold.map(k => Json.fromString(k.toString))*))*)),
      "model"->Json.fromString(cfg.annotation.model),"revision"->Json.fromString(cfg.annotation.revision),"requestPolicy"->Json.fromString(cfg.annotation.requestPolicy.identity),
      "baselineAnnotationIdentity"->Json.fromString(ProblemPassages.identity),"timeoutSeconds"->Json.fromInt(cfg.annotation.timeoutSeconds),
      "maxResponseBytes"->Json.fromInt(cfg.annotation.maxResponseBytes),"plannedCalls"->Json.fromInt(planned),"concurrency"->Json.fromInt(cfg.indexing.annotationSessions))
    _ <- IO.blocking(Files.writeString(out.resolve("manifest.json"),manifest.spaces2,StandardOpenOption.CREATE_NEW))
    results <- Ref.of[IO,Vector[Result]](Vector.empty)
    telemetry <- ModelTelemetry.make(new JavaModelTelemetryClock(Clock.systemUTC(),cats.effect.Clock[IO]),Set(owner))
    admission <- ModelAdmission.make(cfg.indexing)
    outputLock <- cats.effect.std.Semaphore[IO](1)
    emit=(json: Json) => outputLock.permit.use(_ => IO.blocking { Files.writeString(out.resolve("progress.jsonl"),json.noSpaces+"\n",StandardOpenOption.CREATE,StandardOpenOption.APPEND); println(json.noSpaces) }.void)
    _ <- ModelHttp.client(cfg).use { client =>
      val http=new ModelHttp(client,telemetry,admission)
      Stream.emits(fixtures.flatMap(e => Mode.values.toVector.map(m => (e,m)))).covary[IO]
        .parEvalMapUnordered(cfg.indexing.annotationSessions)((e,m) => evaluate(e,m,http,cfg.annotation,admission,results,emit)).compile.drain
    }.timeoutTo((planned.toLong*(cfg.annotation.timeoutSeconds.toLong+30L)+60L).seconds,emit(Json.obj("event"->Json.fromString("experiment-deadline"))))
    rows <- results.get
    valid=rows.count(_.valid)
    mismatches=rows.count(r => r.valid && !r.value.hcursor.get[Boolean]("classificationExact").toOption.get)
    summary=Json.obj("plannedCalls"->Json.fromInt(planned),"attemptedCalls"->Json.fromInt(rows.count(_.attempted)),"completedWindows"->Json.fromInt(rows.size),
      "coverageValid"->Json.fromInt(valid),"classificationMismatchWindows"->Json.fromInt(mismatches),"coverageValidRate"->Json.fromDoubleOrNull(valid.toDouble/planned),"coverageFailuresOrUnfinished"->Json.fromInt(planned-valid),
      "unfinishedWindows"->Json.fromInt(planned-rows.size),"byMode"->comparison(rows,fixtures),"results"->Json.arr(rows.sortBy(r => (r.caseId,r.mode.ordinal,r.index)).map(r => r.value.deepMerge(Json.obj("coverageValid"->Json.fromBoolean(r.valid))))*))
    _ <- IO.blocking(Files.writeString(out.resolve("summary.json"),summary.spaces2,StandardOpenOption.CREATE_NEW))
  } yield valid==planned && mismatches==0

  // Behavioral-Active / Blackbox-Group, specified-origin; no provider or configuration access.
  private def selfTest(): Unit = {
    val fixtures=corpus
    assert(fixtures.size==12 && fixtures.map(_.windows.size).sum*2==28)
    assert(fixtures.find(_.id=="dense-24").get.windows.head.fragments.size==24)
    val dense=fixtures.find(_.id=="dense-65").get.windows
    assert(dense.size==2 && dense.flatMap(_.fragments).forall(f => f.byteEnd-f.byteStart==maximumFragmentBytes))
    assert(fixtures.find(_.id=="full-64").get.windows.head.fragments.size==64)
    assert(fixtures.find(_.id=="long-2048").get.windows.head.fragments.head.byteEnd==2048)
    val e=fixtures.find(_.id=="unicode-mixed").get; val w=e.windows.head
    val decision=Decision(Vector(Part.context(Point(0,0),Point(1,0)),Part(Point(1,0),w.terminal,false,"parser",Nil)))
    validate(w,false,decision)
    val initial=State.start(new UUID(0,1),new UUID(0,2))
    val correct=score(e,w,accept(initial,w,decision))
    assert(correct.scalars(1)==0 && correct.scalars(2)==0 && correct.bytes.sum>correct.scalars.sum)
    assert(score(e,w,accept(initial,w,Decision(Vector(Part.context(Point(0,0),w.terminal))))).scalars(1)>0)
    val cfg=ModelConfig("https://synthetic.invalid","synthetic","v1","/unused",900,1024,AnnotationRequestPolicy.GlmMaxReasoning)
    val baseline=request(cfg,w,None,Mode.Baseline); val candidate=request(cfg,w,None,Mode.Candidate)
    assert(baseline==ProblemPassageHttp.request(cfg,w,None))
    assert(baseline.hcursor.downField("messages").downN(0).focus==candidate.hcursor.downField("messages").downN(0).focus)
    val b=Wire.parse(baseline.hcursor.downField("messages").downN(1).get[String]("content").toOption.get)
    val c=Wire.parse(candidate.hcursor.downField("messages").downN(1).get[String]("content").toOption.get)
    assert(c.mapObject(_.remove("requiredTerminal").remove("coverageReminder"))==b)
    assert(baseline.mapObject(_.remove("messages"))==candidate.mapObject(_.remove("messages")))
    val carryCase=fixtures.find(_.id=="carry-65").get; val first=carryCase.windows.head
    val next=accept(State.start(new UUID(0,1),new UUID(0,2)),first,Decision(Vector(Part(Point(0,0),first.terminal,false,"checksum",Nil)))).state
    assert(next.carry.nonEmpty && carryCase.source.next(next.nextSource).get.fragments.size==1)
    val continued=Decision(Vector(Part(Point(0,0),carryCase.windows(1).terminal,true,"checksum",Nil)))
    assert(accept(next,carryCase.windows(1),continued).state.nextPassageOrdinal==1)
    def envelope(d: Decision): Json = Json.obj("choices"->Json.arr(Json.obj("finish_reason"->Json.fromString("stop"),
      "message"->Json.obj("content"->Json.fromString(CheckpointJson.decision(d).noSpaces)))))
    assert(ProblemPassageHttp.response(w,false,envelope(decision))==decision)
    val incomplete=Decision(Vector(Part.context(Point(0,0),Point(1,0))))
    try { ProblemPassageHttp.response(w,false,envelope(incomplete)); assert(false) }
    catch { case DomainError("model-output","incomplete passage partition") => () }
    assert(failure(new RuntimeException("secret response text")).noSpaces.indexOf("secret")<0)
    println("coverage-experiment self-test: passed")
  }
  def main(args: Array[String]): Unit = try {
    if(args.toList==List("--self-test")) selfTest()
    else {
      Check(args.length==2,"experiment-usage","CONFIG FRESH_OUTPUT_DIRECTORY required")
      if(!run(args(0),Path.of(args(1))).unsafeRunSync()) System.exit(1)
    }
  } catch {
    case NonFatal(error) => System.err.println(failure(error).noSpaces); System.exit(1)
  }
}
