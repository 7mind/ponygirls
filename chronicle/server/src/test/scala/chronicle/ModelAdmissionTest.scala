package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.Json
import java.nio.file.{Files,Path}

class ModelAdmissionTest extends munit.FunSuite {
  test("BA specified: external old configuration gets explicit capacity defaults; malformed records do not") {
    import Config.given
    val json=Wire.parse(Files.readString(Path.of("config.example.json")))
    assertEquals(json.as[Config].toOption.get.indexing,IndexingCapacity(4,8,16))
    val capacity=Json.obj("annotationSessions"->Json.fromInt(2),"embeddingRequests"->Json.fromInt(3),"embeddingBatchSize"->Json.fromInt(5))
    assertEquals(json.mapObject(_.add("indexing",capacity)).as[Config].toOption.get.indexing,IndexingCapacity(2,3,5))
    List(Json.Null,Json.obj(),Json.fromString("invalid"),capacity.mapObject(_.add("embeddingRequests",Json.fromString("3")))).foreach { value =>
      assert(json.mapObject(_.add("indexing",value)).as[Config].isLeft,s"malformed capacity accepted: ${value.noSpaces}")
    }
  }
  test("BA specified: execution knobs validate independently and never alter either semantic profile") {
    val base=Fixtures.config()
    val original=IndexProfileCatalog.passages(base,PassagePolicyIdentity(ProblemPassages.identity))
    List(IndexingCapacity(1,1,1),IndexingCapacity(8,32,16),IndexingCapacity(4,8,7)).foreach { capacity =>
      val config=base.copy(indexing=capacity); config.validate()
      assertEquals(config.profile,base.profile)
      assertEquals(IndexProfileCatalog.passages(config,PassagePolicyIdentity(ProblemPassages.identity)).profiles,original.profiles)
    }
    List(IndexingCapacity(0,8,16),IndexingCapacity(9,8,16),IndexingCapacity(4,0,16),IndexingCapacity(4,33,16),IndexingCapacity(4,8,0),IndexingCapacity(4,8,17)).foreach { capacity =>
      assertEquals(intercept[DomainError](base.copy(indexing=capacity).validate()).code,"config")
      assert(ModelAdmission.make(capacity).attempt.unsafeRunSync().isLeft)
    }
  }
  test("BA specified: session and annotation HTTP permits are distinct, not a recursive gate") {
    (for {
      admission <- ModelAdmission.make(IndexingCapacity(1,1,1))
      _ <- admission.annotationSession.use(_ => admission.request(ModelWorkload.IndexAnnotation).use(_ => IO.unit))
      _ <- List(ModelWorkload.McpTest,ModelWorkload.IndexEmbedding,ModelWorkload.QueryEmbedding).traverse_(purpose => admission.request(purpose).use(_ => IO.unit))
    } yield ()).unsafeRunSync()
  }
}
