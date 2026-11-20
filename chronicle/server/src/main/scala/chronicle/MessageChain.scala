package chronicle

import chronicle.api.Message
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest

/** Message chain v1 (append-only ingest spec §5) over a revision's stored messages in position order, computed alike by
  * the server and the collector; golden vectors in chronicle/tests/message-chain-v1.json. With field(s) = u32be(UTF-8
  * length) ‖ UTF-8 bytes and opt = 0x00 or 0x01 ‖ field(s):
  * message(m) = SHA-256("chronicle.message.v1" ‖ 0x00 ‖ field(id) ‖ opt(parentId) ‖ field(role) ‖ field(stored text)
  * ‖ opt(timestamp) ‖ i32be(recordIndex)), initial = SHA-256("chronicle.message-chain.v1"),
  * next = SHA-256(chain ‖ message(m)). The stored text is `SnapshotProjection.text`, so a text with U+0000 and its
  * stored form chain alike. */
object MessageChain {
  val bytes=32
  private val messageDomain="chronicle.message.v1".getBytes(UTF_8)
  def initial: Array[Byte] = MessageDigest.getInstance("SHA-256").digest("chronicle.message-chain.v1".getBytes(UTF_8))
  def message(m: Message): Array[Byte] = message(MessageDigest.getInstance("SHA-256"),m)
  def extend(chain: Array[Byte],messages: IterableOnce[Message]): Array[Byte] = {
    Check(chain.length==bytes,"internal","invalid message chain")
    val (link,item)=(MessageDigest.getInstance("SHA-256"),MessageDigest.getInstance("SHA-256"))
    messages.iterator.foldLeft(chain) { (previous,m) => link.update(previous); link.digest(message(item,m)) }
  }
  private def message(digest: MessageDigest,m: Message): Array[Byte] = {
    def field(value: String): Unit = { val utf8=value.getBytes(UTF_8); digest.update(ByteBuffer.allocate(4).putInt(utf8.length).array()); digest.update(utf8) }
    def optional(value: Option[String]): Unit = value.fold(digest.update(0.toByte)) { present => digest.update(1.toByte); field(present) }
    digest.update(messageDomain); digest.update(0.toByte)
    field(m.id); optional(m.parentId); field(m.role); field(SnapshotProjection.text(m.text)); optional(m.timestamp)
    digest.digest(ByteBuffer.allocate(4).putInt(m.recordIndex).array())
  }
}
