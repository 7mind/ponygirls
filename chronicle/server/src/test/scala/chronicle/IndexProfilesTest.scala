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
      embedding.copy(model="different"),embedding.copy(revision="different"),
      embedding.copy(dimensions=embedding.dimensions+1),embedding.copy(sendDimensions= !embedding.sendDimensions),
      embedding.copy(queryPrefix="different"),embedding.copy(documentPrefix="different")
    )
    changes.foreach(change => assertNotEquals(EmbeddingSpaceDescriptor.from(change).id,space.id))
    assertNotEquals(space.copy(normalization="different").id,space.id)
    assertEquals(EmbeddingSpaceDescriptor.from(embedding.copy(endpoint="http://relocated.invalid/v1/embeddings",credentialFile="/synthetic/secret-not-metadata",timeoutSeconds=2,maxResponseBytes=999)).id,space.id)
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
  test("Effectual GoodCommunication: start-up refuses retired model identity rows instead of discarding them and drops the emptied tables again after a rollback") {
    OwnerProfilePostgres.withDatabase { (c,admin,a,catalog) =>
      val schema="model_identity_retired_"+java.util.UUID.randomUUID().toString.replace("-","")
      admin.transaction(x => Sql.exec(x,s"CREATE SCHEMA $schema"))
      try {
        val separator=if(c.jdbcUrl.contains("?")) "&" else "?"
        val db=Fixtures.database(c.copy(jdbcUrl=c.jdbcUrl+separator+"currentSchema="+schema+",public"),catalog)
        try {
          val retired=List("ch_retained_profile_reads","ch_checkpoint_namespaces","ch_model_identity_migrations","ch_profile")
          def present: List[String] = db.transaction(x => retired.filter(table => Sql.one(x,"SELECT to_regclass(?) IS NOT NULL",table)(_.getBoolean(1)).contains(true)))
          // A previous release started on this database (deployment rollback) re-creates the four tables and seeds the singleton; their shape is irrelevant here.
          def rollback(): Unit = db.transaction { x => retired.foreach(table => Sql.exec(x,s"CREATE TABLE $table()")); Sql.exec(x,"INSERT INTO ch_profile DEFAULT VALUES") }
          def refused(): String = { val error=intercept[DomainError](db.initialize()); assertEquals(error.code,"migration-required"); error.detail }
          db.initialize(); assertEquals(present,Nil)
          rollback(); db.initialize(); assertEquals(present,Nil)
          assertEquals(db.transaction(x => Sql.one(x,"SELECT count(*) FROM ch_schema_migrations WHERE version=21")(_.getInt(1))),Some(1))
          retired.init.foreach { table =>
            rollback(); db.transaction(x => Sql.exec(x,s"INSERT INTO $table DEFAULT VALUES"))
            val refusal=refused(); assert(refusal.contains(s"model identity v1 rows remain in $table"),refusal)
            assertEquals(present,retired,"a refused start changes nothing")
            db.transaction(x => Sql.exec(x,s"DELETE FROM $table"))
            db.initialize(); assertEquals(present,Nil)
          }
          // An archive from before owner targets: the singleton would have seeded them; this release refuses to guess.
          rollback(); db.transaction(x => Sql.exec(x,"DELETE FROM ch_owner_targets WHERE owner='a'"))
          val refusal=refused(); assert(refusal.contains("users without an owner target"),refusal)
          db.transaction(x => Sql.exec(x,"INSERT INTO ch_owner_targets(owner,profile) VALUES('a',?)",catalog.preferred.profile))
          db.initialize(); assertEquals(present,Nil)
        } finally db.close()
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
