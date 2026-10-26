package chronicle

import chronicle.api.*
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8
import java.time.{Clock,Instant,ZoneOffset}
import java.time.format.DateTimeFormatter
import java.util.{Locale,UUID}

private object HintTestData {
  val now=Instant.parse("2026-10-26T12:00:00Z")
  val target="hint-current-target"
  val archive=ExpressionHintTarget.Archive()
  val collectors=ExpressionHintTarget.ActivityCollectors()
  def jobs(scope: ActivityJobScope,collector: Option[String]): ExpressionHintTarget = ExpressionHintTarget.ActivityJobs(scope,collector)
  final case class Revision(number: Int,metadata: Metadata,source: SourceIdentity,time: String)
  final case class Head(id: UUID,owner: String,revisions: List[Revision],publishedTags: List[String],tombstone: Boolean) {
    def current: Revision = revisions.maxBy(_.number)
  }
  final case class Job(id: UUID,session: UUID,revision: Int,profile: String,reason: String)
  final case class Report(owner: String,collector: String,received: Instant)
  final case class Seed(heads: List[Head],jobs: List[Job],reports: List[Report],users: List[String],disabled: Set[String],shared: Set[(String,String)])
  def id(n: Int): UUID = new UUID(0,n.toLong)
  def head(n: Int,owner: String,namespace: String,projects: List[String],tags: List[String],publishedTags: List[String]): Head = {
    val source=Fixtures.snapshot()
    Head(id(n),owner,projects.zipWithIndex.map { case (project,index) =>
      Revision(index+1,source.metadata.copy(title="synthetic hint fixture",project=Some(project),gitBranch=Some("branch-"+project),producer="producer-"+project,model=Some("model-"+project),tags=tags),source.source.copy(collectorNamespace=if(index==projects.size-1) namespace else "wrong-old-namespace"),now.minusSeconds((projects.size-index).toLong).toString)
    },publishedTags,false)
  }
  def seed: Seed = {
    val heads=List(head(1,"a","base/episode/child",List("old-project","current-project"),List("head-tag"),List("published-tag")),
      head(2,"a","orphan/child",List("orphan-project"),Nil,Nil),head(3,"a","percentX/child",List("wildcard-neighbor"),Nil,Nil),
      head(4,"a","percent%/child",List("literal-percent"),Nil,Nil),head(5,"b","base/episode/child",List("private-b"),List("private-tag"),Nil),
      head(6,"c","disabled/child",List("disabled-c"),Nil,Nil),head(7,"a","purged",List("purged-project"),Nil,List("purged-published")).copy(tombstone=true))
    val jobs=List(Job(id(101),id(1),2,target,"current-reason"),Job(id(102),id(1),1,target,"historical-reason"),Job(id(103),id(1),2,"obsolete-profile","obsolete-reason"),Job(id(104),id(2),1,target,"orphan-reason"),Job(id(105),id(3),1,target,"wildcard-reason"),Job(id(106),id(4),1,target,"percent-reason"),Job(id(107),id(5),1,target,"private-reason"),Job(id(108),id(7),1,target,"purged-reason"))
    Seed(heads,jobs,List(Report("a","base",now),Report("a","base/episode",now),Report("a","percent%",now),Report("a","report-only",now),Report("b","orphan",now)),List("a","b","c"),Set("c"),Set.empty)
  }
  private val caseIgnorableCategories=Set[Int](Character.NON_SPACING_MARK,Character.ENCLOSING_MARK,Character.FORMAT,Character.MODIFIER_LETTER,Character.MODIFIER_SYMBOL)
  private val caseIgnorablePunctuation="'’‘.:··״‧՟﹒﹕：．＇︓".codePoints().toArray.toSet
  def fold(value: String): String = {
    val points=value.codePoints().toArray
    def cased(position: Int,step: Int): Boolean = {
      var at=position
      while(at>=0 && at<points.length && (caseIgnorableCategories.contains(Character.getType(points(at))) || caseIgnorablePunctuation.contains(points(at)))) at+=step
      at>=0 && at<points.length && (Character.isLowerCase(points(at)) || Character.isUpperCase(points(at)) || Character.isTitleCase(points(at)))
    }
    val result=new java.lang.StringBuilder
    points.indices.foreach { n =>
      // JVM contextual sigma uses word boundaries; PostgreSQL skips Unicode Case_Ignorable scalars.
      result.appendCodePoint(if(points(n)=='Σ') { if(cased(n-1,-1) && !cased(n+1,1)) 'ς' else 'σ' } else points(n))
    }
    result.toString.toLowerCase(Locale.ROOT)
  }
  def compare(left: String,right: String): Int = {
    val a=left.codePoints().toArray; val b=right.codePoints().toArray
    var i=0
    while(i<a.length && i<b.length) { if(a(i)!=b(i)) return Integer.compare(a(i),b(i)); i+=1 }
    Integer.compare(a.length,b.length)
  }
}
private trait HintFixture {
  def index: ExpressionHintIndex
  def sharing(reader: String,owner: String,enabled: Boolean): Unit
  def enabled(user: String,value: Boolean): Unit
  def purge(id: UUID): Unit
  def append(id: UUID,project: String): Unit
  def report(owner: String,collector: String): Unit
  def target(owner: String,profile: String): Unit
}

abstract class ExpressionHintsContract extends munit.FunSuite {
  import HintTestData.*
  def fixture(seed: Seed)(f: HintFixture => Unit): Unit
  private def query(target: ExpressionHintTarget,expression: String,limit: Int): ExpressionHintQuery = ExpressionHintQuery(target,expression,expression.length,limit)
  private def labels(f: HintFixture,reader: String,target: ExpressionHintTarget,expression: String): List[String] = f.index.hints(reader,query(target,expression,20)).hints.map(_.label)
  test("Blackbox Atomic/GoodCommunication specified: Archive uses authorized live HEAD metadata plus the published tag union, independent of clauses") { fixture(seed) { f =>
    assertEquals(labels(f,"a",archive,"project:"),List("current-project","literal-percent","orphan-project","wildcard-neighbor"))
    assertEquals(labels(f,"a",archive,"tag:"),List("head-tag","published-tag"))
    assertEquals(labels(f,"a",archive,"project:missing AND tag:"),List("head-tag","published-tag"))
    assertEquals(labels(f,"a",archive,"user:"),List("a"))
    assertEquals(labels(f,"b",archive,"project:"),List("private-b"))
    assertEquals(intercept[DomainError](labels(f,"c",archive,"project:")).code,"unauthorized")
    assert(!labels(f,"a",archive,"project:").exists(value => value.contains("old-") || value.contains("purged") || value.contains("private") || value.contains("disabled")))
    f.append(id(1),"newest-project")
    assert(labels(f,"a",archive,"project:").contains("newest-project"))
    assert(!labels(f,"a",archive,"project:").contains("current-project"))
    assertEquals(labels(f,"a",archive,"tag:"),List("head-tag","published-tag"))
  }}
  test("Blackbox Atomic/GoodCommunication specified: sharing, revocation, restoration, owner disable and purge are re-evaluated without cached values") { fixture(seed) { f =>
    f.sharing("a","b",true)
    assert(labels(f,"a",archive,"project:").contains("private-b"))
    assertEquals(labels(f,"a",archive,"user:"),List("a","b"))
    f.sharing("a","b",false)
    assert(!labels(f,"a",archive,"project:").contains("private-b"))
    f.sharing("a","b",true)
    assert(labels(f,"a",archive,"project:").contains("private-b"))
    f.enabled("b",false)
    assert(!labels(f,"a",archive,"project:").contains("private-b"))
    f.enabled("b",true)
    f.purge(id(5))
    assert(!labels(f,"a",archive,"project:").contains("private-b"))
    f.enabled("a",false)
    assertEquals(intercept[DomainError](labels(f,"a",archive,"status:")).code,"unauthorized")
  }}
  test("Blackbox Atomic/GoodCommunication specified: Activity job metadata is owner-only and revision/profile scoped, not Archive facets") { fixture(seed.copy(shared=Set(("a","b")))) { f =>
    val current=jobs(ActivityJobScope.Current,None); val historical=jobs(ActivityJobScope.Historical,None)
    assertEquals(labels(f,"a",current,"project:"),List("current-project","literal-percent","orphan-project","wildcard-neighbor"))
    assertEquals(labels(f,"a",historical,"project:"),List("current-project","old-project"))
    assertEquals(labels(f,"a",historical,"reason:"),List("historical-reason","obsolete-reason"))
    assertEquals(labels(f,"a",jobs(ActivityJobScope.All,None),"profile:"),List(target,"obsolete-profile"))
    assertEquals(labels(f,"a",current,"tag:"),List("head-tag"))
    assert(!labels(f,"a",jobs(ActivityJobScope.All,None),"project:").contains("private-b"))
    assertEquals(labels(f,"b",jobs(ActivityJobScope.All,None),"project:"),List("private-b"))
    f.target("a","opaque-new-target")
    assertEquals(labels(f,"a",current,"project:"),Nil)
    assert(labels(f,"a",historical,"reason:").contains("current-reason"))
  }}
  test("Blackbox Atomic/GoodCommunication specified: collector universes use owner reports and longest literal HEAD assignment, never guessed prefixes") { fixture(seed) { f =>
    assertEquals(labels(f,"a",collectors,"collector:"),List("base","base/episode","orphan/child","percent%","percentX/child","report-only"))
    assertEquals(labels(f,"a",jobs(ActivityJobScope.All,Some("base/episode")),"project:"),List("current-project","old-project"))
    List("base","orphan","percentX","report-only","base' OR true --").foreach { collector => assertEquals(labels(f,"a",jobs(ActivityJobScope.All,Some(collector)),"project:"),Nil) }
    assertEquals(labels(f,"a",jobs(ActivityJobScope.Current,Some("percent%")),"project:"),List("literal-percent"))
    assertEquals(labels(f,"a",jobs(ActivityJobScope.Current,Some("orphan/child")),"collector:"),List("orphan/child"))
    assertEquals(labels(f,"a",jobs(ActivityJobScope.Historical,Some("base/episode")),"collector:"),List("base/episode"))
    f.report("a","base/episode/child")
    assertEquals(labels(f,"a",jobs(ActivityJobScope.All,Some("base/episode")),"project:"),Nil)
    assertEquals(labels(f,"a",jobs(ActivityJobScope.All,Some("base/episode/child")),"project:"),List("current-project","old-project"))
    assertEquals(labels(f,"a",collectors,"collector:orphan"),List("orphan/child"))
    assertEquals(labels(f,"a",collectors,"after:").map(Instant.parse).distinct,List(now))
  }}
  test("Blackbox Atomic/GoodCommunication specified: Unicode matching lowers the entire candidate before literal prefix matching and exact deterministic dedup") {
    val projects=List("Kelvin","kelvin","İstanbul","i\u0307stanbul","aΣ\u0345b","aΣ\u0345 ","literal%_\\value","literalXneighbor","é","e\u0301","\ue000","😀")
    val heads=projects.zipWithIndex.map { case (value,n) => head(n+1,"a","unicode-"+n,List(value),Nil,Nil) }
    fixture(seed.copy(heads=heads,jobs=Nil,reports=Nil)) { f =>
      assertEquals(labels(f,"a",archive,"project:k"),List("kelvin","Kelvin"))
      assertEquals(labels(f,"a",archive,"project:i"),List("i\u0307stanbul","İstanbul"))
      assertEquals(labels(f,"a",archive,"project:aσ"),List("aΣ\u0345b"))
      assertEquals(labels(f,"a",archive,"project:aς"),List("aΣ\u0345 "))
      assertEquals(labels(f,"a",archive,"project:"+Json.fromString("literal%_").noSpaces),List("literal%_\\value"))
      val all=labels(f,"a",archive,"project:")
      assertEquals(all.size,projects.size)
      assertEquals(all.takeRight(2),List("\ue000","😀"))
      assert(all.contains("é") && all.contains("e\u0301"))
    }
  }
  test("Blackbox Atomic/GoodCommunication specified: opaque empty, long, control and Unicode identities/filter IDs are retained, while uninsertable whole values are omitted observably") {
    val owners=List("","o"*50000,"o"*50000+"x","🙂é\t\n\u0001", "é","e\u0301")
    val heads=owners.zipWithIndex.map { case (owner,n) => head(n+1,owner,"collector-"+n,List("owned-"+n),Nil,Nil) }
    val rows=heads.zipWithIndex.map { case (h,n) => Job(id(100+n),h.id,1,target,"own-reason") }
    fixture(Seed(heads,rows,Nil,owners,Set.empty,Set.empty)) { f =>
      owners.zipWithIndex.foreach { case (owner,n) =>
        assertEquals(labels(f,owner,archive,"project:"),List("owned-"+n))
        assertEquals(labels(f,owner,jobs(ActivityJobScope.Current,None),"project:"),List("owned-"+n))
        val result=f.index.hints(owner,query(archive,"user:",20))
        if(owner.isEmpty || owner.getBytes(UTF_8).length>512) { assertEquals(result.hints,Nil); assert(result.truncated) }
        else assertEquals(result.hints.map(h => Wire.parse(h.insertText).asString.get),List(owner))
      }
    }
    val collector="long/"+"x"*50000
    val own=head(1,"a",collector,List("long-collector-project"),Nil,Nil)
    fixture(seed.copy(heads=List(own),jobs=List(Job(id(10),own.id,1,target,"reason")),reports=List(Report("a",collector,now)))) { f =>
      assertEquals(labels(f,"a",jobs(ActivityJobScope.Current,Some(collector)),"project:"),List("long-collector-project"))
      assertEquals(labels(f,"a",jobs(ActivityJobScope.All,Some("")),"project:"),Nil)
      val result=f.index.hints("a",query(collectors,"collector:",20))
      assertEquals(result.hints,Nil); assert(result.truncated)
    }
  }
  test("Blackbox Atomic/GoodCommunication specified: candidates and complete wire response stay bounded; oversize metadata is not materialized as a candidate") {
    val values=(1 to 25).map(n => "\u0001"*509+f"$n%03d").toList
    val heads=(values:+("x"*200000)).zipWithIndex.map { case (value,n) => head(n+1,"a","bounded-"+n,List(value),Nil,Nil) }
    fixture(seed.copy(heads=heads,jobs=Nil,reports=Nil)) { f =>
      val q=query(archive,"project:",20)
      val result=f.index.hints("a",q)
      assert(result.truncated); assert(result.hints.nonEmpty && result.hints.size<20)
      assert(result.hints.forall(h => values.contains(h.label) && Wire.parse(h.insertText).asString.contains(h.label)))
      assert(Wire.encode(ServerEnvelope.codecJson,ServerEnvelope(id(99),Result.ExpressionHints(result))).noSpaces.getBytes(UTF_8).length<=48*1024)
      val oversized=f.index.hints("a",query(archive,"project:x",20))
      assertEquals(oversized.hints,Nil); assert(oversized.truncated)
      val short=f.index.hints("a",query(archive,"project:",1))
      assertEquals(short.hints.size,1); assert(short.truncated)
    }
  }
}

final class ExpressionHintsDummyTest extends ExpressionHintsContract {
  import HintTestData.*
  def fixture(initial: Seed)(f: HintFixture => Unit): Unit = {
    val fixture=new HintFixture {
      private var state=initial
      private var profiles=initial.users.map(_ -> HintTestData.target).toMap
      private def live(reader: String): List[Head] = state.heads.filter(head => !head.tombstone && !state.disabled.contains(head.owner) && (head.owner==reader || state.shared.contains((reader,head.owner))))
      private def assignment(reader: String,head: Head): String = {
        val namespace=head.current.source.collectorNamespace
        state.reports.filter(r => r.owner==reader && (namespace==r.collector || namespace.startsWith(r.collector+"/"))).map(_.collector).sortWith { (a,b) =>
          val lengths=Integer.compare(b.codePointCount(0,b.length),a.codePointCount(0,a.length))
          if(lengths!=0) lengths<0 else compare(a,b)<0
        }.headOption.getOrElse(namespace)
      }
      private def metadata(owner: String,revision: Revision,tags: List[String],field: HintField): List[String] = field match {
        case HintField.User => List(owner)
        case HintField.Project => revision.metadata.project.toList
        case HintField.Branch => revision.metadata.gitBranch.toList
        case HintField.Producer => List(revision.metadata.producer)
        case HintField.Model => revision.metadata.model.toList
        case HintField.Tag | HintField.Tags => revision.metadata.tags++tags
        case HintField.After | HintField.Before => List(revision.time)
        case _ => throw new AssertionError("unexpected metadata hint field")
      }
      val index: ExpressionHintIndex = new CorpusExpressionHintIndex(new ExpressionHintStore {
        def read(reader: String,target: ExpressionHintTarget,field: Option[HintField],prefix: String,limit: Int): HintValues = {
          Check(state.users.contains(reader) && !state.disabled.contains(reader),"unauthorized","reader disabled")
          val owned=live(reader).filter(_.owner==reader)
          val universe=field.toList.flatMap { selected => target match {
            case _: ExpressionHintTarget.Archive => live(reader).flatMap(h => metadata(h.owner,h.current,h.publishedTags,selected))
            case _: ExpressionHintTarget.ActivityCollectors => selected match {
              case HintField.Collector => state.reports.filter(_.owner==reader).map(_.collector)++owned.map(assignment(reader,_))
              case HintField.After | HintField.Before => state.reports.filter(_.owner==reader).map(r => DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSSSSS'Z'").withZone(ZoneOffset.UTC).format(r.received))
              case _ => throw new AssertionError("unexpected collector hint field")
            }
            case ExpressionHintTarget.ActivityJobs(scope,collector) => owned.flatMap { head =>
              state.jobs.filter(_.session==head.id).filter { job =>
                val current=job.revision==head.current.number && job.profile==profiles(reader)
                (scope==ActivityJobScope.All || ((scope==ActivityJobScope.Current)==current)) && collector.forall(_==assignment(reader,head))
              }.flatMap { job => selected match {
                case HintField.Collector => List(assignment(reader,head))
                case HintField.Profile => List(job.profile)
                case HintField.Reason => List(job.reason)
                case _ => metadata(head.owner,head.revisions.find(_.number==job.revision).get,Nil,selected)
              }}
            }
          }}
          val matched=universe.distinct.filter(value => fold(value).startsWith(fold(prefix)))
          val bounded=matched.filter(value => value.nonEmpty && value.getBytes(UTF_8).length<=512).sortWith { (a,b) =>
            val folded=compare(fold(a),fold(b))
            if(folded!=0) folded<0 else compare(a,b)<0
          }
          HintValues(now,bounded.take(limit),bounded.size!=matched.size)
        }
      })
      def sharing(reader: String,owner: String,enabled: Boolean): Unit = state=state.copy(shared=if(enabled) state.shared+((reader,owner)) else state.shared-((reader,owner)))
      def enabled(user: String,value: Boolean): Unit = state=state.copy(disabled=if(value) state.disabled-user else state.disabled+user)
      def purge(id: UUID): Unit = state=state.copy(heads=state.heads.map(h => if(h.id==id) h.copy(tombstone=true) else h))
      def append(id: UUID,project: String): Unit = state=state.copy(heads=state.heads.map(h => if(h.id==id) h.copy(revisions=h.revisions:+h.current.copy(number=h.current.number+1,metadata=h.current.metadata.copy(project=Some(project)))) else h))
      def report(owner: String,collector: String): Unit = state=state.copy(reports=state.reports.filterNot(r => r.owner==owner && r.collector==collector):+Report(owner,collector,now))
      def target(owner: String,profile: String): Unit = profiles=profiles.updated(owner,profile)
    }
    f(fixture)
  }
}

final class ExpressionHintsPostgresTest extends ExpressionHintsContract {
  import HintTestData.*
  def fixture(seed: Seed)(f: HintFixture => Unit): Unit = database(seed)((provided,_) => f(provided))
  private def database(seed: Seed)(f: (HintFixture,Database) => Unit): Unit = {
    Check(sys.env.contains("CHRONICLE_TEST_JDBC"),"test","PostgreSQL is required for expression hint contracts")
    val base=Fixtures.config()
    val config=base.copy(users=seed.users.zipWithIndex.map { case (id,n) => UserConfig(id,"hint-login-"+n,base.users.head.passwordHashFile,true) })
    val admin=new Database(config,IndexProfileCatalog.legacyOnly(config))
    val schema="hint_test_"+UUID.randomUUID().toString.replace("-","")
    admin.transaction { c => Sql.exec(c,"CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public"); Sql.exec(c,"CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public"); Sql.exec(c,s"CREATE SCHEMA $schema") }
    try {
      val separator=if(config.jdbcUrl.contains("?")) "&" else "?"
      val scoped=config.copy(jdbcUrl=config.jdbcUrl+separator+"currentSchema="+schema+",public")
      val db=new Database(scoped,IndexProfileCatalog.legacyOnly(scoped)); db.initialize()
      def revision(c: java.sql.Connection,id: UUID,value: Revision): Unit = {
        Sql.exec(c,"INSERT INTO ch_revisions VALUES(?,?,?::jsonb)",id,value.number,"{\"mustNotDecodeRawSnapshot\":true}")
        Sql.exec(c,"INSERT INTO ch_revision_info(session_id,revision,metadata,source,completion,redacted,last_timestamp,last_timestamp_order,message_count,lexical_version) VALUES(?,?,?::jsonb,?::jsonb,'Quiescent',false,?,?::numeric,0,1)",id,value.number,Wire.encode(Metadata.codecJson,value.metadata).noSpaces,Wire.encode(SourceIdentity.codecJson,value.source).noSpaces,value.time,ArchiveProjection.timestampOrder(Instant.parse(value.time)))
      }
      def setSharing(reader: String,owner: String,enabled: Boolean): Unit = db.transaction { c =>
        val group=UUID.nameUUIDFromBytes(Json.arr(Json.fromString(reader),Json.fromString(owner)).noSpaces.getBytes(UTF_8))
        Sql.exec(c,"DELETE FROM ch_groups WHERE id=?",group)
        if(enabled) { Sql.exec(c,"INSERT INTO ch_groups VALUES(?,?,?)",group,owner,"synthetic hint sharing"); Sql.exec(c,"INSERT INTO ch_members VALUES(?,?),(?,?)",group,reader,group,owner) }
      }
      def putReport(owner: String,collector: String): Unit = db.transaction { c =>
        val value=CollectorProgressUpdate(collector,1,id(1000),CollectorPhase.Idle,now.toString,CollectorCounters(0,0,0,0,0,0,0,0,0,0,0,0,0),0,0,None,None)
        Sql.exec(c,"INSERT INTO ch_collector_progress(owner,collector_id,sequence,report,received_at) VALUES(?,?,1,?::jsonb,?::timestamptz) ON CONFLICT(owner,collector_id) DO UPDATE SET report=excluded.report,received_at=excluded.received_at",owner,collector,Wire.encode(CollectorProgressUpdate.codecJson,value).noSpaces,now.toString)
      }
      db.transaction { c =>
        Sql.exec(c,"UPDATE ch_owner_targets SET profile=?",target)
        seed.disabled.foreach(user => Sql.exec(c,"UPDATE ch_users SET enabled=false WHERE id=?",user))
        seed.heads.foreach { head =>
          Sql.exec(c,"INSERT INTO ch_sources(id,owner,source_key,revision,tombstone) VALUES(?,?,?,?,?)",head.id,head.owner,head.id.toString,head.current.number,head.tombstone)
          head.revisions.foreach(revision(c,head.id,_))
          if(head.publishedTags.nonEmpty) {
            val generation=UUID.randomUUID()
            Sql.exec(c,"INSERT INTO ch_generations VALUES(?,?,?,?)",generation,head.id,1,target)
            Sql.exec(c,"UPDATE ch_sources SET published=? WHERE id=?",generation,head.id)
            head.publishedTags.foreach(tag => Sql.exec(c,"INSERT INTO ch_generation_tags VALUES(?,?)",generation,tag))
          }
        }
        seed.jobs.foreach { job => Sql.exec(c,"INSERT INTO ch_jobs(id,session_id,revision,profile,state,error) VALUES(?,?,?,?,'Failed',?)",job.id,job.session,job.revision,job.profile,job.reason) }
      }
      seed.shared.foreach { case (reader,owner) => setSharing(reader,owner,true) }
      seed.reports.foreach(r => putReport(r.owner,r.collector))
      val provided=new HintFixture {
        val index: ExpressionHintIndex = new PostgresExpressionHintIndex(db,new PostgresArchive(db,scoped),Clock.fixed(now,ZoneOffset.UTC))
        def sharing(reader: String,owner: String,enabled: Boolean): Unit = setSharing(reader,owner,enabled)
        def enabled(user: String,value: Boolean): Unit = db.transaction(c => { Sql.exec(c,"UPDATE ch_users SET enabled=? WHERE id=?",value,user); () })
        def purge(id: UUID): Unit = db.transaction(c => { Sql.exec(c,"UPDATE ch_sources SET tombstone=true WHERE id=?",id); () })
        def append(id: UUID,project: String): Unit = db.transaction { c =>
          val head=seed.heads.find(_.id==id).get
          val next=head.current.copy(number=head.current.number+1,metadata=head.current.metadata.copy(project=Some(project)))
          revision(c,id,next); Sql.exec(c,"UPDATE ch_sources SET revision=? WHERE id=?",next.number,id); ()
        }
        def report(owner: String,collector: String): Unit = putReport(owner,collector)
        def target(owner: String,profile: String): Unit = db.transaction(c => { Sql.exec(c,"UPDATE ch_owner_targets SET profile=? WHERE owner=?",profile,owner); () })
      }
      f(provided,db)
    } finally admin.transaction(c => { Sql.exec(c,s"DROP SCHEMA $schema CASCADE"); () })
  }
  test("Blackbox GoodCommunication specified: numeric preflight and bounded fetch share one RR authority/metadata snapshot") {
    val shared=head(1,"b","shared",List("shared-before"),Nil,Nil)
    database(seed.copy(heads=List(shared),jobs=Nil,reports=Nil,disabled=Set.empty,shared=Set(("a","b")))) { (provided,db) =>
      val barrier=91731402L
      val timeoutSeconds=10
      db.transaction { c =>
        Sql.exec(c,"CREATE SEQUENCE hint_scans")
        Sql.exec(c,s"""CREATE FUNCTION hint_barrier(value jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$$$
          BEGIN IF nextval('hint_scans')=2 THEN PERFORM pg_advisory_lock($barrier); PERFORM pg_advisory_unlock($barrier); END IF; RETURN value; END $$$$""")
        Sql.exec(c,"ALTER TABLE ch_revision_info RENAME TO hint_revision_info_source")
        Sql.exec(c,"CREATE VIEW ch_revision_info AS SELECT session_id,revision,hint_barrier(metadata) AS metadata,source,completion,redacted,last_timestamp,last_timestamp_order,message_count,lexical_version FROM hint_revision_info_source")
      }
      db.transaction { control =>
        Sql.exec(control,"SELECT pg_advisory_lock(?)",barrier)
        val executor=java.util.concurrent.Executors.newSingleThreadExecutor()
        val query=ExpressionHintQuery(archive,"project:","project:".length,20)
        val future=java.util.concurrent.CompletableFuture.supplyAsync(() => provided.index.hints("a",query),executor)
        try {
          val deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(timeoutSeconds)
          def scans: Long = Sql.one(control,"SELECT last_value FROM hint_scans")(_.getLong(1)).get
          while(scans<2 && System.nanoTime()<deadline) Thread.sleep(10)
          assertEquals(scans,2L,"bounded fetch must wait after the numeric preflight")
          provided.sharing("a","b",false)
          Sql.exec(control,"SELECT pg_advisory_unlock(?)",barrier)
          val result=future.get(timeoutSeconds,java.util.concurrent.TimeUnit.SECONDS)
          assertEquals(result.hints.map(_.label),List("shared-before"))
          assertEquals(provided.index.hints("a",query).hints,Nil,"the next request must observe the committed revocation")
        } finally {
          Sql.exec(control,"SELECT pg_advisory_unlock(?)",barrier)
          executor.shutdownNow()
        }
      }
    }
  }
}
