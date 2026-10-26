package chronicle

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import scala.concurrent.duration.*

class ProviderUsageTest extends munit.FunSuite {
  private def parse(text: String,purpose: ModelWorkload): ProviderUsage = ProviderUsage.parse(io.circe.parser.parse(text).fold(error => throw error,identity),purpose)
  private def annotation(text: String): ProviderUsage = parse(text,ModelWorkload.IndexAnnotation)

  test("BA specified: absent and null usage are unknown, never reported zero") {
    List("{}","{\"usage\":null}","{\"usage\":{}}","{\"usage\":{\"prompt_tokens\":null,\"completion_tokens\":null,\"completion_tokens_details\":null}}").foreach { text =>
      assertEquals(annotation(text),ProviderUsage.unknown)
    }
  }
  test("BA specified: zero and integral decimal/exponent numbers are explicitly reported") {
    List("0","0.0","0e1000000","12.000","1.2e1","1200e-2","12e+0").zip(List(0L,0L,0L,12L,12L,12L,12L)).foreach { case (number,expected) =>
      val usage=annotation(s"""{"usage":{"prompt_tokens":$number,"completion_tokens":0,"completion_tokens_details":{"reasoning_tokens":0}}}""")
      assertEquals(usage.input,Some(expected)); assertEquals(usage.output,Some(0L)); assertEquals(usage.reasoningSubset,Some(0L)); assertEquals(usage.invalid,false)
    }
  }
  test("BA specified: malformed, negative, fractional and overflowing counters remain unknown") {
    val numbers=List("-1","-0","1.5","1e-1","9223372036854775808","9.223372036854775808e18","1e1000000","1e-1000000","\"12\"","true","[]","{}")
    numbers.foreach { number =>
      val usage=annotation(s"""{"usage":{"prompt_tokens":$number,"completion_tokens":7,"completion_tokens_details":{"reasoning_tokens":2}}}""")
      assertEquals(usage.input,None,number); assertEquals(usage.output,Some(7L),number); assertEquals(usage.reasoningSubset,Some(2L),number); assertEquals(usage.invalid,true,number)
    }
  }
  test("BA specified: malformed usage containers and reasoning details are observable") {
    List("[]","true","\"usage\"","7").foreach { value =>
      val usage=annotation(s"{\"usage\":$value}")
      assertEquals(usage.input,None); assertEquals(usage.output,None); assertEquals(usage.reasoningSubset,None); assertEquals(usage.invalid,true)
    }
    List("[]","true","\"details\"","7").foreach { value =>
      val usage=annotation(s"""{"usage":{"prompt_tokens":8,"completion_tokens":7,"completion_tokens_details":$value}}""")
      assertEquals(usage.input,Some(8L)); assertEquals(usage.output,Some(7L)); assertEquals(usage.reasoningSubset,None); assertEquals(usage.invalid,true)
    }
  }
  test("BA specified: independently reported components survive missing or malformed siblings") {
    val inputOnly=annotation("""{"usage":{"prompt_tokens":5,"total_tokens":8}}""")
    assertEquals(inputOnly.input,Some(5L)); assertEquals(inputOnly.output,None); assertEquals(inputOnly.reasoningSubset,None); assertEquals(inputOnly.invalid,false)
    val outputOnly=annotation("""{"usage":{"completion_tokens":7,"completion_tokens_details":{"reasoning_tokens":2}}}""")
    assertEquals(outputOnly.input,None); assertEquals(outputOnly.output,Some(7L)); assertEquals(outputOnly.reasoningSubset,Some(2L)); assertEquals(outputOnly.invalid,false)
    val malformedOutput=annotation("""{"usage":{"prompt_tokens":5,"completion_tokens":-1,"completion_tokens_details":{"reasoning_tokens":2}}}""")
    assertEquals(malformedOutput.input,Some(5L)); assertEquals(malformedOutput.output,None); assertEquals(malformedOutput.reasoningSubset,Some(2L)); assertEquals(malformedOutput.invalid,true)
    val malformedReasoning=annotation("""{"usage":{"prompt_tokens":5,"completion_tokens":7,"completion_tokens_details":{"reasoning_tokens":1.1}}}""")
    assertEquals(malformedReasoning.input,Some(5L)); assertEquals(malformedReasoning.output,Some(7L)); assertEquals(malformedReasoning.reasoningSubset,None); assertEquals(malformedReasoning.invalid,true)
  }
  test("BA specified: reasoning is a subset, not additional completion tokens") {
    val valid=annotation("""{"usage":{"prompt_tokens":11,"completion_tokens":7,"completion_tokens_details":{"reasoning_tokens":7}}}""")
    assertEquals(valid.output,Some(7L)); assertEquals(valid.reasoningSubset,Some(7L)); assertEquals(valid.invalid,false)
    val invalid=annotation("""{"usage":{"prompt_tokens":11,"completion_tokens":7,"completion_tokens_details":{"reasoning_tokens":8}}}""")
    assertEquals(invalid.input,Some(11L)); assertEquals(invalid.output,Some(7L)); assertEquals(invalid.reasoningSubset,None); assertEquals(invalid.invalid,true)
  }
  test("BA specified: embedding output and reasoning are inapplicable; input is never inferred from total") {
    List(ModelWorkload.IndexEmbedding,ModelWorkload.QueryEmbedding).foreach { purpose =>
      val usage=parse("""{"usage":{"prompt_tokens":11,"completion_tokens":-1,"completion_tokens_details":[]}}""",purpose)
      assertEquals(usage.input,Some(11L)); assertEquals(usage.output,None); assertEquals(usage.reasoningSubset,None); assertEquals(usage.invalid,false)
      val totalOnly=parse("""{"usage":{"total_tokens":11},"data":[{"embedding":[1]}]}""",purpose)
      assertEquals(totalOnly,ProviderUsage.unknown)
    }
  }
  test("BA specified: annotation and MCP test use identical usage semantics independently of choices") {
    val envelope="""{"usage":{"prompt_tokens":11,"completion_tokens":7,"completion_tokens_details":{"reasoning_tokens":2}},"choices":[{"finish_reason":"length","message":{"refusal":"synthetic","content":"invalid downstream payload"}}]}"""
    val annotationUsage=annotation(envelope)
    assertEquals(annotationUsage.input,Some(11L)); assertEquals(annotationUsage.output,Some(7L)); assertEquals(annotationUsage.reasoningSubset,Some(2L))
    assertEquals(parse(envelope,ModelWorkload.McpTest),annotationUsage)
    assertEquals(annotation("""{"usage":{"total_tokens":18},"choices":[{"message":{"content":"do not count characters"}}]}"""),ProviderUsage.unknown)
  }
  test("BA specified: counters above JavaScript's exact integer range retain Long precision") {
    List("9007199254740993"->9007199254740993L,"9223372036854775807"->Long.MaxValue,"9223372036854775807000e-3"->Long.MaxValue,"9.223372036854775807e18"->Long.MaxValue).foreach { case (number,expected) =>
      val usage=annotation(s"""{"usage":{"prompt_tokens":$number}}""")
      assertEquals(usage.input,Some(expected)); assertEquals(usage.invalid,false)
    }
  }
  test("BA specified: extreme exponents are rejected without exponent-sized allocation") {
    val exponent="9"*10000
    IO {
      List(s"1e$exponent",s"1e-$exponent","1e1000000","1.1e-1000000").foreach { number =>
        val usage=annotation(s"""{"usage":{"prompt_tokens":$number}}""")
        assertEquals(usage.input,None); assertEquals(usage.invalid,true)
      }
    }.timeout(2.seconds).unsafeRunSync()
  }
}
