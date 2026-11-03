package ponygirls.retrieval.postgres

import ponygirls.retrieval.*
import scala.concurrent.duration.*
import io.circe.Json
import java.nio.file.{Files,Path}

class AuthorizedCandidateTest extends munit.FunSuite {
  override val munitTimeout = 2.minutes
  import ControlledFixtures.*
  test("Blackbox-GoodCommunication: ACL and typed filters precede each 1000-candidate leg; selective ANN yield is measured against exact diagnostic") {
    val f=new PgFixture(Some(profile))
    f.tx { c =>
      // More than a full ANN/lexical window of forbidden nearest neighbors.
      (0 until 1100).foreach(i => f.index.put(c,source(s"forbidden-$i","alpha nearest",Set("other"))))
      // A second full window is authorized but fails the structured filter.
      (0 until 1100).foreach(i => f.index.put(c,source(s"filtered-$i","alpha nearest",Set("reader")).copy(attributes=Vector(ProjectionAttribute(field,AttributeValue("excluded"))))))
      (0 until 12).foreach(i => f.index.put(c,source(s"authorized-$i","alpha controlled",Set("reader"))))
    }
    var claim=f.tx(c => f.index.claim(c,60))
    while(claim.nonEmpty) {
      val work=claim.get
      val vector=if(work.sourceId.startsWith("authorized-")) List(1.0,0.2+work.sourceId.stripPrefix("authorized-").toInt*0.01,0.0) else List(1.0,0.0,0.0)
      f.tx { c => f.index.accept(c,work,0,List(vector)); f.index.publish(c,work) }
      claim=f.tx(c => f.index.claim(c,60))
    }
    val q=query(RetrievalMode.Semantic).copy(filters=Vector(AttributeFilter.Equal(field,AttributeValue("controlled"))))
    val oracle=f.tx { c =>
      Jdbc.rows(c,"""SELECT s.id FROM pony_retrieval_chunks ch JOIN pony_retrieval_sources s ON s.namespace=ch.namespace AND s.id=ch.source_id
        WHERE s.namespace=? AND s.eligible AND NOT s.archived AND EXISTS(SELECT 1 FROM pony_retrieval_audience a WHERE a.namespace=s.namespace AND a.source_id=s.id AND a.principal=?)
        AND EXISTS(SELECT 1 FROM pony_retrieval_attributes a WHERE a.namespace=s.namespace AND a.source_id=s.id AND a.key=? AND a.value=?)
        ORDER BY ch.embedding <=> '[1,0,0]'::vector,s.id""",Jdbc.key(f.index.namespace),Jdbc.key("reader"),field.value,Jdbc.bytes("controlled"))(r => Jdbc.unkey(r.getString(1)))
    }
    // Capture the actual compiled production query plan, with exactly the normal local scan knobs.
    val diagnostic=f.tx { c =>
      val plan=f.index.plan(c,q,Some(List(1.0,0.0,0.0)))
      val knobs=Jdbc.rows(c,"SELECT name,current_setting(name) FROM (VALUES('hnsw.iterative_scan'),('hnsw.ef_search'),('hnsw.max_scan_tuples'),('hnsw.scan_mem_multiplier'),('work_mem')) settings(name)")(r => r.getString(1)->Json.fromString(r.getString(2)))
      val explain=Jdbc.one(c,"EXPLAIN (ANALYZE,BUFFERS,SETTINGS,FORMAT JSON) "+plan.sql,plan.args*)(r => io.circe.parser.parse(r.getString(1)).toOption.get).get
      Json.obj("effectiveLocalKnobs"->Json.obj(knobs*),"productionExplain"->explain,"sourcePolicy"->Json.fromString("unchanged finite policy; no exact fallback"))
    }
    println("CONTROLLED ADVERSARIAL PRODUCTION PLAN\n"+diagnostic.spaces2)
    sys.env.get("RETRIEVAL_DIAGNOSTIC_DIR").foreach { directory =>
      val path=Path.of(directory); Files.createDirectories(path); Files.writeString(path.resolve("authorized-candidate-plan.json"),diagnostic.spaces2+"\n")
    }
    assertEquals(oracle.size,12)
    List(RetrievalMode.Lexical,RetrievalMode.Semantic,RetrievalMode.Hybrid).foreach { mode =>
      val page=f.store.search(q.copy(mode=mode))
      assert(page.hits.forall(h => oracle.contains(h.id)),"unauthorized or filtered candidate leaked")
      assertEquals(page.total,page.hits.size.toLong)
      assert(page.total<=oracle.size.toLong)
      if(mode==RetrievalMode.Lexical) assertEquals(page.total,12L)
      else {
        // Exact diagnostic executes the SAME production query with index scans disabled.
        // Post-limit ACL/filtering would return zero here too, so this is the negative control.
        val exactPlan=f.tx { c =>
          Jdbc.exec(c,"SET LOCAL enable_indexscan = off"); Jdbc.exec(c,"SET LOCAL enable_bitmapscan = off")
          f.index.search(c,q.copy(mode=mode),Some(List(1.0,0.0,0.0)))
        }
        assertEquals(exactPlan.total,12L); assertEquals(exactPlan.hits.map(_.id).toSet,oracle.toSet)
        if(mode==RetrievalMode.Semantic) assertEquals(exactPlan.hits.map(_.id),oracle)
        assertEquals(page.countScope,CountScope.CandidateWindow)
      }
      println(s"CONTROLLED ADVERSARIAL AUTHORIZED YIELD mode=$mode authorizedExact=${oracle.size} candidateYield=${page.total} recall=${page.hits.size.toDouble/oracle.size} (finite unchanged ANN policy; scripted vectors; not provider quality)")
    }
    // The lexical path is exact, not the candidate-window total, even beyond 1000.
    val lexical=f.store.search(query(RetrievalMode.Lexical))
    assertEquals(lexical.total,1112L); assertEquals(lexical.countScope,CountScope.ExactMatches)
  }
}
