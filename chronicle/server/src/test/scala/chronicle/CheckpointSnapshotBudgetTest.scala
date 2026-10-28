package chronicle

import io.circe.Json
import java.sql.{Connection,Driver,DriverManager,DriverPropertyInfo,PreparedStatement}
import java.lang.reflect.{InvocationHandler,InvocationTargetException,Method,Proxy}
import java.util.Properties
import java.util.concurrent.atomic.AtomicInteger

// Regression-origin: count actual full-source JDBC parameters, not heap guesses or mock call expectations.
class CheckpointSnapshotBudgetTest extends munit.FunSuite {
  private def invoke(target: AnyRef,method: Method,args: Array[AnyRef]): AnyRef =
    try method.invoke(target,args*) catch { case error: InvocationTargetException => throw error.getCause }
  test("GoodCommunication: full snapshot validation traffic stays constant per claim instead of growing with checkpoint count") { CurrentIndexDatabase.withDatabase { (config,_,_) =>
    val fullSourceArguments=new AtomicInteger()
    val prefix="jdbc:measure-source:"
    val driver=new Driver {
      def acceptsURL(url: String): Boolean=url.startsWith(prefix)
      def connect(url: String,properties: Properties): Connection = {
        if(!acceptsURL(url)) null else {
          val delegate=DriverManager.getConnection(url.drop(prefix.length),properties)
          Proxy.newProxyInstance(classOf[Connection].getClassLoader,Array(classOf[Connection]),new InvocationHandler {
            def invoke(proxy: Any,method: Method,args: Array[AnyRef]): AnyRef = {
              val value=CheckpointSnapshotBudgetTest.this.invoke(delegate,method,args)
              if(method.getName=="prepareStatement" && args!=null && args.nonEmpty && args(0).isInstanceOf[String]) {
                val sql=args(0).asInstanceOf[String]
                val statement=value.asInstanceOf[PreparedStatement]
                Proxy.newProxyInstance(classOf[PreparedStatement].getClassLoader,Array(classOf[PreparedStatement]),new InvocationHandler {
                  def invoke(proxy: Any,method: Method,arguments: Array[AnyRef]): AnyRef = {
                    if(method.getName=="setString" && sql.contains("snapshot=?::jsonb")) fullSourceArguments.incrementAndGet()
                    CheckpointSnapshotBudgetTest.this.invoke(statement,method,arguments)
                  }
                })
              } else value
            }
          }).asInstanceOf[Connection]
        }
      }
      def getPropertyInfo(url: String,properties: Properties): Array[DriverPropertyInfo]=Array.empty
      def getMajorVersion(): Int=1
      def getMinorVersion(): Int=0
      def jdbcCompliant(): Boolean=false
      def getParentLogger(): java.util.logging.Logger=java.util.logging.Logger.getGlobal
    }
    DriverManager.registerDriver(driver)
    try {
      val measured=config.copy(jdbcUrl=prefix+config.jdbcUrl)
      val db=new Database(measured,IndexProfileCatalog.current(measured)); val archive=new PostgresArchive(db,measured)
      archive.ingest("a",Fixtures.snapshot())
      val claim=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
      def accepted(index: Int): Unit = {
        val key=IndexCheckpoints.key(claim,IndexingStage.Annotation,index,0,"synthetic-policy",Json.fromInt(index))
        assertEquals(archive.checkpoint(claim,key),None)
        archive.checkpoint(claim,key,Json.obj("accepted"->Json.fromInt(index)))
      }
      accepted(0); val afterOne=fullSourceArguments.get()
      (1 until 5).foreach(accepted)
      val afterFive=fullSourceArguments.get()
      println(s"FULL_SNAPSHOT_BINDINGS after1=$afterOne after5=$afterFive")
      assert(afterFive<=1,s"full-source JDBC bindings must be constant per claim: after1=$afterOne after5=$afterFive")
    } finally DriverManager.deregisterDriver(driver)
  }}
  test("GoodCommunication: complete snapshot projection is bound, not just its caller-supplied raw digest") { CurrentIndexDatabase.withDatabase { (_,_,archive) =>
    archive.ingest("a",Fixtures.snapshot()); val claim=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    val key=IndexCheckpoints.key(claim,IndexingStage.Annotation,0,0,"synthetic-policy",Json.fromInt(0))
    archive.checkpoint(claim,key,Json.fromString("accepted"))
    val variants=List(claim.snapshot.copy(metadata=claim.snapshot.metadata.copy(title="changed metadata")),claim.snapshot.copy(messages=claim.snapshot.messages.map(_.copy(text="changed normalized source"))),claim.snapshot.copy(files=claim.snapshot.files.map(_.copy(content="changed raw source"))))
    variants.foreach { snapshot =>
      assertEquals(snapshot.digest,claim.snapshot.digest)
      val forged=claim.copy(snapshot=snapshot)
      assertEquals(intercept[DomainError](archive.checkpoint(forged,key)).code,"stale-claim")
      assertEquals(intercept[DomainError](archive.checkpoint(forged,key,Json.fromString("replacement"))).code,"stale-claim")
    }
    assertEquals(archive.checkpoint(claim,key),Some(Json.fromString("accepted")))
  }}
  test("GoodCommunication: snapshot and logical revision identity updates are rejected by the database") { CurrentIndexDatabase.withDatabase { (_,db,archive) =>
    val receipt=archive.ingest("a",Fixtures.snapshot())
    List("snapshot=jsonb_set(snapshot,'{metadata,title}',to_jsonb('changed metadata'::text))","binding_id=gen_random_uuid()").foreach { replacement =>
      val error=intercept[java.sql.SQLException](db.transaction(c => Sql.exec(c,s"UPDATE ch_revisions SET $replacement WHERE session_id=? AND revision=1",receipt.sessionId)))
      assertEquals(error.getSQLState,"23514")
    }
  }}
  test("GoodCommunication: logical INSERT SELECT roundtrip changes physical xmin but preserves source binding and accepted work") { CurrentIndexDatabase.withDatabase { (_,db,archive) =>
    archive.ingest("a",Fixtures.snapshot()); val claim=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    val key=IndexCheckpoints.key(claim,IndexingStage.Annotation,0,0,"synthetic-policy",Json.fromInt(0)); val value=Json.fromString("accepted")
    archive.checkpoint(claim,key,value)
    val (snapshot,id)=db.transaction { c =>
      Sql.exec(c,"CREATE TEMP TABLE restored_revision ON COMMIT DROP AS SELECT snapshot,binding_id,xmin::text AS original_xmin FROM ch_revisions WHERE session_id=? AND revision=?",claim.sessionId,claim.revision)
      Sql.one(c,"SELECT snapshot,binding_id,original_xmin,xmin::text AS restored_xmin FROM pg_temp.restored_revision") { row =>
        assertNotEquals(row.getString("original_xmin"),row.getString("restored_xmin"))
        (Wire.decode(chronicle.api.IngestRequest.codecJson,Sql.json(row,"snapshot")),row.getObject("binding_id",classOf[java.util.UUID]))
      }.get
    }
    assertEquals(snapshot,claim.snapshot); assertEquals(id,claim.revisionBinding.id)
    val restored=claim.copy(snapshot=snapshot,revisionBinding=RevisionBinding.captured(id,claim.sessionId,claim.revision,snapshot))
    val restoredKey=IndexCheckpoints.key(restored,IndexingStage.Annotation,0,0,"synthetic-policy",Json.fromInt(0))
    assertEquals(restoredKey,key); assertEquals(archive.checkpoint(restored,restoredKey),Some(value))
  }}
  test("GoodCommunication: missing immutable row is stale but a different present logical revision is internal corruption") { CurrentIndexDatabase.withDatabase { (_,db,archive) =>
    archive.ingest("a",Fixtures.snapshot()); val claim=archive.claim(archive.knownProfiles,ClaimScope.Owner("a"),300).get
    val key=IndexCheckpoints.key(claim,IndexingStage.Annotation,0,0,"synthetic-policy",Json.fromInt(0))
    db.transaction(c => Sql.exec(c,"DELETE FROM ch_revisions WHERE session_id=? AND revision=?",claim.sessionId,claim.revision))
    assertEquals(intercept[DomainError](archive.checkpoint(claim,key)).code,"stale-claim")
    db.transaction(c => Sql.exec(c,"INSERT INTO ch_revisions(session_id,revision,snapshot) VALUES(?,?,?::jsonb)",claim.sessionId,claim.revision,Wire.encode(chronicle.api.IngestRequest.codecJson,claim.snapshot).noSpaces))
    assertEquals(intercept[DomainError](archive.checkpoint(claim,key)).code,"internal")
    assertEquals(intercept[DomainError](archive.checkpoint(claim,key,Json.fromString("accepted"))).code,"internal")
  }}
}
