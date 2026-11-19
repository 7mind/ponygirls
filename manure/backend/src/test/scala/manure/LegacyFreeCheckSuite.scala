package manure

import ponygirls.retrieval.{EmbeddingSpace,RetrievalProfile}
import ponygirls.retrieval.postgres.PostgresRetrieval
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files,Path}
import java.sql.{Connection,DriverManager}
import java.util.UUID
import java.util.concurrent.{TimeUnit,TimeoutException}
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*
import scala.util.Using

/** The retained post-deployment check manure/scripts/check-legacy-free.sql, run exactly as the operator runs it (psql -f),
  * on copies of one fresh database of the current binary (its schema and the retrieval registry with a configured
  * profile); then one legacy shape, seeded with plain SQL. Built like the LegacyFreeCheckTest suites of Chronicle and
  * Haystack, whose shared retrieval predicate the check repeats.
  */
final class LegacyFreeCheckSuite extends munit.FunSuite:
  private val check = BackendFixture.source.resolve("manure/scripts/check-legacy-free.sql")
  private lazy val url = sys.env.getOrElse("MANURE_TEST_JDBC_URL",throw new IllegalArgumentException("required owned PG leg unavailable"))
  private lazy val user = sys.env.getOrElse("MANURE_TEST_JDBC_USER","postgres")
  private lazy val password = Files.readString(Path.of(sys.env("MANURE_TEST_JDBC_PASSWORD_FILE"))).stripSuffix("\n")
  private def database(name: String): String = url.substring(0,url.lastIndexOf('/')+1) + name
  private lazy val maintenance = url.substring(url.lastIndexOf('/')+1)
  private def admin[A](name: String)(run: Connection => A): A =
    Using.resource(DriverManager.getConnection(database(name),user,password))(run)
  private def execute(name: String,statements: Seq[String]): Unit =
    admin(name)(c => statements.foreach(sql => Using.resource(c.createStatement())(_.execute(sql))))
  /** Every counter line of a passing run (the database name and the verdict are asserted apart). */
  private val clean = Map("LP.retrieval.profiles" -> "1","LP.retrieval.not_proven_v2" -> "0")

  /** One fresh database of the current binary: the Manure schema, then the projection with a configured profile. */
  private val fresh = new Fixture[String]("fresh database of the current binary"):
    private var name = Option.empty[String]
    def apply(): String = name.getOrElse(fail("fresh database was not created"))
    override def beforeAll(): Unit =
      Require(sys.env.get("MANURE_TEST_ALLOW_CREATEDB").contains("1"),"unavailable")
      val created = "manure_legacy_free_" + UUID.randomUUID().toString.replace("-","")
      execute(maintenance,List("CREATE DATABASE " + created)); name = Some(created)
      execute(created,List("CREATE EXTENSION vector"))
      val profile = RetrievalProfile(EmbeddingSpace("synthetic-fixture","v1",3,true,"","","cosine"),"manure-metadata-paths-v1")
      admin(created) { c =>
        c.setAutoCommit(false)
        Using.resource(c.createStatement())(_.execute(Files.readString(BackendFixture.source.resolve("manure/migration/schema.sql"))))
        // Production layout: the service connects as role manure, whose "$user" schema is manure, so the unqualified
        // shared registry lands there, not in public.
        Using.resource(c.createStatement())(_.execute("SET LOCAL search_path = manure, public"))
        CatalogueProjection.initialize(c)
        new PostgresRetrieval("manure",Some(profile)).initialize(c)
        c.commit()
      }
    override def afterAll(): Unit = name.foreach(created => execute(maintenance,List("DROP DATABASE " + created + " WITH (FORCE)")))
  override def munitFixtures = List(fresh)

  private final case class Checked(exit: Int,lines: List[String],err: String):
    def last: String = lines.lastOption.getOrElse("")
    def counters: Map[String,String] = lines.filter(line => line.startsWith("LP.") || line.startsWith("LF.")).map { line =>
      val separator = line.indexOf('|'); line.take(separator) -> line.drop(separator+1)
    }.toMap -- List("LF.database","LF.result")
  private def checked(name: String): Checked =
    assert(Files.isRegularFile(check),s"missing retained check $check")
    val psql = sys.env("PATH").split(java.io.File.pathSeparatorChar).iterator.map(Path.of(_,"psql")).find(Files.isExecutable(_))
      .getOrElse(throw new IllegalStateException("psql required on PATH (nix develop .#chronicle)")).toString
    val address = url.stripPrefix("jdbc:postgresql://").takeWhile(_ != '/')
    val connection = Map("PGHOST" -> address.takeWhile(_ != ':'),"PGPORT" -> address.dropWhile(_ != ':').drop(1),"PGUSER" -> user,
      "PGPASSWORD" -> password,"PGDATABASE" -> name,
      // As the operator runs it: a superuser session whose search_path ("$user", public for postgres) excludes manure.
      "PGOPTIONS" -> "-c search_path=public")
    val ran = CheckChild.run(List(psql,"-X","-q","-v","ON_ERROR_STOP=1","-f",check.toString),sys.env,connection,CheckChild.limit)
    Checked(ran.exit,ran.out.linesIterator.toList,ran.err)
  /** A copy of the fresh database with the seed applied. */
  private def copy(seed: List[String]): Checked =
    val name = "manure_legacy_free_case_" + UUID.randomUUID().toString.replace("-","")
    execute(maintenance,List("CREATE DATABASE " + name + " TEMPLATE " + fresh()))
    try { execute(name,seed); checked(name) } finally execute(maintenance,List("DROP DATABASE " + name + " WITH (FORCE)"))

  test("a fresh database of the current binary with a configured retrieval profile: last line LF.result|legacy-free, exit 0") {
    val ran = copy(Nil)
    assertEquals((ran.exit,ran.last),(0,"LF.result|legacy-free"),ran.err)
    assertEquals(ran.counters,clean)
  }
  List(
    "a v1" -> s"""["embedding-space-v1","${"e" * 64}","embed","v1",3,false,"query: ","passage: ","cosine"]""",
    "a non-JSON" -> "embedding-space-v2").foreach { (kind,descriptor) =>
    test(s"seeded: $kind retrieval profile descriptor -> LP.retrieval.not_proven_v2|1, LF.result|legacy-present, exit 3") {
      val ran = copy(List(s"INSERT INTO manure.pony_retrieval_profiles VALUES ('seeded', 'seeded-profile', 'seeded-space', '$descriptor', convert_to('seeded-policy', 'UTF8'))"))
      assertEquals((ran.exit,ran.last),(3,"LF.result|legacy-present"),ran.err)
      assert(ran.err.contains("manure legacy-free check failed"),ran.err)
      assertEquals(ran.counters,Map("LP.retrieval.profiles" -> "2","LP.retrieval.not_proven_v2" -> "1"))
    }
  }
  test("the registry not in schema manure (moved to public): LF.missing|manure.pony_retrieval_profiles, LF.result|refused-missing-objects, exit 3, nothing counted") {
    val ran = copy(List("ALTER TABLE manure.pony_retrieval_profiles SET SCHEMA public"))
    assertEquals((ran.exit,ran.last),(3,"LF.result|refused-missing-objects"),ran.err)
    assert(ran.lines.contains("LF.missing|manure.pony_retrieval_profiles"),ran.lines.mkString("\n"))
    assert(ran.err.contains("expected tables do not resolve"),ran.err)
    assertEquals(ran.counters,Map("LF.missing" -> "manure.pony_retrieval_profiles"))
  }

/** The check's psql child, the helper of Chronicle's and Haystack's LegacyFreeCheckTest. Environment: an allow-list of
  * tool locations and locale plus the fixture's connection, so no inherited PGHOSTADDR, PGSERVICE or PGPASSFILE can
  * redirect it. Wait: bounded; on timeout or interruption the child and its descendants are killed and awaited, again
  * bounded.
  */
private[manure] object CheckChild {
  val inherited: Set[String] = Set("PATH", "LANG", "LC_ALL", "TMPDIR")
  /** A run of the check on a fixture database takes well under a second; the bound only stops a hung child. */
  val limit: FiniteDuration = 20.seconds
  /** How long killed processes may take to be gone. */
  val reapLimit: FiniteDuration = 5.seconds
  final case class Result(exit: Int, out: String, err: String)
  def run(command: List[String], parent: Map[String, String], fixture: Map[String, String], limit: FiniteDuration): Result = {
    val builder = new ProcessBuilder(command.asJava)
    val env = builder.environment(); env.clear(); env.putAll((parent.filter(entry => inherited.contains(entry._1)) ++ fixture).asJava)
    val out = Files.createTempFile("legacy-free-check-", ".out"); val err = Files.createTempFile("legacy-free-check-", ".err")
    builder.redirectOutput(out.toFile).redirectError(err.toFile)
    try {
      val process = builder.start()
      val finished = try process.waitFor(limit.toMillis, TimeUnit.MILLISECONDS) catch { case interrupted: InterruptedException => destroy(process); throw interrupted }
      if (!finished) { destroy(process); throw new TimeoutException(s"${command.head} did not finish within $limit") }
      Result(process.exitValue(), Files.readString(out, UTF_8), Files.readString(err, UTF_8))
    } finally { Files.delete(out); Files.delete(err) }
  }
  /** Kills the descendants and the child, then waits until each is gone, within `reapLimit` in total. */
  private def destroy(process: Process): Unit = {
    val family = process.descendants().iterator().asScala.toList :+ process.toHandle
    family.foreach(_.destroyForcibly())
    val deadline = System.nanoTime() + reapLimit.toNanos
    family.foreach { handle =>
      try handle.onExit().get(math.max(0L, deadline - System.nanoTime()), TimeUnit.NANOSECONDS)
      catch { case _: TimeoutException => throw new IllegalStateException(s"process ${handle.pid()} still runs $reapLimit after it was killed") }
    }
  }
}
