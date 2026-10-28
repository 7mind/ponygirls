package chronicle

import io.circe.Json

final class IndexProfilesTest extends munit.FunSuite {
  test("Blackbox Atomic: exactly one current policy is executable and annotation identity changes never create fallback executors") {
    val config=Fixtures.config(); val current=IndexProfileCatalog.current(config)
    val changed=IndexProfileCatalog.current(config.copy(annotation=config.annotation.copy(revision="synthetic-v2")))
    assertEquals(current.knownProfiles,Set(config.profile)); assertEquals(current.profiles.map(_.policy),List(IndexPolicy.ContextAwareProblemsV1))
    assertNotEquals(current.preferred.profile,changed.preferred.profile)
    assertEquals(current.preferred.embedding,changed.preferred.embedding)
    assertEquals(intercept[DomainError](changed.resolve(current.preferred.profile)).code,"unavailable")
    assertEquals(intercept[DomainError](current.resolve("historical-opaque-profile")).code,"unavailable")
  }
  test("Blackbox Atomic: embedding equality binds all identity fields, not only dimensions or credentials") {
    val c=Fixtures.config(); val embedding=c.embedding
    val space=EmbeddingSpaceDescriptor.from(embedding)
    val changes=List(
      embedding.copy(endpoint=embedding.endpoint+"/different"),embedding.copy(model="different"),embedding.copy(revision="different"),
      embedding.copy(dimensions=embedding.dimensions+1),embedding.copy(sendDimensions= !embedding.sendDimensions),
      embedding.copy(queryPrefix="different"),embedding.copy(documentPrefix="different")
    )
    changes.foreach(change => assertNotEquals(EmbeddingSpaceDescriptor.from(change).id,space.id))
    assertNotEquals(space.copy(normalization="different").id,space.id)
    assertEquals(EmbeddingSpaceDescriptor.from(embedding.copy(credentialFile="/synthetic/secret-not-metadata",timeoutSeconds=2,maxResponseBytes=999)).id,space.id)
    val annotated=IndexProfileCatalog.passages(c.copy(annotation=c.annotation.copy(revision="different")),PassagePolicyIdentity("synthetic-kernel-v1"))
    assertEquals(annotated.preferred.embedding,space)
    assert(!annotated.preferred.descriptor.noSpaces.contains(c.annotation.credentialFile))
    assert(!space.json.noSpaces.contains(embedding.endpoint))
    assert(!space.json.noSpaces.contains(embedding.credentialFile))
  }
  test("Blackbox Atomic: missing or dimension-only embedding descriptors are unverified") {
    val c=Fixtures.config(); val verified=EmbeddingSpaceDescriptor.from(c.embedding)
    IndexProfiles.verifiedSpace(verified.id,verified.json)
    List(Json.obj("dimensions"->Json.fromInt(c.embedding.dimensions)),Json.arr(Json.fromInt(c.embedding.dimensions)),Json.Null).foreach { descriptor =>
      assertEquals(intercept[DomainError](IndexProfiles.verifiedSpace(Wire.hash(descriptor.noSpaces),descriptor)).code,"unavailable")
    }
    assertEquals(intercept[DomainError](IndexProfiles.verifiedSpace("0"*64,verified.json)).code,"unavailable")
  }
  test("Effectual GoodCommunication: migration seeds retained opaque targets once without fabricating embedding compatibility") {
    OwnerProfilePostgres.withDatabase { (c,admin,a,catalog) =>
      val schema="owner_profile_migration_"+java.util.UUID.randomUUID().toString.replace("-","")
      admin.transaction(x => Sql.exec(x,s"CREATE SCHEMA $schema"))
      try {
        val separator=if(c.jdbcUrl.contains("?")) "&" else "?"
        val isolated=c.copy(jdbcUrl=c.jdbcUrl+separator+"currentSchema="+schema+",public")
        val db=new Database(isolated,catalog)
        db.transaction { x =>
          Sql.exec(x,"CREATE TABLE ch_users(id text PRIMARY KEY,login text UNIQUE NOT NULL,enabled boolean NOT NULL,credential text NOT NULL)")
          Sql.exec(x,"CREATE TABLE ch_profile(singleton boolean PRIMARY KEY CHECK(singleton),active text NOT NULL,target text NOT NULL,maintenance boolean NOT NULL)")
          Sql.exec(x,"INSERT INTO ch_users VALUES('a','a',true,'synthetic')")
          Sql.exec(x,"INSERT INTO ch_profile VALUES(true,'opaque-retained','opaque-retained',false)")
        }
        db.initialize()
        def targets: List[(String,String)] = db.transaction(x => Sql.rows(x,"SELECT owner,profile FROM ch_owner_targets ORDER BY owner")(r => (r.getString(1),r.getString(2))))
        assertEquals(targets,List("a"->"opaque-retained","b"->catalog.preferred.profile,"c"->catalog.preferred.profile))
        db.initialize(); assertEquals(targets.head,"a"->"opaque-retained")
        assertEquals(db.transaction(x => Sql.one(x,"SELECT count(*) FROM ch_index_profiles WHERE profile='opaque-retained'")(_.getLong(1)).get),0L)
        assertEquals(new PostgresOwnerReindex(db).preview("a").targetProfile,catalog.preferred.profile)
        assertEquals(intercept[DomainError](new PostgresArchive(db,isolated).ingest("a",Fixtures.snapshot())).code,"unavailable")
      } finally admin.transaction(x => Sql.exec(x,s"DROP SCHEMA $schema CASCADE"))
    }
  }
  test("Effectual GoodCommunication: immutable registration rejects relabeling and keeps metadata credential-free") {
    OwnerProfilePostgres.withDatabase { (c,db,a,catalog) =>
      val before=db.transaction(x => Sql.one(x,"SELECT descriptor::text FROM ch_index_profiles WHERE profile=?",c.profile)(_.getString(1)).get)
      assertEquals(intercept[DomainError](db.transaction(x => IndexProfiles.register(x,catalog.resolve(c.profile).copy(descriptor=Json.obj("fabricated"->Json.True))))).code,"config")
      assertEquals(db.transaction(x => Sql.one(x,"SELECT descriptor::text FROM ch_index_profiles WHERE profile=?",c.profile)(_.getString(1)).get),before)
      val values=db.transaction(x => Sql.rows(x,"SELECT descriptor::text FROM ch_embedding_spaces UNION ALL SELECT descriptor::text FROM ch_index_profiles")(_.getString(1)))
      assert(values.forall(value => !value.contains(c.annotation.credentialFile) && !value.contains(c.embedding.credentialFile) && !value.contains(c.annotation.endpoint) && !value.contains(c.embedding.endpoint)))
    }
  }
}
