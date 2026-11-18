package haystack.storage

import cats.effect.IO
import cats.syntax.all.*
import haystack.domain.*
import haystack.auth.{Auth,AuthFixtures}
import io.circe.Json
import java.nio.charset.StandardCharsets.UTF_8

/** Regression from executing the baseline production auth loader and frozen
  * ItemService: ECMAScript whitespace is not Java isWhitespace; regex lengths
  * were UTF16 code units, not JVM regex code points. No live credentials/data.
  */
class HistoricalIdentityTest extends ContractSuite {
  import AuthFixtures.*
  private val stream=getClass.getResourceAsStream("/haystack/historical-auth/manifest.json")
  private val manifest=try io.circe.parser.parse(new String(stream.readAllBytes(),UTF_8)).toOption.get finally stream.close()
  private val fixtures=manifest.hcursor.get[Vector[Json]]("fixtures").toOption.get
  fixtures.foreach { fixture=>
    val c=fixture.hcursor;val name=c.get[String]("name").toOption.get
    test("actual old static identity admission is preserved: "+name) { directory { dir=>
      val user=c.get[String]("userId").toOption.get;val token=c.get[String]("tokenId").toOption.get
      val cfg=config(dir);val previous=cfg.users.head.copy(id=user,tokens=Vector(cfg.users.head.tokens.head.copy(id=token)))
      if(c.get[Boolean]("accepted").toOption.get){
        assertEquals(Auth.load(cfg.copy(users=Vector(previous))).authenticate(AliceToken),Some(Principal(user,"human",token)))
      }else assertEquals(intercept[Fault](Auth.load(cfg.copy(users=Vector(previous)))).code,"config")
    }}
    if(c.get[Boolean]("accepted").toOption.get)test("acknowledged PG author/token/history identities remain exact: "+name) { directory { dir=>
      val user=c.get[String]("userId").toOption.get;val token=c.get[String]("tokenId").toOption.get
      val cfg=config(dir);val auth=Auth.load(cfg.copy(users=Vector(cfg.users.head.copy(id=user,tokens=Vector(cfg.users.head.tokens.head.copy(id=token))))))
      val principal=auth.authenticate(AliceToken).get
      val key=QualifiedId.decodeKey(c.get[String]("key").toOption.get);val doc=c.get[String]("documentCanonical").toOption.get
      run(TestSupport.emptyDatabase.use { db=>for{
        _<-Migrations.initialize(db,TestSupport.Activity)
        _<-db.transaction { connection=>
          Sql.update(connection,"INSERT INTO items(project_id,item_id,revision,document,document_text,created_at,created_by,modified_at,modified_by) VALUES(?,?,1,?::jsonb,?,?,?,?,?)",key.project,key.item,doc,doc,TestSupport.Now,user,TestSupport.Now,user)
          Sql.update(connection,"INSERT INTO item_revisions(project_id,item_id,revision,document,document_text,modified_at,modified_by,token_id) VALUES(?,?,1,?::jsonb,?,?,?,?)",key.project,key.item,doc,doc,TestSupport.Now,user,token)
          ()
        }
        repo=new PostgresItemRepository(db)
        first<-repo.current(key);_=assertEquals(first.map(_.documentCanonical),Some(doc));_=assertEquals(first.map(_.metadata.createdBy),Some(user))
        history<-repo.history(key);_=assertEquals(history.map(_.tokenId),Vector(token));_=assertEquals(history.map(_.modifiedBy),Vector(user))
        updated<-repo.commit(TestSupport.op(key.qualified,1,doc),principal,TestSupport.Later);_=assertEquals(updated.metadata.createdBy,user)
        retained<-repo.revision(key,1);_=assertEquals(retained.map(_.documentCanonical),Some(doc));_=assertEquals(retained.map(_.metadata.createdBy),Some(user))
        latest<-repo.history(key);_=assertEquals(latest.map(_.tokenId),Vector(token,token));_=assertEquals(latest.map(_.modifiedBy),Vector(user,user))
      }yield()})
    }}
  }
}
