package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.Json
import java.nio.file.{Files,Path}
import ponygirls.auth.IndexingPolicy

class ModelAdmissionTest extends munit.FunSuite {
  test("BA specified: external old configuration gets explicit capacity defaults; malformed records do not") {
    import Config.given
    val json=Wire.parse(Files.readString(Path.of("config.example.json")))
    assertEquals(json.as[Config].toOption.get.indexing,IndexingCapacity(4,8,16))
    val capacity=Json.obj("annotationSessions"->Json.fromInt(2),"embeddingRequests"->Json.fromInt(3),"embeddingBatchSize"->Json.fromInt(5))
    assertEquals(json.mapObject(_.add("indexing",capacity)).as[Config].toOption.get.indexing,IndexingCapacity(2,3,5))
    // SWITCH: an omitted capacity keeps its default, so an empty section is the defaults.
    assertEquals(json.mapObject(_.add("indexing",Json.obj())).as[Config].toOption.get.indexing,IndexingCapacity.defaults)
    List(Json.Null,Json.fromString("invalid"),capacity.mapObject(_.add("embeddingRequests",Json.fromString("3")))).foreach { value =>
      assert(json.mapObject(_.add("indexing",value)).as[Config].isLeft,s"malformed capacity accepted: ${value.noSpaces}")
    }
  }
  test("indexing policy decodes alongside Chronicle's existing indexing capacity and continuation settings") {
    import Config.given
    val example=Wire.parse(Files.readString(Path.of("config.example.json")))
    def decode(indexing: Json) = example.mapObject(_.add("indexing",indexing)).as[Config]
    val capacity=Json.obj("annotationSessions"->Json.fromInt(2),"annotationContinuations"->Json.True)
    assertEquals(example.mapObject(_.remove("indexing")).as[Config].toOption.get.indexingPolicy,IndexingPolicy(true,false,false))
    assertEquals(decode(capacity).toOption.get.indexingPolicy,IndexingPolicy(true,false,false))
    val configured=decode(capacity.mapObject(_.add("defaultEnabled",Json.False).add("allowOptIn",Json.True).add("allowOptOut",Json.True))).toOption.get
    assertEquals(configured.indexingPolicy,IndexingPolicy(false,true,true))
    assertEquals(configured.indexing,IndexingCapacity.defaults.copy(annotationSessions=2,annotationContinuations=true))
    assert(decode(capacity.mapObject(_.add("allowOptIn",Json.Null))).isLeft)
  }
  test("BA specified: execution knobs validate independently and never alter either semantic profile") {
    val base=Fixtures.config()
    val original=IndexProfileCatalog.current(base)
    List(IndexingCapacity(1,1,1),IndexingCapacity(8,32,16),IndexingCapacity(4,8,7),IndexingCapacity(4,8,16,annotationContinuations=true)).foreach { capacity =>
      val config=base.copy(indexing=capacity); config.validate()
      assertEquals(config.profile,base.profile)
      assertEquals(IndexProfileCatalog.current(config).profiles,original.profiles)
    }
    List(IndexingCapacity(0,8,16),IndexingCapacity(9,8,16),IndexingCapacity(4,0,16),IndexingCapacity(4,33,16),IndexingCapacity(4,8,0),IndexingCapacity(4,8,17)).foreach { capacity =>
      assertEquals(intercept[DomainError](base.copy(indexing=capacity).validate()).code,"config")
      assert(ModelAdmission.make(capacity).attempt.unsafeRunSync().isLeft)
    }
  }
  test("SWITCH: the server's loader on a file: indexing.annotationContinuations alone keeps every other indexing default; omitted or false is off; not a boolean refuses the start naming the key, not the value") {
    val example=Wire.parse(Files.readString(Path.of("config.example.json"))).asObject.get
    val directory=Files.createTempDirectory("chronicle-config"); val file=directory.resolve("server.json")
    def load(indexing: Option[Json]): Config = {
      Files.writeString(file,Json.fromJsonObject(indexing.fold(example.remove("indexing"))(example.add("indexing",_))).noSpaces)
      Config.load(file.toString)
    }
    try {
      assert(!IndexingCapacity.defaults.annotationContinuations)
      assertEquals(load(Some(Json.obj("annotationContinuations"->Json.True))).indexing,IndexingCapacity.defaults.copy(annotationContinuations=true))
      assertEquals(load(None).indexing,IndexingCapacity.defaults)
      assertEquals(load(Some(Json.obj("annotationContinuations"->Json.False))).indexing,IndexingCapacity.defaults)
      List(Json.fromString("synthetic-value"),Json.fromInt(1),Json.Null).foreach { value =>
        val refused=intercept[DomainError](load(Some(Json.obj("annotationContinuations"->value))))
        assertEquals((refused.code,refused.detail),("config","indexing.annotationContinuations must be true or false"))
      }
      // A present capacity of another type still refuses the start as before.
      assertEquals(intercept[DomainError](load(Some(Json.obj("annotationSessions"->Json.fromString("4"),"annotationContinuations"->Json.True)))).detail,"invalid configuration")
    } finally { Files.deleteIfExists(file); Files.delete(directory) }
  }
  test("BA specified: session and annotation HTTP permits are distinct, not a recursive gate") {
    (for {
      admission <- ModelAdmission.make(IndexingCapacity(1,1,1))
      _ <- admission.annotationSession.use(_ => admission.request(ModelWorkload.IndexAnnotation).use(_ => IO.unit))
      _ <- List(ModelWorkload.McpTest,ModelWorkload.IndexEmbedding,ModelWorkload.QueryEmbedding).traverse_(purpose => admission.request(purpose).use(_ => IO.unit))
    } yield ()).unsafeRunSync()
  }
}
