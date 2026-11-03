package manure

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.{Json,parser}
import java.util.Base64
import munit.FunSuite
import manure.{api => wire}

/** Specified-origin dual behavioral contract. Memory is a handwritten dummy;
  * PostgreSQL uses the real least-privilege runtime role and exact bytea SQL.
  */
abstract class CatalogueContract(postgres: Boolean) extends FunSuite:
  private def run(body: BackendFixture => IO[Unit]): Unit = BackendFixture.resource(postgres).use(body).unsafeRunSync()
  private def query(sort: wire.CatalogueSort = wire.CatalogueSort.Name,direction: wire.SortDirection = wire.SortDirection.Asc): wire.CatalogueQuery =
    wire.CatalogueQuery("",true,None,None,sort,direction,3,None)
  private def catalogue(f: BackendFixture) = new Catalogue(f.artifacts,f.config.limits,f.clock)
  private def fixture(f: BackendFixture): Vector[Artifact] =
    val names = Vector("same","same","\ue000","𐀀","İ\u0000X","i\u0307\u0000x","Straße","STRASSE","Σ","σ","a%_'\\\u0000","🦄")
    names.zipWithIndex.map { (name,i) =>
      val expiry = if i%3 == 0 then None else Some(f.clock.now + (if i%3 == 1 then 60 else -60))
      Artifact(f"${i+1}%032x",name,if i%2 == 0 then ArtifactKind.Directory else ArtifactKind.File,
        Vector(Visibility.Public,Visibility.Internal,Visibility.External)(i%3),
        Vector("owner\u0000馬","\ue000","𐀀")(i%3),"token",Exact.displayTime(f.clock.now),
        f.clock.now+(i%3),expiry.map(Exact.displayTime),expiry,
        Vector(UploadState.Uploading,UploadState.Publishing,UploadState.Ready)(i%3),
        (i%3).toLong,(i%2).toLong,(i%3).toLong,None,f.clock.now,"[]")
    }
  private def seed(f: BackendFixture): IO[Vector[Artifact]] =
    val values = fixture(f)
    f.metadata.transaction(tx => values.foreach(tx.put)).as(values)
  // Deliberately independent expected ordering: no CataloguePolicy comparator.
  private def expected(values: Vector[Artifact],q: wire.CatalogueQuery): Vector[Artifact] =
    def text(a: Artifact): String = q.sort match
      case wire.CatalogueSort.Name => a.name
      case wire.CatalogueSort.Visibility => a.visibility.wire
      case wire.CatalogueSort.State => a.state.wire
      case wire.CatalogueSort.Kind => a.kind.wire
      case wire.CatalogueSort.CreatedByUser => a.createdByUser
      case _ => ""
    values.sortWith { (a,b) =>
      val primary = q.sort match
        case wire.CatalogueSort.CreatedAt => java.lang.Double.compare(a.createdAtSeconds,b.createdAtSeconds)
        case wire.CatalogueSort.ExpiresAt => (a.expiresAtSeconds,b.expiresAtSeconds) match
          case (Some(x),Some(y)) => java.lang.Double.compare(x,y)
          case _ => 0
        case wire.CatalogueSort.TotalBytes => java.lang.Long.compare(a.totalBytes,b.totalBytes)
        case wire.CatalogueSort.FileCount => java.lang.Long.compare(a.fileCount,b.fileCount)
        case _ => java.util.Arrays.compareUnsigned(Exact.utf8(text(a)),Exact.utf8(text(b)))
      if q.sort == wire.CatalogueSort.ExpiresAt && a.expiresAtSeconds.isEmpty != b.expiresAtSeconds.isEmpty then a.expiresAtSeconds.nonEmpty
      else
        val comparison = if primary == 0 then java.util.Arrays.compareUnsigned(Exact.utf8(a.id),Exact.utf8(b.id)) else primary
        if q.direction == wire.SortDirection.Asc then comparison < 0 else comparison > 0
    }
  private def walk(f: BackendFixture,q: wire.CatalogueQuery,after: Option[String] = None,seen: Vector[Artifact] = Vector.empty): IO[Vector[Artifact]] =
    catalogue(f).list(f.other,q.copy(cursor=after)).flatMap { (page,next) =>
      IO { assert(page.size <= q.limit); assert(seen.size < 100); assert(!page.exists(a => seen.exists(_.id == a.id))) } *>
        next.fold(IO.pure(seen++page))(token => walk(f,q,Some(token),seen++page))
    }
  for sort <- wire.CatalogueSort.all; direction <- wire.SortDirection.all do
    test(s"all metadata shared; $sort/$direction byte order, ties, NULL-last keyset traversal") { run { f => for
      values <- seed(f)
      actual <- walk(f,query(sort,direction))
      _ <- IO(assertEquals(actual,expected(values,query(sort,direction))))
    yield () }}
  test("normative full Unicode casefold matches independently expected historical values") { run { f =>
    val names=Vector("Straße","STRASSE","straße","Σ","σ","ς","ΟΣ","οσ","ος","ﬃ","FFI","İ\u0000X","i\u0307\u0000x","𐐀\u0000","𐐨\u0000","a%_'\\\u0000")
    val values=names.zipWithIndex.map { (name,i) => fixture(f).head.copy(id=f"${i+1}%032x",name=name,state=UploadState.Uploading) }
    val strasse=Set("Straße","STRASSE","straße")
    val sigma=Set("Σ","σ","ς","ΟΣ","οσ","ος")
    val words=Set("ΟΣ","οσ","ος")
    val checks=Vector(
      "strasse" -> strasse, "straße" -> strasse, "STRASSE" -> strasse,
      "Σ" -> sigma, "σ" -> sigma, "ς" -> sigma, "οσ" -> words, "ος" -> words,
      "FFI" -> Set("ﬃ","FFI"), "ﬃ" -> Set("ﬃ","FFI"),
      "İ\u0000X" -> Set("İ\u0000X","i\u0307\u0000x"),
      "𐐨\u0000" -> Set("𐐀\u0000","𐐨\u0000"), "𐐀\u0000" -> Set("𐐀\u0000","𐐨\u0000"),
      "%_'\\\u0000" -> Set("a%_'\\\u0000"))
    for
      _ <- f.metadata.transaction(tx => values.foreach(tx.put))
      _ <- checks.traverse_ { (text,names) =>
        val q=query().copy(query=text)
        walk(f,q).map(actual => assertEquals(actual,expected(values.filter(a => names(a.name)),q)))
      }
    yield ()
  }}
  test("expiry authorization and state/visibility filtering happen before keyset LIMIT") { run { f => for
    values <- seed(f)
    combinations = for
      visibility <- List[Option[wire.Visibility]](None) ++ wire.Visibility.all.map(Some(_))
      state <- List[Option[wire.ArtifactState]](None) ++ wire.ArtifactState.all.map(Some(_))
    yield (visibility,state)
    _ <- combinations.traverse_ { (visibility,state) =>
          val q=query(wire.CatalogueSort.ExpiresAt,wire.SortDirection.Desc).copy(includeExpired=false,visibility=visibility,state=state,limit=1)
          walk(f,q).map { actual =>
            val selected=values.filter(a => !a.expired(f.clock.now) && visibility.forall(_.toString.toLowerCase(java.util.Locale.ROOT)==a.visibility.wire) && state.forall(_.toString.toLowerCase(java.util.Locale.ROOT)==a.state.wire))
            assertEquals(actual,expected(selected,q))
          }
        }
  yield () }}
  test("cursor binds every effective option and enforces typed count/time/text/null positions") { run { f => for
    _ <- seed(f)
    q=query()
    first <- catalogue(f).list(f.identity,q)
    cursor=first._2.get
    _ <- Vector("",cursor+"=",cursor.reverse,"x"*8193,"_w").traverse_ { invalid =>
      catalogue(f).list(f.other,q.copy(cursor=Some(invalid))).attempt.map { result =>
        assertEquals(result.left.toOption.collect { case e: DomainError => e.code },Some("bad-envelope"))
      }
    }
    _ <- Vector(q.copy(query="x"),q.copy(includeExpired=false),q.copy(visibility=Some(wire.Visibility.Public)),
      q.copy(state=Some(wire.ArtifactState.Ready)),q.copy(sort=wire.CatalogueSort.State),
      q.copy(direction=wire.SortDirection.Desc),q.copy(limit=2)).traverse_ { changed =>
      catalogue(f).list(f.other,changed.copy(cursor=Some(cursor))).attempt.map { result =>
        assertEquals(result.left.toOption.collect { case e: DomainError => e.code },Some("bad-envelope"))
      }
    }
    _ <- wire.CatalogueSort.all.traverse_ { sort =>
      val current=query(sort)
      catalogue(f).list(f.identity,current).flatMap { (_,token) =>
        val obj=parser.parse(Exact.string(Base64.getUrlDecoder.decode(token.get))).toOption.get
        val invalid = sort match
          case wire.CatalogueSort.TotalBytes | wire.CatalogueSort.FileCount => Vector(Json.fromDoubleOrNull(0.5),Json.fromBigInt(BigInt(Long.MaxValue)+1),Json.fromString("1"),Json.Null)
          case wire.CatalogueSort.CreatedAt => Vector(Json.fromString("1"),Json.Null,parser.parse("1e10000").toOption.get)
          case wire.CatalogueSort.ExpiresAt => Vector(Json.fromString("1"),parser.parse("1e10000").toOption.get)
          case _ => Vector(Json.fromInt(1),Json.Null,Json.True)
        invalid.traverse_ { bad =>
          val json=obj.mapObject(_.add("value",bad))
          val forged=Base64.getUrlEncoder.withoutPadding().encodeToString(Exact.utf8(json.noSpaces))
          catalogue(f).list(f.identity,current.copy(cursor=Some(forged))).attempt.map { result =>
            assertEquals(result.left.toOption.collect { case e: DomainError => e.code },Some("bad-envelope"))
          }
        }
      }
    }
  yield () }}
  test("deleting a cursor boundary does not require a boundary-row lookup") { run { f => for
    values <- seed(f)
    q=query()
    first <- catalogue(f).list(f.identity,q)
    removed=first._1.last
    _ <- f.metadata.transaction(_.delete(removed.id))
    rest <- walk(f,q,first._2)
    _ <- IO(assertEquals(rest,expected(values,q).drop(q.limit)))
  yield () }}
  test("put/rename atomically refreshes bytea name matching without changing source bytes") { run { f => for
    values <- seed(f)
    changed=values.head.copy(name="NEw\u0000İ𐀀")
    _ <- f.metadata.transaction(_.put(changed))
    found <- walk(f,query().copy(query="new\u0000i\u0307𐀀"))
    _ <- IO(assertEquals(found,Vector(changed)))
    rollback <- f.metadata.transaction { tx => tx.put(changed.copy(name="rolled-back")); throw DomainError("unavailable") }.attempt
    _ <- IO(assert(rollback.isLeft))
    afterRollback <- walk(f,query().copy(query="new\u0000i\u0307𐀀"))
    _ <- IO(assertEquals(afterRollback,Vector(changed)))
    _ <- f.database.traverse_(_.transaction { c =>
      val stored=Jdbc.rows(c,"SELECT name,name_match,created_at_s FROM manure.artifacts WHERE id=?",Exact.utf8(changed.id)) { r =>
        (r.getBytes(1).toVector,r.getBytes(2).toVector,r.getBytes(3).toVector)
      }.head
      assertEquals(stored,(Exact.utf8(changed.name).toVector,Exact.utf8(Exact.matching(changed.name)).toVector,Exact.timestamp(changed.createdAtSeconds).toVector))
    })
  yield () }}

  test("integer keysets preserve adjacent counts beyond IEEE754 precision") { run { f =>
    val counts=Vector(9007199254740993L,9007199254740992L,Long.MaxValue)
    val values=fixture(f).take(3).zip(counts).map((a,n) => a.copy(totalBytes=n,fileCount=n,state=UploadState.Uploading))
    for
      _ <- f.metadata.transaction(tx => values.foreach(tx.put))
      _ <- Vector(wire.CatalogueSort.TotalBytes,wire.CatalogueSort.FileCount).traverse_ { sort =>
        wire.SortDirection.all.traverse_ { direction =>
          val q=query(sort,direction).copy(limit=1)
          walk(f,q).map(actual => assertEquals(actual,expected(values,q)))
        }
      }
    yield ()
  }}
  test("timestamp keysets retain adjacent source binary64 values and NULL expiry tails") { run { f =>
    val t=f.clock.now
    val times=Vector(Math.nextUp(t),t,Math.nextUp(Math.nextUp(t)),t)
    val values=fixture(f).take(4).zip(times).zipWithIndex.map { case ((a,time),i) =>
      a.copy(createdAtSeconds=time,expiresAtSeconds=if i==3 then None else Some(time),state=UploadState.Uploading)
    }
    for
      _ <- f.metadata.transaction(tx => values.foreach(tx.put))
      _ <- Vector(wire.CatalogueSort.CreatedAt,wire.CatalogueSort.ExpiresAt).traverse_ { sort =>
        wire.SortDirection.all.traverse_ { direction =>
          val q=query(sort,direction).copy(limit=1)
          walk(f,q).map(actual => assertEquals(actual,expected(values,q)))
        }
      }
    yield ()
  }}
  test("catalogue forwarding revalidates authenticated management identity") { run { f => for
    _ <- seed(f)
    rejected <- catalogue(f).list(f.identity.copy(tokenDigest="0"*64),query()).attempt
    _ <- IO(assertEquals(rejected.left.toOption.collect { case e: DomainError => e.code },Some("unauthorized")))
    accepted <- walk(f,query())
    _ <- IO(assertEquals(accepted.size,12))
  yield () }}

  test("accepted wide owner strings do not acquire a PostgreSQL btree-width admission limit") { run { f =>
    val owner=Vector.tabulate(64)(i => SecretCodec.sha256("wide-owner-"+i)).mkString
    val values=fixture(f).take(3).zipWithIndex.map((a,i) => a.copy(createdByUser=owner+i.toString,state=UploadState.Uploading))
    val q=query(wire.CatalogueSort.CreatedByUser).copy(limit=1)
    for
      _ <- f.metadata.transaction(tx => values.foreach(tx.put))
      result <- walk(f,q)
      _ <- IO(assertEquals(result,expected(values,q)))
    yield ()
  }}

final class MemoryCatalogueSuite extends CatalogueContract(false)
final class PostgresCatalogueSuite extends CatalogueContract(true)
