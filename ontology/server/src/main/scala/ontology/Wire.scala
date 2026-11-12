package ontology

import baboon.runtime.shared.{BaboonCodecContext, BaboonJsonCodec}
import io.circe.Json
import ontology.domain.{Fault, Require}
import ponygirls.losslessjson.LosslessJson

object Wire {
  val versions: api.VersionInfo = api.VersionInfo("0.1.0", "0.1.0", List("0.1.0"))
  val MaxBodyBytes: Int = 4 * 1024 * 1024
  private val limits = LosslessJson.Limits(MaxBodyBytes, 96, 4096, 999999)
  def parse(bytes: Array[Byte]): Json = {
    val tree = LosslessJson.parseUtf8(bytes, limits).fold(_ => throw Fault("bad-envelope", "invalid JSON envelope"), identity)
    io.circe.parser.parse(LosslessJson.encode(tree)).fold(_ => throw Fault("bad-envelope", "invalid JSON envelope"), identity)
  }
  def encode[A](codec: BaboonJsonCodec[A], value: A): Json = codec.encode(BaboonCodecContext.Default, value)
  def decode[A](codec: BaboonJsonCodec[A], json: Json): A = {
    WireSchemas.validate(codec, json)
    val value = codec.decode(BaboonCodecContext.Default, json).fold(_ => throw Fault("bad-envelope", "invalid typed payload"), identity)
    requireShape(json, encode(codec, value))
    value
  }
  // Generated codecs intentionally allow additive fields. The service's current
  // mutation contract instead requires exact recursive field membership.
  private def requireShape(input: Json, encoded: Json): Unit = {
    if (encoded.isObject) {
      val expected = encoded.asObject.get
      val actual = input.asObject.getOrElse(throw Fault("bad-envelope", "object required"))
      Require(actual.keys.toSet == expected.keys.toSet, "bad-envelope", "unknown or missing fields")
      expected.toIterable.foreach { case (key, value) => requireShape(actual(key).get, value) }
    } else if (encoded.isArray) {
      val expected = encoded.asArray.get
      val actual = input.asArray.getOrElse(throw Fault("bad-envelope", "array required"))
      Require(actual.size == expected.size, "bad-envelope", "array structure changed during decoding")
      actual.zip(expected).foreach { case (a, b) => requireShape(a, b) }
    } else if (encoded.isNull) Require(input.isNull, "bad-envelope", "null required")
  }
}
