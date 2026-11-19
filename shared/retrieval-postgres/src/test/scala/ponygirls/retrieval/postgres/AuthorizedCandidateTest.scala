package ponygirls.retrieval.postgres

import ponygirls.retrieval.*
import java.time.Instant

class AuthorizedCandidateTest extends munit.FunSuite {
  import ControlledFixtures.*
  private val ProductionCandidatesPerLeg = 1000
  private val Window = 25
  private val ForbiddenSources = Window+5
  private val FilteredSources = Window+5
  private val NearAuthorizedSources = Window
  // Authorized, lexically strongest of the authorized, but vector-farther than the ANN window.
  private val LexicalOnlyAuthorizedSources = 5
  private val AuthorizedSources = NearAuthorizedSources+LexicalOnlyAuthorizedSources
  // Strict lexical rank order by 'alpha' occurrences: excluded > lexical-only authorized > near authorized.
  private val ExcludedText = "alpha alpha alpha alpha nearest"
  private val LexicalOnlyText = "alpha alpha alpha tail"
  private val NearText = "alpha controlled"

  test("Contract: the production candidate window is 1000 per leg") {
    assertEquals(CandidatePolicy.candidatesPerLeg,ProductionCandidatesPerLeg)
    assertEquals(new PostgresRetrieval("production-window",None).candidatesPerLeg,ProductionCandidatesPerLeg)
  }
  test("Blackbox-GoodCommunication: ACL and typed filters precede each candidate-window leg; exact scan is the negative control") {
    val f=new PgFixture(Some(profile),Window)
    f.tx { c =>
      // More than a full ANN/lexical window of forbidden nearest, lexically strongest candidates.
      (0 until ForbiddenSources).foreach(i => f.index.put(c,source(s"forbidden-$i",ExcludedText,Set("other"))))
      // A second full window is authorized but fails the structured filter.
      (0 until FilteredSources).foreach(i => f.index.put(c,source(s"filtered-$i",ExcludedText,Set("reader")).copy(attributes=Vector(ProjectionAttribute(field,AttributeValue("excluded"))))))
      (0 until AuthorizedSources).foreach(i => f.index.put(c,source(s"authorized-$i",if(i<NearAuthorizedSources) NearText else LexicalOnlyText,Set("reader"))))
      var claim=f.index.claim(c,60,Instant.now())
      while(claim.nonEmpty) {
        val work=claim.get
        val vector=if(work.sourceId.startsWith("authorized-")) List(1.0,0.2+work.sourceId.stripPrefix("authorized-").toInt*0.01,0.0) else List(1.0,0.0,0.0)
        f.index.accept(c,work,0,List(vector)); f.index.publish(c,work)
        claim=f.index.claim(c,60,Instant.now())
      }
    }
    val q=query(RetrievalMode.Semantic).copy(filters=Vector(AttributeFilter.Equal(field,AttributeValue("controlled"))))
    val oracle=f.tx { c =>
      Jdbc.rows(c,"""SELECT s.id FROM pony_retrieval_chunks ch JOIN pony_retrieval_sources s ON s.namespace=ch.namespace AND s.id=ch.source_id
        WHERE s.namespace=? AND s.eligible AND NOT s.archived AND EXISTS(SELECT 1 FROM pony_retrieval_audience a WHERE a.namespace=s.namespace AND a.source_id=s.id AND a.principal=?)
        AND EXISTS(SELECT 1 FROM pony_retrieval_attributes a WHERE a.namespace=s.namespace AND a.source_id=s.id AND a.key=? AND a.value=?)
        ORDER BY ch.embedding <=> '[1,0,0]'::vector,s.id""",Jdbc.key(f.index.namespace),Jdbc.key("reader"),field.value,Jdbc.bytes("controlled"))(r => Jdbc.unkey(r.getString(1)))
    }
    assertEquals(oracle.size,AuthorizedSources)
    List(RetrievalMode.Lexical,RetrievalMode.Semantic,RetrievalMode.Hybrid).foreach { mode =>
      val page=f.store.search(q.copy(mode=mode))
      assert(page.hits.forall(h => oracle.contains(h.id)),"unauthorized or filtered candidate leaked")
      assertEquals(page.total,page.hits.size.toLong)
      assert(page.total<=oracle.size.toLong)
      if(mode==RetrievalMode.Lexical) assertEquals(page.total,oracle.size.toLong)
      else {
        // Exact diagnostic executes the SAME production query with index scans disabled.
        // Post-window ACL/filtering would lose the ANN leg (semantic and hybrid) or the lexical leg (hybrid:
        // the lexical-only authorized sources) here, so this is the negative control.
        // Semantic is clipped to the ANN window; hybrid also holds the lexical-only sources outside it.
        val expected=if(mode==RetrievalMode.Semantic) oracle.take(Window) else oracle
        val exactPlan=f.tx { c =>
          Jdbc.exec(c,"SET LOCAL enable_indexscan = off"); Jdbc.exec(c,"SET LOCAL enable_bitmapscan = off")
          f.index.search(c,q.copy(mode=mode),Some(List(1.0,0.0,0.0)))
        }
        assertEquals(exactPlan.total,expected.size.toLong); assertEquals(exactPlan.hits.map(_.id).toSet,expected.toSet)
        if(mode==RetrievalMode.Semantic) assertEquals(exactPlan.hits.map(_.id),expected)
        assertEquals(page.countScope,CountScope.CandidateWindow)
        assertEquals(page.rankingLimit,Some(if(mode==RetrievalMode.Hybrid) Window*2 else Window))
      }
    }
    // The lexical path is exact, not the candidate-window total, even beyond the window.
    val lexical=f.store.search(query(RetrievalMode.Lexical))
    assertEquals(lexical.total,(FilteredSources+AuthorizedSources).toLong); assertEquals(lexical.countScope,CountScope.ExactMatches)
  }
}
