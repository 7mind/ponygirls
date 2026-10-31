package chronicle

import io.circe.Json
import ProblemPassages.*
import ProblemPassageFixtures.*
import ModelRejectionReason as Reason
import ModelRejectionLocation as Location
import ModelRejectionDetail as Detail

final class ModelRejectionTest extends munit.FunSuite {
  private val privateId="private-source-id"
  private val privateText="private transcript a😀éb"
  private val privateSummary="private-summary"
  private val privateTag="private-tag"
  private val window=Source(List(message(privateId,"a😀éb","user",0))).next(SourceCursor.start).get
  private val part=Part(Point(0,0),window.terminal,false,privateSummary,List(privateTag))
  private val valid=Decision(Vector(part))
  private val validJson=json(valid)
  private val partJson=validJson.hcursor.downField("parts").focus.get.asArray.get.head
  private def coverage(value: Json): Json = Json.obj("parts"->Json.arr(value))
  private def changed(field: String,value: Json): Json = coverage(partJson.mapObject(_.add(field,value)))
  private def response(value: Json): Decision = ProblemPassageHttp.response(window,false,value)
  private def decode(value: Json): Decision = ProblemPassages.decode(window,false,value)
  private def validatePart(value: Part): Unit = validate(window,false,Decision(Vector(value)))
  private def rejection(reason: Reason)(run: => Any): ModelRejection = {
    val error=intercept[ModelRejection](run)
    assertEquals(error.reason,reason)
    assertEquals(error.code,reason.code)
    assertEquals(error.detail,reason.detail)
    assertEquals(ModelRejection.classify(error),Some(error))
    error match {
      case DomainError(code,detail) => assertEquals((code,detail),(reason.code,reason.detail))
    }
    val exposed=error.safeDetails.noSpaces+error.toString+error.getMessage
    List(privateId,privateText,privateSummary,privateTag).foreach(value => assert(!exposed.contains(value)))
    assert(error.safeDetails.noSpaces.length<1024)
    error
  }

  test("BA regression: rejected coverage has a typed diagnostic rather than an unclassified DomainError") {
    val window=Source(List(message("private-id",privateText,"user",0))).next(SourceCursor.start).get
    val error=intercept[DomainError](validate(window,false,Decision(Vector.empty)))
    assertEquals(error.code,"model-output")
    assertEquals(error.getClass.getSimpleName,"ModelRejection")
  }

  private val envelopeCases=Vector(
    ("missing choices",Reason.ChoicesDecode,Json.obj()),
    ("choices type",Reason.ChoicesDecode,Json.obj("choices"->Json.fromString(privateText))),
    ("choices null",Reason.ChoicesDecode,Json.obj("choices"->Json.Null)),
    ("empty choices",Reason.ChoiceCount,Json.obj("choices"->Json.arr())),
    ("extra choices",Reason.ChoiceCount,Json.obj("choices"->Json.arr(Json.obj(),Json.obj()))),
    ("missing finish",Reason.FinishDecode,Json.obj("choices"->Json.arr(Json.obj()))),
    ("finish type",Reason.FinishDecode,Json.obj("choices"->Json.arr(Json.obj("finish_reason"->Json.fromInt(1))))),
    ("length",Reason.TokenLimit,envelope(validJson.noSpaces,"length")),
    ("other finish",Reason.FinishNotStop,envelope(validJson.noSpaces,privateText)),
    ("missing content",Reason.ContentDecode,Json.obj("choices"->Json.arr(Json.obj("finish_reason"->Json.fromString("stop"),"message"->Json.obj())))),
    ("content type",Reason.ContentDecode,Json.obj("choices"->Json.arr(Json.obj("finish_reason"->Json.fromString("stop"),"message"->Json.obj("content"->Json.arr()))))),
    ("empty content",Reason.ContentEmpty,envelope("","stop")),
    ("invalid JSON",Reason.ModelJsonInvalid,envelope(privateText,"stop"))
  )
  envelopeCases.foreach { (name,reason,value) => test(s"BA: envelope $name has typed rejection") {
    rejection(reason)(response(value))
  }}
  List("refusal","tool_calls","function_call").foreach { field =>
    test(s"BA: envelope $field presence is rejected without recording its contents") {
      val value=envelope(validJson.noSpaces,"stop").mapObject { root =>
        val choice=root("choices").get.asArray.get.head.mapObject { choice =>
          choice.add("message",choice("message").get.mapObject(_.add(field,Json.fromString(privateText))))
        }
        root.add("choices",Json.arr(choice))
      }
      rejection(Reason.RefusalOrToolCall)(response(value))
      val allowed=value.mapObject { root =>
        val choice=root("choices").get.asArray.get.head.mapObject { choice =>
          choice.add("message",choice("message").get.mapObject(_.add(field,Json.Null)))
        }
        root.add("choices",Json.arr(choice))
      }
      assertEquals(response(allowed),valid)
    }
  }

  private val decoderCases=Vector(
    ("root shape",Reason.Fields,Json.arr(Json.fromString(privateText))),
    ("root missing field",Reason.Fields,Json.obj()),
    ("root extra field",Reason.Fields,validJson.mapObject(_.add(privateText,Json.fromString(privateSummary)))),
    ("parts type",Reason.PartsDecode,Json.obj("parts"->Json.fromString(privateText))),
    ("part shape",Reason.KindDecode,coverage(Json.fromString(privateText))),
    ("part missing field",Reason.Fields,coverage(partJson.mapObject(_.remove("summary")))),
    ("part extra field",Reason.Fields,coverage(partJson.mapObject(_.add(privateText,Json.fromString(privateSummary))))),
    ("point shape",Reason.Fields,changed("start",Json.arr())),
    ("point fields",Reason.Fields,changed("end",pointJson(window.terminal).mapObject(_.add(privateText,Json.True)))),
    ("fragment index type",Reason.FragmentIndexDecode,changed("start",Json.obj("fragmentIndex"->Json.fromString(privateText),"scalarOffset"->Json.fromInt(0)))),
    ("scalar offset type",Reason.ScalarOffsetDecode,changed("end",Json.obj("fragmentIndex"->Json.fromInt(1),"scalarOffset"->Json.fromDoubleOrNull(0.5)))),
    ("continuation type",Reason.ContinuationDecode,changed("continuePrevious",Json.fromString(privateText))),
    ("summary type",Reason.SummaryDecode,changed("summary",Json.arr(Json.fromString(privateText)))),
    ("tags type",Reason.TagsDecode,changed("tags",Json.fromString(privateText))),
    ("tag element type",Reason.TagsDecode,changed("tags",Json.arr(Json.fromString(privateTag),Json.fromInt(1)))),
    ("kind unknown",Reason.KindDecode,changed("kind",Json.fromString(privateText))),
    ("kind type",Reason.KindDecode,changed("kind",Json.True)),
    ("kind missing",Reason.KindDecode,coverage(partJson.mapObject(_.remove("kind")))),
    ("context metadata",Reason.Fields,coverage(partJson.mapObject(_.add("kind",Json.fromString("Context")))))
  )
  decoderCases.foreach { (name,reason,value) => test(s"BA: decoder $name has typed rejection") {
    rejection(reason)(decode(value))
  }}

  private val validationCases=Vector(
    ("empty partition",Reason.PartCount,Decision(Vector.empty)),
    ("too many parts",Reason.PartCount,Decision(Vector.fill(5)(part))),
    ("negative fragment",Reason.NoncanonicalCoordinate,Decision(Vector(part.copy(start=Point(-1,0))))),
    ("fragment beyond terminal",Reason.NoncanonicalCoordinate,Decision(Vector(part.copy(end=Point(2,0))))),
    ("negative scalar",Reason.NoncanonicalCoordinate,Decision(Vector(part.copy(start=Point(0,-1))))),
    ("UTF16 or internal fragment end",Reason.NoncanonicalCoordinate,Decision(Vector(part.copy(end=Point(0,4))))),
    ("nonzero terminal scalar",Reason.NoncanonicalCoordinate,Decision(Vector(part.copy(end=Point(1,1))))),
    ("leading gap",Reason.PartitionRange,Decision(Vector(part.copy(start=Point(0,1))))),
    ("empty range",Reason.PartitionRange,Decision(Vector(part.copy(end=Point(0,0))))),
    ("reverse range",Reason.PartitionRange,Decision(Vector(part.copy(end=Point(0,2)),part.copy(start=Point(0,2),end=Point(0,1))))),
    ("gap",Reason.PartitionRange,Decision(Vector(part.copy(end=Point(0,1)),part.copy(start=Point(0,2))))),
    ("overlap",Reason.PartitionRange,Decision(Vector(part.copy(end=Point(0,2)),part.copy(start=Point(0,1))))),
    ("incomplete partition",Reason.PartitionIncomplete,Decision(Vector(part.copy(end=Point(0,3))))),
    ("context summary",Reason.ContextMetadata,Decision(Vector(Part.context(Point(0,0),window.terminal).copy(summary=privateSummary)))),
    ("context tags",Reason.ContextMetadata,Decision(Vector(Part.context(Point(0,0),window.terminal).copy(tags=List(privateTag))))),
    ("context continuation",Reason.ContextMetadata,Decision(Vector(Part.context(Point(0,0),window.terminal).copy(continuePrevious=true)))),
    ("continuation without problem",Reason.ContinuationWithoutProblem,Decision(Vector(part.copy(continuePrevious=true))))
  )
  validationCases.foreach { (name,reason,value) => test(s"BA: coverage $name has typed rejection") {
    rejection(reason)(validate(window,false,value))
  }}

  private val metadataCases=Vector(
    ("empty summary",Reason.SummaryBounds,part.copy(summary="")),
    ("long summary",Reason.SummaryBounds,part.copy(summary="😀" * 1001)),
    ("too many tags",Reason.TagCount,part.copy(tags=(0 to 16).map(_.toString).toList)),
    ("duplicate tags",Reason.DuplicateTags,part.copy(tags=List(privateTag,privateTag))),
    ("empty tag",Reason.TagBounds,part.copy(tags=List(""))),
    ("long tag",Reason.TagBounds,part.copy(tags=List("😀" * 65)))
  )
  metadataCases.foreach { (name,reason,value) => test(s"BA: metadata $name has typed rejection") {
    rejection(reason)(validatePart(value))
    rejection(reason)(decode(coverage(json(Decision(Vector(value))).hcursor.downField("parts").focus.get.asArray.get.head)))
  }}
  List("\u0000","\ud800","\udc00","\ud800x").zipWithIndex.foreach { (invalid,index) =>
    test(s"BA: invalid metadata Unicode $index is rejected safely in summaries and tags") {
      val summaryError=rejection(Reason.Unicode)(validatePart(part.copy(summary=privateSummary+invalid)))
      assertEquals(summaryError.location,Location.Summary)
      val tagError=rejection(Reason.Unicode)(validatePart(part.copy(tags=List(privateTag+invalid))))
      assertEquals(tagError.location,Location.Tag)
      assertEquals(intercept[DomainError](Source(List(message(privateId,invalid,"user",0)))).code,"invalid")
    }
  }

  test("BA: coordinate and shape diagnostics contain bounded structural facts, not input strings or field names") {
    val coordinate=rejection(Reason.NoncanonicalCoordinate)(validatePart(part.copy(end=Point(Int.MaxValue,Int.MinValue))))
    assertEquals(coordinate.structuralDetails,Vector(Detail.Item(0),Detail.Coordinate(Int.MaxValue,Int.MinValue),Detail.Window(1,4)))
    val incomplete=rejection(Reason.PartitionIncomplete)(validatePart(part.copy(end=Point(0,3))))
    assertEquals(incomplete.structuralDetails,Vector(Detail.Coordinate(0,3),Detail.ExpectedCoordinate(1,0),Detail.Window(1,4)))
    val hostile=Json.obj("parts"->Json.arr(),(privateText * 10000)->Json.fromString(privateSummary * 10000))
    val fields=rejection(Reason.Fields)(decode(hostile))
    assertEquals(fields.structuralDetails,Vector(Detail.Shape(ModelValueShape.Object),Detail.Fields(0,1)))
    assertEquals(fields.safeDetails,Json.obj("location"->Json.fromString("coverage"),"structure"->Json.arr(
      Json.obj("shape"->Json.fromString("object")),Json.obj("missingFields"->Json.fromInt(0),"unexpectedFields"->Json.fromInt(1)))))
  }

  test("BA: accepted scalar boundaries and metadata limits remain unchanged") {
    val unicode=part.copy(summary="😀" * 1000,tags=List("😀" * 64))
    validatePart(unicode)
    assertEquals(response(envelope(json(Decision(Vector(unicode))).noSpaces,"stop")),Decision(Vector(unicode)))
    val context=Part.context(Point(0,0),Point(0,1))
    val decision=Decision(Vector(context,part.copy(start=Point(0,1)),Part.context(window.terminal,window.terminal)))
    rejection(Reason.PartitionRange)(validate(window,false,decision))
    val mixed=Decision(Vector(context,part.copy(start=Point(0,1),end=Point(0,3)),part.copy(start=Point(0,3),continuePrevious=true)))
    assertEquals(decode(json(mixed)),mixed)
    assertEquals(ProblemPassages.decode(window,true,json(Decision(Vector(part.copy(continuePrevious=true))))),Decision(Vector(part.copy(continuePrevious=true))))
    val onlyContext=Decision(Vector(Part.context(Point(0,0),window.terminal)))
    assertEquals(decode(json(onlyContext)),onlyContext)
    assertEquals(response(envelope(validJson.noSpaces,"stop")),valid)
  }

  test("BA: integer admission and diagnostic factories preserve broad codes and stable reason identities") {
    assertEquals(checkedUtf8Length(Int.MaxValue.toLong,"model-output"),Int.MaxValue)
    rejection(Reason.Utf8Length)(checkedUtf8Length(Int.MaxValue.toLong+1,"model-output"))
    rejection(Reason.Utf8Length)(checkedUtf8Length(-1,"model-output"))
    assertEquals(intercept[DomainError](checkedUtf8Length(-1,"invalid")).code,"invalid")
    assertEquals(ModelRejection.classify(DomainError("model-output","invalid model JSON")),None)
    assertEquals(ModelRejection.classify(new RuntimeException(privateText)),None)
    assertEquals(Reason.values.map(_.value).distinct.length,Reason.values.length)
    Reason.values.foreach { reason =>
      val error=ModelRejection.from(reason)
      assertEquals(error.reason.value,reason.value)
      assertEquals(error.safeDetails,Json.obj("location"->Json.fromString("envelope"),"structure"->Json.arr()))
      assertEquals(error.code,if(reason==Reason.TokenLimit) "model-output/truncated" else "model-output")
    }
    intercept[DomainError](ModelRejection.at(Reason.Fields,Location.Coverage,Vector.fill(9)(Detail.Shape(ModelValueShape.Object))*))
  }
}
