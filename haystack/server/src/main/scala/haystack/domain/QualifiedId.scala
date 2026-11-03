package haystack.domain

import java.nio.ByteBuffer
import java.nio.charset.{CharacterCodingException, CodingErrorAction, StandardCharsets}

/** The single qualified-ID codec: exactly one decode; no normalization or path interpretation. */
object QualifiedId {
  val MaxComponentChars = 256 // UTF-16 units, matching the existing client contract.
  val MaxComponentBytes = 1024
  private val Hex = "0123456789ABCDEF"
  private def invalid(message: String): Nothing = throw Fault("invalid-id", message)
  private def unreserved(c: Int): Boolean =
    c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' ||
      c == '-' || c == '.' || c == '_' || c == '~'

  def encodeComponent(component: String): String = {
    if (component.isEmpty || component.length > MaxComponentChars) invalid("invalid id component length")
    var i = 0
    while (i < component.length) {
      val c = component.charAt(i)
      if (c == 0) invalid("NUL in id component")
      if (Character.isHighSurrogate(c)) {
        if (i + 1 >= component.length || !Character.isLowSurrogate(component.charAt(i + 1)))
          invalid("invalid Unicode in id component")
        i += 2
      } else if (Character.isLowSurrogate(c)) invalid("invalid Unicode in id component")
      else i += 1
    }
    val bytes = component.getBytes(StandardCharsets.UTF_8)
    if (bytes.length > MaxComponentBytes) invalid("id component exceeds UTF-8 byte limit")
    val out = new java.lang.StringBuilder
    bytes.foreach { b =>
      val n = b & 255
      if (unreserved(n)) out.append(n.toChar)
      else { out.append('%'); out.append(Hex.charAt(n >>> 4)); out.append(Hex.charAt(n & 15)) }
    }
    out.toString
  }

  def decodeComponent(encoded: String): String = {
    if (encoded.isEmpty || encoded.length > MaxComponentBytes * 3) invalid("invalid encoded id length")
    val bytes = new java.io.ByteArrayOutputStream
    var i = 0
    while (i < encoded.length) {
      val c = encoded.charAt(i)
      if (c == '%') {
        if (i + 2 >= encoded.length) invalid("truncated id escape")
        val hi = Hex.indexOf(encoded.charAt(i + 1))
        val lo = Hex.indexOf(encoded.charAt(i + 2))
        if (hi < 0 || lo < 0) invalid("noncanonical id escape")
        val n = hi * 16 + lo
        if (unreserved(n)) invalid("escaped unreserved character")
        bytes.write(n)
        i += 3
      } else {
        if (!unreserved(c.toInt)) invalid("invalid literal id character")
        bytes.write(c.toInt)
        i += 1
      }
    }
    val decoder = StandardCharsets.UTF_8.newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
    val decoded = try decoder.decode(ByteBuffer.wrap(bytes.toByteArray)).toString
      catch { case _: CharacterCodingException => invalid("invalid UTF-8 in id") }
    if (encodeComponent(decoded) != encoded) invalid("noncanonical id")
    decoded
  }

  def encodeKey(key: ItemKey): String = encodeComponent(key.project) + ":" + encodeComponent(key.item)
  def decodeKey(qualified: String): ItemKey = {
    val colon = qualified.indexOf(':')
    if (colon < 0 || qualified.indexOf(':', colon + 1) >= 0) invalid("qualified id requires exactly one colon")
    ItemKey(decodeComponent(qualified.substring(0, colon)), decodeComponent(qualified.substring(colon + 1)))
  }
}
