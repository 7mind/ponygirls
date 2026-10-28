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
    e.operation match {
      case Operation.Search(q) if version=="1.0.0" =>
        i.requireScope(Scope.Read)
        query(ReadAccess.current(i),q,true).map(Result.Search.apply)
      case Operation.GetPassages(id,view,_,_) if version!="1.7.0" => retainedPassageRead(i,e,id,view)
      case Operation.GetPassageSpans(id,view,_,_,_) if version!="1.7.0" => retainedPassageRead(i,e,id,view)
      case _ => operation(i,e)
    }
  }
  private def retainedPassageRead(i: Identity,e: ClientEnvelope,id: UUID,view: ContentView): IO[Result] =
    IO.blocking {
      i.requireScope(Scope.Read)
      // Fresh ACL/pin/retirement validation precedes feature compatibility; never disconnect an older client.
      Check(archive.passages(i.user.id,id,0,1,Some(view)).format!=PassageFormat.ContextAwareProblems,"unavailable","context-aware passage reads require API1.7")
    } *> operation(i,e)
  def operation(i: Identity,e: ClientEnvelope): IO[Result] = IO.defer {
    val uid = i.user.id
    e.operation match {
      case Operation.Hello(versions) => IO { Wire.negotiate(versions); Result.Hello(Wire.versions,i.user) }
      case Operation.Ping(nonce) => IO { Check.text(nonce,128); Result.Pong(nonce) }
      case Operation.Pong(nonce) => IO.pure(Result.Pong(nonce))
      case Operation.Whoami() | Operation.Search(_) => read(ReadAccess.current(i),e.operation)
      case Operation.Archive(q) =>
        i.requireScope(Scope.Read)
        val parsed=ArchiveExpression.parse(q.expression)
        ArchivePaging.page(q.limit); ArchivePaging.decode(q,uid)
        val vectors=if(parsed.mode==SearchMode.Lexical || parsed.textOperands.isEmpty) IO.pure(List.empty[ArchiveVector])
          else parsed.textOperands.traverse(text => embedder.query(uid,text).map(values => ArchiveVector(text,values))).handleErrorWith(_ => IO.raiseError(DomainError("unavailable","query embedding unavailable")))
        vectors.flatMap(values => IO.blocking(Result.Archive(archiveIndex.browse(uid,q,parsed,values))))
      case Operation.ExpressionHints(q) => i.requireScope(Scope.Read); IO.blocking(Result.ExpressionHints(hints.hints(uid,q)))
      case Operation.ModelUsage() => usage.read(i).map(Result.ModelUsage.apply)
      case Operation.GetPassages(id,view,offset,limit) => i.requireScope(Scope.Read); IO.blocking(Result.Passages(archive.passages(uid,id,offset,limit,Some(view))))
      case Operation.GetPassageSpans(id,view,passageId,offset,limit) => i.requireScope(Scope.Read); IO.blocking(Result.PassageSpans(archive.passageSpans(uid,id,passageId,offset,limit,Some(view))))
      case Operation.Activity(q) => i.requireScope(Scope.Read); IO.blocking(Result.Activity(activityIndex.summary(i.user,q)))
      case Operation.ActivityJobs(q) => i.requireScope(Scope.Read); IO.blocking(Result.ActivityJobs(activityIndex.jobs(uid,q)))
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
  def read(access: ReadAccess,operation: Operation): IO[Result] = IO.defer {
    val materialization=access.materialization
    operation match {
      case Operation.Whoami() => access.fresh.map { identity =>
        materialization.admit(JsonUtf8Size(Wire.encode(UserInfo.codecJson,identity.user)))
        Result.Whoami(identity.user)
      }
      case Operation.Search(q) => query(access,q,false).map(Result.Search.apply)
      case Operation.GetSession(id,view) => access.blocking(i => Result.Session(archive.readSession(i.user.id,id,view,materialization)))
      case Operation.GetChunks(id,offset,limit,view) => access.blocking(i => Result.Chunks(archive.pageChunks(i.user.id,id,offset,limit,view,materialization)))
      case Operation.GetMessages(id,offset,limit,view) => access.blocking(i => Result.Messages(archive.messages(i.user.id,id,offset,limit,view,materialization)))
      case Operation.SearchSessionMessages(id,view,literal,cursor,limit) => access.blocking(i => Result.SessionMessageSearch(archive.searchSessionMessages(i.user.id,id,view,literal,cursor,limit,materialization)))
      case Operation.Related(id,limit) =>
        Check.page(0,limit)
        access.blocking(i => archive.pageChunks(i.user.id,id,0,1,None,materialization).chunks.headOption.map(_.summary).getOrElse("")).flatMap { text =>
          if(text.isEmpty) IO.pure(Result.Related(RelatedResult(Nil)))
          else query(access,SearchQuery(text.take(2048),SearchMode.Lexical,emptyFilter,math.min(limit+1,100),0),false).map(r => Result.Related(RelatedResult(r.hits.filterNot(_.session.id==id).take(limit))))
        }
      case Operation.Facets(f) => access.blocking(i => Result.Facets(searchIndex.facets(i.user.id,f,materialization)))
      case Operation.IngestStatus(offset,limit) => access.blocking(i => Result.Status(archive.statuses(i.user.id,offset,limit,materialization)))
      case _ => IO.raiseError(DomainError("invalid","operation is not a source read tool"))
    }
  }
  private def query(access: ReadAccess,q: SearchQuery,legacy: Boolean): IO[SearchResult] = IO.defer {
    SearchPolicy.validateQuery(q,legacy)
    access.identity.flatMap { identity =>
      val vector = if(q.mode==SearchMode.Lexical) IO.pure(None) else embedder.query(identity.user.id,q.query).map(Some(_))
      vector.flatMap(v => access.blocking(i => if(legacy) searchIndex.searchLegacy(i.user.id,q,v,access.materialization) else searchIndex.search(i.user.id,q,v,access.materialization)))
    }
  }
}
