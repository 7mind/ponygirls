package manure

import cats.effect.IO
import manure.storage.RootLease

/** Handwritten contract dummy, not a second database/isolation emulator. Exact PG
  * lock contention and uncertain commit cases live in real-adapter-only suites.
  */
final class MemoryMetadata(root: RootLease) extends Metadata:
  private case class State(artifacts: Map[String,Artifact],receipts: Map[(String,String,Long),Receipt],
    oneTime: Map[String,OneTimeGrant],content: Map[String,ContentGrant],passwords: Map[String,ExternalPasswordSecret])
  private var committed = State(Map.empty,Map.empty,Map.empty,Map.empty,Map.empty)
  def transaction[A](body: MetadataTxn => A): IO[A] = IO.blocking { synchronized { root.run {
    var s = committed
    val tx = new MetadataTxn:
      def artifact(id: String): Option[Artifact] = s.artifacts.get(id)
      def artifacts(after: Option[String],limit: Int): Vector[Artifact] = s.artifacts.values.toVector.filter(a => after.forall(Exact.compare(a.id,_) > 0)).sortWith((a,b) => Exact.compare(a.id,b.id) < 0).take(limit)
      def catalogue(selection: CataloguePolicy.Selection): Vector[Artifact] = CataloguePolicy.select(s.artifacts.values,selection)
      def put(a: Artifact): Unit = s = s.copy(artifacts=s.artifacts.updated(a.id,a))
      def delete(id: String): Unit =
        revokeArtifact(id); clearReceipts(id); s = s.copy(artifacts=s.artifacts-id,passwords=s.passwords-id)
      def externalPassword(id: String): Option[ExternalPasswordSecret] = s.passwords.get(id)
      def putExternalPassword(id: String,password: Option[ExternalPasswordSecret]): Unit =
        if password.nonEmpty then Require(s.artifacts.contains(id), "not-found")
        s = s.copy(passwords=password.fold(s.passwords-id)(p => s.passwords.updated(id,p)))
      def reservation: Long = s.artifacts.values.map(_.reservedBytes).sum
      def sessions(user: Option[String]): Long = s.artifacts.values.count(a => a.state != UploadState.Ready && user.forall(_ == a.createdByUser)).toLong
      def receipts(id: String,path: String): Vector[Receipt] = s.receipts.values.filter(r => r.artifactId == id && r.path == path).toVector.sortBy(_.offset)
      def putReceipt(r: Receipt): Unit =
        Require(s.artifacts.contains(r.artifactId) && !s.receipts.contains((r.artifactId,r.path,r.offset)), "chunk-conflict")
        s = s.copy(receipts=s.receipts.updated((r.artifactId,r.path,r.offset),r))
      def deleteReceipt(id: String,path: String,offset: Long): Unit = s = s.copy(receipts=s.receipts-((id,path,offset)))
      def clearReceipts(id: String): Unit = s = s.copy(receipts=s.receipts.filterNot(_._1._1 == id))
      def oneTime(hash: String): Option[OneTimeGrant] = s.oneTime.get(hash)
      def putOneTime(g: OneTimeGrant): Unit =
        Require(s.artifacts.contains(g.artifactId), "not-found")
        s = s.copy(oneTime=s.oneTime.updated(g.hash,g))
      def content(hash: String): Option[ContentGrant] = s.content.get(hash)
      def putContent(g: ContentGrant): Unit =
        Require(s.artifacts.contains(g.artifactId) && !s.content.contains(g.hash), "grant-invalid")
        s = s.copy(content=s.content.updated(g.hash,g))
      def deleteContent(hash: String): Unit = s = s.copy(content=s.content-hash)
      def trimContent(id: String,max: Int,newestHash: String): Unit =
        Require(max > 0, "bad-envelope")
        val keep = s.content.values.filter(g => g.artifactId == id && g.hash != newestHash).toVector
          .sortWith((a,b) => if a.createdAt == b.createdAt then Exact.compare(a.hash,b.hash) > 0 else a.createdAt > b.createdAt)
          .take(max-1).map(_.hash).toSet + newestHash
        s = s.copy(content=s.content.filter((_,g) => g.artifactId != id || keep(g.hash)))
      def revokeArtifact(id: String): Unit = s = s.copy(oneTime=s.oneTime.filterNot(_._2.artifactId == id),content=s.content.filterNot(_._2.artifactId == id))
      def revokeCredential(user: String,token: String): Unit =
        s = s.copy(oneTime=s.oneTime.filterNot((_,g) => g.userId.contains(user) && g.tokenId.contains(token)),content=s.content.filterNot((_,g) => g.userId.contains(user) && g.tokenId.contains(token)))
      def sweepGrants(now: Double): Unit = s = s.copy(oneTime=s.oneTime.filter(_._2.expiresAt > now),content=s.content.filter(_._2.expiresAt > now))
    val result = body(tx)
    committed = s
    result
  }}}
