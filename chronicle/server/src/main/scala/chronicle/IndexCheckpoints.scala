package chronicle

import chronicle.api.*
import io.circe.Json
import java.sql.Connection

/** Durable accepted work inside one run; a claim/cursor is never authority on its own. */
enum IndexingStage { case Annotation,Embedding,Publication }
final case class CheckpointKey(stage: IndexingStage,window: Int,part: Int,inputHash: String) {
  Check(stage!=IndexingStage.Publication && window>=0 && part>=0 && inputHash.matches("[0-9a-f]{64}"),"internal","invalid checkpoint key")
}
trait IndexCheckpoints {
  def reserveAnnotation(claim: Claim,key: CheckpointKey): AnnotationReservation
  def rejectAnnotation(claim: Claim,key: CheckpointKey,attempt: Int,reason: String): Int
  def checkpoint(claim: Claim,key: CheckpointKey): Option[Json]
  def checkpoint(claim: Claim,key: CheckpointKey,value: Json): Unit
}
object IndexCheckpoints {
  val identity="accepted-index-work-v2"
  def hash(value: Json): String = Wire.hash(value.noSpacesSortKeys)
  def key(claim: Claim,stage: IndexingStage,window: Int,part: Int,algorithm: String,input: Json): CheckpointKey =
    CheckpointKey(stage,window,part,hash(Json.arr(Json.fromString(identity),Json.fromString(claim.runId.toString),Json.fromString(claim.profile),
      Json.fromString(claim.revisionBinding.id.toString),Json.fromString(claim.snapshot.digest),Json.fromString(algorithm),input)))
  private[chronicle] def read(c: Connection,claim: Claim,key: CheckpointKey): Option[Json] =
    Sql.one(c,"SELECT input_hash,output_hash,value FROM ch_index_checkpoints WHERE job_id=? AND run_id=? AND stage=? AND window_ordinal=? AND part=?",claim.jobId,claim.runId,key.stage.toString,key.window,key.part) { row =>
      val value=Sql.json(row,"value")
      Check(row.getString("input_hash")==key.inputHash && row.getString("output_hash")==hash(value),"internal","checkpoint identity mismatch")
      value
    }
  private[chronicle] def write(c: Connection,claim: Claim,key: CheckpointKey,value: Json): Unit = {
    Sql.exec(c,"INSERT INTO ch_index_checkpoints VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",claim.jobId,claim.runId,key.stage.toString,key.window,key.part,key.inputHash,hash(value),value.noSpaces)
    Check(read(c,claim,key).exists(stored => hash(stored)==hash(value)),"internal","immutable checkpoint output mismatch")
  }
}
private[chronicle] object CheckpointJson {
  def chunks(values: List[Chunk]): Json = Json.arr(values.map(Wire.encode(Chunk.codecJson,_))*)
  def decision(value: ProblemPassages.Decision): Json = {
    def point(p: ProblemPassages.Point): Json = Json.obj("fragmentIndex"->Json.fromInt(p.fragmentIndex),"scalarOffset"->Json.fromInt(p.scalarOffset))
    Json.obj("parts"->Json.arr(value.parts.map { part =>
      val range=Json.obj("kind"->Json.fromString(part.kind.toString),"start"->point(part.start),"end"->point(part.end))
      if(part.kind==ProblemPassages.Kind.Context) range else range.deepMerge(Json.obj("continuePrevious"->Json.fromBoolean(part.continuePrevious),"summary"->Json.fromString(part.summary),"tags"->Json.arr(part.tags.map(Json.fromString)*)))
    }*))
  }
  def vectors(values: List[List[Double]]): Json = Json.arr(values.map(vector => Json.arr(vector.map(Json.fromDoubleOrNull)*))*)
  def vectors(value: Json): List[List[Double]] = value.as[List[List[Double]]].getOrElse(throw DomainError("internal","invalid embedding checkpoint"))
  def validateVectors(values: List[List[Double]],size: Int,dimensions: Int): Unit =
    Check(values.size==size && values.forall(v => v.size==dimensions && v.forall(_.isFinite) && v.exists(_!=0.0)),"model-output","invalid accepted embedding batch")
}
