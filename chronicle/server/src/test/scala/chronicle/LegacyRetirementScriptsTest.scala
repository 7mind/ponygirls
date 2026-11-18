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
  private final case class Seeded(relocated: UUID,retained: UUID,unfinished: UUID,unfinishedJob: UUID,history: UUID,historyOld: ContentView,legacyAnnotations: UUID,contiguous: UUID,retainedProfile: String,canonicalRetainedProfile: String,annotationKey: CheckpointKey)

  /** owner a: one source relocated by the product CLI (L), one readable through a retained approval (R, same model,
    * older annotation policy), one Failed run that began under L, one source with superseded LegacyAnnotations history.
    * owner b: one source published as LegacyAnnotations and one as ContiguousProblems under a v1-space profile.
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
    val historyOld=archive.session("a",history.sessionId).view
    archive.ingest("a",historyRequest.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    val second=claimOf(s,"a"); assert(archive.publish(second,chunks(second,"current problem")))
    // owner b: both retired output formats, published.
    val legacyAnnotations=archive.ingest("b",Fixtures.snapshot()); val legacyClaim=claimOf(s,"b")
    StoredPublicationFixtures.publish(db,legacyClaim,chunks(legacyClaim,"legacy annotations"))
    val contiguous=archive.ingest("b",Fixtures.snapshot()); val contiguousClaim=claimOf(s,"b")
    assert(archive.publish(contiguousClaim,chunks(contiguousClaim,"contiguous problem")))
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
    Seeded(published(0).sessionId,published(1).sessionId,running.sessionId,running.jobId,history.sessionId,historyOld,legacyAnnotations.sessionId,contiguous.sessionId,retained,IndexProfileCatalog.current(older).preferred.profile,annotation)
  }
  // Semantic totals count the reader's visible published sources within the candidate window: every one must be readable.
  private def semanticTotal(s: Scratch,reader: String,text: String): Int =
    new PostgresSearch(s.db,s.archive,s.config).search(reader,SearchQuery(text,SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),20,0),Some(vector)).total

  // Opt-in (scripts/one-off/legacy-retirement/test.sh sets the variable): the Nix-filtered sources of the permanent
  // full-suite checks do not contain scripts/one-off, and this one-off is not meant to join them.
  if(sys.env.get("LEGACY_RETIREMENT_SCRIPTS").contains("1")) test("legacy retirement: preflight, refusals, product re-index, dry-run, apply, verify, idempotence and current-code reads") { withScratch { s=>
    val seeded=seed(s)
    // The current binary serves the legacy database before anything is migrated.
    assertEquals(semanticTotal(s,"a","retained"),3); assertEquals(semanticTotal(s,"b","contiguous"),2)

    val preflight=s.run("preflight"); assertEquals(preflight.exit,0,preflight.err)
    assertEquals(preflight.count("LR.spaces.v1"),1L); assertEquals(preflight.count("LR.profiles.v1_space"),3L)
    assertEquals(preflight.count("LR.profiles.legacy_policy"),3L)
    assertEquals(preflight.count("LR.generations.legacy_format_or_policy"),3L); assertEquals(preflight.count("LR.generations.legacy_format_or_policy.published"),2L)
    assertEquals(preflight.count("LR.generations.v1_space.published"),2L)
    assertEquals(preflight.count("LR.retained_profile_reads"),2L); assertEquals(preflight.count("LR.model_identity_migrations"),1L)
    assertEquals(preflight.count("LR.checkpoint_namespaces"),2L); assertEquals(preflight.count("LR.checkpoint_namespaces.unfinished_run"),1L)
    assertEquals(preflight.count("LR.singleton.legacy_or_unregistered"),1L); assertEquals(preflight.count("LR.sessions.deadline"),1L)
    assert(preflight.out.contains("LR.reindex_worklist|owner-enabled|ContiguousProblems|head|"),preflight.out)
    assert(preflight.out.contains("LR.reindex_worklist|owner-enabled|LegacyAnnotations|head|"),preflight.out)
    assert(preflight.out.contains("LR.relocation_worklist|ContextAwareProblemsV1|ContextAwareProblems|1"),preflight.out)
    val unverified=s.run("verify"); assertEquals(unverified.exit,3); assertEquals(unverified.value("LR.result"),"verify-nonzero")

    // Refusal: a published retired-format generation cannot be converted by SQL.
    val untouched=s.everything()
    List(List("dry-run","--allow-active-connections"),List("apply","--apply-irreversible","--confirm-database",s.name,"--expect-plan",preflight.value("LR.plan"),"--allow-active-connections")).foreach { arguments=>
      val refused=s.run(arguments*); assertEquals(refused.exit,3,refused.out); assert(refused.err.contains("still published in a retired output format"),refused.err)
    }
    assertEquals(s.everything(),untouched)

    // Product action, as the dashboard's "Rebuild archive index" performs it for owner b; the annotator and the
    // embedder are scripted (TestPublications), the claim, publication and retirement paths are the product's.
    val rebuild=new PostgresOwnerReindex(s.db); val request=UUID.randomUUID(); val preview=rebuild.preview("b")
    assertEquals(rebuild("b",request,preview.targetProfile,preview.selectionHash,true).queued,2L)
    List.fill(2)(()).foreach { _=>val claim=claimOf(s,"b"); assert(s.archive.publish(claim,chunks(claim,"contiguous current problem"))) }
    assertEquals(rebuild.status("b",request).complete,2L)
    assertEquals(s.count("SELECT count(*) FROM ch_sources s JOIN ch_generations g ON g.id=s.published WHERE s.owner='b' AND g.passage_format='ContextAwareProblems' AND g.profile=?",s.catalog.preferred.profile),2L)
    // A receipt relocated by the product CLI keeps the v1 id in its stored result.
    s.exec("UPDATE ch_reindex_requests SET result=jsonb_set(result,'{targetProfile}',to_jsonb(?::text)) WHERE request_id=?",seeded.retainedProfile,request)

    val before=s.everything(); val token=s.plan()
    // Dry-run: reports the whole migration and keeps nothing.
    val dry=s.run("dry-run","--allow-active-connections","--batch-size","1"); assertEquals(dry.exit,0,dry.err)
    assertEquals(dry.value("LR.result"),"dry-run-rolled-back"); assertEquals(dry.steps("generations_deleted"),3L); assertEquals(dry.steps("generations_deleted.not_retired"),1L)
    assertEquals(dry.steps("unfinished_runs_reset"),1L); assertEquals(dry.count("LR.step.profiles_relocated"),1L); assertEquals(dry.count("LR.after.spaces.v1"),0L)
    assertEquals(s.everything(),before)

    // Refusals of apply: missing acknowledgement, wrong database name, stale plan, other connections, live lease.
    assertEquals(s.run("apply","--confirm-database",s.name,"--expect-plan",token).exit,2)
    val wrongName=s.run("apply","--apply-irreversible","--confirm-database","chronicle","--expect-plan",token,"--allow-active-connections")
    assertEquals(wrongName.exit,3); assert(wrongName.err.contains("--confirm-database does not name the connected database"),wrongName.err)
    val stale=s.run("apply","--apply-irreversible","--confirm-database",s.name,"--expect-plan",preflight.value("LR.plan"),"--allow-active-connections")
    assertEquals(stale.exit,3); assert(stale.err.contains("differ from the preflight plan token"),stale.err)
    s.db.transaction { _=>
      val connected=s.run("apply","--apply-irreversible","--confirm-database",s.name,"--expect-plan",token)
      assertEquals(connected.exit,3); assert(connected.err.contains("other client connection"),connected.err)
    }
    s.exec("UPDATE ch_jobs SET state='Running',lease_until=clock_timestamp()+interval '5 minutes' WHERE id=?",seeded.unfinishedJob)
    val leased=s.run("apply","--apply-irreversible","--confirm-database",s.name,"--expect-plan",token,"--allow-active-connections")
    assertEquals(leased.exit,3); assert(leased.err.contains("hold a live lease"),leased.err)
    s.exec("UPDATE ch_jobs SET state='Failed',lease_until=NULL WHERE id=?",seeded.unfinishedJob)
    assertEquals(s.everything(),before)

    // Apply, in batches of one row to cross every batch boundary; then verify.
    val applied=s.run("apply","--apply-irreversible","--confirm-database",s.name,"--expect-plan",token,"--batch-size","1"); assertEquals(applied.exit,0,applied.err+applied.out)
    assertEquals(applied.value("LR.result"),"applied"); assertEquals(applied.steps("generations_deleted"),3L); assertEquals(applied.count("LR.step.profiles_relocated"),1L)
    assertEquals(applied.count("LR.step.retained_profile_reads_deleted"),2L); assertEquals(applied.count("LR.step.model_identity_migrations_deleted"),1L)
    assertEquals(applied.count("LR.step.v1_embedding_spaces_deleted"),1L); assertEquals(applied.count("LR.step.sessions_made_persistent"),1L)
    assertEquals(applied.count("LR.step.rebuild_receipts_canonicalized"),1L)
    val verified=s.run("verify"); assertEquals(verified.exit,0,verified.out+verified.err); assertEquals(verified.value("LR.result"),"verify-zero")

    // A second apply finds nothing and changes nothing.
    val after=s.everything()
    val again=s.run("apply","--apply-irreversible","--confirm-database",s.name,"--expect-plan",s.plan()); assertEquals(again.exit,0,again.err)
    assertEquals(again.steps("generations_deleted"),0L); assertEquals(again.count("LR.step.profiles_relocated"),0L); assertEquals(s.everything(),after)

    // The current product code on the migrated database: startup, authorization of semantic reads, search, views.
    s.db.initialize()
    s.db.transaction { c=>List("a","b").foreach(reader=>IndexProfiles.semantic(c,reader,s.archive.visible,s.catalog.preferred.embedding)) }
    assertEquals(semanticTotal(s,"a","retained"),3); assertEquals(semanticTotal(s,"b","contiguous"),2)
    // The retained profile now carries the identity the product itself derives for that model and annotation policy.
    assertEquals(s.one("SELECT g.profile FROM ch_sources s JOIN ch_generations g ON g.id=s.published WHERE s.id=?",seeded.retained)(_.getString(1)),seeded.canonicalRetainedProfile)
    assertEquals(s.count("SELECT count(*) FROM ch_search_chunks WHERE session_id=? AND profile=?",seeded.retained,seeded.canonicalRetainedProfile),1L)
    val retainedView=s.archive.readSession("a",seeded.retained,None); assertEquals(retainedView.chunks.size,1)
    assertEquals(s.archive.passages("a",seeded.retained,0,10,None).format,PassageFormat.ContextAwareProblems)
    assertEquals(s.archive.passages("a",seeded.history,0,10,None).format,PassageFormat.ContextAwareProblems)
    assertEquals(intercept[DomainError](s.archive.pageChunks("a",seeded.history,0,10,Some(seeded.historyOld))).code,"not-found")
    assertEquals(s.archive.raw("a",seeded.history,Some(1)).revision,1)
    assertEquals(rebuild.status("b",request).complete,2L)
    assertEquals(s.count("SELECT count(*) FROM ch_profile WHERE active=? AND target=?",s.catalog.preferred.profile,s.catalog.preferred.profile),1L)
    // The Failed run that began under the v1 identity is retried under the canonical one, with nothing to trip over.
    s.archive.retry("a",seeded.unfinishedJob)
    val retried=claimOf(s,"a"); assertEquals(retried.jobId,seeded.unfinishedJob)
    assertEquals(s.archive.checkpointNamespace(retried,s.catalog.preferred.embedding.id),CheckpointNamespace(retried.profile,s.catalog.preferred.embedding.id))
    assertEquals(s.archive.checkpoint(retried,seeded.annotationKey),None)
    val fresh=IndexCheckpoints.key(retried,IndexingStage.Annotation,0,0,ProblemPassages.identity,Json.obj("synthetic-input"->Json.fromString("after-retirement")))
    assertEquals(s.archive.reserveAnnotation(retried,fresh),AnnotationReservation.Reserved(1))
    assert(s.archive.publish(retried,chunks(retried,"retained synthetic problem")))
    assertEquals(semanticTotal(s,"a","retained"),4)
    // Ordinary work continues: ingest, claim, publish.
    s.archive.ingest("a",Fixtures.snapshot()); val next=claimOf(s,"a"); assert(s.archive.publish(next,chunks(next,"retained synthetic problem")))
    val settled=s.run("verify"); assertEquals(settled.exit,0,settled.out+settled.err)
  }}
}
