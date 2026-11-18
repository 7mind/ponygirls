package chronicle

import chronicle.api.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.{Files,Path}
import java.sql.DriverManager
import java.util.{Properties,UUID}
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

/** One-off: exercises scripts/one-off/legacy-retirement against a database that holds every Chronicle legacy shape,
  * built with the fixtures of ModelIdentityMigrationTest, StoredPublicationFixtures and the product's own relocation
  * and rebuild code. Deleted together with the legacy code once production is migrated (see that directory's README).
  */
final class LegacyRetirementScriptsTest extends munit.FunSuite {
  override val munitTimeout: Duration = 5.minutes
  private val vector=List(1.0,0.0,0.0)
  private final case class Ran(exit: Int,out: String,err: String) {
    def value(key: String): String = out.linesIterator.collectFirst { case line if line.startsWith(key+"|") => line.drop(key.length+1) }.getOrElse(fail(s"no $key in script output:\n$out\n$err"))
    def count(key: String): Long = value(key).toLong
    def steps(key: String): Long = out.linesIterator.collect { case line if line.startsWith(s"LR.step.$key|") => line.drop(key.length+9).toLong }.sum
  }
  private final class Scratch(val config: Config,val name: String,host: String,port: String) {
    val catalog: IndexProfileCatalog = IndexProfileCatalog.current(config)
    val db: Database = new Database(config,catalog)
    val archive=new PostgresArchive(db,config)
    def run(arguments: String*): Ran = runIn(name,arguments*)
    def runIn(database: String,arguments: String*): Ran = {
      val script=Path.of("..","scripts","one-off","legacy-retirement","run.sh").toAbsolutePath.normalize()
      Check(Files.isRegularFile(script),"test","legacy retirement driver is absent")
      val builder=new ProcessBuilder((List("sh",script.toString,"chronicle")++arguments).asJava)
      val env=builder.environment()
      List("PGSERVICE","PGOPTIONS","PGSSLMODE").foreach(env.remove)
      env.put("PGHOST",host); env.put("PGPORT",port); env.put("PGUSER",config.databaseUser); env.put("PGPASSWORD",Fixtures.databasePassword); env.put("PGDATABASE",database)
      env.put("PSQL",Path.of(sys.env.getOrElse("POSTGRES_HOME",throw DomainError("test","POSTGRES_HOME required (nix develop .#chronicle)")),"bin","psql").toString)
      val out=Files.createTempFile("legacy-retirement-",".out"); val err=Files.createTempFile("legacy-retirement-",".err")
      builder.redirectOutput(out.toFile).redirectError(err.toFile)
      val exit=builder.start().waitFor()
      try Ran(exit,Files.readString(out,UTF_8),Files.readString(err,UTF_8)) finally { Files.delete(out); Files.delete(err) }
    }
    /** A plain psql file against the scratch database (the retained check, the proposed clean-up schema). */
    def psql(file: Path): Ran = {
      Check(Files.isRegularFile(file),"test",s"missing SQL file $file")
      val builder=new ProcessBuilder(List(Path.of(sys.env("POSTGRES_HOME"),"bin","psql").toString,"-X","-q","-v","ON_ERROR_STOP=1","-f",file.toString).asJava)
      val env=builder.environment()
      List("PGSERVICE","PGOPTIONS","PGSSLMODE").foreach(env.remove)
      env.put("PGHOST",host); env.put("PGPORT",port); env.put("PGUSER",config.databaseUser); env.put("PGPASSWORD",Fixtures.databasePassword); env.put("PGDATABASE",name)
      val out=Files.createTempFile("legacy-retirement-",".out"); val err=Files.createTempFile("legacy-retirement-",".err")
      builder.redirectOutput(out.toFile).redirectError(err.toFile)
      val exit=builder.start().waitFor()
      try Ran(exit,Files.readString(out,UTF_8),Files.readString(err,UTF_8)) finally { Files.delete(out); Files.delete(err) }
    }
    def one[A](sql: String,args: Sql.Param*)(read: java.sql.ResultSet=>A): A = db.transaction(c=>Sql.one(c,sql,args*)(read).get)
    def count(sql: String,args: Sql.Param*): Long = one(sql,args*)(_.getLong(1))
    def exec(sql: String,args: Sql.Param*): Unit = db.transaction { c=>Sql.exec(c,sql,args*); () }
    /** Every row of every Chronicle table, to prove that a mode changed nothing. */
    def everything(): List[String] = db.transaction { c=>
      val tables=Sql.rows(c,"SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ch\\_%' ORDER BY tablename")(_.getString(1))
      tables.flatMap(table=>Sql.rows(c,s"SELECT '$table '||md5(to_jsonb(t)::text) FROM $table t ORDER BY 1")(_.getString(1)))
    }
    def plan(): String = { val preflight=run("preflight"); assertEquals(preflight.exit,0,preflight.err); preflight.value("LR.plan") }
  }
  private def withScratch(body: Scratch=>Unit): Unit = {
    Check(sys.env.contains("CHRONICLE_TEST_JDBC"),"test","owned PostgreSQL fixture required")
    val original=Fixtures.config()
    val url=original.jdbcUrl; val base=url.take(url.lastIndexOf('/')+1)
    val address=url.stripPrefix("jdbc:postgresql://").takeWhile(_!='/'); val host=address.takeWhile(_!=':'); val port=address.dropWhile(_!=':').drop(1)
    val name="legacy_retirement_"+UUID.randomUUID().toString.replace("-","")
    def admin(target: String,statements: String*): Unit = {
      val properties=new Properties; properties.setProperty("user",original.databaseUser); properties.setProperty("password",Fixtures.databasePassword)
      val connection=DriverManager.getConnection(target,properties)
      try statements.foreach { sql=>val statement=connection.createStatement(); try statement.execute(sql) finally statement.close() } finally connection.close()
    }
    admin(url,s"CREATE DATABASE $name")
    try {
      admin(base+name,"CREATE EXTENSION vector","CREATE EXTENSION pg_trgm")
      val scratch=new Scratch(original.copy(jdbcUrl=base+name),name,host,port)
      try { scratch.db.initialize(); body(scratch) } finally scratch.db.close()
    } finally admin(url,s"DROP DATABASE $name WITH (FORCE)")
  }
  // The v1 identities exactly as ModelIdentityMigrationTest derives them (transport hash prepended).
  private def legacyIdentity(config: Config): (String,Json,String,Json) = {
    val catalog=IndexProfileCatalog.current(config)
    val space=Json.arr((Vector(Json.fromString("embedding-space-v1"),Json.fromString(Wire.hash(config.embedding.endpoint)))++catalog.preferred.embedding.json.asArray.get.tail)*)
    val spaceId=Wire.hash(space.noSpaces)
    val current=catalog.preferred.descriptor.asArray.get
    val descriptor=Json.arr(Json.fromString("index-profile-descriptor-v1"),Json.arr((Vector(Json.fromString(Wire.hash(config.annotation.endpoint)))++current(1).asArray.get)*),current(2))
    (spaceId,space,Wire.hash(Json.arr(Json.fromString("context-aware-problems-profile-v1"),Json.fromString(spaceId),descriptor).noSpaces),descriptor)
  }
  private def chunks(claim: Claim,summary: String): List[IndexedChunk] =
    Fragments.split(claim.snapshot.messages).map(value=>IndexedChunk(value.copy(sessionId=claim.sessionId,summary=summary),vector))
  private def claimOf(s: Scratch,owner: String): Claim = s.archive.claim(s.catalog.knownProfiles,ClaimScope.Owner(owner),300).getOrElse(fail(s"no claimable job for $owner"))
  private final case class Seeded(relocated: UUID,retained: UUID,unfinished: UUID,unfinishedJob: UUID,history: UUID,historyPin: ContentView,
    legacyAnnotations: UUID,legacyAnnotationsPin: ContentView,contiguous: UUID,contiguousPin: ContentView,tombstoned: UUID,tombstonePin: ContentView,
    retainedProfile: String,canonicalRetainedProfile: String,contiguousProfile: String,annotationKey: CheckpointKey)

  /** owner a: one source relocated by the product CLI (L), one readable through a retained approval (R, same model,
    * older annotation policy), one Failed run that began under L, one source with superseded but still readable
    * LegacyAnnotations history. owner b: one source published as LegacyAnnotations and one as ContiguousProblems
    * under a v1-space profile. owner c: a LegacyAnnotations generation the product already retired by a rebuild.
    */
  private def seed(s: Scratch): Seeded = {
    val (config,db,archive,catalog)=(s.config,s.db,s.archive,s.catalog)
    val (spaceId,space,active,activeDescriptor)=legacyIdentity(config)
    val older=config.copy(annotation=config.annotation.copy(maxResponseBytes=config.annotation.maxResponseBytes-1))
    val (_,_,retained,retainedDescriptor)=legacyIdentity(older)
    val published=List.fill(2)(archive.ingest("a",Fixtures.snapshot())).map { _=>
      val claim=claimOf(s,"a"); assert(archive.publish(claim,chunks(claim,"retained synthetic problem"))); claim
    }
    val pending=archive.ingest("a",Fixtures.snapshot()); val running=claimOf(s,"a")
    assertEquals(running.jobId,pending.jobId)
    val old=running.copy(profile=active)
    val input=Json.obj("synthetic-input"->Json.fromString("accepted-before-relocation"))
    val annotation=IndexCheckpoints.key(old,IndexingStage.Annotation,0,0,ProblemPassages.identity,input)
    archive.checkpoint(running,annotation,input)
    archive.checkpoint(running,IndexCheckpoints.key(old,IndexingStage.Embedding,0,0,spaceId,input),Json.arr(Json.arr(Json.fromInt(1),Json.fromInt(0),Json.fromInt(0))))
    db.transaction { c=>
      Sql.exec(c,"INSERT INTO ch_embedding_spaces VALUES(?,?::jsonb)",spaceId,space.noSpaces)
      List(active->activeDescriptor,retained->retainedDescriptor).foreach { (profile,descriptor)=>
        Sql.exec(c,"INSERT INTO ch_index_profiles VALUES(?,?,'ContextAwareProblemsV1',?::jsonb)",profile,spaceId,descriptor.noSpaces)
      }
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=? WHERE owner='a'",active)
      List(published(0).sessionId->active,published(1).sessionId->retained,running.sessionId->active).foreach { (session,profile)=>
        List("ch_jobs","ch_generations","ch_search_chunks").foreach(table=>Sql.exec(c,s"UPDATE $table SET profile=? WHERE session_id=?",profile,session))
      }
      Sql.exec(c,"UPDATE ch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",running.jobId)
      // The product's own relocation and retained-read approval: mapping row, checkpoint namespaces, proof row.
      ModelIdentityMigration(c,catalog,ModelIdentityPlan(Set(active),Vector(RetainedReadApproval(retained,spaceId,ReadableIndexPolicy.ContextAwareProblemsV1,Wire.hash(retainedDescriptor.noSpacesSortKeys))),catalog.preferred.profile))
      Sql.exec(c,"UPDATE ch_jobs SET state='Failed',error='model-http',failure_stage='Annotation',lease_until=NULL WHERE id=?",running.jobId)
    }
    // Superseded LegacyAnnotations history under an ordinary (non-rebuild) publication: stays readable, not retired.
    val historyRequest=Fixtures.snapshot(); val history=archive.ingest("a",historyRequest)
    val first=claimOf(s,"a"); StoredPublicationFixtures.publish(db,first,chunks(first,"legacy annotations"))
    val historyPin=archive.session("a",history.sessionId).view
    archive.ingest("a",historyRequest.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    val second=claimOf(s,"a"); assert(archive.publish(second,chunks(second,"current problem")))
    // owner b: both retired output formats, published.
    val legacyAnnotations=archive.ingest("b",Fixtures.snapshot()); val legacyClaim=claimOf(s,"b")
    StoredPublicationFixtures.publish(db,legacyClaim,chunks(legacyClaim,"legacy annotations"))
    val legacyAnnotationsPin=archive.session("b",legacyAnnotations.sessionId).view
    val contiguous=archive.ingest("b",Fixtures.snapshot()); val contiguousClaim=claimOf(s,"b")
    assert(archive.publish(contiguousClaim,chunks(contiguousClaim,"contiguous problem")))
    val contiguousPin=archive.session("b",contiguous.sessionId).view
    val contiguousProfile=Wire.hash("synthetic-retained-ContiguousPassagesV1"); val contiguousDescriptor=Json.obj("syntheticHistoricalPolicy"->Json.fromString("ContiguousPassagesV1"))
    db.transaction { c=>
      Sql.exec(c,"INSERT INTO ch_index_profiles VALUES(?,?,'ContiguousPassagesV1',?::jsonb)",contiguousProfile,spaceId,contiguousDescriptor.noSpaces)
      List("ch_jobs","ch_generations","ch_search_chunks").foreach(table=>Sql.exec(c,s"UPDATE $table SET profile=? WHERE session_id=?",contiguousProfile,contiguous.sessionId))
      Sql.exec(c,"UPDATE ch_generations SET passage_format='ContiguousProblems' WHERE session_id=?",contiguous.sessionId)
      ModelIdentityMigration(c,catalog,ModelIdentityPlan(Set.empty,Vector(RetainedReadApproval(contiguousProfile,spaceId,ReadableIndexPolicy.ContiguousPassagesV1,Wire.hash(contiguousDescriptor.noSpacesSortKeys))),catalog.preferred.profile))
      // Production's singleton still names a pre-owner-target profile; a session row carries a pre-020 deadline.
      Sql.exec(c,"UPDATE ch_profile SET active=?,target=?",contiguousProfile,contiguousProfile)
      Sql.exec(c,"INSERT INTO ch_sessions(hash,owner,expires) VALUES(?,'a',clock_timestamp()+interval '1 day')",Wire.hash("synthetic-deadline-session"))
    }
    // owner c: a LegacyAnnotations generation that a product rebuild has already retired (a tombstone).
    val tombstoned=archive.ingest("c",Fixtures.snapshot()); val tombstoneClaim=claimOf(s,"c")
    StoredPublicationFixtures.publish(db,tombstoneClaim,chunks(tombstoneClaim,"legacy annotations"))
    val tombstonePin=archive.session("c",tombstoned.sessionId).view
    Fixtures.rebuild(db,"c"); val rebuilt=claimOf(s,"c"); assert(archive.publish(rebuilt,chunks(rebuilt,"current problem")))
    Seeded(published(0).sessionId,published(1).sessionId,running.sessionId,running.jobId,history.sessionId,historyPin,legacyAnnotations.sessionId,legacyAnnotationsPin,
      contiguous.sessionId,contiguousPin,tombstoned.sessionId,tombstonePin,retained,IndexProfileCatalog.current(older).preferred.profile,contiguousProfile,annotation)
  }
  // Semantic totals count the reader's visible published sources within the candidate window: every one must be readable.
  private def semanticTotal(s: Scratch,reader: String,text: String): Int =
    new PostgresSearch(s.db,s.archive,s.config).search(reader,SearchQuery(text,SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),20,0),Some(vector)).total
  /** A pinned historical read: the number of chunks, or the product's error code. */
  private def pinned(s: Scratch,reader: String,session: UUID,view: ContentView): Either[String,Int] =
    try Right(s.archive.pageChunks(reader,session,0,10,Some(view)).chunks.size) catch { case error: DomainError => Left(error.code) }
  private def generationRow(s: Scratch,view: ContentView): String = s.one("SELECT md5(to_jsonb(g)::text) FROM ch_generations g WHERE id=?",view.generationId.get)(_.getString(1))

  // Part of the service's full suite (the suite check's source includes scripts/one-off/legacy-retirement and the
  // retained check-legacy-free.sql); deleted together with the one-off scripts (that directory's README).
  test("legacy retirement: identity without the formats item, then formats by re-index and explicit retirement; pinned reads, refusals, idempotence, current-code reads, clean-up schema") { withScratch { s=>
    val seeded=seed(s)
    def apply(arguments: String*): Ran = s.run((List("apply","--apply-irreversible","--confirm-database",s.name,"--backup-reference","fixture-backup")++arguments)*)
    // The current binary serves the legacy database before anything is migrated.
    assertEquals((semanticTotal(s,"a","x"),semanticTotal(s,"b","x"),semanticTotal(s,"c","x")),(3,2,1))
    // Pinned historical reads before: published old format, unpublished non-retired history, product-retired tombstone.
    assertEquals(pinned(s,"b",seeded.legacyAnnotations,seeded.legacyAnnotationsPin),Right(1)); assertEquals(pinned(s,"b",seeded.contiguous,seeded.contiguousPin),Right(1))
    assertEquals(pinned(s,"a",seeded.history,seeded.historyPin),Right(1)); assertEquals(pinned(s,"c",seeded.tombstoned,seeded.tombstonePin),Left("indexed-view-retired"))
    val tombstoneBefore=generationRow(s,seeded.tombstonePin)

    val preflight=s.run("preflight"); assertEquals(preflight.exit,0,preflight.err)
    assertEquals(preflight.count("LR.spaces.v1"),1L); assertEquals(preflight.count("LR.profiles.v1_space"),3L)
    assertEquals(preflight.count("LR.generations.old_format.published"),2L); assertEquals(preflight.count("LR.generations.old_format.history"),1L)
    assertEquals(preflight.count("LR.info.generations.old_format.retired_tombstones"),1L); assertEquals(preflight.count("LR.generations.v1_space.published"),2L)
    assertEquals(preflight.count("LR.retained_profile_reads"),2L); assertEquals(preflight.count("LR.model_identity_migrations"),1L)
    assertEquals(preflight.count("LR.checkpoint_namespaces"),2L); assertEquals(preflight.count("LR.unfinished_runs.identity_changes"),1L)
    assertEquals(preflight.count("LR.info.unfinished_runs.accepted_checkpoints_to_discard"),2L)
    assertEquals(preflight.count("LR.singleton.legacy_or_unregistered"),1L); assertEquals(preflight.count("LR.sessions.deadline"),1L)
    assert(preflight.count("LR.size.database_bytes")>0L && preflight.count("LR.size.table_data_without_checkpoints_bytes")<=preflight.count("LR.size.table_data_bytes"))
    List("LR.old_format|ContiguousProblems|published|1","LR.old_format|LegacyAnnotations|published|1","LR.old_format|LegacyAnnotations|history|1","LR.old_format|LegacyAnnotations|retired-tombstone|1",
      "LR.reindex_worklist|owner-enabled|ContiguousProblems|head|","LR.reindex_worklist|owner-enabled|LegacyAnnotations|head|",
      "LR.relocation_worklist|ContextAwareProblemsV1|ContextAwareProblems|1","LR.relocation_worklist|ContiguousPassagesV1|ContiguousProblems|1","LR.unfinished_runs|Failed|1").foreach(line=>assert(preflight.out.contains(line),line+"\n"+preflight.out))
    val unverified=s.run("verify"); assertEquals(unverified.exit,3); assertEquals(unverified.value("LR.result"),"verify-nonzero")

    // Default: a published retired-format generation is refused, with the counts by format and state.
    val untouched=s.everything()
    List(s.run("dry-run","--allow-active-connections"),apply("--expect-plan",preflight.value("LR.plan"))).foreach { refused=>
      assertEquals(refused.exit,3,refused.out); assert(refused.err.contains("still published in a retired output format"),refused.err)
      assert(refused.err.contains("ContiguousProblems/published=1, LegacyAnnotations/history=1, LegacyAnnotations/published=1"),refused.err)
    }
    // Refusals of apply: missing acknowledgement, missing backup reference, wrong database name, stale plan, another connection, live lease.
    val token=preflight.value("LR.plan")
    assertEquals(s.run("apply","--confirm-database",s.name,"--expect-plan",token,"--backup-reference","x","--skip-formats").exit,2)
    assertEquals(s.run("apply","--apply-irreversible","--confirm-database",s.name,"--expect-plan",token,"--skip-formats").exit,2)
    val wrongName=s.run("apply","--apply-irreversible","--confirm-database","chronicle","--expect-plan",token,"--backup-reference","x","--skip-formats")
    assertEquals(wrongName.exit,3); assert(wrongName.err.contains("--confirm-database does not name the connected database"),wrongName.err)
    val stale=apply("--expect-plan","1.2.3","--skip-formats")
    assertEquals(stale.exit,3); assert(stale.err.contains("differ from the preflight plan token"),stale.err)
    // I1: the Chronicle apply has no bypass of the connection guard (usage refusal before any session).
    assertEquals(apply("--expect-plan",token,"--skip-formats","--allow-active-connections").exit,2)
    s.db.transaction { _=>
      val connected=apply("--expect-plan",token,"--skip-formats")
      assertEquals(connected.exit,3); assert(connected.err.contains("other client connection"),connected.err)
    }
    s.exec("UPDATE ch_jobs SET state='Running',lease_until=clock_timestamp()+interval '5 minutes' WHERE id=?",seeded.unfinishedJob)
    val leased=apply("--expect-plan",token,"--skip-formats")
    assertEquals(leased.exit,3); assert(leased.err.contains("hold a live lease"),leased.err)
    s.exec("UPDATE ch_jobs SET state='Failed',lease_until=NULL WHERE id=?",seeded.unfinishedJob)
    assertEquals(s.everything(),untouched)

    // The formats item skipped as a whole: the identity item alone. Dry-run keeps nothing; apply in batches of one.
    val dry=s.run("dry-run","--skip-formats","--allow-active-connections","--batch-size","1"); assertEquals(dry.exit,0,dry.err)
    assertEquals(dry.value("LR.result"),"dry-run-rolled-back"); assertEquals(dry.steps("unfinished_runs_reset"),1L); assertEquals(dry.steps("unfinished_run_checkpoints_deleted"),2L)
    assertEquals(dry.count("LR.step.profiles_relocated"),1L); assertEquals(dry.count("LR.step.retired_policy_profiles_rehomed"),1L); assertEquals(dry.count("LR.after.spaces.v1"),0L)
    assertEquals(s.everything(),untouched)
    val identity=apply("--expect-plan",token,"--skip-formats","--batch-size","1"); assertEquals(identity.exit,0,identity.err+identity.out)
    assertEquals(identity.value("LR.result"),"applied"); assertEquals(identity.value("LR.formats"),"skipped"); assertEquals(identity.value("LR.backup_reference"),"fixture-backup")
    assertEquals(identity.count("LR.step.profiles_relocated"),1L); assertEquals(identity.count("LR.step.retired_policy_profiles_rehomed"),1L)
    assertEquals(identity.count("LR.step.retained_profile_reads_deleted"),2L); assertEquals(identity.count("LR.step.model_identity_migrations_deleted"),1L)
    assertEquals(identity.count("LR.step.v1_embedding_spaces_deleted"),1L); assertEquals(identity.count("LR.step.sessions_made_persistent"),1L)
    assertEquals(identity.steps("history_generations_retired"),0L)
    val identityVerified=s.run("verify","--skip-formats"); assertEquals(identityVerified.exit,0,identityVerified.out+identityVerified.err); assertEquals(identityVerified.value("LR.result"),"verify-zero"); assertEquals(identityVerified.value("LR.formats"),"skipped")
    assertEquals(s.run("verify").exit,3)
    // Nothing was deleted: every generation, job and rebuild receipt is still there; both old formats are still served.
    assertEquals(s.count("SELECT count(*) FROM ch_generations"),untouched.count(_.startsWith("ch_generations ")).toLong)
    assertEquals(s.count("SELECT count(*) FROM ch_jobs"),untouched.count(_.startsWith("ch_jobs ")).toLong)
    s.db.initialize()
    s.db.transaction { c=>List("a","b","c").foreach(reader=>IndexProfiles.semantic(c,reader,s.archive.visible,s.catalog.preferred.embedding)) }
    assertEquals((semanticTotal(s,"a","x"),semanticTotal(s,"b","x"),semanticTotal(s,"c","x")),(3,2,1))
    assertEquals(s.archive.passages("b",seeded.contiguous,0,10,None).format,PassageFormat.ContiguousProblems)
    assertEquals(s.archive.passages("b",seeded.legacyAnnotations,0,10,None).format,PassageFormat.LegacyAnnotations)
    assertEquals(pinned(s,"b",seeded.legacyAnnotations,seeded.legacyAnnotationsPin),Right(1)); assertEquals(pinned(s,"b",seeded.contiguous,seeded.contiguousPin),Right(1))
    assertEquals(pinned(s,"a",seeded.history,seeded.historyPin),Right(1)); assertEquals(pinned(s,"c",seeded.tombstoned,seeded.tombstonePin),Left("indexed-view-retired"))
    // The retained profile now carries the identity the product itself derives for that model and annotation policy;
    // the retired-policy profile keeps its id and is re-homed onto the configured space.
    assertEquals(s.one("SELECT g.profile FROM ch_sources s JOIN ch_generations g ON g.id=s.published WHERE s.id=?",seeded.retained)(_.getString(1)),seeded.canonicalRetainedProfile)
    assertEquals(s.count("SELECT count(*) FROM ch_search_chunks WHERE session_id=? AND profile=?",seeded.retained,seeded.canonicalRetainedProfile),1L)
    assertEquals(s.one("SELECT embedding_space FROM ch_index_profiles WHERE profile=?",seeded.contiguousProfile)(_.getString(1)),s.catalog.preferred.embedding.id)
    assertEquals(s.count("SELECT count(*) FROM ch_profile WHERE active=? AND target=?",s.catalog.preferred.profile,s.catalog.preferred.profile),1L)
    assertEquals(s.archive.readSession("a",seeded.retained,None).chunks.size,1)
    // A second identity apply finds nothing and changes nothing.
    val afterIdentity=s.everything()
    val identityAgain=apply("--expect-plan",s.plan(),"--skip-formats"); assertEquals(identityAgain.exit,0,identityAgain.err)
    assertEquals(identityAgain.count("LR.step.profiles_relocated"),0L); assertEquals(s.everything(),afterIdentity)

    // The formats item. Still refused by default while a retired format is published.
    val stillPublished=s.run("dry-run","--allow-active-connections"); assertEquals(stillPublished.exit,3); assert(stillPublished.err.contains("still published in a retired output format"),stillPublished.err)
    // Product action, as the dashboard's "Rebuild archive index" performs it for owner b; the annotator and the
    // embedder are scripted (TestPublications), the claim, publication and retirement paths are the product's.
    val rebuild=new PostgresOwnerReindex(s.db); val request=UUID.randomUUID(); val preview=rebuild.preview("b")
    assertEquals(rebuild("b",request,preview.targetProfile,preview.selectionHash,true).queued,2L)
    List.fill(2)(()).foreach { _=>val claim=claimOf(s,"b"); assert(s.archive.publish(claim,chunks(claim,"contiguous current problem"))) }
    assertEquals(rebuild.status("b",request).complete,2L)
    // The product retired the two previously published generations: their pinned reads answer "retired".
    assertEquals(pinned(s,"b",seeded.legacyAnnotations,seeded.legacyAnnotationsPin),Left("indexed-view-retired")); assertEquals(pinned(s,"b",seeded.contiguous,seeded.contiguousPin),Left("indexed-view-retired"))
    val productTombstones=List(seeded.legacyAnnotationsPin,seeded.contiguousPin,seeded.tombstonePin).map(generationRow(s,_))

    // Default refusal: a non-retired historical generation is a readable pinned view and is never removed silently.
    val beforeHistory=s.everything()
    val history=s.run("dry-run","--allow-active-connections")
    assertEquals(history.exit,3,history.out); assert(history.err.contains("are not retired and remain readable as pinned views (LegacyAnnotations/history=1)"),history.err)
    val wrongCount=s.run("dry-run","--retire-history","--confirm-retire-history","2","--allow-active-connections")
    assertEquals(wrongCount.exit,3); assert(wrongCount.err.contains("--confirm-retire-history must be the number of historical generations to retire (found 1"),wrongCount.err)
    assertEquals(s.run("dry-run","--retire-history").exit,2)
    val retireDry=s.run("dry-run","--retire-history","--confirm-retire-history","1","--allow-active-connections"); assertEquals(retireDry.exit,0,retireDry.err)
    assertEquals(retireDry.steps("history_generations_retired"),1L)
    assertEquals(s.everything(),beforeHistory); assertEquals(pinned(s,"a",seeded.history,seeded.historyPin),Right(1))
    // Explicit retirement, the product's way: the tombstone stays, the derived rows go, the pinned read answers "retired".
    val retired=apply("--expect-plan",s.plan(),"--retire-history","--confirm-retire-history","1"); assertEquals(retired.exit,0,retired.err+retired.out)
    assertEquals(retired.value("LR.result"),"applied"); assertEquals(retired.steps("history_generations_retired"),1L)
    assertEquals(pinned(s,"a",seeded.history,seeded.historyPin),Left("indexed-view-retired"))
    val historyGeneration=seeded.historyPin.generationId.get
    assertEquals(s.count("SELECT count(*) FROM ch_generations WHERE id=? AND retired AND passage_format='LegacyAnnotations'",historyGeneration),1L)
    List("ch_chunks","ch_search_chunks","ch_generation_tags","ch_problem_passages","ch_problem_spans","ch_context_spans").foreach(table=>assertEquals(s.count(s"SELECT count(*) FROM $table WHERE generation=?",historyGeneration),0L,table))
    // Tombstones that existed before keep their identity, byte for byte; no generation or job row was deleted at all.
    assertEquals(List(seeded.legacyAnnotationsPin,seeded.contiguousPin,seeded.tombstonePin).map(generationRow(s,_)),productTombstones); assertEquals(generationRow(s,seeded.tombstonePin),tombstoneBefore)
    assertEquals(s.count("SELECT count(*) FROM ch_generations"),beforeHistory.count(_.startsWith("ch_generations ")).toLong)
    assertEquals(s.count("SELECT count(*) FROM ch_jobs"),beforeHistory.count(_.startsWith("ch_jobs ")).toLong)
    assertEquals(s.archive.raw("a",seeded.history,Some(1)).revision,1)
    val verified=s.run("verify"); assertEquals(verified.exit,0,verified.out+verified.err); assertEquals(verified.value("LR.result"),"verify-zero")
    assert(verified.out.contains("LR.published_by_format|ContextAwareProblems|embedding-space-v2|"),verified.out); assertEquals(verified.out.linesIterator.count(_.startsWith("LR.published_by_format|")),1)
    val after=s.everything()
    val again=apply("--expect-plan",s.plan()); assertEquals(again.exit,0,again.err); assertEquals(again.steps("history_generations_retired"),0L); assertEquals(s.everything(),after)

    // The current product code on the fully migrated database.
    s.db.initialize()
    s.db.transaction { c=>List("a","b","c").foreach(reader=>IndexProfiles.semantic(c,reader,s.archive.visible,s.catalog.preferred.embedding)) }
    assertEquals((semanticTotal(s,"a","x"),semanticTotal(s,"b","x"),semanticTotal(s,"c","x")),(3,2,1))
    List(seeded.retained->"a",seeded.history->"a",seeded.contiguous->"b",seeded.legacyAnnotations->"b").foreach((session,owner)=>assertEquals(s.archive.passages(owner,session,0,10,None).format,PassageFormat.ContextAwareProblems))
    assertEquals(rebuild.status("b",request).complete,2L)
    // The Failed run that began under the v1 identity is retried under the canonical one, with nothing to trip over.
    s.archive.retry("a",seeded.unfinishedJob)
    val retried=claimOf(s,"a"); assertEquals(retried.jobId,seeded.unfinishedJob)
    assertEquals(s.archive.checkpointNamespace(retried,s.catalog.preferred.embedding.id),CheckpointNamespace(retried.profile,s.catalog.preferred.embedding.id))
    assertEquals(s.archive.checkpoint(retried,seeded.annotationKey),None)
    val fresh=IndexCheckpoints.key(retried,IndexingStage.Annotation,0,0,ProblemPassages.identity,Json.obj("synthetic-input"->Json.fromString("after-retirement")))
    assertEquals(s.archive.reserveAnnotation(retried,fresh),AnnotationReservation.Reserved(1))
    assert(s.archive.publish(retried,chunks(retried,"retained synthetic problem")))
    assertEquals(semanticTotal(s,"a","x"),4)
    s.archive.ingest("a",Fixtures.snapshot()); val next=claimOf(s,"a"); assert(s.archive.publish(next,chunks(next,"retained synthetic problem")))
    assertEquals(s.run("verify").exit,0)

    // What a tombstone must carry: only its identity and the retired flag. Its format and profile labels are never read.
    s.exec("UPDATE ch_generations SET passage_format=NULL,profile='not-a-registered-profile' WHERE id=?",seeded.tombstonePin.generationId.get)
    assertEquals(pinned(s,"c",seeded.tombstoned,seeded.tombstonePin),Left("indexed-view-retired"))
    assertEquals(intercept[DomainError](s.archive.passages("c",seeded.tombstoned,0,10,Some(seeded.tombstonePin))).code,"indexed-view-retired")
    s.db.transaction { c=>IndexProfiles.semantic(c,"c",s.archive.visible,s.catalog.preferred.embedding) }
    s.exec("UPDATE ch_generations SET passage_format='LegacyAnnotations',profile=(SELECT profile FROM ch_index_profiles WHERE policy='LegacyV4' ORDER BY profile LIMIT 1) WHERE id=?",seeded.tombstonePin.generationId.get)

    // Runbook steps 14-16 against the proposed clean-up schema: the pre-removal verify passes before it; after it
    // the retained check passes and the one-off verify cannot run any more (its tables are gone).
    val oneOff=Path.of("..","scripts","one-off","legacy-retirement","sql","chronicle"); val retainedCheck=Path.of("scripts","check-legacy-free.sql")
    assertEquals(s.psql(retainedCheck).exit,3)
    List("proposed-cleanup-identity.sql","proposed-cleanup-formats.sql").foreach { file=>val cleaned=s.psql(oneOff.resolve(file)); assertEquals(cleaned.exit,0,cleaned.err) }
    val legacyFree=s.psql(retainedCheck); assertEquals(legacyFree.exit,0,legacyFree.out+legacyFree.err); assertEquals(legacyFree.value("LF.result"),"legacy-free")
    assertEquals(legacyFree.count("LF.legacy_tables_present"),0L); assertEquals(legacyFree.count("LP.generations.not_retired_old_format"),0L)
    val gone=s.run("verify"); assertEquals(gone.exit,3); assert(gone.err.contains("does not exist"),gone.err)
    val refusedSchema=s.run("dry-run","--allow-active-connections"); assertEquals(refusedSchema.exit,3)
    // The clean-up constraint holds: a non-retired generation in an old format can no longer be stored.
    assert(scala.util.Try(s.exec("UPDATE ch_generations SET passage_format='LegacyAnnotations' WHERE id=(SELECT published FROM ch_sources WHERE id=?)",seeded.retained)).isFailure)
    assertEquals(s.archive.passages("a",seeded.retained,0,10,None).format,PassageFormat.ContextAwareProblems)
    // Rolling the deployment back to the current binary: its start-up re-creates what it needs and serves again;
    // the retained check then reports the legacy tables as present.
    s.db.initialize()
    assertEquals(semanticTotal(s,"a","x"),5)
    s.archive.ingest("a",Fixtures.snapshot()); val afterRollback=claimOf(s,"a"); assert(s.archive.publish(afterRollback,chunks(afterRollback,"retained synthetic problem")))
    val rolledBack=s.psql(retainedCheck); assertEquals(rolledBack.exit,3); assertEquals(rolledBack.count("LF.legacy_tables_present"),4L)
  }}

  // R2 reproduction: accepted work of an unfinished run on a v1 profile that the product CLI never relocated (so no
  // checkpoint-namespace row exists). After the relocation the job keeps its run; the worker must not meet v1 hashes.
  test("legacy retirement: an unfinished, unrelocated v1 run with accepted work resumes under the current worker") { withScratch { s=>
    import cats.effect.IO
    import cats.effect.unsafe.implicits.global
    val (spaceId,space,active,activeDescriptor)=legacyIdentity(s.config)
    val receipt=s.archive.ingest("a",Fixtures.snapshot()); val running=claimOf(s,"a"); assertEquals(running.jobId,receipt.jobId)
    val old=running.copy(profile=active)
    val input=Json.obj("synthetic-input"->Json.fromString("accepted-under-v1"))
    val accepted=IndexCheckpoints.key(old,IndexingStage.Annotation,0,0,ProblemPassages.identity,input)
    s.archive.checkpoint(running,accepted,input)
    assertEquals(s.archive.reserveAnnotation(running,accepted),AnnotationReservation.Reserved(1))
    s.db.transaction { c=>
      Sql.exec(c,"INSERT INTO ch_embedding_spaces VALUES(?,?::jsonb)",spaceId,space.noSpaces)
      Sql.exec(c,"INSERT INTO ch_index_profiles VALUES(?,?,'ContextAwareProblemsV1',?::jsonb)",active,spaceId,activeDescriptor.noSpaces)
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?",active); Sql.exec(c,"UPDATE ch_profile SET active=?,target=?",active,active)
      Sql.exec(c,"UPDATE ch_jobs SET profile=?,state='Failed',error='model-http',failure_stage='Annotation',lease_until=NULL WHERE id=?",active,receipt.jobId)
    }
    assertEquals(s.count("SELECT count(*) FROM ch_checkpoint_namespaces"),0L)
    val preflight=s.run("preflight"); assertEquals(preflight.exit,0,preflight.err)
    assertEquals(preflight.count("LR.unfinished_runs.identity_changes"),1L); assertEquals(preflight.count("LR.info.unfinished_runs.accepted_checkpoints_to_discard"),1L)
    val applied=s.run("apply","--apply-irreversible","--confirm-database",s.name,"--backup-reference","fixture-backup","--expect-plan",preflight.value("LR.plan")); assertEquals(applied.exit,0,applied.err+applied.out)
    assertEquals(applied.steps("unfinished_runs_reset"),1L); assertEquals(applied.steps("unfinished_run_checkpoints_deleted"),1L)
    assertEquals(s.one("SELECT profile FROM ch_jobs WHERE id=?",receipt.jobId)(_.getString(1)),s.catalog.preferred.profile)
    assertEquals(s.one("SELECT run_id FROM ch_jobs WHERE id=?",receipt.jobId)(_.getObject(1,classOf[UUID])),running.runId)
    s.db.initialize()
    s.archive.retry("a",receipt.jobId)
    val annotator=new ProblemPassageAnnotator {
      def annotate(owner: String,window: ProblemPassages.Window,previous: Option[ProblemPassages.Carry]): IO[ProblemPassages.Decision] =
        IO(ProblemPassageFixtures.one(window,previous.nonEmpty,"resumed problem",List("resumed")))
    }
    val embedder=new Embedder {
      def query(owner: String,text: String): IO[List[Double]] = IO.raiseError(new AssertionError("worker queried embedding"))
      def documents(owner: String,text: List[String]): IO[List[List[Double]]] = IO(text.map(_=>vector))
    }
    // The product's Worker; a checkpoint or attempt identity mismatch is `internal` and escapes `once`.
    assert(ModelFixtures.worker(s.archive,annotator,embedder,s.config,logstage.IzLogger()).once.unsafeRunSync())
    assertEquals(s.one("SELECT state FROM ch_jobs WHERE id=?",receipt.jobId)(_.getString(1)),"Complete")
    assertEquals(semanticTotal(s,"a","resumed"),1)
  }}
}
