package chronicle
import chronicle.api.*
import cats.effect.IO
import cats.syntax.all.*
import java.util.UUID
final class Application(archive: PostgresArchive,searchIndex: SearchIndex,embedder: Embedder,auth: Auth,db: Database,collectors: CollectorProgress,archiveIndex: ArchiveIndex,activityIndex: ActivityIndex,hints: ExpressionHintIndex,usage: ModelUsageView) {
  def collectorProgress(i: Identity,r: CollectorProgressUpdate): CollectorProgressAck = collectors.update(i,r)
  private val emptyFilter = SearchFilter(None,None,None,None,Nil)
  def operationVersion(i: Identity,e: ClientEnvelope,version: String): IO[Result] = {
    Check(Wire.versions.supported.contains(version),"version-mismatch","unsupported API version")
    operation(i,e)
  }
  def operation(i: Identity,e: ClientEnvelope): IO[Result] = IO.defer {
    val uid = i.user.id
    e.operation match {
      case Operation.Hello(versions) => IO { Wire.negotiate(versions); Result.Hello(Wire.versions,i.user) }
      case Operation.Ping(nonce) => IO { Check.text(nonce,128); Result.Pong(nonce) }
      case Operation.Pong(nonce) => IO.pure(Result.Pong(nonce))
      case Operation.Whoami() | Operation.Search(_) => read(ReadAccess.current(i),e.operation)
      case Operation.Archive(q) =>
        i.requireScope(Scope.Read)
        archivePlan(uid,q).flatMap { (parsed,values) => IO.blocking(Result.Archive(archiveIndex.browse(uid,q,parsed,values))) }
      case request: Operation.ArchiveSearch =>
        contextReadAccess(i,IO.blocking(db.transaction(c => auth.currentBrowser(c,i)))).flatMap(access => read(access,request))
      case Operation.ExpressionHints(q) => i.requireScope(Scope.Read); IO.blocking(Result.ExpressionHints(hints.hints(uid,q)))
      case Operation.ModelUsage() => usage.read(i).map(Result.ModelUsage.apply)
      case Operation.GetPassages(id,view,offset,limit) => i.requireScope(Scope.Read); IO.blocking(Result.Passages(archive.passages(uid,id,offset,limit,Some(view))))
      case Operation.GetPassageSpans(id,view,passageId,offset,limit) => i.requireScope(Scope.Read); IO.blocking(Result.PassageSpans(archive.passageSpans(uid,id,passageId,offset,limit,Some(view))))
      case Operation.Activity(q) => i.requireScope(Scope.Read); IO.blocking(Result.Activity(activityIndex.summary(i.user,q)))
      case Operation.ActivityJobs(q) => i.requireScope(Scope.Read); IO.blocking(Result.ActivityJobs(activityIndex.jobs(uid,q)))
      case request: Operation.ReadMessageContext =>
        contextReadAccess(i,IO.blocking(db.transaction(c => auth.currentBrowser(c,i)))).flatMap(access => read(access,request))
      case Operation.LocateMessage(id,view,messageId) => i.requireScope(Scope.Read); IO.blocking(Result.LocatedMessage(archive.locateMessage(uid,id,view,messageId)))
      case Operation.GetSession(_,_) | Operation.GetChunks(_,_,_,_) | Operation.GetMessages(_,_,_,_) | Operation.SearchSessionMessages(_,_,_,_,_) => read(ReadAccess.current(i),e.operation)
      case Operation.GetRaw(id,revision) => i.requireScope(Scope.Read); i.requireScope(Scope.Raw); IO.blocking(Result.Raw(archive.raw(uid,id,revision)))
      case Operation.Related(_,_) | Operation.Facets(_) | Operation.IngestStatus(_,_) => read(ReadAccess.current(i),e.operation)
      case Operation.CollectionStatus() => IO.blocking(Result.CollectionStatus(collectors.status(i)))
      case Operation.ListTokens() => IO.blocking(Result.Tokens(auth.tokens(i)))
      case Operation.ListGroups() => IO.blocking(Result.Groups(auth.groups(i)))
      case Operation.Receipt(id) => IO.blocking(auth.receipt(i,id))
      case Operation.PreviewRetryFailed() => IO.blocking(Result.RetryFailedPreview(auth.previewRetryFailed(i)))
      case Operation.PreviewOwnerReindex() => IO.blocking(Result.OwnerReindexPreview(auth.previewOwnerReindex(i)))
      case Operation.GetReindexStatus(id) => IO.blocking(Result.ReindexStatus(auth.reindexStatus(i,id)))
      case _ => IO.blocking(auth.mutate(i,e))
    }
  }
  def contextReadAccess(expected: Identity,fresh: IO[Identity]): IO[ReadAccess] =
    IO.blocking(db.transaction(SecurityEpoch.current)).map { epoch =>
      val current=fresh.flatTap { identity => IO.blocking {
        Check(identity.user.id==expected.user.id && identity.browser==expected.browser && identity.credentialHash==expected.credentialHash,"unauthorized","context credential changed")
        Check(db.transaction(SecurityEpoch.current)==epoch,"authorization-changed","access changed during context read")
      }}
      ReadAccess(current,ReadMaterialization.unrestricted)
    }
  def searchTags(access: ReadAccess,query: TagSearchQuery): IO[Result] =
    access.blocking(i => Result.Facets(FacetsResult(Nil,Nil,searchIndex.tags(i.user.id,query,access.materialization))))
  def read(access: ReadAccess,operation: Operation): IO[Result] = IO.defer {
    val materialization=access.materialization
    operation match {
      case Operation.Whoami() => access.fresh.map { identity =>
        materialization.admit(JsonUtf8Size(Wire.encode(UserInfo.codecJson,identity.user)))
        Result.Whoami(identity.user)
      }
      case Operation.Search(q) => query(access,q).map(Result.Search.apply)
      case Operation.ArchiveSearch(q) =>
        ArchiveSearchPolicy.page(q.limit)
        access.identity.flatMap(i => archivePlan(i.user.id,q)).flatMap { (parsed,values) =>
          access.blocking(i => Result.ArchiveSearch(archiveIndex.sourceSearch(i.user.id,q,parsed,values,materialization)))
        }
      case Operation.GetSession(id,view) => access.blocking(i => Result.Session(archive.readSession(i.user.id,id,view,materialization)))
      case Operation.GetChunks(id,offset,limit,view) => access.blocking(i => Result.Chunks(archive.pageChunks(i.user.id,id,offset,limit,view,materialization)))
      case Operation.ReadMessageContext(id,view,anchor,beforeBytes,afterBytes) => access.blocking(i => Result.MessageContext(archive.readMessageContext(i.user.id,id,view,anchor,beforeBytes,afterBytes,materialization)))
      case Operation.GetMessages(id,offset,limit,view) => access.blocking(i => Result.Messages(archive.messages(i.user.id,id,offset,limit,view,materialization)))
      case Operation.SearchSessionMessages(id,view,literal,cursor,limit) => access.blocking(i => Result.SessionMessageSearch(archive.searchSessionMessages(i.user.id,id,view,literal,cursor,limit,materialization)))
      case Operation.Related(id,limit) =>
        Check.page(0,limit)
        access.blocking(i => archive.pageChunks(i.user.id,id,0,1,None,materialization).chunks.headOption.map(_.summary).getOrElse("")).flatMap { text =>
          if(text.isEmpty) IO.pure(Result.Related(RelatedResult(Nil)))
          else query(access,SearchQuery(text.take(2048),SearchMode.Lexical,emptyFilter,math.min(limit+1,100),0)).map(r => Result.Related(RelatedResult(r.hits.filterNot(_.session.id==id).take(limit))))
        }
      case Operation.Facets(f) => access.blocking(i => Result.Facets(searchIndex.facets(i.user.id,f,materialization)))
      case Operation.IngestStatus(offset,limit) => access.blocking(i => Result.Status(archive.statuses(i.user.id,offset,limit,materialization)))
      case _ => IO.raiseError(DomainError("invalid","operation is not a source read tool"))
    }
  }
  private def archivePlan(reader: String,q: ArchiveQuery): IO[(ParsedArchiveExpression,List[ArchiveVector])] = IO.defer {
    val parsed=ArchiveExpression.parse(q.expression)
    ArchivePaging.page(q.limit); ArchivePaging.decode(q,reader,ArchiveExpression.relevanceOrdered(q,parsed))
    val vectors=if(parsed.mode==SearchMode.Lexical || parsed.textOperands.isEmpty) IO.pure(List.empty[ArchiveVector])
      else parsed.textOperands.traverse(text => embedder.query(reader,text).map(values => ArchiveVector(text,values))).handleErrorWith(_ => IO.raiseError(DomainError("unavailable","query embedding unavailable")))
    vectors.map(values => (parsed,values))
  }
  private def query(access: ReadAccess,q: SearchQuery): IO[SearchResult] = IO.defer {
    SearchPolicy.validateQuery(q,false)
    access.identity.flatMap { identity =>
      val vector = if(q.mode==SearchMode.Lexical) IO.pure(None) else embedder.query(identity.user.id,q.query).map(Some(_))
      vector.flatMap(v => access.blocking(i => searchIndex.search(i.user.id,q,v,access.materialization)))
    }
  }
}
