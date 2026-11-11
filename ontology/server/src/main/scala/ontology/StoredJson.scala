package ontology

import baboon.runtime.shared.BaboonJsonCodec
import ontology.domain.{Fault, Require}

/** Application-produced canonical records are not HTTP request envelopes. */
object StoredJson {
  def encode[A](codec: BaboonJsonCodec[A], value: A): String = Wire.encode(codec, value).noSpaces
  def decode[A](codec: BaboonJsonCodec[A], text: String): A = {
    val json = io.circe.parser.parse(text).fold(_ => throw Fault("corrupt", "invalid stored JSON"), identity)
    val value = try Wire.decode(codec, json) catch { case _: Fault => throw Fault("corrupt", "invalid stored record") }
    Require(encode(codec, value) == text, "corrupt", "stored record is not canonical")
    value
  }
}
