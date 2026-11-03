package manure

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Base64
import manure.{api => wire}
import manure.plugins.RuntimeServices
import munit.FunSuite

/** Regression: accepted wide manager IDs must not break publication or ACL
  * backfill. Real production lifecycle, owned PG and non-owner runtime role.
  * Expected behavior is SUCCESS, never acceptance/skipping of SQLSTATE 54000.
  * Diagnostics contain only synthetic ID length/hash, never the raw wide ID.
  */
final class WideAudienceAuditSuite extends FunSuite:
  private val wide = Base64.getUrlEncoder.withoutPadding.encodeToString(
    (0 until 96).flatMap(i => MessageDigest.getInstance("SHA-256").digest(Exact.utf8(s"manure-wide-audience-audit-1:$i"))).toArray)
  private def encoded(value: String): String = Base64.getUrlEncoder.withoutPadding.encodeToString(Exact.utf8(value))
  private def normalConfig(base: Config): Config = base.copy(users=base.users.map(u => if u.id=="other" then u.copy(userType="human") else u))
  private def withWide(config: Config): IO[(Config,Identity)] = IO.blocking {
    val token=SecretCodec.token()
    val path=config.dataDir.getParent.resolve("wide-audit.hash")
    Files.writeString(path,SecretCodec.sha256(token)+"\n")
    val out=config.copy(users=config.users :+ UserConfig(wide,"human",Vector(TokenRef("audit",path)),""))
    out.validate()
    val identity=new Auth(out.users).authenticate(token).get
    assert(identity.userId==wide,"authentication changed the exact wide ID")
    (out,identity)
  }
  private def checkedRuntime(s: RuntimeServices,config: Config): IO[Unit] = for
    _ <- IO { assertEquals(config.embedding,None); assertEquals(s.search.modes,List(wire.SearchMode.Lexical)) }
    worked <- s.worker.once()
    _ <- IO(assertEquals(worked,false))
    _ <- s.database.transaction { c =>
      val restricted=Jdbc.rows(c,"SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AND current_user<>(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) FROM pg_roles WHERE rolname=current_user")(_.getBoolean(1)).head
      assert(restricted,"runtime must not be administrator or database owner")
      val modelRows=Jdbc.rows(c,"SELECT (SELECT count(*) FROM pony_retrieval_jobs)+(SELECT count(*) FROM pony_retrieval_accepted)+(SELECT count(*) FROM pony_retrieval_generations)+(SELECT count(*) FROM pony_retrieval_chunks)")(_.getLong(1)).head
      assertEquals(modelRows,0L)
    }
  yield ()
  private def publish(s: RuntimeServices,identity: Identity): IO[Artifact] = for
    initialized <- s.artifacts.init(identity,InitUpload("audienceprobe",ArtifactKind.Directory,Visibility.Internal,Vector.empty,None))
    result <- s.artifacts.finish(identity,initialized.artifact.id).attempt
    state <- s.database.transaction(c => Jdbc.rows(c,"SELECT state FROM manure.artifacts WHERE id=?",Exact.utf8(initialized.artifact.id))(r => Exact.string(r.getBytes(1))).head)
    _ <- IO(println("WIDE_AUDIENCE_PUBLICATION "+status(result)+" persistedState="+state))
    ready <- IO.fromEither(result)
    _ <- IO(assertEquals(ready.state,UploadState.Ready))
  yield ready
  private def hits(s: RuntimeServices,config: Config,identity: Identity,owner: String): IO[wire.SearchPage] =
    s.search.query(identity,wire.SearchQuery("audienceprobe",wire.SearchMode.Lexical,wire.SearchFilter(None,None,Some(owner)),20,None),config.apiOrigin)
  private def visible(s: RuntimeServices,config: Config,identity: Identity,a: Artifact): IO[Unit] = for
    page <- hits(s,config,identity,a.createdByUser)
    info <- s.artifacts.info(identity,a.id)
    _ <- IO {
      assertEquals(page.total,1L)
      assertEquals(page.hits.map(_.artifact.artifactId),List(a.id))
      val hit=page.hits.head
      assertEquals(hit.sourceVersion,s.projection.version(a))
      assertEquals(hit.embeddingProfile,None); assertEquals(hit.embeddingSpace,None)
      assert(hit.artifact.createdByUser==a.createdByUser,"public creator was hashed/truncated")
      assert(info.createdByUser==a.createdByUser,"authoritative creator changed")
      val actual=Exact.utf8(CurrentWire.encode(wire.Artifact.codecJson,hit.artifact).noSpaces)
      val expected=Exact.utf8(CurrentWire.encode(wire.Artifact.codecJson,s.projection.snapshot(a)).noSpaces)
      assert(java.util.Arrays.equals(actual,expected),"public pinned snapshot bytes changed")
    }
    _ <- s.database.transaction { c =>
      val raw=Jdbc.rows(c,"SELECT created_by_user FROM manure.artifacts WHERE id=?",Exact.utf8(a.id))(_.getBytes(1)).head
      assert(java.util.Arrays.equals(raw,Exact.utf8(a.createdByUser)),"raw UTF-8 creator bytes changed")
    }
  yield ()
  private case class Snapshot(heads: Vector[Vector[String]],pinned: Vector[(Vector[Byte],Vector[Byte])])
  private def snapshot(s: RuntimeServices): IO[Snapshot] = s.database.transaction { c =>
    val heads=Jdbc.rows(c,"SELECT version,input_digest,target_profile,epoch::text,head_generation,coalesce(published,'') FROM pony_retrieval_sources ORDER BY namespace,id")(r => (1 to 6).map(r.getString).toVector)
    val pinned=Jdbc.rows(c,"SELECT version,metadata FROM manure.search_versions ORDER BY artifact_id,version")(r => (r.getBytes(1).toVector,r.getBytes(2).toVector))
    Snapshot(heads,pinned)
  }
  private def status[A](result: Either[Throwable,A]): String = result.fold({
    case e: java.sql.SQLException => "sqlstate="+Option(e.getSQLState).getOrElse("none")
    case e => e.getClass.getSimpleName
  },_ => "success")

  test("accepted 4096-byte manager ID preserves publication, lexical authorization, raw creators and startup ACL backfill") {
    assertEquals(Exact.utf8(wide).length,4096)
    println("WIDE_AUDIENCE_SYNTHETIC_ID bytes=4096 sha256="+SecretCodec.sha256(wide))
    val publication=BackendFixture.configuration.use { (base,_,normalToken) =>
      val normal=normalConfig(base)
      val identity=new Auth(normal.users).authenticate(normalToken).get
      for
        _ <- IO { normal.validate(); assertEquals(identity.userId,"other"); assertEquals(identity.userType,"human") }
        _ <- Main.resources(normal).use { s => for
          _ <- checkedRuntime(s,normal)
          ready <- publish(s,identity) // Existing NUL/Unicode audience is a valid positive control.
          _ <- visible(s,normal,identity,ready)
          _ <- s.artifacts.delete(identity,ready.id)
        yield () }
        pair <- withWide(normal)
        (config,wideIdentity)=pair
        _ <- IO { assert(new Auth(config.users).authenticate(normalToken).nonEmpty); println("WIDE_AUDIENCE_CURRENT_CONFIG accepted authenticated-normal-manager") }
        _ <- Main.resources(config).use { s => for
          _ <- checkedRuntime(s,config)
          normalReady <- publish(s,identity)
          _ <- visible(s,config,identity,normalReady)
          _ <- visible(s,config,wideIdentity,normalReady)
          wideReady <- publish(s,wideIdentity)
          _ <- IO { assert(wideReady.createdByUser==wide,"wide publisher ID was replaced"); assertEquals(SecretCodec.sha256(wideReady.createdByUser),SecretCodec.sha256(wide)) }
          _ <- visible(s,config,wideIdentity,wideReady)
          _ <- visible(s,config,identity,wideReady)
          hashedFilter <- hits(s,config,wideIdentity,SecretCodec.sha256(wide))
          _ <- IO(assertEquals(hashedFilter.hits,Nil)) // Creator filter remains exact original user ID.
          _ <- checkedRuntime(s,config)
        yield () }
      yield ()
    }.attempt
    // Independent scope ensures the RED publication does not hide startup/backfill evidence.
    val restart=BackendFixture.configuration.use { (base,_,normalToken) =>
      val normal=normalConfig(base)
      val identity=new Auth(normal.users).authenticate(normalToken).get
      for
        saved <- Main.resources(normal).use { s => for
          _ <- checkedRuntime(s,normal)
          ready <- publish(s,identity)
          before <- snapshot(s)
          // Owned historical fixture: legacy audience used Base64(raw UTF-8).
          // Only ACL rows change; never edit source/version/vector/snapshot bytes.
          _ <- s.database.transaction { c =>
            Jdbc.exec(c,"DELETE FROM pony_retrieval_audience WHERE namespace=? AND source_id=?",encoded("manure"),encoded(ready.id))
            normal.users.foreach(u => Jdbc.exec(c,"INSERT INTO pony_retrieval_audience VALUES(?,?,?)",encoded("manure"),encoded(ready.id),encoded(u.id)))
          }
        yield (ready,before) }
        pair <- withWide(normal)
        (config,wideIdentity)=pair
        _ <- Main.resources(config).use { s => for
          // First application action after acquisition is the newly added wide
          // manager's query. No publication/mutation may repair ACLs for it.
          _ <- visible(s,config,wideIdentity,saved._1)
          _ <- visible(s,config,identity,saved._1)
          after <- snapshot(s)
          _ <- IO(assert(after==saved._2,"startup ACL backfill changed source version/generation or pinned metadata bytes"))
          _ <- checkedRuntime(s,config)
          ready <- publish(s,identity)
          page <- hits(s,config,wideIdentity,identity.userId)
          _ <- IO(assertEquals(page.hits.map(_.artifact.artifactId).toSet,Set(saved._1.id,ready.id)))
        yield () }
      yield ()
    }.attempt
    (for
      p <- publication
      r <- restart
      _ <- IO {
        println("WIDE_AUDIENCE_EXPECTED_SUCCESS publication="+status(p)+" restartBackfill="+status(r))
        assertEquals(p.map(_ => ()),Right(()))
        assertEquals(r.map(_ => ()),Right(()))
      }
    yield ()).unsafeRunSync()
  }
