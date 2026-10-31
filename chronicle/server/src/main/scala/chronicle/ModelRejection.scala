package chronicle

import io.circe.Json

enum ModelRejectionReason(val value: String,val detail: String) {
  case ResponseByteBound extends ModelRejectionReason("response-byte-bound","model response too large")
  case ModelJsonInvalid extends ModelRejectionReason("model-json-invalid","invalid model JSON")
  case ChoicesDecode extends ModelRejectionReason("annotation-choices-decode","missing passage choices")
  case ChoiceCount extends ModelRejectionReason("annotation-choice-count","invalid passage choice count")
  case FinishDecode extends ModelRejectionReason("annotation-finish-decode","missing passage finish reason")
  case TokenLimit extends ModelRejectionReason("annotation-token-limit","passage token limit reached")
  case FinishNotStop extends ModelRejectionReason("annotation-finish-not-stop","passage annotation did not complete")
  case RefusalOrToolCall extends ModelRejectionReason("annotation-refusal-or-tool-call","passage refusal or tool call")
  case ContentDecode extends ModelRejectionReason("annotation-content-decode","missing passage content")
  case ContentEmpty extends ModelRejectionReason("annotation-content-empty","empty passage content")
  case Fields extends ModelRejectionReason("annotation-fields","unexpected passage fields")
  case PartsDecode extends ModelRejectionReason("annotation-parts-decode","missing passage parts")
  case FragmentIndexDecode extends ModelRejectionReason("annotation-fragment-index-decode","invalid fragment index")
  case ScalarOffsetDecode extends ModelRejectionReason("annotation-scalar-offset-decode","invalid scalar offset")
  case ContinuationDecode extends ModelRejectionReason("annotation-continuation-decode","invalid passage continuation")
  case SummaryDecode extends ModelRejectionReason("annotation-summary-decode","invalid passage summary")
  case TagsDecode extends ModelRejectionReason("annotation-tags-decode","invalid passage tags")
  case KindDecode extends ModelRejectionReason("annotation-kind-decode","invalid coverage kind")
  case PartCount extends ModelRejectionReason("annotation-part-count","invalid passage part count")
  case NoncanonicalCoordinate extends ModelRejectionReason("annotation-coordinate-noncanonical","noncanonical passage coordinate")
  case PartitionRange extends ModelRejectionReason("annotation-partition-range","passage gap/overlap/empty/range")
  case ContextMetadata extends ModelRejectionReason("annotation-context-metadata","context must not invent problem metadata")
  case ContinuationWithoutProblem extends ModelRejectionReason("annotation-continuation-without-problem","continuation requires an open problem")
  case PartitionIncomplete extends ModelRejectionReason("annotation-partition-incomplete","incomplete passage partition")
  case SummaryBounds extends ModelRejectionReason("annotation-summary-bounds","passage annotation bounds")
  case TagCount extends ModelRejectionReason("annotation-tag-count","passage annotation bounds")
  case DuplicateTags extends ModelRejectionReason("annotation-tags-duplicate","passage annotation bounds")
  case TagBounds extends ModelRejectionReason("annotation-tag-bounds","passage annotation bounds")
  case Unicode extends ModelRejectionReason("annotation-unicode","non-storable passage Unicode")
  case Utf8Length extends ModelRejectionReason("annotation-utf8-length","passage UTF8 length exceeds i32 coordinates")

  def code: String = if(this==TokenLimit) "model-output/truncated" else "model-output"
}

enum ModelRejectionLocation {
  case Envelope,Choices,Finish,Message,Content,Coverage,Part,Start,End,Kind,FragmentIndex,ScalarOffset,Continuation,Summary,Tags,Tag,Source
}

enum ModelValueShape {
  case Missing,Null,Boolean,Number,String,Array,Object
}
object ModelValueShape {
  def of(value: Option[Json]): ModelValueShape = value match {
    case None => ModelValueShape.Missing
    case Some(json) => json.fold(ModelValueShape.Null,_ => ModelValueShape.Boolean,_ => ModelValueShape.Number,
      _ => ModelValueShape.String,_ => ModelValueShape.Array,_ => ModelValueShape.Object)
  }
}

enum ModelRejectionDetail {
  case Shape(value: ModelValueShape)
  case Count(actual: Long,maximum: Long)
  case Fields(missing: Int,unexpected: Int)
  case Coordinate(fragmentIndex: Int,scalarOffset: Int)
  case ExpectedCoordinate(fragmentIndex: Int,scalarOffset: Int)
  case Window(fragmentCount: Int,scalarCount: Int)
  case Item(index: Int)
  case TextUnits(count: Int)
  case Flag(value: Boolean)

  private[chronicle] def json: Json = {
    def number(value: Long): Json = Json.fromLong(value)
    this match {
      case Shape(value) => Json.obj("shape"->Json.fromString(value.toString.toLowerCase(java.util.Locale.ROOT)))
      case Count(actual,maximum) => Json.obj("actual"->number(actual),"maximum"->number(maximum))
      case Fields(missing,unexpected) => Json.obj("missingFields"->number(missing),"unexpectedFields"->number(unexpected))
      case Coordinate(fragment,scalar) => Json.obj("fragmentIndex"->number(fragment),"scalarOffset"->number(scalar))
      case ExpectedCoordinate(fragment,scalar) => Json.obj("expectedFragmentIndex"->number(fragment),"expectedScalarOffset"->number(scalar))
      case Window(fragments,scalars) => Json.obj("fragmentCount"->number(fragments),"scalarCount"->number(scalars))
      case Item(index) => Json.obj("itemIndex"->number(index))
      case TextUnits(count) => Json.obj("utf16Units"->number(count))
      case Flag(value) => Json.obj("flag"->Json.fromBoolean(value))
    }
  }
}

final class ModelRejection private(val reason: ModelRejectionReason,val location: ModelRejectionLocation,val structuralDetails: Vector[ModelRejectionDetail])
  extends DomainError(reason.code,reason.detail) {
  val safeDetails: Json = Json.obj("location"->Json.fromString(location.toString.toLowerCase(java.util.Locale.ROOT)),
    "structure"->Json.arr(structuralDetails.map(_.json)*))
}
object ModelRejection {
  private val maximumDetails = 8
  def from(reason: ModelRejectionReason): ModelRejection = at(reason,ModelRejectionLocation.Envelope)
  def at(reason: ModelRejectionReason,location: ModelRejectionLocation,details: ModelRejectionDetail*): ModelRejection = {
    Check(details.size<=maximumDetails,"internal","too many model rejection details")
    new ModelRejection(reason,location,details.toVector)
  }
  def classify(error: Throwable): Option[ModelRejection] = error match {
    case rejection: ModelRejection => Some(rejection)
    case _ => None
  }
}
