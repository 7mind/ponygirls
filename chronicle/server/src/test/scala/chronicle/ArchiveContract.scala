package chronicle
import chronicle.api.*
import java.util.UUID
import java.time.Instant
import scala.collection.mutable
import distage.*

final class DummyArchive(config: Config,catalog: IndexProfileCatalog) extends SessionArchive with OwnerReindex with PassageReader {
  private final case class Head(id: UUID,owner: String,var request: IngestRequest,var revision: Int,var indexed: Option[Int])
  private final case class Job(var claim: Claim,var state: JobState,var attempts: Int,var lease: Instant,var completed: Int,var total: Option[Int])
  private val sources = mutable.Map.empty[(String,String),Head]
  private val receipts = mutable.Map.empty[(String,String,UUID),(String,IngestReceipt)]
  private val targets=mutable.Map.empty[String,OwnerTarget]
  private val jobs=mutable.LinkedHashMap.empty[UUID,Job]
  private val published = mutable.Map.empty[UUID,(ContentView,IngestRequest,String)]
  private final case class Publication(sessionId: UUID,view: ContentView,format: Option[PassageFormat],chunks: List[IndexedChunk],problems: Option[ProblemsPublication])
  private val revisions=mutable.Map.empty[(UUID,Int),IngestRequest]
  private val generations=mutable.Map.empty[UUID,Publication]
  private val removed=mutable.Set.empty[UUID]
  private val disabled=mutable.Set.empty[String]
  private val sharing=mutable.Set.empty[(String,String)]
  private def enabled(owner: String): Boolean = config.users.exists(u => u.id==owner && u.enabled) && !disabled(owner)
  def clearFormat(generation: UUID): Unit = synchronized { generations(generation)=generations(generation).copy(format=None) }
  def share(owner: String,reader: String): Unit = synchronized { sharing+=((owner,reader)); () }
  def revokeSharing(owner: String,reader: String): Unit = synchronized { sharing-=((owner,reader)); () }
  def setEnabled(owner: String,value: Boolean): Unit = synchronized { if(value) disabled-=owner else disabled+=owner; () }
  def purge(id: UUID): Unit = synchronized {
    removed+=id
    revisions.keys.filter(_._1==id).toList.foreach(revisions.remove)
    generations.filter(_._2.sessionId==id).keys.toList.foreach(generations.remove)
  }
  val knownProfiles: Set[String] = catalog.knownProfiles
  private def target(owner: String): OwnerTarget = targets.getOrElseUpdate(owner,OwnerTarget(catalog.preferred.profile,0))
  def retainTarget(owner: String,profile: String): Unit = synchronized {
    Check(!sources.values.exists(_.owner==owner),"test","retained target must be seeded before ingestion")
    catalog.resolve(profile); targets(owner)=OwnerTarget(profile,0)
  }
  private def key(r: IngestRequest) = Wire.hash(Wire.canonical(Wire.encode(SourceIdentity.codecJson,r.source)))
  def ingest(owner: String,r: IngestRequest): IngestReceipt = synchronized {
    SnapshotValidation.validate(r,config)
    val selected=target(owner); catalog.resolve(selected.profile)
    val k=key(r); val digest=Wire.hash(Wire.canonical(Wire.encode(IngestRequest.codecJson,r)))
    receipts.get((owner,k,r.requestId)) match {
      case Some((d,out)) => Check(d==digest,"conflict","request changed"); out
      case None =>
        val h=sources.getOrElseUpdate((owner,k),Head(UUID.randomUUID(),owner,r,0,None))
        Check(!removed(h.id),"gone","source purged")
        Check(h.revision==r.expectedRevision,"conflict","revision mismatch")
        h.request=SnapshotProjection(r); h.revision+=1
        revisions((h.id,h.revision))=h.request
        jobs.values.filter(j => j.claim.sessionId==h.id && j.claim.revision<h.revision && j.state!=JobState.Complete).foreach { j => j.state=JobState.Failed; j.claim=j.claim.copy(fence=j.claim.fence+1) }
        val claim=Claim(UUID.randomUUID(),h.id,h.revision,0L,selected.profile,h.request,owner,selected.epoch)
        jobs(claim.jobId)=Job(claim,JobState.Queued,0,Instant.EPOCH,0,None)
        val out=IngestReceipt(r.requestId,h.id,h.revision,claim.jobId); receipts((owner,k,r.requestId))=(digest,out); out
    }
  }
  private def head(reader: String,id: UUID): Head = sources.values.find(h => h.id==id && !removed(id) && enabled(h.owner) && enabled(reader) && (h.owner==reader || sharing((h.owner,reader)))).getOrElse(throw DomainError("not-found","not found"))
  def session(reader: String,id: UUID): SessionInfo = synchronized {
    val h=head(reader,id); val value=published.get(id)
    val (view,r)=value.map(x => (x._1,x._2)).getOrElse((ContentView(h.revision,None),h.request))
    SessionInfo(view,id,h.owner,h.revision,h.indexed,r.metadata,r.source,r.completion,r.redacted)
  }
  def headSnapshot(reader: String,id: UUID): IngestRequest = synchronized(head(reader,id).request)
  def claim(profiles: Set[String],scope: ClaimScope,leaseSeconds: Int): Option[Claim] = synchronized {
    Check(profiles.nonEmpty && leaseSeconds>=0,"invalid","invalid claim profiles or lease"); profiles.foreach(catalog.resolve)
    def eligible(j: Job): Boolean = {
      val c=j.claim; val selected=target(c.owner)
      val scoped=scope match { case ClaimScope.AllOwners => true; case ClaimScope.Owner(owner) => c.owner==owner }
      scoped && enabled(c.owner) && !removed(c.sessionId) && profiles(c.profile) && selected.profile==c.profile && sources.values.exists(h => h.id==c.sessionId && h.revision==c.revision)
    }
    jobs.values.filter(j => eligible(j) && j.state==JobState.Running && !j.lease.isAfter(Instant.now()) && j.attempts>=5).foreach { j => j.state=JobState.Failed; j.claim=j.claim.copy(fence=j.claim.fence+1) }
    jobs.values.find(j => eligible(j) && j.attempts<5 && (j.state==JobState.Queued || (j.state==JobState.Running && !j.lease.isAfter(Instant.now())))).map { j =>
      j.state=JobState.Running; j.attempts+=1; j.claim=j.claim.copy(fence=j.claim.fence+1,targetEpoch=target(j.claim.owner).epoch)
      j.lease=Instant.now().plusSeconds(leaseSeconds); j.completed=0; j.total=None; j.claim
    }
  }
  private def valid(c: Claim): Boolean = {
    val selected=target(c.owner)
    enabled(c.owner) && !removed(c.sessionId) && selected==OwnerTarget(c.profile,c.targetEpoch) && sources.values.exists(h => h.id==c.sessionId && h.owner==c.owner && h.revision==c.revision) &&
      jobs.get(c.jobId).exists(j => j.claim==c && j.state==JobState.Running && j.lease.isAfter(Instant.now()))
  }
  def progress(c: Claim,completedWindows: Int,totalWindows: Int): Boolean = synchronized {
    Check(completedWindows>=0 && totalWindows>=completedWindows,"invalid","invalid indexing progress")
    if(!valid(c)) false else {
      val j=jobs(c.jobId)
      if(j.completed>completedWindows || j.total.exists(_!=totalWindows)) false else { j.completed=completedWindows; j.total=Some(totalWindows); true }
    }
  }
  def renew(c: Claim,leaseSeconds: Int): Boolean = synchronized {
    Check(leaseSeconds>0,"invalid","invalid claim lease")
    if(!valid(c)) false else { jobs(c.jobId).lease=Instant.now().plusSeconds(leaseSeconds); true }
  }
  def publish(c: Claim,chunks: List[IndexedChunk]): Boolean = publishGeneration(c,chunks,IndexPolicy.LegacyV4,PassageFormat.LegacyAnnotations,None)
  def publishProblems(c: Claim,publication: ProblemsPublication): Boolean = publishGeneration(c,publication.chunks,IndexPolicy.ContiguousPassagesV1,PassageFormat.ContiguousProblems,Some(publication))
  private def publishGeneration(c: Claim,chunks: List[IndexedChunk],policy: IndexPolicy,format: PassageFormat,problems: Option[ProblemsPublication]): Boolean = synchronized {
    if(!valid(c)) false else {
      Check(catalog.resolve(c.profile).policy==policy,"invalid","publication payload does not match profile policy")
      problems.foreach(_.validate(c,config.embedding.dimensions))
      if(!valid(c)) false else {
        val h=head(c.owner,c.sessionId); h.indexed=Some(c.revision)
        val generation=UUID.randomUUID(); val view=ContentView(c.revision,Some(generation))
        published(h.id)=(view,c.snapshot,c.profile)
        generations(generation)=Publication(c.sessionId,view,Some(format),chunks,problems)
        jobs(c.jobId).state=JobState.Complete; true
      }
    }
  }
  private def selectView(reader: String,id: UUID,selector: Option[ContentView]): ContentView = {
    val h=head(reader,id)
    val view=selector.getOrElse(published.get(id).map(_._1).getOrElse(ContentView(h.revision,None)))
    Check(view.revision>0,"invalid","content revision must be positive")
    Check(revisions.contains((id,view.revision)) && view.generationId.forall(g => generations.get(g).exists(p => p.sessionId==id && p.view==view)),"not-found","content view not found")
    view
  }
  def raw(reader: String,id: UUID,revision: Option[Int]): RawResult = synchronized {
    val h=head(reader,id); val selected=revision.getOrElse(h.revision)
    Check(selected>0,"invalid","content revision must be positive")
    RawResult(revisions.getOrElse((id,selected),throw DomainError("not-found","content view not found")).files,selected)
  }
  def pageChunks(reader: String,id: UUID,offset: Int,limit: Int,selector: Option[ContentView]): ChunksResult = synchronized {
    Check.contentPage(offset,limit); val view=selectView(reader,id,selector)
    val chunks=view.generationId.toList.flatMap(g => generations(g).chunks.map(_.chunk))
    ChunksResult(chunks.drop(offset).take(limit),chunks.size,offset,view)
  }
  def passages(reader: String,id: UUID,offset: Int,limit: Int,selector: Option[ContentView]): PassagesResult = synchronized {
    Check.contentPage(offset,limit); val view=selectView(reader,id,selector)
    view.generationId match {
      case None => PassagesResult(view,PassageFormat.Unindexed,Nil,0,offset)
      case Some(generation) =>
        val stored=generations(generation); val values=stored.problems.map(_.passages).getOrElse(Vector.empty)
        PassagesResult(view,stored.format.getOrElse(throw DomainError("unavailable","generation passage provenance is unknown")),values.drop(offset).take(limit).map(ProblemsPublication.info).toList,values.size.toLong,offset)
    }
  }
  def passageSpans(reader: String,id: UUID,passageId: UUID,offset: Int,limit: Int,selector: Option[ContentView]): PassageSpansResult = synchronized {
    Check.contentPage(offset,limit); val view=selectView(reader,id,selector)
    val generation=view.generationId.getOrElse(throw DomainError("invalid","passage spans require an indexed content view"))
    val stored=generations(generation)
    Check(stored.format.nonEmpty,"unavailable","generation passage provenance is unknown")
    val publication=stored.problems.getOrElse(throw DomainError("not-found","passage not found"))
    val passage=publication.passages.find(_.id==passageId).getOrElse(throw DomainError("not-found","passage not found"))
    val spans=publication.spans.iterator.filter(_.passageOrdinal==passage.ordinal).drop(offset).take(limit).map { span =>
      val s=span.source; PassageSourceSpan(s.messageId,s.messagePosition,s.start,s.end)
    }.toList
    PassageSpansResult(view,passageId,spans,passage.spanCount,offset)
  }
  def fail(c: Claim,code: String): Unit = synchronized {
    if(valid(c)) { val j=jobs(c.jobId); j.state=if(j.attempts>=5) JobState.Failed else JobState.Queued; j.lease=Instant.EPOCH }
  }
  private def ownerHeads(owner: String): List[Head] = sources.values.filter(h => h.owner==owner && !removed(h.id)).toList.sortBy(_.id.toString)
  private def ready(h: Head,profile: String): Boolean = published.get(h.id).exists(p => p._1.revision==h.revision && p._3==profile)
  def preview(owner: String): OwnerReindexPreview = synchronized {
    val current=target(owner); val destination=catalog.transition(current.profile)
    val heads=ownerHeads(owner); val already=heads.count(ready(_,destination.profile)).toLong
    val versions=heads.map(h => s"${h.id}:${h.revision}:${published.get(h.id).map(_._1)}")++jobs.values.filter(_.claim.owner==owner).toList.map(j => s"${j.claim}:${j.state}:${j.attempts}:${j.lease}:${j.completed}:${j.total}")
    OwnerReindexPreview(current.profile,destination.profile,Wire.hash(s"$owner:$current:${destination.profile}:"+versions.mkString("|")),heads.size.toLong,already,heads.size.toLong-already)
  }
  def apply(owner: String,requestId: UUID,targetProfile: String,selectionHash: String,confirm: Boolean): OwnerReindexOutcome = synchronized {
    Check(confirm && requestId!=null && selectionHash!=null && selectionHash.matches("[0-9a-f]{64}"),"invalid","valid selection and explicit confirmation required")
    val plan=preview(owner)
    Check(plan.targetProfile==targetProfile && plan.selectionHash==selectionHash,"conflict","owner reindex selection changed; preview again")
    val current=target(owner); val changed=current.profile!=targetProfile
    if(changed) targets(owner)=OwnerTarget(targetProfile,current.epoch+1)
    var invalidated=0L; var queued=0L
    jobs.values.filter(j => j.claim.owner==owner && j.claim.profile!=targetProfile && Set(JobState.Running,JobState.Queued)(j.state)).foreach { j =>
      if(j.state==JobState.Running) invalidated+=1
      j.state=JobState.Failed; j.claim=j.claim.copy(fence=j.claim.fence+1); j.lease=Instant.EPOCH
    }
    ownerHeads(owner).filterNot(ready(_,targetProfile)).foreach { h =>
      val existing=jobs.values.find(j => j.claim.sessionId==h.id && j.claim.revision==h.revision && j.claim.profile==targetProfile)
      existing match {
        case Some(j) if !changed && j.state==JobState.Running && j.lease.isAfter(Instant.now()) => ()
        case Some(j) => j.state=JobState.Queued; j.attempts=0; j.claim=j.claim.copy(fence=j.claim.fence+1); j.lease=Instant.EPOCH; queued+=1
        case None =>
          val c=Claim(UUID.randomUUID(),h.id,h.revision,0,targetProfile,h.request,owner,target(owner).epoch)
          jobs(c.jobId)=Job(c,JobState.Queued,0,Instant.EPOCH,0,None); queued+=1
      }
    }
    OwnerReindexOutcome(requestId,targetProfile,plan.heads,queued,plan.alreadyCurrent,invalidated)
  }
  def completed(owner: String): Boolean = synchronized(ownerHeads(owner).forall(ready(_,target(owner).profile)))
}
abstract class ArchiveContract extends munit.FunSuite {
  def withArchive(f: (SessionArchive,Config) => Unit): Unit
  test("B-Atomic/GoodCommunication regression: display NUL projection preserves raw fidelity and binds the original request") { withArchive { (a,c) =>
    val original=Fixtures.snapshot(); val value="\u0000start\u0000middle\u0000\t\nend\u0000😀"
    val raw=io.circe.Json.obj("id"->io.circe.Json.fromString("u"),"text"->io.circe.Json.fromString(value)).noSpaces+"\n"
    val metadata=original.metadata.copy(title=value,project=Some(value),gitRemote=Some(value),gitBranch=Some(value),gitCommit=Some(value),producer=value,model=Some(value),tags=List(value))
    val request=original.copy(metadata=metadata,messages=List(Message("u",None,"user",value,None,0)),files=List(RawFile("session.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
    val receipt=a.ingest("a",request); val stored=a.headSnapshot("a",receipt.sessionId)
    val display=value.replace("\u0000","\\u0000")
    assertEquals(stored.messages.head.text,display)
    assertEquals(stored.metadata,metadata.copy(title=display,project=Some(display),gitRemote=Some(display),gitBranch=Some(display),gitCommit=Some(display),producer=display,model=Some(display),tags=List(display)))
    assertEquals(stored.files,request.files); assertEquals(stored.digest,request.digest)
    assertEquals(a.ingest("a",request),receipt)
    assertEquals(intercept[DomainError](a.ingest("a",request.copy(messages=stored.messages,metadata=stored.metadata))).code,"conflict")
    val claim=a.claim(Set(c.profile),ClaimScope.AllOwners,300).get
    assertEquals(claim.snapshot,stored); assert(a.publish(claim,Nil))
    assertEquals(a.session("a",receipt.sessionId).metadata,stored.metadata)
  }}
  test("B-Atomic/GoodCommunication regression: scalar and repeated display NULs terminate fragment derivation") { withArchive { (a,c) =>
    List("\u0000","\u0000\u0000","\u0000start","end\u0000","mid\u0000dle").foreach { text =>
      val original=Fixtures.snapshot()
      val raw=io.circe.Json.obj("id"->io.circe.Json.fromString("u"),"text"->io.circe.Json.fromString(text)).noSpaces+"\n"
      val request=original.copy(messages=List(Message("u",None,"user",text,None,0)),files=List(RawFile("session.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
      val receipt=a.ingest("a",request); val stored=a.headSnapshot("a",receipt.sessionId)
      val fragments=Fragments.split(stored.messages)
      assertEquals(fragments.map(_.text).mkString,text.replace("\u0000","\\u0000"))
      assertEquals(fragments.last.spans.last.end,stored.messages.head.text.length)
      assertEquals(stored.files,request.files)
    }
  }}
  test("B-Atomic/GoodCommunication regression: metadata tags obey the length bound after display projection") { withArchive { (a,c) =>
    val original=Fixtures.snapshot()
    List(123,127).foreach { count =>
      val overflow=original.copy(metadata=original.metadata.copy(tags=List("a"*count+"\u0000")))
      assertEquals(intercept[DomainError](a.ingest("a",overflow)).code,"invalid")
    }
    List("a"*128,"a"*122+"\u0000","a"*126+"\t\n").foreach { tag =>
      val request=Fixtures.snapshot().copy(metadata=original.metadata.copy(tags=List(tag)))
      val receipt=a.ingest("a",request)
      val stored=a.headSnapshot("a",receipt.sessionId)
      assertEquals(stored.metadata.tags,List(tag.replace("\u0000","\\u0000")))
      assertEquals(stored.metadata.tags.head.length,128)
      assertEquals(stored.files,request.files)
    }
  }}
  test("B-Atomic/GoodCommunication regression: unsupported structured NUL and non-scalar Unicode are domain errors") { withArchive { (a,c) =>
    val r=Fixtures.snapshot()
    val invalid: List[IngestRequest => IngestRequest]=List(
      r => r.copy(source=r.source.copy(collectorNamespace="bad\u0000")),
      r => r.copy(source=r.source.copy(discoveryRootId="bad\u0000")),
      r => r.copy(source=r.source.copy(producerSessionId="bad\u0000")),
      r => r.copy(source=r.source.copy(subagentId=Some("bad\u0000"))),
      r => r.copy(files=r.files.map(_.copy(path="bad\u0000"))),
      r => r.copy(files=r.files.map(_.copy(sha256="bad\u0000"))),
      r => r.copy(digest="bad\u0000"),
      r => r.copy(metadata=r.metadata.copy(workdir=Some("bad\u0000"))),
      r => r.copy(metadata=r.metadata.copy(startedAt=Some("bad\u0000"))),
      r => r.copy(metadata=r.metadata.copy(endedAt=Some("bad\u0000"))),
      r => r.copy(messages=r.messages.map(_.copy(id="bad\u0000"))),
      r => r.copy(messages=r.messages.map(_.copy(parentId=Some("bad\u0000")))),
      r => r.copy(messages=r.messages.map(_.copy(role="bad\u0000"))),
      r => r.copy(messages=r.messages.map(_.copy(timestamp=Some("bad\u0000")))),
      r => r.copy(messages=r.messages.map(_.copy(text="bad"+0xd800.toChar))),
      r => r.copy(metadata=r.metadata.copy(title="bad"+0xdc00.toChar)),
      r => r.copy(files=r.files.map(_.copy(path="bad"+0xd800.toChar))),
      r => r.copy(source=r.source.copy(collectorNamespace="bad"+0xdc00.toChar))
    )
    invalid.foreach(change => assertEquals(intercept[DomainError](a.ingest("a",change(r))).code,"invalid"))
  }}
  test("B-Atomic/GoodCommunication: supported non-NUL controls in opaque IDs paths and display text remain unchanged") { withArchive { (a,c) =>
    val original=Fixtures.snapshot(); val value="tab\tline\ncarriage\r"
    val r=original.copy(source=original.source.copy(collectorNamespace=value,discoveryRootId=value,producerSessionId=value,subagentId=Some(value)),files=original.files.map(_.copy(path=value)),metadata=original.metadata.copy(title=value,workdir=Some(value)),messages=original.messages.map(_.copy(id=value,parentId=None,role=value,text=value,timestamp=Some(value))))
    val receipt=a.ingest("a",r)
    assertEquals(a.headSnapshot("a",receipt.sessionId),r)
  }}
  test("B-Atomic/GoodCommunication: durable replay binding CAS and raw retention") { withArchive { (a,c) =>
    val r=Fixtures.snapshot(); val out=a.ingest("a",r)
    assertEquals(a.ingest("a",r),out)
    assertEquals(a.headSnapshot("a",out.sessionId),r)
    assertEquals(intercept[DomainError](a.ingest("a",r.copy(metadata=r.metadata.copy(title="different")))).code,"conflict")
    assertEquals(intercept[DomainError](a.ingest("a",r.copy(requestId=UUID.randomUUID()))).code,"conflict")
    assertEquals(a.ingest("a",r.copy(requestId=UUID.randomUUID(),expectedRevision=1)).revision,2)
    assertEquals(intercept[DomainError](a.headSnapshot("b",out.sessionId)).code,"not-found")
  }}
  test("B-Atomic/GoodCommunication: discovery binds published source while head remains explicitly readable") { withArchive { (a,c) =>
    val r=Fixtures.snapshot(); val out=a.ingest("a",r)
    assert(a.publish(a.claim(Set(c.profile),ClaimScope.AllOwners,300).get,Nil))
    a.ingest("a",r.copy(requestId=UUID.randomUUID(),expectedRevision=1,metadata=r.metadata.copy(title="new-head")))
    val selected=a.session("a",out.sessionId)
    assertEquals(selected.view.revision,1); assert(selected.view.generationId.isDefined)
    assertEquals(selected.revision,2); assertEquals(selected.metadata.title,r.metadata.title)
    assertEquals(a.headSnapshot("a",out.sessionId).metadata.title,"new-head")
  }}
  test("B-Atomic/GoodCommunication: stale worker cannot publish over newer archive head") { withArchive { (a,c) =>
    val r=Fixtures.snapshot(); val out=a.ingest("a",r); val claim=a.claim(Set(c.profile),ClaimScope.AllOwners,300).get
    a.ingest("a",r.copy(requestId=UUID.randomUUID(),expectedRevision=1))
    assert(!a.publish(claim,Nil)); assertEquals(a.session("a",out.sessionId).indexedRevision,None)
    val fresh=a.claim(Set(c.profile),ClaimScope.AllOwners,300).get; assert(a.publish(fresh,Nil)); assertEquals(a.session("a",out.sessionId).indexedRevision,Some(2))
    assert(!a.publish(fresh,Nil))
  }}
}
final class ArchiveDummyTest extends ArchiveContract {
  def withArchive(f: (SessionArchive,Config) => Unit): Unit = {
    val c=Fixtures.config()
    Injector().produceGet[SessionArchive](new ModuleDef { tag(StandardAxis.Repo.Dummy); make[Config].fromValue(c); make[IndexProfileCatalog].fromValue(IndexProfileCatalog.legacyOnly(c)); make[SessionArchive].from[DummyArchive] }).use(a => f(a,c))
  }
}
final class ArchivePostgresTest extends ArchiveContract {
  def withArchive(f: (SessionArchive,Config) => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped; run scripts/test-postgres.sh for full verification") }
    val c=Fixtures.config()
    val db=new Database(c,IndexProfileCatalog.legacyOnly(c)); db.initialize()
    db.transaction(x => { Sql.exec(x,"TRUNCATE ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE"); Sql.exec(x,"UPDATE ch_profile SET active=?,target=?,maintenance=false",c.profile,c.profile); Sql.exec(x,"UPDATE ch_owner_targets SET profile=?,epoch=0",c.profile) })
    Injector().produceGet[SessionArchive](new ModuleDef { tag(StandardAxis.Repo.Prod); make[Config].fromValue(c); make[Database].fromValue(db); make[SessionArchive].from[PostgresArchive] }).use(a => f(a,c))
  }
}
