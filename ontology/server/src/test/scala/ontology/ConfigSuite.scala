package ontology

import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.Files
import scala.util.Using
import ontology.api.*
import ontology.domain.Fault
import munit.FunSuite

final class ConfigSuite extends FunSuite {
  private val bytes = Using.resource(Option(getClass.getResourceAsStream("/runtime-config.json")).getOrElse(throw new IllegalStateException("config fixture missing")))(_.readAllBytes())
  private val fixture = Wire.parse(bytes)
  private def replace(value: Json, path: List[String], replacement: Json): Json = path match {
    case Nil => replacement
    case name :: rest => value.mapObject(objectValue => objectValue.add(name, replace(objectValue(name).get, rest, replacement)))
  }
  private def set(path: List[String], value: Json): Json = replace(fixture, path, value)
  private def reject(value: Json): Unit = assertEquals(intercept[Fault](Config.decode(value)).code, "config")

  test("complete explicit configuration maps to typed owners without secret or network resources") {
    val value = Config.decode(bytes)
    assertEquals(value.http.listenPort.value, 19090)
    assertEquals(value.http.webRoot, None)
    assertEquals(value.curator.reasoningEffort, None)
    assertEquals(value.curation.service, value.serviceActor)
    assertEquals(value.curation.guards.maxInputBytes, 524288L)
    assertEquals(value.projection.storage, RdfStorage.Memory)
    assertEquals(value.toString, "OntologyConfig(<redacted>)")
    val native = Config.decode(set(List("projection", "storage"), Json.obj("Native" -> Json.obj("path" -> Json.fromString("/synthetic/rdf")))))
    assertEquals(native.projection.storage, RdfStorage.Native(java.nio.file.Path.of("/synthetic/rdf")))
  }
  test("all object fields remain mandatory and unknown fields reject at every object boundary") {
    def check(value: Json, root: Json => Json): Unit = value.asObject match {
      case Some(objectValue) =>
        objectValue.keys.foreach { name => reject(root(value.mapObject(_.remove(name)))) }
        reject(root(value.mapObject(_.add("unexpected", Json.True))))
        objectValue.toList.foreach { case (name, nested) => check(nested, changed => root(value.mapObject(_.add(name, changed)))) }
      case None => value.asArray.foreach { values => values.zipWithIndex.foreach { case (nested, index) =>
        check(nested, changed => root(Json.fromValues(values.updated(index, changed))))
      } }
    }
    check(fixture, identity)
  }
  test("numeric coercion overflow and nonpositive durations reject without narrowing") {
    List(Json.fromString("1"), Json.fromDoubleOrNull(1.5), Json.fromLong(Int.MaxValue.toLong + 1L)).foreach(value => reject(set(List("http", "maxConnections"), value)))
    reject(set(List("runner", "pollEveryMs"), Json.fromInt(0)))
    reject(set(List("runner", "renewEveryMs"), Json.fromLong(Long.MaxValue)))
    reject(set(List("database", "limits", "socketTimeoutMs"), Json.fromLong(3600001L)))
    reject(set(List("curation", "guards", "maxInputBytes"), Json.fromInt(-1)))
  }
  test("tagged storage nullable options and referenced paths do not fall back") {
    reject(set(List("projection", "storage"), Json.obj("Native" -> Json.obj("path" -> Json.fromString("relative")))))
    reject(set(List("projection", "storage"), Json.obj("Memory" -> Json.obj(), "Native" -> Json.obj("path" -> Json.fromString("/tmp/x")))))
    reject(set(List("projection", "storage"), Json.obj("Unknown" -> Json.obj())))
    reject(set(List("cursorKeyFile"), Json.fromString("relative")))
    reject(set(List("http", "webRoot"), Json.fromBoolean(false)))
    reject(set(List("curator", "reasoningEffort"), Json.fromInt(1)))
  }
  test("transport grants and runtime ownership bounds are validated structurally") {
    reject(set(List("http", "listenHost"), Json.fromString("0.0.0.0")))
    reject(set(List("http", "listenPort"), Json.fromInt(0)))
    reject(set(List("http", "listenPort"), Json.fromInt(19091)))
    reject(set(List("runner", "renewEveryMs"), Json.fromInt(10000)))
    reject(set(List("cycle", "scanLimit"), Json.fromInt(5)))
    reject(set(List("projection", "scopes"), Json.arr()))
    reject(set(List("curation", "principal", "capabilities"), Json.arr(Json.fromString("Read"))))
    reject(set(List("serviceActor", "kind"), Json.fromString("Agent")))
    reject(set(List("curation", "scopes"), Json.arr(Json.fromString("fixture"), Json.fromString("fixture"))))
    val credentials = fixture.hcursor.downField("auth").get[List[Json]]("credentials").toOption.get
    val readonly = credentials.head.mapObject(_.add("scopes", Json.arr(Json.fromString("read-only-empty"))).add("capabilities", Json.arr(Json.fromString("Read"))))
    assert(Config.decode(set(List("auth", "credentials"), Json.fromValues(readonly :: credentials.tail))).auth.credentials.head.scopes.contains("read-only-empty"))
    reject(set(List("auth", "credentials"), Json.fromValues(credentials.head.mapObject(_.add("scopes", Json.arr(Json.fromString("unmaintained")))) :: credentials.tail)))
  }
  test("raw duplicate keys malformed UTF8 and oversized input are rejected and not echoed") {
    val duplicate = fixture.noSpaces.dropRight(1) + ",\"cursorKeyFile\":\"/synthetic/duplicate\"}"
    assertEquals(intercept[Fault](Config.decode(duplicate.getBytes(UTF_8))).code, "config")
    assertEquals(intercept[Fault](Config.decode(Array(0xc3.toByte, 0x28.toByte))).code, "config")
    assertEquals(intercept[Fault](Config.decode(Array.fill[Byte](2 * 1024 * 1024)(32))).code, "config")
    val marker = "PRIVATE-MARKER-DO-NOT-ECHO"
    val error = intercept[Fault](Config.decode(set(List("curator", "operationUrl"), Json.fromString("https://example.test/path?token=" + marker))))
    assert(!error.getMessage.contains(marker))
  }
  test("configured claim labels fit the retained curation label limit") {
    reject(set(List("curator", "profileId"), Json.fromString("x" * 257)))
    reject(set(List("curation", "guards", "maxLabelChars"), Json.fromInt(6)))
    reject(set(List("curation", "guards", "maxLabelChars"), Json.fromInt(16)))
  }
  test("configured cycle limits cannot request the repository's forbidden maximum") {
    val recovery = replace(set(List("curation", "maxRecoveryAttempts"), Json.fromInt(Int.MaxValue)), List("cycle", "recoveryLimit"), Json.fromInt(Int.MaxValue))
    val scan = replace(set(List("curation", "maxScanScopes"), Json.fromInt(Int.MaxValue)), List("cycle", "scanLimit"), Json.fromInt(Int.MaxValue))
    reject(recovery)
    reject(scan)
  }
  test("explicit default-port origins are rejected before browser transport disagrees") {
    reject(replace(set(List("auth", "publicOrigin"), Json.fromString("http://127.0.0.1:80")), List("http", "listenPort"), Json.fromInt(80)))
    reject(replace(set(List("auth", "publicOrigin"), Json.fromString("https://ontology.example:443")), List("auth", "loopbackDevelopment"), Json.False))
    assertEquals(Config.decode(replace(set(List("auth", "publicOrigin"), Json.fromString("http://127.0.0.1")), List("http", "listenPort"), Json.fromInt(80))).auth.publicOrigin, "http://127.0.0.1")
  }

  for (origin <- List("http://127.0.0.1:019090", "https://ONTOLOGY.example", "https://[0:0:0:0:0:0:0:1]", "https://127.1"))
    test(s"noncanonical browser origin is rejected: $origin") {
      reject(replace(set(List("auth", "publicOrigin"), Json.fromString(origin)), List("auth", "loopbackDevelopment"), Json.fromBoolean(origin.startsWith("http:"))))
    }

  test("canonical DNS IPv4 and compressed IPv6 origins remain accepted") {
    List("https://ontology.example", "https://127.0.0.1", "https://[::1]", "https://[2001:db8::1]", "https://[::ffff:c000:280]").foreach { origin =>
      assertEquals(Config.decode(replace(set(List("auth", "publicOrigin"), Json.fromString(origin)), List("auth", "loopbackDevelopment"), Json.False)).auth.publicOrigin, origin)
    }
    val ipv6 = replace(replace(set(List("auth", "publicOrigin"), Json.fromString("http://[::1]:19090")), List("http", "listenHost"), Json.fromString("::1")), List("auth", "loopbackDevelopment"), Json.True)
    assertEquals(Config.decode(ipv6).auth.publicOrigin, "http://[::1]:19090")
  }

  test("loading a native configuration does not create its storage directory") {
    val directory = Files.createTempDirectory("ontology-config-test-")
    val path = directory.resolve("config.json")
    val storage = directory.resolve("not-created")
    val value = set(List("projection", "storage"), Json.obj("Native" -> Json.obj("path" -> Json.fromString(storage.toString))))
    try {
      Files.writeString(path, value.noSpaces)
      assertEquals(Config.load(path).projection.storage, RdfStorage.Native(storage))
      assert(!Files.exists(storage))
    } finally {
      Files.deleteIfExists(path)
      Files.deleteIfExists(directory)
    }
  }
}
