package ponygirls.retrieval.postgres

import ponygirls.retrieval.*
import java.time.Instant

class AuthorizedCandidateTest extends munit.FunSuite {
  import ControlledFixtures.*
  private val ProductionCandidatesPerLeg = 1000
  private val Window = 25
  // More than the HNSW scan's chunk window (and so more than the lexical leg's window).
  private val ForbiddenSources = Window*CandidatePolicy.annChunksPerCandidate+5
  private val FilteredSources = Window*CandidatePolicy.annChunksPerCandidate+5
  private val NearAuthorizedSources = Window
  // Authorized, lexically strongest of the authorized, but vector-farther than the ANN window.
  private val LexicalOnlyAuthorizedSources = 5
  private val AuthorizedSources = NearAuthorizedSources+LexicalOnlyAuthorizedSources
  // Strict lexical rank order by 'alpha' occurrences: excluded > lexical-only authorized > near authorized.
  private val ExcludedText = "alpha alpha alpha alpha nearest"
  private val LexicalOnlyText = "alpha alpha alpha tail"
  private val NearText = "alpha controlled"
  // Own HNSW index: the 3-dimensional one holds every other suite's identical [1,0,0] vectors.
  private val Dimensions = 6
  private val windowProfile = RetrievalProfile(profile.space.copy(dimensions=Dimensions),profile.policy)
  private def leaning(offset: Double): List[Double] = List.tabulate(Dimensions)(i => if(i==0) 1.0 else if(i==1) offset else 0.0)

  test("Contract: the production candidate window is 1000 per leg") {
    assertEquals(CandidatePolicy.candidatesPerLeg,ProductionCandidatesPerLeg)
    assertEquals(new PostgresRetrieval("production-window",None).candidatesPerLeg,ProductionCandidatesPerLeg)
  }
  test("Blackbox-GoodCommunication: ACL and typed filters precede each candidate-window leg, by exact scan and by HNSW index") {
    val f=new PgFixture(Some(windowProfile),Window)
    f.tx { c =>
      // More than a full ANN/lexical window of forbidden nearest, lexically strongest candidates.
      (0 until ForbiddenSources).foreach(i => f.index.put(c,source(s"forbidden-$i",ExcludedText,Set("other"))))
      // A second full window is authorized but fails the structured filter.
      (0 until FilteredSources).foreach(i => f.index.put(c,source(s"filtered-$i",ExcludedText,Set("reader")).copy(attributes=Vector(ProjectionAttribute(field,AttributeValue("excluded"))))))
      (0 until AuthorizedSources).foreach(i => f.index.put(c,source(s"authorized-$i",if(i<NearAuthorizedSources) NearText else LexicalOnlyText,Set("reader"))))
      var claim=f.index.claim(c,60,Instant.now())
      while(claim.nonEmpty) {
        val work=claim.get
        val ordinal=work.sourceId.dropWhile(_!='-').drop(1).toInt
        // Excluded sources are nearest; distinct vectors keep the HNSW graph free of large identical groups.
        val vector=if(work.sourceId.startsWith("authorized-")) leaning(0.2+ordinal*0.01) else leaning(ordinal*0.001)
        f.index.accept(c,work,0,List(vector)); f.index.publish(c,work)
        claim=f.index.claim(c,60,Instant.now())
      }
    }
    val q=query(RetrievalMode.Semantic).copy(filters=Vector(AttributeFilter.Equal(field,AttributeValue("controlled"))))
    val oracle=f.tx { c =>
      Jdbc.rows(c,"""SELECT s.id FROM pony_retrieval_chunks ch JOIN pony_retrieval_sources s ON s.namespace=ch.namespace AND s.id=ch.source_id
        WHERE s.namespace=? AND s.eligible AND NOT s.archived AND EXISTS(SELECT 1 FROM pony_retrieval_audience a WHERE a.namespace=s.namespace AND a.source_id=s.id AND a.principal=?)
        AND EXISTS(SELECT 1 FROM pony_retrieval_attributes a WHERE a.namespace=s.namespace AND a.source_id=s.id AND a.key=? AND a.value=?)
        ORDER BY ch.embedding <=> ?::vector,s.id""",Jdbc.key(f.index.namespace),Jdbc.key("reader"),field.value,Jdbc.bytes("controlled"),leaning(0.0).mkString("[",",","]"))(r => Jdbc.unkey(r.getString(1)))
    }
    assertEquals(oracle.size,AuthorizedSources)
    // This namespace is below the exact-scan threshold; the second index ranks it through the HNSW index, which the planner
    // takes for a namespace that is most of its table (as in production) and here once sorts are discouraged.
    val approximate=new PostgresRetrieval(f.index.namespace,f.profile,Window,0)
    def search(index: PostgresRetrieval,mode: RetrievalMode): RetrievalPage = f.tx { c =>
      Jdbc.exec(c,"SET LOCAL enable_sort = off")
      index.search(c,q.copy(mode=mode),Some(leaning(0.0)))
    }
    val plan=f.tx { c => Jdbc.exec(c,"SET LOCAL enable_sort = off"); val compiled=approximate.plan(c,q,Some(leaning(0.0))); Jdbc.rows(c,"EXPLAIN "+compiled.sql,compiled.args*)(_.getString(1)) }
    assert(plan.exists(_.contains(s"pony_retrieval_hnsw_d$Dimensions")),plan.mkString("\n"))
    List(RetrievalMode.Lexical,RetrievalMode.Semantic,RetrievalMode.Hybrid).foreach { mode =>
      List(f.index,approximate).foreach { index =>
        val page=search(index,mode)
        assert(page.hits.forall(h => oracle.contains(h.id)),"unauthorized or filtered candidate leaked")
        assertEquals(page.total,page.hits.size.toLong)
        assert(page.total<=oracle.size.toLong)
        if(mode==RetrievalMode.Lexical) assertEquals(page.total,oracle.size.toLong)
        else {
          // Post-window ACL/filtering would lose the near authorized sources (semantic and hybrid) or the lexical-only
          // authorized sources (hybrid) behind the nearer, lexically stronger excluded ones.
          // Semantic is clipped to the window; hybrid also holds the lexical-only sources outside it.
          val expected=if(mode==RetrievalMode.Semantic) oracle.take(Window) else oracle
          assertEquals(page.total,expected.size.toLong); assertEquals(page.hits.map(_.id).toSet,expected.toSet)
          if(mode==RetrievalMode.Semantic) assertEquals(page.hits.map(_.id),expected)
          assertEquals(page.countScope,CountScope.CandidateWindow)
          assertEquals(page.rankingLimit,Some(if(mode==RetrievalMode.Hybrid) Window*2 else Window))
        }
      }
    }
    // The lexical path is exact, not the candidate-window total, even beyond the window.
    val lexical=f.store.search(query(RetrievalMode.Lexical))
    assertEquals(lexical.total,(FilteredSources+AuthorizedSources).toLong); assertEquals(lexical.countScope,CountScope.ExactMatches)
  }
}
