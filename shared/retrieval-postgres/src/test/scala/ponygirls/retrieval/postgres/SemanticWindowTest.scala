package ponygirls.retrieval.postgres

import ponygirls.retrieval.*
import java.time.Instant

/** Semantic leg: an exact scan at or below `exactScanChunks` published chunks, the HNSW index above it, and on both sides
  * a window of sources by their best chunk. Each case has its own dimension count: an HNSW index is partial per dimension
  * count and shared by every namespace of the database. */
class SemanticWindowTest extends munit.FunSuite {
  import ControlledFixtures.*
  private def profileOf(dimensions: Int) = RetrievalProfile(EmbeddingSpace("controlled-window","immutable-v1",dimensions,false,"","","cosine"),"controlled-metadata-v1")
  /** Unit vector along axis 0, leaning by the given offsets. */
  private def lean(dimensions: Int,offsets: (Int,Double)*): List[Double] = {
    val values=List.tabulate(dimensions)(i => (if(i==0) 1.0 else 0.0)+offsets.collect { case (`i`,offset) => offset }.sum)
    val norm=math.sqrt(values.map(x => x*x).sum)
    values.map(_/norm)
  }
  private def sourceWith(id: String,chunks: Int): SourceProjection = source(id,"alpha",Set("reader")).copy(chunks=List.tabulate(chunks)(i => InputChunk(s"chunk-$i",s"alpha $i",provenance)))
  private def publish(f: PgFixture,sources: Seq[SourceProjection])(vectors: WorkClaim => List[List[Double]]): Unit = {
    sources.foreach(f.store.put)
    f.tx { c => Iterator.continually(f.index.claim(c,60,Instant.now())).takeWhile(_.nonEmpty).flatten.foreach { work => f.index.accept(c,work,0,vectors(work)); f.index.publish(c,work) } }
  }
  /** Oracle: every published source by its best chunk's cosine distance. */
  private def exactRanking(f: PgFixture,vector: List[Double]): List[String] = f.tx { c =>
    Jdbc.rows(c,"SELECT source_id FROM pony_retrieval_chunks WHERE namespace=? GROUP BY source_id ORDER BY min(embedding <=> ?::vector),source_id",Jdbc.key(f.index.namespace),vector.mkString("[",",","]"))(r => Jdbc.unkey(r.getString(1)))
  }
  private def hnsw(f: PgFixture,window: Int): PostgresRetrieval = new PostgresRetrieval(f.index.namespace,f.profile,window,0)
  // The planner takes the HNSW scan for a namespace that is most of its table (one service per database, as in production);
  // in this shared test database a bitmap scan + sort can cost less, so sorts are discouraged.
  private def preferIndex(c: java.sql.Connection): Unit = Jdbc.exec(c,"SET LOCAL enable_sort = off")
  private def semantic(f: PgFixture,index: PostgresRetrieval,vector: List[Double]): RetrievalPage =
    f.tx { c => preferIndex(c); index.search(c,query(RetrievalMode.Semantic).copy(limit=CandidatePolicy.candidatesPerLeg),Some(vector)) }
  private def usesHnsw(f: PgFixture,index: PostgresRetrieval,vector: List[Double]): Boolean = f.tx { c =>
    preferIndex(c)
    val compiled=index.plan(c,query(RetrievalMode.Semantic),Some(vector))
    Jdbc.rows(c,"EXPLAIN "+compiled.sql,compiled.args*)(_.getString(1)).exists(_.contains("pony_retrieval_hnsw_d"))
  }

  test("ANN-1: half of the chunks share one vector; below the threshold semantic ranks like the exact scan, which ranks each late target first") {
    val dimensions=8
    val f=new PgFixture(Some(profileOf(dimensions)))
    // 400 identical rows: 40 HNSW elements (10 heap rows each) fill each other's 32-slot neighbour lists, so no edge leaves them.
    publish(f,(0 until 4).map(i => sourceWith(s"duplicate-$i",100)))(w => List.fill(w.chunks.size)(lean(dimensions)))
    // 400 distinct vectors leaning along axes 5 and 6: nearer to the duplicates than to any target.
    publish(f,(0 until 4).map(i => sourceWith(s"distinct-$i",100))) { w =>
      val i=w.sourceId.last.asDigit
      List.tabulate(w.chunks.size) { k => val angle=2*math.Pi*(i*100+k)/400; lean(dimensions,5 -> 0.3*math.cos(angle),6 -> 0.3*math.sin(angle)) }
    }
    // Each target leans along its own axis (±1..±4): nearer to the duplicates than to another target.
    val targets=(0 until 8).map(j => s"target-$j" -> lean(dimensions,(1+j/2) -> (if(j%2==0) 0.15 else -0.15)))
    publish(f,targets.map((id,_) => sourceWith(id,1)))(w => List(targets.toMap.apply(w.sourceId)))
    val approximate=hnsw(f,CandidatePolicy.candidatesPerLeg)
    val ranked=targets.map { (id,vector) =>
      val exact=exactRanking(f,vector)
      assertEquals(exact.head,id)
      (id,exact,semantic(f,f.index,vector).hits.map(_.id),semantic(f,approximate,vector).hits.map(_.id))
    }
    assertEquals(ranked.map(_._3),ranked.map(_._2))
    // Negative control: through the HNSW index a target is reached only if it drew an upper layer (p ~ 1/16 each); if no
    // target is lost, this corpus no longer reproduces the cause.
    assert(ranked.exists((id,_,_,viaIndex) => !viaIndex.headOption.contains(id)),"the HNSW index ranked every target first")
  }
  test("ANN-2: the exact scan holds up to and including the threshold; one more published chunk selects the HNSW index") {
    val dimensions=5; val threshold=3
    val f=new PgFixture(Some(profileOf(dimensions)),CandidatePolicy.candidatesPerLeg,threshold)
    publish(f,List(sourceWith("first",2),sourceWith("second",1)))(w => List.tabulate(w.chunks.size)(k => lean(dimensions,1 -> 0.1*(k+1))))
    f.store.put(sourceWith("unpublished",1))
    assert(!usesHnsw(f,f.index,lean(dimensions)),"exact scan expected at the threshold; head chunks are not published chunks")
    publish(f,Nil)(_ => List(lean(dimensions,2 -> 0.1)))
    assert(usesHnsw(f,f.index,lean(dimensions)),"HNSW index expected above the threshold")
  }
  test("ANN-3: on both sides of the threshold the window counts sources, so a few sources' near chunks do not crowd out the next") {
    val dimensions=4; val window=4
    val f=new PgFixture(Some(profileOf(dimensions)),window)
    // window-1 sources with more chunks than the window, all nearer than the target; together with the target's chunk they
    // still fit the HNSW scan's window*annChunksPerCandidate chunks.
    val crowdChunks=(window*CandidatePolicy.annChunksPerCandidate-1)/(window-1)
    assert((window-1)*crowdChunks>window)
    publish(f,(0 until window-1).map(i => sourceWith(s"crowd-$i",crowdChunks)))(w => List.tabulate(w.chunks.size)(k => lean(dimensions,1 -> 0.01*(w.sourceId.last.asDigit*crowdChunks+k+1))))
    publish(f,List(sourceWith("target",1),sourceWith("far",1)))(w => List(lean(dimensions,1 -> (if(w.sourceId=="target") 0.01*((window-1)*crowdChunks+1) else 0.5))))
    val vector=lean(dimensions)
    val exact=exactRanking(f,vector)
    assertEquals(exact,(0 until window-1).map(i => s"crowd-$i").toList++List("target","far"))
    val approximate=hnsw(f,window)
    assert(usesHnsw(f,approximate,vector))
    List(f.index,approximate).foreach { index =>
      val page=semantic(f,index,vector)
      assertEquals(page.hits.map(_.id),exact.take(window)); assertEquals(page.total,window.toLong)
    }
  }
}
