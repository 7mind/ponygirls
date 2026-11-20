package chronicle

import chronicle.api.Message
import io.circe.Decoder
import java.nio.file.{Files,Path}
import java.util.HexFormat

final class MessageChainTest extends munit.FunSuite {
  private val hex=HexFormat.of()
  private final case class Golden(name: String,messages: List[Message],messageDigests: List[String],chains: List[String])
  private given Decoder[Message] = Decoder.forProduct6("id","parentId","role","text","timestamp","recordIndex")(Message.apply)
  private given Decoder[Golden] = Decoder.forProduct4("name","messages","messageDigests","chains")(Golden.apply)

  test("chain v1 equals the golden vectors shared with the collector") {
    val vectors=io.circe.parser.parse(Files.readString(Path.of("tests","message-chain-v1.json"))).toTry.get.hcursor
    assertEquals(hex.formatHex(MessageChain.initial),vectors.get[String]("initial").toTry.get)
    val cases=vectors.get[List[Golden]]("cases").toTry.get
    assert(cases.nonEmpty)
    cases.foreach { golden =>
      assertEquals(golden.messages.map(m => hex.formatHex(MessageChain.message(m))),golden.messageDigests,golden.name)
      val chains=golden.messages.scanLeft(MessageChain.initial)((chain,m) => MessageChain.extend(chain,List(m))).tail
      assertEquals(chains.map(hex.formatHex),golden.chains,golden.name)
      assertEquals(hex.formatHex(MessageChain.extend(MessageChain.initial,golden.messages)),golden.chains.last,golden.name)
    }
  }
}
