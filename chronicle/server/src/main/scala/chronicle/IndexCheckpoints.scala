package chronicle

import chronicle.api.*
import io.circe.Json
import java.sql.{Connection,ResultSet}

/** Durable accepted work inside one run; a claim/cursor is never authority on its own. */
enum IndexingStage { case Annotation,Embedding,Publication }
final case class CheckpointKey(stage: IndexingStage,window: Int,part: Int,inputHash: String) {
  Check(stage!=IndexingStage.Publication && window>=0 && part>=0 && inputHash.matches("[0-9a-f]{64}"),"internal","invalid checkpoint key")
}
/** The slot of a key holds accepted work for another input, e.g. an embedding part grouped under another batch size. */
final class CheckpointInputMismatch extends DomainError("internal","checkpoint identity mismatch")
final case class CheckpointNamespace(profile: String,embeddingSpace: String) {
  def key(claim: Claim,stage: IndexingStage,window: Int,part: Int,algorithm: String,input: Json): CheckpointKey =
    IndexCheckpoints.key(claim.copy(profile=profile),stage,window,part,if(stage==IndexingStage.Embedding) embeddingSpace else algorithm,input)
}
trait IndexCheckpoints {
  def checkpointNamespace(claim: Claim,currentEmbeddingSpace: String): CheckpointNamespace
  def reserveAnnotation(claim: Claim,key: CheckpointKey): AnnotationReservation
  def rejectAnnotation(claim: Claim,key: CheckpointKey,attempt: Int,reason: String): Int
  def checkpoint(claim: Claim,key: CheckpointKey): Option[Json]
  def checkpoint(claim: Claim,key: CheckpointKey,value: Json): Unit
  /** Removes the accepted work of one window and stage of the claimed run while the claim is current; a corrupt part is an internal fault and keeps all. Returns the number of parts removed. */
  def discardCheckpoints(claim: Claim,stage: IndexingStage,window: Int): Int
}
object IndexCheckpoints {
  val identity="accepted-index-work-v2"
  def hash(value: Json): String = Wire.hash(value.noSpacesSortKeys)
  def key(claim: Claim,stage: IndexingStage,window: Int,part: Int,algorithm: String,input: Json): CheckpointKey =
    CheckpointKey(stage,window,part,hash(Json.arr(Json.fromString(identity),Json.fromString(claim.runId.toString),Json.fromString(claim.profile),
      Json.fromString(claim.revisionBinding.id.toString),Json.fromString(claim.snapshot.digest),Json.fromString(algorithm),input)))
  private def verified(row: ResultSet): Json = {
    val value=Sql.json(row,"value")
    Check(row.getString("output_hash")==hash(value),"internal","corrupt checkpoint output")
    value
  }
  private def stored(c: Connection,claim: Claim,key: CheckpointKey): Option[(String,Json)] =
    Sql.one(c,"SELECT input_hash,output_hash,value FROM ch_index_checkpoints WHERE job_id=? AND run_id=? AND stage=? AND window_ordinal=? AND part=?",claim.jobId,claim.runId,key.stage.toString,key.window,key.part)(row => (row.getString("input_hash"),verified(row)))
  private[chronicle] def read(c: Connection,claim: Claim,key: CheckpointKey): Option[Json] = stored(c,claim,key).map { (input,value) =>
    if(input!=key.inputHash) throw new CheckpointInputMismatch
    value
  }
  private[chronicle] def write(c: Connection,claim: Claim,key: CheckpointKey,value: Json): Unit = {
    Sql.exec(c,"INSERT INTO ch_index_checkpoints VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",claim.jobId,claim.runId,key.stage.toString,key.window,key.part,key.inputHash,hash(value),value.noSpaces)
    Check(stored(c,claim,key).exists((input,stored) => input==key.inputHash && hash(stored)==hash(value)),"internal","immutable checkpoint output mismatch")
  }
  /** A corrupt part is a fault, never discarded with the rest. */
  private[chronicle] def discard(c: Connection,claim: Claim,stage: IndexingStage,window: Int): Int = {
    Check(stage!=IndexingStage.Publication && window>=0,"internal","invalid checkpoint window")
    Sql.rows(c,"SELECT output_hash,value FROM ch_index_checkpoints WHERE job_id=? AND run_id=? AND stage=? AND window_ordinal=? FOR UPDATE",claim.jobId,claim.runId,stage.toString,window)(verified)
    Sql.exec(c,"DELETE FROM ch_index_checkpoints WHERE job_id=? AND run_id=? AND stage=? AND window_ordinal=?",claim.jobId,claim.runId,stage.toString,window)
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
