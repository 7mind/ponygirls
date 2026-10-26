package chronicle
import chronicle.api.*
import cats.effect.IO
import cats.syntax.all.*
import java.util.UUID
final class Application(archive: PostgresArchive,searchIndex: SearchIndex,embedder: Embedder,auth: Auth,db: Database,collectors: CollectorProgress,archiveIndex: ArchiveIndex,activityIndex: ActivityIndex) {
  def collectorProgress(i: Identity,r: CollectorProgressUpdate): CollectorProgressAck = collectors.update(i,r)
  private val emptyFilter = SearchFilter(None,None,None,None,Nil)
  def operationVersion(i: Identity,e: ClientEnvelope,version: String): IO[Result] = {
    Check(Wire.versions.supported.contains(version),"version-mismatch","unsupported API version")
    e.operation match {
      case Operation.Search(q) if version=="1.0.0" =>
        i.requireScope(Scope.Read)
        val vector=if(q.mode==SearchMode.Lexical) IO.pure(None) else embedder.query(q.query).map(Some(_))
        vector.flatMap(v => IO.blocking(Result.Search(searchIndex.searchLegacy(i.user.id,q,v))))
      case _ => operation(i,e)
    }
  }
  def operation(i: Identity,e: ClientEnvelope): IO[Result] = IO.defer {
    val uid = i.user.id
    e.operation match {
      case Operation.Hello(versions) => IO { Wire.negotiate(versions); Result.Hello(Wire.versions,i.user) }
      case Operation.Ping(nonce) => IO { Check.text(nonce,128); Result.Pong(nonce) }
      case Operation.Pong(nonce) => IO.pure(Result.Pong(nonce))
      case Operation.Whoami() => IO.pure(Result.Whoami(i.user))
      case Operation.Search(q) => i.requireScope(Scope.Read); query(i,q).map(Result.Search.apply)
      case Operation.Archive(q) =>
        i.requireScope(Scope.Read)
        val parsed=ArchiveExpression.parse(q.expression)
        ArchivePaging.page(q.limit); ArchivePaging.decode(q,uid)
        val vectors=if(parsed.mode==SearchMode.Lexical || parsed.textOperands.isEmpty) IO.pure(List.empty[ArchiveVector])
          else parsed.textOperands.traverse(text => embedder.query(text).map(values => ArchiveVector(text,values))).handleErrorWith(_ => IO.raiseError(DomainError("unavailable","query embedding unavailable")))
        vectors.flatMap(values => IO.blocking(Result.Archive(archiveIndex.browse(uid,q,parsed,values))))
      case Operation.Activity(q) => i.requireScope(Scope.Read); IO.blocking(Result.Activity(activityIndex.summary(i.user,q)))
      case Operation.ActivityJobs(q) => i.requireScope(Scope.Read); IO.blocking(Result.ActivityJobs(activityIndex.jobs(uid,q)))
      case Operation.LocateMessage(id,view,messageId) => i.requireScope(Scope.Read); IO.blocking(Result.LocatedMessage(archive.locateMessage(uid,id,view,messageId)))
      case Operation.GetSession(id,view) => i.requireScope(Scope.Read); IO.blocking(Result.Session(archive.readSession(uid,id,view)))
      case Operation.GetChunks(id,offset,limit,view) => i.requireScope(Scope.Read); IO.blocking(Result.Chunks(archive.pageChunks(uid,id,offset,limit,view)))
      case Operation.GetMessages(id,offset,limit,view) => i.requireScope(Scope.Read); IO.blocking(Result.Messages(archive.messages(uid,id,offset,limit,view)))
      case Operation.GetRaw(id,revision) => i.requireScope(Scope.Read); i.requireScope(Scope.Raw); IO.blocking(Result.Raw(archive.raw(uid,id,revision)))
      case Operation.Related(id,limit) =>
        i.requireScope(Scope.Read)
        IO.blocking(archive.pageChunks(uid,id,0,1,None).chunks.headOption.map(_.summary).getOrElse("")).flatMap { text =>
          Check.page(0,limit)
          if(text.isEmpty) IO.pure(Result.Related(RelatedResult(Nil)))
          else query(i,SearchQuery(text.take(2048),SearchMode.Lexical,emptyFilter,math.min(limit+1,100),0)).map(r => Result.Related(RelatedResult(r.hits.filterNot(_.session.id==id).take(limit))))
        }
      case Operation.Facets(f) => i.requireScope(Scope.Read); IO.blocking(Result.Facets(searchIndex.facets(uid,f)))
      case Operation.IngestStatus(offset,limit) => i.requireScope(Scope.Read); IO.blocking(Result.Status(archive.statuses(uid,offset,limit)))
      case Operation.CollectionStatus() => IO.blocking(Result.CollectionStatus(collectors.status(i)))
      case Operation.ListTokens() => IO.blocking(Result.Tokens(auth.tokens(i)))
      case Operation.ListGroups() => IO.blocking(Result.Groups(auth.groups(i)))
      case Operation.Receipt(id) => IO.blocking(auth.receipt(i,id))
      case Operation.PreviewRetryFailed() => IO.blocking(Result.RetryFailedPreview(auth.previewRetryFailed(i)))
      case _ => IO.blocking(auth.mutate(i,e))
    }
  }
  private def query(i: Identity,q: SearchQuery): IO[SearchResult] = {
    val vector = if(q.mode==SearchMode.Lexical) IO.pure(None) else embedder.query(q.query).map(Some(_))
    vector.flatMap(v => IO.blocking(searchIndex.search(i.user.id,q,v)))
  }
}
