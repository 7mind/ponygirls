package chronicle

import chronicle.api.*
import io.circe.Json
import java.util.UUID

/** Import synthetic historical payloads for retained-reader/admission tests, including deliberately
  * malformed or oversized old chunks. This is not an annotation executor and cannot publish current
  * policy output: old provenance is explicit, with no invented run or passage extents.
  */
object StoredPublicationFixtures {
  def publish(db: Database,claim: Claim,chunks: List[IndexedChunk]): Unit = db.transaction { c =>
    val space=IndexProfiles.registered(c,claim.profile)
    val profile=Wire.hash("stored-historical-fixture:"+claim.jobId.toString)
    val descriptor=Json.arr(Json.fromString("synthetic-stored-historical-payload"))
    Sql.exec(c,"INSERT INTO ch_index_profiles(profile,embedding_space,policy,descriptor) VALUES(?,?,'LegacyV4',?::jsonb) ON CONFLICT DO NOTHING",profile,space,descriptor.noSpaces)
    val generation=UUID.randomUUID()
    Sql.exec(c,"INSERT INTO ch_generations(id,session_id,revision,profile,passage_format,passage_count) VALUES(?,?,?,?,'LegacyAnnotations',0)",generation,claim.sessionId,claim.revision,profile)
    chunks.zipWithIndex.foreach { (indexed,ordinal) =>
      val chunk=indexed.chunk
      Sql.exec(c,"INSERT INTO ch_chunks(id,generation,value,document,embedding,ordinal) VALUES(?,?,?::jsonb,to_tsvector('english',?),?::vector,?)",chunk.id,generation,Wire.encode(Chunk.codecJson,chunk).noSpaces,s"${chunk.text} ${chunk.summary} ${chunk.tags.mkString(" ")}",indexed.vector.mkString("[",",","]"),ordinal)
    }
    chunks.flatMap(_.chunk.tags).distinct.foreach(tag => Sql.exec(c,"INSERT INTO ch_generation_tags(generation,tag) VALUES(?,?)",generation,tag))
    Sql.exec(c,"DELETE FROM ch_search_chunks WHERE session_id=?",claim.sessionId)
    Sql.exec(c,"INSERT INTO ch_search_chunks(id,generation,session_id,revision,profile,document,embedding) SELECT ch.id,ch.generation,g.session_id,g.revision,g.profile,ch.document,ch.embedding FROM ch_chunks ch JOIN ch_generations g ON g.id=ch.generation WHERE g.id=?",generation)
    Sql.exec(c,"UPDATE ch_sources SET published=? WHERE id=?",generation,claim.sessionId)
    Check(Sql.exec(c,"UPDATE ch_jobs SET profile=?,state='Complete',error=NULL,failure_stage=NULL,lease_until=NULL WHERE id=? AND state='Running' AND run_id=?",profile,claim.jobId,claim.runId)==1,"test","historical fixture job missing")
  }
}
