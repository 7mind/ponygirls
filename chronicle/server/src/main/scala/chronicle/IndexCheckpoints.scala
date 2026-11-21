package chronicle

import chronicle.api.*
import io.circe.Json
import java.sql.{Connection,ResultSet}
import java.util.UUID

/** Durable accepted work inside one run; a claim/cursor is never authority on its own. */
enum IndexingStage { case Annotation,Embedding,Publication }
/** `contentHash` keys the input without the run or revision (ingest-limits spec §5.4): work accepted under it is reusable by
  * another run of the same source and profile; None is never reused. */
final case class CheckpointKey(stage: IndexingStage,window: Int,part: Int,inputHash: String,contentHash: Option[String]=None) {
  Check(stage!=IndexingStage.Publication && window>=0 && part>=0 && inputHash.matches("[0-9a-f]{64}") && contentHash.forall(_.matches("[0-9a-f]{64}")),"internal","invalid checkpoint key")
}
/** What phase W finds for a key (ingest-limits spec §5.4): work the run accepted (its own checkpoint or its reference), or
  * work another run of the source and profile accepted for the key's content hash, which the read recorded as the run's
  * reference. */
enum WindowWork { case Accepted(value: Json); case Reused(value: Json) }
/** The slot of a key holds accepted work for another input, e.g. an embedding part grouped under another batch size. */
final class CheckpointInputMismatch extends DomainError("internal","checkpoint identity mismatch")
trait IndexCheckpoints {
  def reserveAnnotation(claim: Claim,key: CheckpointKey): AnnotationReservation
  def rejectAnnotation(claim: Claim,key: CheckpointKey,attempt: Int,reason: String): Int
  /** The run's accepted work at the key's coordinates: its own checkpoint, or the checkpoint its reference names. */
  def checkpoint(claim: Claim,key: CheckpointKey): Option[Json]
  def checkpoint(claim: Claim,key: CheckpointKey,value: Json): Unit
  /** Phase W's read: the run's accepted work at the key's coordinates, else (ingest-limits spec §5.4) the output another
    * run of the claim's source and profile accepted for the key's content hash, the published generation's run first,
    * recorded as this run's reference at the key's coordinates. The publication never reads this way. */
  def windowWork(claim: Claim,key: CheckpointKey): Option[WindowWork]
  /** Removes the accepted work (own checkpoints and references) of one window and stage of the claimed run while the claim is current; a corrupt part is an internal fault and keeps all. Returns the number of parts removed. */
  def discardCheckpoints(claim: Claim,stage: IndexingStage,window: Int): Int
}
object IndexCheckpoints {
  val identity="accepted-index-work-v2"
  /** The content hashes' identities: a window's decision by its profile and input, an embedding part by its space and texts. */
  val windowReuse="window-reuse-v1"
  val embeddingReuse="embedding-reuse-v1"
  def hash(value: Json): String = Wire.hash(value.noSpacesSortKeys)
  def key(claim: Claim,stage: IndexingStage,window: Int,part: Int,algorithm: String,input: Json): CheckpointKey =
    CheckpointKey(stage,window,part,hash(Json.arr(Json.fromString(identity),Json.fromString(claim.runId.toString),Json.fromString(claim.profile),
      Json.fromString(claim.revisionBinding.id.toString),Json.fromString(claim.snapshot.digest),Json.fromString(algorithm),input)))
  /** A window's decision for `input` (its source and carry): equal inputs carry equal positions and texts. */
  def annotation(claim: Claim,window: Int,input: Json): CheckpointKey =
    key(claim,IndexingStage.Annotation,window,0,ProblemPassages.identity,input).copy(contentHash=Some(hash(Json.arr(Json.fromString(windowReuse),Json.fromString(claim.profile),input))))
  /** An embedding part of a window's pieces: the embedder sees the space's document prefix and the texts only. */
  def embedding(claim: Claim,window: Int,part: Int,space: String,batch: List[Chunk]): CheckpointKey =
    key(claim,IndexingStage.Embedding,window,part,space,CheckpointJson.chunks(batch)).copy(contentHash=Some(hash(Json.arr(Json.fromString(embeddingReuse),Json.fromString(space),Json.arr(batch.map(chunk => Json.fromString(chunk.text))*)))))
  private def verified(row: ResultSet): Json = {
    val value=Sql.json(row,"value")
    Check(row.getString("output_hash")==hash(value),"internal","corrupt checkpoint output")
    value
  }
  private def stored(c: Connection,claim: Claim,key: CheckpointKey): Option[(String,Json)] =
    Sql.one(c,"SELECT input_hash,output_hash,value FROM ch_index_checkpoints WHERE job_id=? AND run_id=? AND stage=? AND window_ordinal=? AND part=?",coordinates(claim,key)*)(row => (row.getString("input_hash"),verified(row)))
  private def coordinates(claim: Claim,key: CheckpointKey): List[Sql.Param] = List(claim.jobId,claim.runId,key.stage.toString,key.window,key.part)
  /** The checkpoint the run's reference at the key's coordinates names by its full key, with the output it accepted. */
  private def referenced(c: Connection,claim: Claim,key: CheckpointKey): Option[Json] =
    Sql.one(c,"""SELECT r.input_hash,r.output_hash AS accepted,k.output_hash,k.content_hash,k.value FROM ch_index_checkpoint_refs r
      LEFT JOIN ch_index_checkpoints k ON k.job_id=r.source_job AND k.run_id=r.source_run AND k.stage=r.source_stage AND k.window_ordinal=r.source_window AND k.part=r.source_part
      WHERE r.job_id=? AND r.run_id=? AND r.stage=? AND r.window_ordinal=? AND r.part=?""",coordinates(claim,key)*) { row =>
      if(row.getString("input_hash")!=key.inputHash) throw new CheckpointInputMismatch
      Check(Option(row.getString("output_hash")).contains(row.getString("accepted")) && key.contentHash.forall(expected => Option(row.getString("content_hash")).contains(expected)),"internal","checkpoint reference does not name its accepted output")
      verified(row)
    }
  private[chronicle] def read(c: Connection,claim: Claim,key: CheckpointKey): Option[Json] = stored(c,claim,key) match {
    case Some((input,value)) =>
      if(input!=key.inputHash) throw new CheckpointInputMismatch
      Some(value)
    case None => referenced(c,claim,key)
  }
  private[chronicle] def write(c: Connection,claim: Claim,key: CheckpointKey,value: Json): Unit = {
    Check(Sql.one(c,"SELECT 1 FROM ch_index_checkpoint_refs WHERE job_id=? AND run_id=? AND stage=? AND window_ordinal=? AND part=?",coordinates(claim,key)*)(_ => ()).isEmpty,"internal","checkpoint coordinates hold a reference")
    // NULLIF: no content hash (work keyed by `key` alone) is stored as NULL, never reused.
    Sql.exec(c,"INSERT INTO ch_index_checkpoints(job_id,run_id,stage,window_ordinal,part,input_hash,output_hash,value,content_hash) VALUES(?,?,?,?,?,?,?,?,NULLIF(?,'')) ON CONFLICT DO NOTHING",
      (coordinates(claim,key)++List[Sql.Param](key.inputHash,hash(value),value.noSpaces,key.contentHash.getOrElse("")))*)
    Check(stored(c,claim,key).exists((input,stored) => input==key.inputHash && hash(stored)==hash(value)),"internal","immutable checkpoint output mismatch")
  }
  /** An own checkpoint another run accepted, by its full key. */
  private[chronicle] final case class Reusable(job: UUID,run: UUID,stage: IndexingStage,window: Int,part: Int,outputHash: String,value: Json)
  /** The own checkpoint of the source's jobs of `profile` under `content` and `stage` that a run other than `excluded`
    * accepted: first one the published generation's run accepted, as its own or through its reference to it (so the next
    * run keeps the published prefix; a legacy generation names no run), then the newest revision's. Never a reference
    * itself, never the run's own (`discard` deletes those). */
  private[chronicle] def reusable(c: Connection,sessionId: UUID,profile: String,excluded: (UUID,UUID),stage: IndexingStage,content: String): Option[Reusable] =
    Sql.one(c,"""WITH published AS (SELECT g.run_id FROM ch_sources s JOIN ch_generations g ON g.id=s.published WHERE s.id=?)
      SELECT k.job_id,k.run_id,k.window_ordinal,k.part,k.output_hash,k.value FROM ch_index_checkpoints k JOIN ch_jobs j ON j.id=k.job_id
      WHERE k.content_hash=? AND k.stage=? AND j.session_id=? AND j.profile=? AND (k.job_id,k.run_id)<>(?,?)
      ORDER BY (k.run_id IN(SELECT run_id FROM published) OR EXISTS(SELECT 1 FROM ch_index_checkpoint_refs r WHERE r.run_id IN(SELECT run_id FROM published)
        AND r.source_job=k.job_id AND r.source_run=k.run_id AND r.source_stage=k.stage AND r.source_window=k.window_ordinal AND r.source_part=k.part)) IS TRUE DESC,
        j.revision DESC,k.job_id,k.run_id,k.window_ordinal,k.part LIMIT 1""",
      sessionId,content,stage.toString,sessionId,profile,excluded._1,excluded._2) { row =>
      Reusable(row.getObject("job_id",classOf[UUID]),row.getObject("run_id",classOf[UUID]),stage,row.getInt("window_ordinal"),row.getInt("part"),row.getString("output_hash"),verified(row))
    }
  /** Phase W on a miss (the caller found neither an own checkpoint nor a reference at the key's coordinates in the same
    * transaction): the reusable work for the key's content hash, recorded as the run's reference there. */
  private[chronicle] def reuse(c: Connection,claim: Claim,key: CheckpointKey): Option[Json] =
    key.contentHash.flatMap(reusable(c,claim.sessionId,claim.profile,(claim.jobId,claim.runId),key.stage,_)).map { found =>
      Sql.exec(c,"INSERT INTO ch_index_checkpoint_refs(job_id,run_id,stage,window_ordinal,part,input_hash,source_job,source_run,source_stage,source_window,source_part,output_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (coordinates(claim,key)++List[Sql.Param](key.inputHash,found.job,found.run,found.stage.toString,found.window,found.part,found.outputHash))*)
      found.value
    }
  /** A corrupt part is a fault, never discarded with the rest. */
  private[chronicle] def discard(c: Connection,claim: Claim,stage: IndexingStage,window: Int): Int = {
    Check(stage!=IndexingStage.Publication && window>=0,"internal","invalid checkpoint window")
    Sql.rows(c,"SELECT output_hash,value FROM ch_index_checkpoints WHERE job_id=? AND run_id=? AND stage=? AND window_ordinal=? FOR UPDATE",claim.jobId,claim.runId,stage.toString,window)(verified)
    Sql.exec(c,"DELETE FROM ch_index_checkpoint_refs WHERE job_id=? AND run_id=? AND stage=? AND window_ordinal=?",claim.jobId,claim.runId,stage.toString,window)+
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
