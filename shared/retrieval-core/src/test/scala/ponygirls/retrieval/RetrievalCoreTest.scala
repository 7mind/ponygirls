package ponygirls.retrieval

class RetrievalCoreTest extends munit.FunSuite {
  private val space=EmbeddingSpace("a"*64,"synthetic","immutable-v1",3,false,"query:","document:","cosine")
  test("BA: durable space identity binds all semantic fields, excludes credentials") {
    space.validate()
    val changes=List(space.copy(endpointIdentity="b"*64),space.copy(model="other"),space.copy(revision="v2"),space.copy(dimensions=4),space.copy(sendDimensions=true),space.copy(queryPrefix=""),space.copy(documentPrefix=""),space.copy(normalization="other"))
    changes.foreach(s => assertNotEquals(s.id,space.id))
    assertEquals(space.id,RetrievalChecks.hash(space.json.noSpaces))
  }
  test("BA: vectors reject malformed dimensions, float overflow/underflow, non-finite, zero") {
    List(List(1.0,0.0),List(Double.NaN,0.0,1.0),List(Double.PositiveInfinity,0.0,1.0),List(1e100,0.0,0.0),List(1e-200,0.0,0.0),List(0.0,0.0,0.0)).foreach(v => intercept[RetrievalError](Vectors.validate(v,3)))
    assertEquals(Vectors.sql(List(1.0,0.0,0.0),3),"[1.0,0.0,0.0]")
    assertEqualsDouble(Vectors.cosineDistance(List(1.0,0.0,0.0),List(0.0,1.0,0.0)),1.0,1e-12)
    intercept[RetrievalError](Vectors.dimensions(4001))
  }
  test("BA: RRF k60 deterministic ties and entity best chunk grouping") {
    val c=List(Fusion.Candidate("b","one",2,0.2),Fusion.Candidate("a","one",2,0.2),Fusion.Candidate("z","two",0,0.0))
    val result=Fusion.rank(c,RetrievalMode.Hybrid)
    assertEquals(result.map(_.candidate.id),List("a","z"))
    assertEqualsDouble(result.head.score,1.0/61+1.0/62,1e-12)
    assertEquals(Fusion.rank(c.reverse,RetrievalMode.Hybrid),result)
  }
  test("BA: identifier-only SQL API cannot inject predicates") {
    assert(CandidateSql.annDistance(3,"ch.embedding").contains("halfvec(3)"))
    intercept[RetrievalError](CandidateSql.annDistance(3,"embedding) OR true --"))
    intercept[RetrievalError](AttributeKey.parse("name' OR true"))
  }
  test("BA: exact binary64 expiry never rounds to microsecond") {
    val x=1000.0000001
    val seconds=EpochSeconds.fromDouble(x)
    assertEquals(seconds.value.bigDecimal,new java.math.BigDecimal(x))
    assertNotEquals(seconds.value,BigDecimal(1000))
  }
}
