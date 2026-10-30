package chronicle

import chronicle.api.*
import io.circe.{Decoder, Json}
import java.nio.ByteBuffer
import java.nio.file.{Files, Path, StandardOpenOption}
import java.security.MessageDigest
import java.sql.Connection
import java.util.UUID
import scala.util.Using
import scala.util.control.NonFatal

/** Evaluation entry point: deliberately not included in the production source directories. */
object SearchDiagnostics {
  private val dimensions = 768
  private val maximumInputBytes = 16L * 1024 * 1024
  private val maximumOutputBytes = 256L * 1024 * 1024
  private val maximumCases = 64
  private val maximumCorpusChunks = 100000
  private val maximumExhaustiveRows = 200000L
  final case class Publication(documentId: String, sessionId: UUID, generation: UUID, revision: Int)
  final case class Request(namespace: String, caseId: String, principal: String, evaluatorPrincipal: String,
    searchQuery: SearchQuery, vector: List[Double], expectedPublications: List[Publication])
  final case class Input(fixtureSha256: String, maxCorpusChunks: Int, statementTimeoutSeconds: Int, cases: List[Request])
  private given Decoder[Publication] = Decoder.forProduct4("documentId", "sessionId", "generation", "revision")(Publication.apply)
  private given Decoder[Request] = Decoder.instance { c => for {
    namespace <- c.get[String]("namespace")
    id <- c.get[String]("caseId")
    principal <- c.get[String]("principal")
    evaluator <- c.get[String]("evaluatorPrincipal")
    encoded <- c.get[Json]("searchQuery")
    query <- SearchQuery.codecJson.decode(Wire.ctx, encoded).left.map(_ => io.circe.DecodingFailure("invalid SearchQuery", c.history))
    _ <- Either.cond(Wire.canonical(encoded) == Wire.canonical(Wire.encode(SearchQuery.codecJson, query)), (), io.circe.DecodingFailure("noncanonical SearchQuery fields", c.history))
    vector <- c.get[List[Double]]("vector")
    catalog <- c.get[List[Publication]]("expectedPublications")
  } yield Request(namespace, id, principal, evaluator, query, vector, catalog) }
  private given Decoder[Input] = Decoder.forProduct4("fixtureSha256", "maxCorpusChunks", "statementTimeoutSeconds", "cases")(Input.apply)
  private def required[A: Decoder](json: Json, key: String): A =
    json.hcursor.get[A](key).fold(_ => throw DomainError("diagnostic-input", "invalid required field"), identity)
  private def hash(bytes: Array[Byte]): String = MessageDigest.getInstance("SHA-256").digest(bytes).map(b => f"${b & 255}%02x").mkString
  private def bounded(path: Path): Array[Byte] = {
    Check(Files.size(path) <= maximumInputBytes, "diagnostic-input", "input byte bound exceeded")
    val bytes = Files.readAllBytes(path)
    Check(bytes.length <= maximumInputBytes, "diagnostic-input", "input byte bound exceeded")
    bytes
  }
  private def publication(p: Publication): Json = Json.obj("documentId" -> Json.fromString(p.documentId),
    "sessionId" -> Json.fromString(p.sessionId.toString), "generation" -> Json.fromString(p.generation.toString), "revision" -> Json.fromInt(p.revision))
  private def rows(c: Connection, plan: SearchStatement, suffix: String, extra: List[Sql.Param]): List[Json] =
    Sql.rows(c, plan.sql + suffix, (plan.args ++ extra)*)(r => Sql.json(r, "value"))

  private def capture(c: Connection, search: PostgresSearch, archive: PostgresArchive, config: Config,
    request: Request, corpusBound: Int, remainingRows: Long): (Json, Long) = {
    val q = request.searchQuery
    SearchPolicy.validateQuery(q, false)
    Check(q.mode == SearchMode.Semantic || q.mode == SearchMode.Hybrid, "diagnostic-input", "semantic or hybrid query required")
    val vector = SearchPolicy.vector(request.vector, config)
    val space = EmbeddingSpaceDescriptor.from(config.embedding)
    IndexProfiles.semantic(c, request.principal, archive.visible, space)
    val catalog = Sql.rows(c, s"""SELECT s.id,s.published,g.revision,g.profile,s.source_key,r.binding_id
      FROM ch_sources s JOIN ch_generations g ON g.id=s.published
      JOIN ch_revisions r ON r.session_id=s.id AND r.revision=g.revision
      WHERE ${archive.visible} ORDER BY s.id""", request.principal, request.principal, request.principal) { r =>
      val id = r.getObject("id", classOf[UUID])
      val expected = request.expectedPublications.find(_.sessionId == id)
        .getOrElse(throw DomainError("diagnostic-catalog", "unexpected visible publication"))
      Check(expected.generation == r.getObject("published", classOf[UUID]) && expected.revision == r.getInt("revision"),
        "diagnostic-catalog", "publication identity mismatch")
      publication(expected).deepMerge(Json.obj("profile" -> Json.fromString(r.getString("profile")),
        "sourceKey" -> Json.fromString(r.getString("source_key")), "bindingId" -> Json.fromString(r.getObject("binding_id", classOf[UUID]).toString)))
    }
    Check(catalog.size == request.expectedPublications.size, "diagnostic-catalog", "visible publication catalog mismatch")
    // Use the semantic legacy plan only: legacy hybrid changes rank denominators to the whole corpus.
    val oracle = search.legacyStatement(request.principal, q.copy(mode = SearchMode.Semantic), Some(request.vector))
    val count = Sql.one(c, oracle.sql + " SELECT count(*) AS n,count(*) FILTER(WHERE vector_dims(embedding)<>768 OR vector_norm(embedding)=0) AS bad FROM corpus", oracle.args*) { r =>
      Check(r.getLong("bad") == 0, "diagnostic-corpus", "invalid corpus vector")
      r.getLong("n")
    }.get
    Check(count <= corpusBound && count <= remainingRows, "diagnostic-corpus", "corpus capture bound exceeded")
    val mismatches = Sql.one(c, oracle.sql + """ SELECT count(*) FROM corpus ch
      LEFT JOIN ch_search_chunks live ON live.id=ch.id JOIN ch_generations g ON g.id=ch.generation
      WHERE live.id IS NULL OR live.generation<>ch.generation OR live.session_id<>ch.session_id
      OR live.revision<>ch.revision OR live.profile<>g.profile OR live.embedding<>ch.embedding OR live.document<>ch.document""", oracle.args*)(_.getLong(1)).get
    Check(mismatches == 0, "diagnostic-corpus", "live search projection differs from oracle")
    val exhaustive = rows(c, oracle, s""" SELECT jsonb_build_object('id',x.id,'sessionId',x.session_id,
      'generation',x.generation,'revision',x.revision,'lex',x.lex,'distance',x.distance,
      'halfDistance',l2_normalize(x.embedding)::halfvec($dimensions) <=> l2_normalize(?::vector)::halfvec($dimensions),
      'lr',x.lr,'vr',x.vr,'score',x.score,'scoreExact',x.score::text,'sessionWinner',winner.id=x.id,'sessionRank',winner.session_rank) AS value
      FROM scored x JOIN (SELECT *,row_number() OVER(ORDER BY score DESC,session_id) AS session_rank FROM sessions) winner USING(session_id)
      ORDER BY x.id""", List(vector))
    Check(exhaustive.size == count, "diagnostic-corpus", "oracle count mismatch")
    val plan = search.statement(request.principal, q, Some(request.vector))
    val hasLexical = q.mode == SearchMode.Hybrid && q.query.nonEmpty
    val lexicalMembership = if(hasLexical) "EXISTS(SELECT 1 FROM lexical l WHERE l.id=x.id)" else "false"
    // All membership and score observations consume this one MATERIALIZED ann traversal.
    val production = rows(c, plan, s""" SELECT jsonb_build_object('id',x.id,'sessionId',x.session_id,
      'generation',x.generation,'revision',x.revision,'lex',x.lex,'distance',x.distance,
      'halfDistance',l2_normalize(x.embedding)::halfvec($dimensions) <=> l2_normalize(?::vector)::halfvec($dimensions),
      'annMember',EXISTS(SELECT 1 FROM ann a WHERE a.id=x.id),'lexicalMember',$lexicalMembership,
      'lr',x.lr,'vr',x.vr,'lexRrf',CASE WHEN x.lex>0 THEN 1.0/(${SearchPolicy.reciprocalRankConstant}+x.lr) ELSE 0 END,
      'vectorRrf',1.0/(${SearchPolicy.reciprocalRankConstant}+x.vr),'score',x.score,'scoreExact',x.score::text,
      'sessionWinner',winner.id=x.id,'sessionRank',winner.session_rank) AS value
      FROM scored x JOIN (SELECT *,row_number() OVER(ORDER BY score DESC,session_id) AS session_rank FROM sessions) winner USING(session_id)
      ORDER BY x.id""", List(vector))
    val corpusById = exhaustive.map(j => required[String](j, "id") -> j).toMap
    production.foreach { j =>
      val full = corpusById.getOrElse(required[String](j, "id"), throw DomainError("diagnostic-corpus", "production candidate outside oracle corpus"))
      List("sessionId", "generation", "revision", "distance", "halfDistance", "lex").foreach { key =>
        Check(j.hcursor.downField(key).focus == full.hcursor.downField(key).focus, "diagnostic-corpus", "candidate source or score differs from oracle")
      }
    }
    val queryJson = Wire.encode(SearchQuery.codecJson, q)
    val vectorJson = Json.arr(request.vector.map(Json.fromDoubleOrNull)*)
    (Json.obj("namespace" -> Json.fromString(request.namespace), "caseId" -> Json.fromString(request.caseId),
      "principal" -> Json.fromString(request.principal), "evaluatorPrincipal" -> Json.fromString(request.evaluatorPrincipal),
      "searchQuery" -> queryJson, "searchQuerySha256" -> Json.fromString(Wire.hash(queryJson.noSpacesSortKeys)),
      "vectorSha256" -> Json.fromString(Wire.hash(vectorJson.noSpaces)), "sqlVectorSha256" -> Json.fromString(Wire.hash(vector)),
      "vectorDimensions" -> Json.fromInt(request.vector.size), "embeddingSpace" -> Json.fromString(space.id),
      "productionStatementSha256" -> Json.fromString(Wire.hash(plan.sql)), "oracleStatementSha256" -> Json.fromString(Wire.hash(oracle.sql)),
      "catalog" -> Json.arr(catalog*), "corpusCount" -> Json.fromLong(count),
      "exhaustive" -> Json.arr(exhaustive*), "production" -> Json.arr(production*)), count)
  }

  def main(args: Array[String]): Unit = {
    try run(args)
    catch {
      case e: DomainError => System.err.println("search-diagnostics failed: " + e.code); System.exit(1)
      case NonFatal(_) => System.err.println("search-diagnostics failed: external-or-io-error (details suppressed)"); System.exit(1)
    }
  }
  private def run(args: Array[String]): Unit = {
    Check(args.length == 4, "diagnostic-usage", "CONFIG REQUEST OUTPUT FIXTURE required")
    val requestBytes = bounded(Path.of(args(1)))
    val input = Wire.parse(new String(requestBytes, java.nio.charset.StandardCharsets.UTF_8)).as[Input]
      .fold(_ => throw DomainError("diagnostic-input", "invalid request"), identity)
    val fixtureBytes = bounded(Path.of(args(3)))
    Check(hash(fixtureBytes) == input.fixtureSha256, "diagnostic-fixture", "fixture digest mismatch")
    val fixture = Wire.parse(new String(fixtureBytes, java.nio.charset.StandardCharsets.UTF_8))
    val tasks = required[List[Json]](fixture, "tasks")
    val documents = required[List[Json]](fixture, "documents")
    Check(input.maxCorpusChunks > 0 && input.maxCorpusChunks <= maximumCorpusChunks && input.statementTimeoutSeconds > 0 && input.statementTimeoutSeconds <= 600,
      "diagnostic-input", "invalid explicit execution bounds")
    Check(input.cases.nonEmpty && input.cases.size <= maximumCases && input.cases.map(_.namespace).distinct.size == input.cases.size,
      "diagnostic-input", "invalid case count or duplicate namespace")
    input.cases.foreach { r =>
      Check(r.namespace.matches("[A-Za-z0-9._-]{1,128}") && r.principal.nonEmpty, "diagnostic-input", "invalid namespace or principal")
      val task = tasks.find(j => required[String](j, "id") == r.caseId).getOrElse(throw DomainError("diagnostic-fixture", "unknown evaluator case"))
      Check(required[String](task, "query") == r.searchQuery.query && required[String](task, "principal") == r.evaluatorPrincipal,
        "diagnostic-fixture", "fixed query or evaluator principal differs")
      Check(r.expectedPublications.nonEmpty && r.expectedPublications.map(_.sessionId).distinct.size == r.expectedPublications.size &&
        r.expectedPublications.map(_.documentId).distinct.size == r.expectedPublications.size &&
        r.expectedPublications.forall(_.revision > 0), "diagnostic-input", "invalid publication catalog")
      val authorizedDocuments = documents.filter(j => required[String](j, "principal") == r.evaluatorPrincipal).map(j => required[String](j, "id")).toSet
      Check(r.expectedPublications.map(_.documentId).toSet == authorizedDocuments,
        "diagnostic-fixture", "fixture principal catalog differs; restricted must not inherit reader corpus")
    }
    val config = Config.load(args(0))
    Check(config.embedding.dimensions == dimensions, "diagnostic-input", "768-dimensional embedding configuration required")
    input.cases.foreach(r => SearchPolicy.vector(r.vector, config))
    val db = new Database(config, IndexProfileCatalog.current(config))
    val archive = new PostgresArchive(db, config)
    val search = new PostgresSearch(db, archive, config)
    Using.resource(Files.newByteChannel(Path.of(args(2)), StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) { output =>
      val result = db.transaction { c =>
        c.setReadOnly(true)
        c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ)
        Sql.exec(c, "SET LOCAL transaction_read_only = on")
        Sql.exec(c, s"SET LOCAL statement_timeout = '${input.statementTimeoutSeconds}s'")
        SearchPolicy.configure(c)
        val snapshot = Sql.one(c, "SELECT pg_current_snapshot()::text AS snapshot,current_setting('transaction_read_only') AS ro,current_setting('transaction_isolation') AS isolation") { r =>
          Check(r.getString("ro") == "on" && r.getString("isolation") == "repeatable read", "diagnostic-safety", "read-only snapshot not established")
          r.getString("snapshot")
        }.get
        var remaining = maximumExhaustiveRows
        val cases = input.cases.map { r =>
          val (value, count) = capture(c, search, archive, config, r, input.maxCorpusChunks, remaining)
          remaining -= count
          value
        }
        Json.obj("schemaVersion" -> Json.fromInt(1), "fixtureSha256" -> Json.fromString(input.fixtureSha256),
          "requestSha256" -> Json.fromString(hash(requestBytes)), "snapshot" -> Json.fromString(snapshot),
          "readOnly" -> Json.True, "isolation" -> Json.fromString("repeatable read"),
          "maxCorpusChunks" -> Json.fromInt(input.maxCorpusChunks), "maxExhaustiveRows" -> Json.fromLong(maximumExhaustiveRows),
          "statementTimeoutSeconds" -> Json.fromInt(input.statementTimeoutSeconds),
          "candidateBudget" -> Json.fromInt(SearchPolicy.candidatesPerLeg), "rrfConstant" -> Json.fromInt(SearchPolicy.reciprocalRankConstant),
          "annOrderObservation" -> Json.fromString("membership only; half-distance tie traversal order and ANN ordinal are not observed"),
          "sessionTiePolicy" -> Json.fromString("winner: score DESC, chunk UUID ASC; session rank: score DESC, session UUID ASC"),
          "cases" -> Json.arr(cases*))
      }
      val bytes = (result.noSpaces + "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8)
      Check(bytes.length <= maximumOutputBytes, "diagnostic-output", "output byte bound exceeded")
      val buffer = ByteBuffer.wrap(bytes)
      while(buffer.hasRemaining) output.write(buffer)
    }
  }
}
