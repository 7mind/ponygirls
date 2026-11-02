package ponygirls.losslessjson

import java.nio.charset.StandardCharsets.UTF_8
import LosslessJson.*

// Behavioral-Active / Blackbox-Atomic, specified-origin. No external adapters:
// the boundary is pure, so the dual-tests external-system pattern is unnecessary.
class LosslessJsonTest extends munit.FunSuite {
  private def read(raw: String): Value = read(raw, StandardLimits)
  private def read(raw: String, limits: Limits): Value =
    parse(raw, limits).fold(e => fail(e.toString), identity)
  private def number(raw: String): Number = read(raw).asInstanceOf[Number]
  private def reject(raw: String, code: String): Unit = reject(raw, code, StandardLimits)
  private def reject(raw: String, code: String, limits: Limits): Unit =
    assertEquals(parse(raw, limits).left.toOption.map(_.code), Some(code), raw)

  test("all JSON kinds, full values and huge integer lexemes survive") {
    val raw = """{"z":null,"a":[true,false,"café 🐎",9007199254740993,0.10,1E+002,-0]}"""
    val value = read(raw).asInstanceOf[Obj]
    assertEquals(encode(value), """{"a":[true,false,"café 🐎",9007199254740993,0.10,1E+002,-0],"z":null}""")
    assertEquals(value.fields.toMap.apply("a").asInstanceOf[Arr].values.size, 7)
    assertEquals(number("-0").lexeme, "-0")
    assertEquals(read("true").asInstanceOf[Bool].value, true)
    assertEquals(read("null"), Null)
  }

  test("ordering is explicit UTF-16 lexical ordering, never JS property enumeration") {
    val raw = """{"2":2,"10":10,"__proto__":null,"constructor":{"prototype":-0},"a":1}"""
    assertEquals(encode(read(raw)), """{"10":10,"2":2,"__proto__":null,"a":1,"constructor":{"prototype":-0}}""")
    assertEquals(encode(read("{\"\ue000\":1,\"🐎\":2}")), "{\"🐎\":2,\"\ue000\":1}")
  }

  test("determinism ignores whitespace/key order but intentionally retains number spelling") {
    val a = read(""" { "b": [0.10], "a": null } """)
    val b = read("""{"a":null,"b":[0.10]}""")
    assertEquals(encode(a), encode(b))
    assertEquals(sha256(a), sha256(b))
    assertNotEquals(sha256(a), sha256(read("""{"a":null,"b":[0.1]}""")))
    val expected = java.security.MessageDigest.getInstance("SHA-256")
      .digest((EncodingVersion + "\n" + encode(a)).getBytes(UTF_8)).map(b => f"${b & 255}%02x").mkString
    assertEquals(sha256(a), expected)
    assertEquals(sha256(a), "82f5e82cb6f83d648a5580b5fca7e660d69a9b226ebcb4fcb6397abd1be26ebb")
  }

  test("duplicate keys are rejected after escape decoding, at any depth") {
    List("""{"x":1,"x":2}""", """{"a":[{"x":1,"\u0078":2}]}""",
      """{"__proto__":0,"__proto__":1}""", """{"🐎":1,"\ud83d\udc0e":2}""").foreach(reject(_, "duplicate-key"))
    assertEquals(encode(read("""{"x":1,"a":{"x":2}}""")), """{"a":{"x":2},"x":1}""")
  }

  test("strict syntax, JSON whitespace and number grammar") {
    List("", " ", "nope", "NaN", "Infinity", "+1", "01", "-01", ".1", "1.", "1e", "1e+",
      "[1,]", "{\"a\":1,}", "{a:1}", "[", "{", "\"unterminated", "true false", "nullx",
      "[1 2]", "{\"a\" 1}", "{\"a\":}", "\ufeffnull", "\u00a0null", "\"\\q\"", "\"\\uZZZZ\"")
      .foreach(reject(_, "syntax"))
    assertEquals(encode(read("\r\n\t [ -12.34e-05 , true ] \n")), "[-12.34e-05,true]")
  }

  test("escapes and astral Unicode round trip without normalization") {
    val raw = "\"\\\"\\\\\\/\\b\\f\\n\\r\\t\\u0001\\u001f\\uD83D\\uDC0E e\\u0301\""
    val result = encode(read(raw))
    assertEquals(result, "\"\\\"\\\\/\\b\\f\\n\\r\\t\\u0001\\u001f🐎 é\"")
    assertEquals(encode(read(result)), result)
    assertNotEquals(encode(read("\"é\"")), encode(read("\"é\"")))
  }

  test("NUL forbidden in decoded strings and keys, raw controls forbidden") {
    List("\"\\u0000\"", "{\"\\u0000\":1}").foreach(reject(_, "unicode"))
    List("\"a\n\"", "\"\u0000\"", "\"\u001f\"").foreach(reject(_, "syntax"))
  }

  test("unpaired surrogates forbidden, paired escaped/raw astral accepted") {
    List("\"\\ud800\"", "\"\\udc00\"", "\"\\ud800a\"", "\"\\ud800\\ud800\"",
      "{\"\\udc00\":1}", "\"" + '\ud800' + "\"", "\"" + '\udc00' + "\"")
      .foreach(reject(_, "unicode"))
    assertEquals(encode(read("\"\\ud83d\\udc0e\"")), "\"🐎\"")
  }

  test("strict UTF-8 rejects malformed, overlong and encoded surrogate sequences") {
    List(Array(0xc0, 0x80), Array(0xed, 0xa0, 0x80), Array(0xf4, 0x90, 0x80, 0x80), Array(0xe2, 0x82))
      .foreach(bytes => assertEquals(parseUtf8(bytes.map(_.toByte), StandardLimits).left.toOption.map(_.code), Some("unicode")))
    val raw = "\"🐎 café\""
    assertEquals(encode(parseUtf8(raw.getBytes(UTF_8), StandardLimits).toOption.get), raw)
  }

  test("byte bound is UTF-8 bytes inclusive, including whitespace and escaped source") {
    val small = StandardLimits.copy(maxBytes = 6)
    assertEquals(encode(read("\"🐎\"", small)), "\"🐎\"")
    reject(" \"🐎\"", "byte-limit", small)
    reject("\"\\u0061\"", "byte-limit", small)
    assertEquals(parseUtf8(" \"🐎\"".getBytes(UTF_8), small).left.toOption.map(_.code), Some("byte-limit"))
  }

  test("depth counts containers, including empty ones; rejects before deep recursion") {
    val small = StandardLimits.copy(maxDepth = 2)
    assertEquals(encode(read("[[0]]", small)), "[[0]]")
    assertEquals(encode(read("[{}]", small)), "[{}]")
    reject("[[[]]]", "depth-limit", small)
    reject("{\"a\":{\"b\":{}}}", "depth-limit", small)
    val deepest = "[" * 128 + "0" + "]" * 128
    assertEquals(encode(read(deepest, StandardLimits.copy(maxDepth = 128))), deepest)
    reject("[" * 10000 + "0" + "]" * 10000, "depth-limit")
    assertEquals(encode(read("0", StandardLimits.copy(maxDepth = 0))), "0")
    reject("[]", "depth-limit", StandardLimits.copy(maxDepth = 0))
  }

  test("number token and exponent bounds are inclusive, no rounding or exponent expansion") {
    val small = StandardLimits.copy(maxNumberChars = 4, maxExponentAbs = 12)
    assertEquals(encode(read("9999", small)), "9999")
    read("1e12", small); read("1e-9", small)
    reject("12345", "number-limit", small)
    reject("1e13", "exponent-limit", small)
    reject("1e-13", "number-limit", small)
    read("1e-12", StandardLimits.copy(maxExponentAbs = 12))
    reject("1e-13", "exponent-limit", StandardLimits.copy(maxExponentAbs = 12))
    reject("1e999999999999999999999999", "exponent-limit")
    reject("1e1000000", "exponent-limit")
    val huge = "9" * 4096
    assertEquals(encode(read(huge)), huge)
    reject(huge + "9", "number-limit")
    assertEquals(number("1e999999").compare(number("9e999998")), 1)
  }

  test("large coefficients compare by digits without precision loss") {
    val a = "9" * 4096
    val b = "9" * 4095 + "8"
    assertEquals(number(a).compare(number(b)), 1)
    assertEquals(number("-" + "9" * 4095).compare(number("-" + "9" * 4094 + "8")), -1)
    assertEquals(number("1." + "0" * 3000 + "1").compare(number("1")), 1)
    assertEquals(number("1e+000001").compare(number("10.000")), 0)
    read("1e0000000000", StandardLimits.copy(maxExponentAbs = 0))
    reject("1e1", "exponent-limit", StandardLimits.copy(maxExponentAbs = 0))
  }

  test("empty values and every allowed control escape are stable on reparse") {
    val raw = """{"":[],"empty":{},"string":""}"""
    assertEquals(encode(read(raw)), raw)
    val controls = (1).until(32).map(i => f"\\u$i%04x").mkString
    val encoded = encode(read("\"" + controls + "\""))
    assertEquals(encode(read(encoded)), encoded)
    assertEquals(read(encoded).asInstanceOf[Str].value, (1).until(32).map(_.toChar).mkString)
    val keys = """{"é":1,"e\u0301":2}"""
    assertEquals(read(keys).asInstanceOf[Obj].fields.size, 2)
  }

  test("limit configuration cannot remove safety bounds") {
    intercept[IllegalArgumentException](StandardLimits.copy(maxDepth = 129))
    intercept[IllegalArgumentException](StandardLimits.copy(maxBytes = 0))
    intercept[IllegalArgumentException](StandardLimits.copy(maxNumberChars = 0))
    intercept[IllegalArgumentException](StandardLimits.copy(maxExponentAbs = -1))
  }

  test("configured lower and upper ceilings are operational") {
    read("0", StandardLimits.copy(maxBytes = 1, maxNumberChars = 1, maxDepth = 0, maxExponentAbs = 0))
    reject("-0", "number-limit", StandardLimits.copy(maxNumberChars = 1))
    val largest = StandardLimits.copy(maxBytes = 16 * 1024 * 1024, maxNumberChars = 65536)
    val coefficient = "9" * 65536
    assertEquals(encode(read(coefficient, largest)), coefficient)
    reject(coefficient + "9", "number-limit", largest)
    val fullInput = " " * (largest.maxBytes - 1) + "0"
    assertEquals(encode(read(fullInput, largest)), "0")
    reject(fullInput + " ", "byte-limit", largest)
    intercept[IllegalArgumentException](StandardLimits.copy(maxBytes = 16777217))
    intercept[IllegalArgumentException](StandardLimits.copy(maxDepth = -1))
    intercept[IllegalArgumentException](StandardLimits.copy(maxNumberChars = 65537))
    intercept[IllegalArgumentException](StandardLimits.copy(maxExponentAbs = 1000000))
  }

  test("seeded fractional spellings match exact decimal oracle and transitivity") {
    val random = new java.util.Random(483129L)
    val tokens = Vector.fill(240) {
      val sign = if (random.nextBoolean()) "-" else ""
      val integer = random.nextInt(1000).toString
      val fraction = "0" * random.nextInt(12) + random.nextInt(1000000).toString + "0" * random.nextInt(8)
      val exponent = random.nextInt(101) - 50
      s"$sign$integer.$fraction${if (random.nextBoolean()) "E" else "e"}${if (exponent >= 0) "+" else ""}$exponent"
    }
    val values = tokens.map(number)
    val exact = tokens.map(new java.math.BigDecimal(_))
    for (a <- values.indices; b <- values.indices) {
      assertEquals(values(a).compare(values(b)), exact(a).compareTo(exact(b)), s"${tokens(a)} / ${tokens(b)}")
    }
    val sorted = values.sorted
    for (i <- (0).until(sorted.size - 2)) {
      assert(sorted(i).compare(sorted(i + 1)) <= 0)
      assert(sorted(i + 1).compare(sorted(i + 2)) <= 0)
      assert(sorted(i).compare(sorted(i + 2)) <= 0)
    }
  }

  val comparisons = List(
    ("1", "2", -1), ("2", "2", 0), ("9007199254740993", "9007199254740992", 1),
    ("0.1", "0.10", 0), ("1e2", "100", 0), ("-0", "0", 0), ("-0.000e-999999", "0", 0),
    ("-5", "-4", -1), ("1.5", "1.25", 1), ("0.1", "0.2", -1),
    ("123456789012345678901234567890", "123456789012345678901234567891", -1),
    ("-1e999999", "-9e999998", -1), ("1e-999999", "0", 1),
    ("0.000000000000000000000000000001", "1e-30", 0), ("10000e-4", "1.000", 0),
    ("0.0012", "0.00119", 1), ("-0", "-1e-999999", 1))
  comparisons.foreach { case (a, b, want) =>
    test(s"exact numeric comparison $a / $b") {
      assertEquals(number(a).compare(number(b)), want)
      assertEquals(number(b).compare(number(a)), -want)
    }
  }

  test("exact comparison agrees with decimal arithmetic across bounded synthetic inputs") {
    val tokens = for (n <- (-20).to(20); e <- (-3).to(3)) yield s"${n}e${e}"
    for (a <- tokens; b <- tokens) {
      assertEquals(number(a).compare(number(b)), new java.math.BigDecimal(a).compareTo(new java.math.BigDecimal(b)), s"$a / $b")
    }
  }
}
