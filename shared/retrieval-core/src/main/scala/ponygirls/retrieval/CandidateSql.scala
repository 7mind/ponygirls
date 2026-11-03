package ponygirls.retrieval

/** Shared executable PostgreSQL ranking policy. Authorization remains inside each
  * caller's SQL relation BEFORE the returned ANN order/limit; never post-filter IDs.
  * Column arguments are identifiers, not SQL predicates or user fragments.
  */
object CandidateSql {
  private def column(value: String): String = {
    RetrievalChecks(value.matches("[a-z_][a-z_0-9]*(\\.[a-z_][a-z_0-9]*)?"),"config","invalid ranking column")
    value
  }
  def annDistance(dimensions: Int,embeddingColumn: String): String = {
    Vectors.dimensions(dimensions)
    s"l2_normalize(${column(embeddingColumn)})::halfvec($dimensions) <=> l2_normalize(?::vector)::halfvec($dimensions)"
  }
  def score(mode: RetrievalMode): String = mode match {
    case RetrievalMode.Lexical => "lex"
    case RetrievalMode.Semantic => "1.0-distance"
    case RetrievalMode.Hybrid => s"(CASE WHEN lex>0 THEN 1.0/(${CandidatePolicy.reciprocalRankConstant}+lr) ELSE 0 END)+1.0/(${CandidatePolicy.reciprocalRankConstant}+vr)"
  }
  /** Input candidates: id, entity key, document (tsvector), embedding (original vector). */
  def rerankCtes(mode: RetrievalMode,entityColumn: String): String = {
    val entity=column(entityColumn)
    val lexical="CASE WHEN document @@ websearch_to_tsquery('english',?) THEN ts_rank_cd(document,websearch_to_tsquery('english',?)) ELSE 0 END"
    s"ranked AS(SELECT *,$lexical AS lex,embedding <=> ?::vector AS distance FROM candidates),ranked2 AS(SELECT *,row_number() OVER(ORDER BY lex DESC,id) AS lr,row_number() OVER(ORDER BY distance,id) AS vr FROM ranked),scored AS(SELECT *,${score(mode)} AS score FROM ranked2),sessions AS(SELECT DISTINCT ON($entity) * FROM scored ORDER BY $entity,score DESC,id)"
  }
  val configureStatements: List[String] = List(
    "SET LOCAL hnsw.iterative_scan = strict_order",
    s"SET LOCAL hnsw.ef_search = ${CandidatePolicy.efSearch}",
    s"SET LOCAL hnsw.max_scan_tuples = ${CandidatePolicy.maxScanTuples}",
    s"SET LOCAL hnsw.scan_mem_multiplier = ${CandidatePolicy.scanMemoryMultiplier}")
}
