package chronicle

import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8

final class JsonUtf8SizeTest extends munit.FunSuite {
  test("BA specified: source byte accounting matches the actual complete Circe JSON encoding") {
    val strings=List("","plain","\"\\/\b\f\n\r\t",(0 to 31).map(_.toChar).mkString,"\u007f\u0080\u07ff\u0800\u2028\u2029\uffff","é🙂e\u0301","x"*50000)
    val random=new scala.util.Random(0L)
    val generated=(0 until 500).map { _ =>
      (0 until 32).map { _ =>
        val scalar=random.nextInt(Character.MAX_CODE_POINT+1)
        new String(Character.toChars(if(scalar>=0xd800 && scalar<=0xdfff) 'x'.toInt else scalar))
      }.mkString
    }
    (strings++generated).foreach { text =>
      val value=Json.obj(text->Json.arr(Json.fromString(text),Json.True,Json.False,Json.Null,Json.fromLong(Long.MinValue),Json.fromDoubleOrNull(-0.5)),"empty"->Json.arr(),"object"->Json.obj())
      assertEquals(JsonUtf8Size.string(text),Json.fromString(text).noSpaces.getBytes(UTF_8).length.toLong)
      assertEquals(JsonUtf8Size(value),value.noSpaces.getBytes(UTF_8).length.toLong)
    }
  }
  test("BA specified: all one-byte-range scalars use the printer's exact escape policy") {
    val mismatches=(0 to 255).filter { code =>
      val text=code.toChar.toString
      JsonUtf8Size.string(text)!=Json.fromString(text).noSpaces.getBytes(UTF_8).length.toLong
    }.map(code => f"U+$code%04X").toList
    assertEquals(mismatches,List.empty[String])
  }
  test("BA specified: a source scalar cannot be approximated by a replacement character") {
    List("\ud800","\udc00","a\ud800z").foreach { text =>
      assertEquals(intercept[DomainError](JsonUtf8Size.string(text)).code,"read-budget")
    }
  }
}
