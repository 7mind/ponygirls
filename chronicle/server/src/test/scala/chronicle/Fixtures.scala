package chronicle
import chronicle.api.*
import java.nio.file.{Files,Path}
import java.util.UUID
object Fixtures {
  def config(): Config = {
    val dir = Files.createTempDirectory("chronicle-test-")
    val credential = dir.resolve("secret"); Files.writeString(credential,"")
    val hash = dir.resolve("password"); Files.writeString(hash,Password.hash("synthetic".toCharArray))
    Config("127.0.0.1",8448,"http://127.0.0.1:8448",false,sys.env.getOrElse("CHRONICLE_TEST_JDBC","jdbc:postgresql://127.0.0.1:55438/postgres"),"postgres",credential.toString,List("a","b","c").map(id => UserConfig(id,id,hash.toString,true)),8388608,16,4194304,10000,43200,ModelConfig("http://127.0.0.1:1/chat","model","v1",credential.toString,1,65536),EmbeddingConfig("http://127.0.0.1:1/embedding","embed","v1",credential.toString,1,65536,3,"query: ","passage: ",false))
  }
  def snapshot(): IngestRequest = {
    val raw = """{"type":"session","id":"session","version":3}
{"type":"model_change","id":"meta","parentId":null,"modelId":"test"}
{"type":"message","id":"u","parentId":"meta","message":{"role":"user","content":[{"type":"text","text":"synthetic PostgreSQL archive"}]}}
"""
    IngestRequest(UUID.randomUUID(),SourceIdentity(UUID.randomUUID().toString,"native",SourceFormat.Pi,"session",None),0,Wire.hash(raw),Completion.Quiescent,false,Metadata("synthetic",Some("project"),None,None,Some("main"),None,"pi",None,Some("2026-01-01T00:00:00Z"),None,List("synthetic")),List(Message("u",Some("meta"),"user","synthetic PostgreSQL archive",None,2)),List(RawFile("session.jsonl",Wire.hash(raw),raw)))
  }
}
