package chronicle

import java.sql.{Connection,SQLException}
import ponygirls.retrieval.CandidatePolicy

/** Budgets of a semantic (ANN) leg and of the second pass that completes a short one. The leg's per-tuple filter
  * (authorization, publication, metadata filters) spends the scan budget on every index entry it rejects: rows of other
  * owners or filters, staged, in-flight and not yet vacuumed rows. */
final case class SemanticLegBudget(firstScanTuples: Int,exactScanChunks: Int,secondScanTuples: Int,secondScanMemoryMultiplier: Int,secondPassMillis: Int) {
  Check(firstScanTuples>=1 && exactScanChunks>=0 && secondScanTuples>=firstScanTuples && secondScanMemoryMultiplier>=1 && secondPassMillis>=1,"config","invalid semantic leg budget")
}
object SemanticLegBudget {
  /** The first pass is today's scan; a visible set of at most `exactScanChunks` is ranked exactly; a larger one by an
    * iterative scan of up to 1,000,000 index entries with 64 times `work_mem` of scan memory (≈ 200 B per entry) for at
    * most 5 s, which completes ≈ 600,000 rejected entries ahead of the visible ones. */
  val production: SemanticLegBudget = SemanticLegBudget(CandidatePolicy.maxScanTuples,CandidatePolicy.exactScanChunks,1000000,64,5000)
}

/** How one execution evaluates a leg: through the HNSW index (the first pass, or the second pass's iterative scan under
  * its larger budget), or by an exact scan of its visible set. */
enum LegPass { case Index, Exact }

/** Detection and completion of short semantic legs. A leg is short when it returns fewer rows than
  * min(candidatesPerLeg, its visible set): rows that exist and pass its filter were not reached. */
private[chronicle] object SemanticLeg {
  val incompleteDetail = "semantic candidates incomplete: the vector index scan ended before it reached the nearest matching chunks " +
    "(index entries being published or not yet vacuumed, or a narrow filter); retry later, narrow the filters or use lexical mode"
  def configure(c: Connection,budget: SemanticLegBudget): Unit = {
    SearchPolicy.configure(c)
    Sql.exec(c,s"SET LOCAL hnsw.max_scan_tuples = ${budget.firstScanTuples}")
  }
  /** Where the bounded count of a leg's visible set stops: enough to tell an exact-scan set and a full window. */
  def visibleCap(budget: SemanticLegBudget): Int = math.max(budget.exactScanChunks,SearchPolicy.candidatesPerLeg)+1
  private def needed(visible: Long): Long = math.min(SearchPolicy.candidatesPerLeg.toLong,visible)
  /** `execute(passes)` runs the statement (legs absent from `passes` through the index) and reports each leg's rows by
    * key; `visible(key)` counts a leg's visible set up to `visibleCap`, in the same snapshot. Short legs are run again:
    * exactly when their visible set is small, else through the index under the second pass's budget and deadline.
    * The second execution repeats every leg, and index entries published meanwhile can make a leg that was full come
    * back short (the snapshot freezes rows, not the index traversal): every leg of it is checked, and one still short
    * fails the whole request — never a silently partial window. */
  def complete[K,A](c: Connection,budget: SemanticLegBudget,legs: List[K])(execute: Map[K,LegPass] => A)(rows: A => Map[K,Long])(visible: K => Long): A = {
    val first=execute(Map.empty)
    val counted=rows(first)
    val sizes=legs.filter(leg => counted(leg)<SearchPolicy.candidatesPerLeg).map(leg => leg -> visible(leg)).toMap
    val short=sizes.filter((leg,size) => counted(leg)<needed(size))
    if(short.isEmpty) first else {
      val passes=short.map((leg,size) => leg -> (if(size<=budget.exactScanChunks) LegPass.Exact else LegPass.Index))
      val second=if(passes.values.exists(_==LegPass.Index)) secondPass(c,budget)(execute(passes)) else execute(passes)
      val recounted=rows(second)
      val incomplete=legs.exists(leg => recounted(leg)<SearchPolicy.candidatesPerLeg && recounted(leg)<needed(sizes.getOrElse(leg,visible(leg))))
      if(incomplete) throw DomainError("unavailable",incompleteDetail)
      second
    }
  }
  /** The second pass's index scan: larger tuple and memory budgets under its own deadline, in a savepoint so that a
    * cancelled pass leaves the transaction usable; the settings are restored afterwards. */
  private def secondPass[A](c: Connection,budget: SemanticLegBudget)(run: => A): A = {
    val settings=List("statement_timeout","hnsw.max_scan_tuples","hnsw.scan_mem_multiplier")
    val saved=settings.map(name => name -> Sql.one(c,"SELECT current_setting(?)",name)(_.getString(1)).get)
    val savepoint=c.setSavepoint()
    try {
      Sql.exec(c,"SELECT set_config('statement_timeout',least(coalesce(nullif(setting::bigint,0),?),?)::text,true) FROM pg_settings WHERE name='statement_timeout'",budget.secondPassMillis,budget.secondPassMillis)
      Sql.exec(c,s"SET LOCAL hnsw.max_scan_tuples = ${budget.secondScanTuples}")
      Sql.exec(c,s"SET LOCAL hnsw.scan_mem_multiplier = ${budget.secondScanMemoryMultiplier}")
      val result=run
      c.releaseSavepoint(savepoint)
      saved.foreach((name,value) => Sql.exec(c,"SELECT set_config(?,?,true)",name,value))
      result
    } catch {
      case error: SQLException if error.getSQLState=="57014" =>
        c.rollback(savepoint)
        throw DomainError("unavailable",incompleteDetail)
    }
  }
}
