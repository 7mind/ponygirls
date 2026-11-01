package chronicle

import java.sql.{Connection,DriverManager}
import scala.util.Using

class ArchiveLexicalIndexTest extends munit.FunSuite {
  private val unicode="COLLATE pg_unicode_fast"
  private def pattern(value: String): String = "%"+value.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%"
  private def database(f: Connection => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    val config=Fixtures.config(); Class.forName("org.postgresql.Driver")
    Using.resource(DriverManager.getConnection(config.jdbcUrl,config.databaseUser,Config.credential(config.databasePasswordFile))) { c =>
      c.setAutoCommit(false)
      try { Sql.exec(c,"CREATE EXTENSION IF NOT EXISTS pg_trgm"); f(c); c.rollback() }
      catch { case error: Throwable => c.rollback(); throw error }
    }
  }
  test("Effectual GoodCommunication regression: raw ILIKE GIN omits Kelvin under C locale; folded GIN agrees with original scan") { database { c =>
    Sql.exec(c,"CREATE TEMP TABLE literal_raw(value text COLLATE pg_unicode_fast)")
    Sql.exec(c,"INSERT INTO literal_raw VALUES(?)","x"*314+"K"*512+"z"*2246)
    Sql.exec(c,"CREATE INDEX literal_raw_gin ON literal_raw USING gin(value gin_trgm_ops)")
    Sql.exec(c,"SET LOCAL enable_seqscan=off")
    val p=pattern("k"*512)
    val rawSql="SELECT count(*) FROM literal_raw WHERE value ILIKE ? ESCAPE '\\'"
    val rawPlan=Sql.rows(c,"EXPLAIN "+rawSql,p)(_.getString(1)).mkString("\n")
    assert(rawPlan.contains("Bitmap Index Scan on literal_raw_gin"),rawPlan)
    assertEquals(Sql.one(c,rawSql,p)(_.getInt(1)),Some(0))
    Sql.exec(c,"SET LOCAL enable_indexscan=off"); Sql.exec(c,"SET LOCAL enable_bitmapscan=off"); Sql.exec(c,"SET LOCAL enable_seqscan=on")
    assertEquals(Sql.one(c,rawSql,p)(_.getInt(1)),Some(1))
    Sql.exec(c,"DROP INDEX literal_raw_gin")
    Sql.exec(c,"CREATE INDEX literal_folded_gin ON literal_raw USING gin((lower(value COLLATE pg_unicode_fast)) gin_trgm_ops)")
    Sql.exec(c,"SET LOCAL enable_indexscan=on"); Sql.exec(c,"SET LOCAL enable_bitmapscan=on"); Sql.exec(c,"SET LOCAL enable_seqscan=off")
    val folded=s"SELECT count(*) FROM literal_raw WHERE lower(value $unicode) LIKE lower(? $unicode) ESCAPE '\\'"
    val plan=Sql.rows(c,"EXPLAIN "+folded,p)(_.getString(1)).mkString("\n")
    assert(plan.contains("Bitmap Index Scan on literal_folded_gin"),plan)
    assertEquals(Sql.one(c,folded,p)(_.getInt(1)),Some(1))
  }}
  test("GoodCommunication specified: pinned Unicode lowercase expansion fits the literal-byte/scalar-overlap bound") { database { c =>
    val violations=Sql.one(c,"WITH scalars AS MATERIALIZED(SELECT CASE WHEN cp BETWEEN 55296 AND 57343 THEN NULL ELSE chr(cp) END AS value FROM generate_series(1,1114111) cp) SELECT count(*) FROM scalars WHERE value IS NOT NULL AND char_length(lower(value COLLATE pg_unicode_fast))>octet_length(value)")(_.getLong(1)).get
    assertEquals(violations,0L)
    val expanded=Sql.one(c,"SELECT lower(? COLLATE pg_unicode_fast)","İ"*256)(_.getString(1)).get
    assert(expanded.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>512)
    assertEquals(expanded.codePointCount(0,expanded.length),ArchiveProjection.overlapScalars)
  }}
  private lazy val literalCases: List[(String,String)] = {
    val generated=(0 to Character.MAX_CODE_POINT).iterator.filter(cp => Character.isValidCodePoint(cp) && (Character.toLowerCase(cp)!=cp || Character.toUpperCase(cp)!=cp)).zipWithIndex.filter(_._2%13==0).map { case (cp,index) =>
      val source=new String(Character.toChars(cp)); val lower=new String(Character.toChars(Character.toLowerCase(cp)))
      (s"prefix-$index-$source-needle %_\\.*😀 suffix",s"prefix-$index-$lower-needle %_\\.*😀")
    }.toList
    List(
      ("x"*3500+"K"*512+"z"*4000,"k"*512),
      ("x"*3500+"i\u0307"*256+"z"*4000,"İ"*256),
      ("aΣ"+"\u0301"*5000+"b","σ"),
      ("aΣ"+"\u0301"*5000+"b","ς"),
      ("x"*4090+"Αλφα БЕТА Needle"+"z"*5000,"αλφα бета needle"),
      ("x"*4000+"İstanbul Straße ſong Kelvin 😀 %_\\"+"z"*5000,"İstanbul Straße ſong kelvin 😀 %_\\"),
      ("x"*20000+"longwordNeedle"+"z"*20000,"LONGWORDneedle"),
      ("raw emoji 😀🚀 punctuation %_\\.*","%_\\.*"),
      ("short α letter","Α"),
      ("dot İ and plain i","i\u0307"),
      ("sharp ß and capitals SS","SS")
    )++generated
  }
  test("GoodCommunication specified: pinned Unicode whole-field lowercase is byte-idempotent before and after fragment slicing") { database { c =>
    val violations=Sql.one(c,"WITH scalars AS MATERIALIZED(SELECT CASE WHEN cp BETWEEN 55296 AND 57343 THEN NULL ELSE chr(cp) END AS value FROM generate_series(1,1114111) cp), folded AS MATERIALIZED(SELECT lower(value COLLATE pg_unicode_fast) AS value FROM scalars WHERE value IS NOT NULL) SELECT count(*) FROM folded WHERE convert_to(value,'UTF8')<>convert_to(lower(value COLLATE pg_unicode_fast),'UTF8')")(_.getLong(1)).get
    assertEquals(violations,0L,"every pinned Unicode scalar lowercase must be a byte fixed point")
    var fragmentCount=0
    literalCases.zipWithIndex.foreach { case ((source,_),index) =>
      val folded=Sql.one(c,"SELECT lower(? COLLATE pg_unicode_fast)",source)(_.getString(1)).get
      assertEquals(Sql.one(c,"SELECT lower(? COLLATE pg_unicode_fast)",folded)(_.getString(1)),Some(folded),s"whole-field case=$index")
      ArchiveProjection.fragments(folded).zipWithIndex.foreach { case (fragment,ordinal) =>
        assertEquals(Sql.one(c,"SELECT lower(? COLLATE pg_unicode_fast)",fragment)(_.getString(1)),Some(fragment),s"sliced case=$index ordinal=$ordinal")
        fragmentCount+=1
      }
    }
    println(s"UNICODE LOWER FIXED POINT cases=${literalCases.size} fragments=$fragmentCount scalars=1112063")
  }}
  test("Effectual GoodCommunication specified: stored LIKE GIN, old lower predicate and whole-field scan agree over Unicode case samples and fragment boundaries") { database { c =>
    val cases=literalCases
    Sql.exec(c,"CREATE TEMP TABLE lexical_original(case_id integer,value text COLLATE pg_unicode_fast)")
    Sql.exec(c,"CREATE TEMP TABLE lexical_fragments(case_id integer,value text COLLATE pg_unicode_fast)")
    cases.zipWithIndex.foreach { case ((source,_),index) =>
      Sql.exec(c,"INSERT INTO lexical_original VALUES(?,?)",index,source)
      val foldedSource=Sql.one(c,"SELECT lower(? COLLATE pg_unicode_fast)",source)(_.getString(1)).get
      ArchiveProjection.fragments(foldedSource).foreach(fragment => Sql.exec(c,"INSERT INTO lexical_fragments VALUES(?,?)",index,fragment))
    }
    Sql.exec(c,"CREATE INDEX lexical_stored_gin ON lexical_fragments USING gin(value gin_trgm_ops)")
    Sql.exec(c,"ANALYZE lexical_fragments")
    val stored=s"SELECT DISTINCT case_id FROM lexical_fragments WHERE value LIKE lower(? $unicode) ESCAPE '\\' ORDER BY case_id"
    val folded=s"SELECT DISTINCT case_id FROM lexical_fragments WHERE lower(value $unicode) LIKE lower(? $unicode) ESCAPE '\\' ORDER BY case_id"
    val gold="SELECT case_id FROM lexical_original WHERE value ILIKE ? ESCAPE '\\' ORDER BY case_id"
    val selective=pattern(cases.last._2)
    Sql.exec(c,"SET LOCAL enable_seqscan=off")
    val plan=Sql.rows(c,"EXPLAIN "+stored,selective)(_.getString(1)).mkString("\n")
    assert(plan.contains("Bitmap Index Scan on lexical_stored_gin"),plan)
    cases.foreach { case (_,query) =>
      val p=pattern(query)
      Sql.exec(c,"SET LOCAL enable_indexscan=on"); Sql.exec(c,"SET LOCAL enable_bitmapscan=on"); Sql.exec(c,"SET LOCAL enable_seqscan=off")
      val indexed=Sql.rows(c,stored,p)(_.getInt(1))
      Sql.exec(c,"SET LOCAL enable_indexscan=off"); Sql.exec(c,"SET LOCAL enable_bitmapscan=off"); Sql.exec(c,"SET LOCAL enable_seqscan=on")
      val scan=Sql.rows(c,stored,p)(_.getInt(1))
      val oldPredicate=Sql.rows(c,folded,p)(_.getInt(1))
      val original=Sql.rows(c,gold,p)(_.getInt(1))
      assertEquals(indexed,scan,s"stored-value LIKE query=$query")
      assertEquals(indexed,oldPredicate,s"old lower(value) LIKE query=$query")
      assertEquals(indexed,original,s"original-value ILIKE query=$query")
    }
    println(s"UNICODE LITERAL DIFFERENTIAL cases=${cases.size} predicate=stored-value+LIKE index=gin(value gin_trgm_ops) oracles=stored-scan,old-lower,whole-field-ILIKE")
  }}
}
