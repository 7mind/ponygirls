package chronicle

import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files,Path}
import java.sql.DriverManager
import java.util.{Properties,UUID}
import java.util.concurrent.{TimeUnit,TimeoutException}
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

/** The retained post-deployment check scripts/check-legacy-free.sql, run exactly as the operator runs it (psql -f),
  * on copies of one fresh database of the current binary. The binary's start-up applies the schema clean-up of the
  * legacy data retirement plan (docs/drafts/20261118-1100-legacy-data-retirement.md §6.6): it drops the four model
  * identity tables (migration 21) and adds the current-format check (migration 22). A copy then receives one legacy
  * shape, seeded with plain SQL.
  */
final class LegacyFreeCheckTest extends munit.FunSuite {
  private val check=Path.of("scripts","check-legacy-free.sql")
  private val original=Fixtures.config()
  private def url(database: String): String = original.jdbcUrl.take(original.jdbcUrl.lastIndexOf('/')+1)+database
  private val formatConstraint="ch_generations_current_format_check CHECK(retired OR (passage_format IS NOT NULL AND passage_format='ContextAwareProblems'))"
  /** Every counter line of a passing run (the database name, the migration list and the verdict are asserted apart). */
  private val clean=Map(
    "LP.embedding_spaces.not_proven_v2"->"0","LP.index_profiles.current_policy_not_proven_v2"->"0","LP.index_profiles.space_unregistered"->"0",
    "LP.owner_targets.not_executable"->"0","LP.published.retired_or_unregistered"->"0","LP.generations.unregistered_profile"->"0",
    "LP.sessions.deadline"->"0","LP.generations.not_retired_old_format"->"0",
    "LF.legacy_tables_present"->"0","LF.generations.current_format_constraint"->"1","LF.info.generations.retired_tombstones"->"0")

  private def admin(database: String,statements: Seq[String]): Unit = {
    val properties=new Properties; properties.setProperty("user",original.databaseUser); properties.setProperty("password",Fixtures.databasePassword)
    val connection=DriverManager.getConnection(url(database),properties)
    try statements.foreach { sql=>val statement=connection.createStatement(); try statement.execute(sql) finally statement.close() } finally connection.close()
  }
  private val maintenance=original.jdbcUrl.drop(original.jdbcUrl.lastIndexOf('/')+1)
  /** One fresh database of the current binary (its own start-up), copied for every case. */
  private val fresh=new Fixture[String]("fresh database of the current binary") {
    private var name=Option.empty[String]
    def apply(): String = name.getOrElse(fail("fresh database was not created"))
    override def beforeAll(): Unit = {
      Check(sys.env.contains("CHRONICLE_TEST_JDBC"),"test","owned PostgreSQL fixture required")
      val created="legacy_free_"+UUID.randomUUID().toString.replace("-","")
      admin(maintenance,List(s"CREATE DATABASE $created")); name=Some(created)
      admin(created,List("CREATE EXTENSION vector","CREATE EXTENSION pg_trgm"))
      val config=original.copy(jdbcUrl=url(created)); val db=new Database(config,IndexProfileCatalog.current(config))
      try db.initialize() finally db.close()
    }
    override def afterAll(): Unit = name.foreach(created=>admin(maintenance,List(s"DROP DATABASE $created WITH (FORCE)")))
  }
  override def munitFixtures = List(fresh)

  private final case class Checked(exit: Int,lines: List[String],err: String) {
    def last: String = lines.lastOption.getOrElse("")
    def counters: Map[String,String] = lines.filter(line=>line.startsWith("LP.") || line.startsWith("LF.")).map { line=>
      val separator=line.indexOf('|'); line.take(separator)->line.drop(separator+1)
    }.toMap--List("LF.database","LF.schema_migrations","LF.result")
  }
  private def checked(database: String): Checked = {
    Check(Files.isRegularFile(check),"test",s"missing retained check $check")
    val psql=Path.of(sys.env.getOrElse("POSTGRES_HOME",throw DomainError("test","POSTGRES_HOME required (nix develop .#chronicle)")),"bin","psql").toString
    val address=original.jdbcUrl.stripPrefix("jdbc:postgresql://").takeWhile(_!='/')
    val connection=Map("PGHOST"->address.takeWhile(_!=':'),"PGPORT"->address.dropWhile(_!=':').drop(1),
      "PGUSER"->original.databaseUser,"PGPASSWORD"->Fixtures.databasePassword,"PGDATABASE"->database,
      // F1: the tables are in public; a session whose search_path does not reach them must still find them (or refuse).
      "PGOPTIONS"->"-c search_path=lr_nowhere")
    val ran=CheckChild.run(List(psql,"-X","-q","-v","ON_ERROR_STOP=1","-f",check.toString),sys.env,connection,CheckChild.limit)
    Checked(ran.exit,ran.out.linesIterator.toList,ran.err)
  }
  private val noProductWrites: Config=>Unit = _=>()
  /** A copy of the fresh database with `writes` (product code) and the seed applied, in this order. */
  private def copy[A](writes: Config=>Unit,seed: List[String])(body: String=>A): A = {
    val name="legacy_free_case_"+UUID.randomUUID().toString.replace("-","")
    admin(maintenance,List(s"CREATE DATABASE $name TEMPLATE ${fresh()}"))
    try { writes(original.copy(jdbcUrl=url(name))); admin(name,seed); body(name) } finally admin(maintenance,List(s"DROP DATABASE $name WITH (FORCE)"))
  }

  test("a fresh database of the current binary: last line LF.result|legacy-free, exit 0, every counter clean") {
    val ran=copy(noProductWrites,Nil)(checked)
    assertEquals((ran.exit,ran.last),(0,"LF.result|legacy-free"),ran.err)
    assertEquals(ran.counters,clean)
  }
  test("a publication of the current binary, and a retired old-format tombstone under a retired-policy profile, stay legacy-free") {
    val ran=copy(publishCurrent,List(retiredPolicyProfile,
      s"INSERT INTO ch_sources(id,owner,source_key) VALUES('$source','b','retired-source')",
      s"INSERT INTO ch_generations(id,session_id,revision,profile,passage_format,retired) VALUES('$generation','$source',0,'$retiredProfile','LegacyAnnotations',true)"))(checked)
    assertEquals((ran.exit,ran.last),(0,"LF.result|legacy-free"),ran.err)
    assertEquals(ran.counters,clean+("LF.info.generations.retired_tombstones"->"1"))
  }

  private val space="(SELECT id FROM ch_embedding_spaces)"   // the one space a fresh database registers
  private val currentProfile="(SELECT profile FROM ch_index_profiles)"   // and its one profile
  private val endpointHash="e"*64
  private val source=UUID.fromString("00000000-0000-4000-8000-000000000001"); private val generation=UUID.fromString("00000000-0000-4000-8000-000000000002")
  private val retiredProfile="f"*64
  private val retiredPolicyProfile=s"""INSERT INTO ch_index_profiles VALUES('$retiredProfile',$space,'LegacyV4','{"syntheticHistoricalPolicy":"LegacyV4"}')"""
  private def publishCurrent(config: Config): Unit = {
    val catalog=IndexProfileCatalog.current(config); val db=new Database(config,catalog)
    try {
      val archive=new PostgresArchive(db,config); archive.ingest("a",Fixtures.snapshot())
      val claim=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).getOrElse(fail("no claimable job"))
      assert(archive.publish(claim,Fragments.split(claim.messages.decoded).map(chunk=>IndexedChunk(chunk.copy(sessionId=claim.sessionId,summary="current problem"),List(1.0,0.0,0.0)))))
    } finally db.close()
  }
  private def publishedSource(generationColumns: String,generationValues: String): List[String] = List(
    s"INSERT INTO ch_sources(id,owner,source_key,published) VALUES('$source','a','seeded-source','$generation')",
    s"INSERT INTO ch_generations(id,session_id,revision,$generationColumns) VALUES('$generation','$source',0,$generationValues)")
  private final case class Seed(name: String,sql: List[String],changed: Map[String,String])
  private final case class Descriptors(kind: String,space: String,profile: String)
  private val descriptors=List(
    Descriptors("a v1",s"""["embedding-space-v1","$endpointHash","embed","v1",3,false,"query: ","passage: ","cosine"]""",
      s"""["index-profile-descriptor-v1",["$endpointHash","model","v1","strict-json-schema","65536"],"context-aware-problems"]"""),
    Descriptors("an empty","[]","[]"),
    Descriptors("a [null]","[null]","[null]"),
    Descriptors("a wrong-shape","""["embedding-space-v2","embed","v1","3",false,"query: ","passage: ","cosine"]""",
      """["index-profile-descriptor-v2",["model","v1","strict-json-schema",65536],"context-aware-problems"]"""))
  private val seeds=descriptors.flatMap(descriptor=>List(
    Seed(s"${descriptor.kind} embedding space descriptor",List(s"INSERT INTO ch_embedding_spaces VALUES('seeded-space','${descriptor.space}')"),
      Map("LP.embedding_spaces.not_proven_v2"->"1")),
    Seed(s"${descriptor.kind} current-policy index profile descriptor",List(s"INSERT INTO ch_index_profiles VALUES('seeded-profile',$space,'ContextAwareProblemsV1','${descriptor.profile}')"),
      Map("LP.index_profiles.current_policy_not_proven_v2"->"1"))))++List(
    // The foreign key forbids this row; the counter is defensive, so the seed drops the key first.
    Seed("an index profile on an unregistered embedding space",List("ALTER TABLE ch_index_profiles DROP CONSTRAINT ch_index_profiles_embedding_space_fkey",
      "INSERT INTO ch_index_profiles SELECT 'seeded-profile','unregistered-space',policy,descriptor FROM ch_index_profiles"),Map("LP.index_profiles.space_unregistered"->"1")),
    Seed("an owner target on a retired-policy profile",List(retiredPolicyProfile,s"UPDATE ch_owner_targets SET profile='$retiredProfile' WHERE owner='a'"),
      Map("LP.owner_targets.not_executable"->"1")),
    Seed("a published retired generation",publishedSource("profile,passage_format,retired",s"$currentProfile,'ContextAwareProblems',true"),
      Map("LP.published.retired_or_unregistered"->"1","LF.info.generations.retired_tombstones"->"1")),
    Seed("a generation of an unregistered profile",List(s"INSERT INTO ch_sources(id,owner,source_key) VALUES('$source','a','seeded-source')",
      s"INSERT INTO ch_generations(id,session_id,revision,profile,passage_format) VALUES('$generation','$source',0,'unregistered-profile','ContextAwareProblems')"),
      Map("LP.generations.unregistered_profile"->"1")),
    Seed("a session with a deadline",List("INSERT INTO ch_sessions(hash,owner,expires) VALUES('seeded-deadline-session','a',clock_timestamp()+interval '1 day')"),
      Map("LP.sessions.deadline"->"1")),
    // The current-format check (migration 22) forbids this row in a new write; it models a row older than the check (NOT VALID).
    Seed("a published old-format generation",List("ALTER TABLE ch_generations DROP CONSTRAINT ch_generations_current_format_check")++
      publishedSource("profile,passage_format",s"$currentProfile,'LegacyAnnotations'")++List(s"ALTER TABLE ch_generations ADD CONSTRAINT $formatConstraint NOT VALID"),
      Map("LP.generations.not_retired_old_format"->"1")),
    // Presence is all the check reads of the four tables the start-up drops (a previous release re-creates them).
    Seed("the legacy tables",List("ch_retained_profile_reads","ch_checkpoint_namespaces","ch_model_identity_migrations","ch_profile").map(table=>s"CREATE TABLE $table()"),
      Map("LF.legacy_tables_present"->"4")),
    Seed("no current-format constraint",List("ALTER TABLE ch_generations DROP CONSTRAINT ch_generations_current_format_check"),Map("LF.generations.current_format_constraint"->"0")))
  test("an expected table that does not resolve: LF.missing|public.ch_sessions, LF.result|refused-missing-objects, exit 3, nothing counted") {
    val ran=copy(noProductWrites,List("DROP TABLE ch_sessions CASCADE"))(checked)
    assertEquals((ran.exit,ran.last),(3,"LF.result|refused-missing-objects"),ran.err)
    assert(ran.err.contains("expected tables do not resolve"),ran.err)
    assertEquals(ran.counters,Map("LF.missing"->"public.ch_sessions"))
  }
  seeds.foreach { seed=>
    test(s"seeded: ${seed.name} -> ${seed.changed.map(_+"|"+_).mkString(", ")}, LF.result|legacy-present, exit 3") {
      val ran=copy(noProductWrites,seed.sql)(checked)
      assertEquals((ran.exit,ran.last),(3,"LF.result|legacy-present"),ran.err)
      assert(ran.err.contains("chronicle legacy-free check failed"),ran.err)
      assertEquals(ran.counters,clean++seed.changed)
    }
  }
}

/** The check's psql child. Environment: an allow-list of tool locations and locale plus the fixture's connection, so no
  * inherited PGHOSTADDR, PGSERVICE or PGPASSFILE can redirect it. Wait: bounded; on timeout or interruption the child
  * and its descendants are killed and awaited, again bounded.
  */
private[chronicle] object CheckChild {
  val inherited: Set[String]=Set("PATH","LANG","LC_ALL","TMPDIR")
  /** A run of the check on a fixture database takes well under a second; the bound only stops a hung child. */
  val limit: FiniteDuration=20.seconds
  /** How long killed processes may take to be gone. */
  val reapLimit: FiniteDuration=5.seconds
  final case class Result(exit: Int,out: String,err: String)
  def run(command: List[String],parent: Map[String,String],fixture: Map[String,String],limit: FiniteDuration): Result = {
    val builder=new ProcessBuilder(command.asJava)
    val env=builder.environment(); env.clear(); env.putAll((parent.filter(entry => inherited.contains(entry._1))++fixture).asJava)
    val out=Files.createTempFile("legacy-free-check-",".out"); val err=Files.createTempFile("legacy-free-check-",".err")
    builder.redirectOutput(out.toFile).redirectError(err.toFile)
    try {
      val process=builder.start()
      val finished=try process.waitFor(limit.toMillis,TimeUnit.MILLISECONDS) catch { case interrupted: InterruptedException => destroy(process); throw interrupted }
      if(!finished) { destroy(process); throw new TimeoutException(s"${command.head} did not finish within $limit") }
      Result(process.exitValue(),Files.readString(out,UTF_8),Files.readString(err,UTF_8))
    } finally { Files.delete(out); Files.delete(err) }
  }
  /** Kills the descendants and the child, then waits until each is gone, within `reapLimit` in total. */
  private def destroy(process: Process): Unit = {
    val family=process.descendants().iterator().asScala.toList:+process.toHandle
    family.foreach(_.destroyForcibly())
    val deadline=System.nanoTime()+reapLimit.toNanos
    family.foreach { handle =>
      try handle.onExit().get(math.max(0L,deadline-System.nanoTime()),TimeUnit.NANOSECONDS)
      catch { case _: TimeoutException => throw new IllegalStateException(s"process ${handle.pid()} still runs $reapLimit after it was killed") }
    }
  }
}
