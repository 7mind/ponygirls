package chronicle

import chronicle.api.*
import io.circe.Json
import java.nio.file.{Files,Path}
import java.util.UUID

private[chronicle] object HistorianFixtures {
  def snapshot(): IngestRequest = Wire.decode(IngestRequest.codecJson,Wire.parse(Files.readString(Path.of("server/src/test/fixtures/historian-ingest.json")))).copy(requestId=UUID.randomUUID())
  def next(original: IngestRequest): IngestRequest = {
    val timestamp="2026-11-07T12:01:00Z"
    val record=Wire.parse(original.files.head.content).deepMerge(Json.obj("episode"->Json.obj("revision"->Json.fromInt(2),"status"->Json.fromString("succeeded"),"recordedAt"->Json.fromString(timestamp))))
    val raw=record.noSpaces+"\n"
    original.copy(requestId=UUID.randomUUID(),expectedRevision=1,digest=Wire.hash(raw),messages=original.messages.map(message => message.copy(text=message.text.replace("Status: ongoing","Status: succeeded"),timestamp=Some(timestamp))),files=List(RawFile("episode.jsonl",Wire.hash(raw),raw)))
  }
}
