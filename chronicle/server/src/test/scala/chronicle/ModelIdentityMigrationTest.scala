package chronicle

import io.circe.Json
import java.util.UUID
import chronicle.api.*

final class ModelIdentityMigrationTest extends munit.FunSuite {
  private def withDatabase(run: (Config,Database,PostgresArchive,IndexProfileCatalog)=>Unit): Unit = {
    Check(sys.env.contains("CHRONICLE_TEST_JDBC"),"test","owned PostgreSQL fixture required")
    val original=Fixtures.config(); val originalCatalog=IndexProfileCatalog.current(original)
    val admin=Fixtures.database(original,originalCatalog); admin.initialize()
    val schema="model_identity_"+UUID.randomUUID().toString.replace("-","")
    admin.transaction(c=>Sql.exec(c,s"CREATE SCHEMA $schema"))
    val separator=if(original.jdbcUrl.contains("?")) "&" else "?"
    val config=original.copy(jdbcUrl=original.jdbcUrl+separator+"currentSchema="+schema+",public")
    val catalog=IndexProfileCatalog.current(config); val database=Fixtures.database(config,catalog)
    try { database.initialize(); run(config,database,new PostgresArchive(database,config),catalog) }
    finally { database.close(); admin.transaction(c=>Sql.exec(c,s"DROP SCHEMA $schema CASCADE")); admin.close() }
  }
  private def legacy(config: Config,catalog: IndexProfileCatalog): (String,Json,String,Json) = {
    val space=Json.arr((Vector(Json.fromString("embedding-space-v1"),Json.fromString(Wire.hash(config.embedding.endpoint)))++catalog.preferred.embedding.json.asArray.get.tail)*)
    val spaceId=Wire.hash(space.noSpaces)
    val current=catalog.preferred.descriptor.asArray.get
    val descriptor=Json.arr(Json.fromString("index-profile-descriptor-v1"),Json.arr((Vector(Json.fromString(Wire.hash(config.annotation.endpoint)))++current(1).asArray.get)*),current(2))
    val profile=Wire.hash(Json.arr(Json.fromString("context-aware-problems-profile-v1"),Json.fromString(spaceId),descriptor).noSpaces)
    (spaceId,space,profile,descriptor)
  }
  private def retainedFixture(config: Config,db: Database,archive: PostgresArchive,catalog: IndexProfileCatalog,policy: ReadableIndexPolicy): RetainedReadApproval = {
    archive.ingest("a",Fixtures.snapshot())
    val claim=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    val chunks=Fragments.split(claim.snapshot.messages).map(value=>IndexedChunk(value.copy(sessionId=claim.sessionId,summary="retained synthetic problem"),List(1.0,0.0,0.0)))
    assert(archive.publish(claim,chunks))
    val (spaceId,space,_,_)=legacy(config,catalog)
    val profile=Wire.hash("synthetic-retained-"+policy.toString)
    val descriptor=Json.obj("syntheticHistoricalPolicy"->Json.fromString(policy.toString))
    db.transaction { c=>
      Sql.exec(c,"INSERT INTO ch_embedding_spaces VALUES(?,?::jsonb)",spaceId,space.noSpaces)
      Sql.exec(c,"INSERT INTO ch_index_profiles VALUES(?,?,?,?::jsonb)",profile,spaceId,policy.toString,descriptor.noSpaces)
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=? WHERE owner='a'",profile)
      List("ch_jobs","ch_generations","ch_search_chunks").foreach(table=>Sql.exec(c,s"UPDATE $table SET profile=?",profile))
    }
    RetainedReadApproval(profile,spaceId,policy,Wire.hash(descriptor.noSpacesSortKeys))
  }
  private def retainedContent(db: Database): List[String] = db.transaction { c=>
    List("ch_profile","ch_owner_targets","ch_jobs","ch_generations","ch_chunks","ch_search_chunks","ch_index_checkpoints","ch_checkpoint_namespaces","ch_model_identity_migrations","ch_reindex_requests").flatMap(table=>Sql.rows(c,s"SELECT to_jsonb(t)::text FROM $table t ORDER BY to_jsonb(t)::text")(_.getString(1)))
  }
  test("BG: verified model migration preserves runs, epochs and accepted checkpoint namespaces without provider calls") { withDatabase { (config,db,archive,catalog)=>
    val receipt=archive.ingest("a",Fixtures.snapshot())
    val current=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    val (spaceId,space,profile,descriptor)=legacy(config,catalog)
    val old=current.copy(profile=profile)
    val input=Json.obj("synthetic-input"->Json.fromString("accepted-before-relocation"))
    val annotation=IndexCheckpoints.key(old,IndexingStage.Annotation,0,0,ProblemPassages.identity,input)
    val embedding=IndexCheckpoints.key(old,IndexingStage.Embedding,0,0,spaceId,input)
    val accepted=Json.arr(Json.arr(Json.fromInt(1),Json.fromInt(0),Json.fromInt(0)))
    archive.checkpoint(current,annotation,input); archive.checkpoint(current,embedding,accepted)
    db.transaction { c=>
      Sql.exec(c,"INSERT INTO ch_embedding_spaces VALUES(?,?::jsonb)",spaceId,space.noSpaces)
      Sql.exec(c,"INSERT INTO ch_index_profiles VALUES(?,?,'ContextAwareProblemsV1',?::jsonb)",profile,spaceId,descriptor.noSpaces)
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=? WHERE owner='a'",profile)
      Sql.exec(c,"UPDATE ch_jobs SET profile=? WHERE id=?",profile,receipt.jobId)
    }
    db.initialize()
    assertEquals(db.transaction(c=>Sql.one(c,"SELECT profile FROM ch_jobs WHERE id=?",receipt.jobId)(_.getString(1)).get),profile)
    val plan=ModelIdentityPlan(Set(profile),Vector.empty,catalog.preferred.profile)
    assertEquals(intercept[DomainError](db.transaction(c=>ModelIdentityMigration(c,catalog,plan))).code,"conflict")
    db.transaction { c=>
      Sql.exec(c,"UPDATE ch_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",receipt.jobId)
      ModelIdentityMigration(c,catalog,plan)
    }
    val restored=new PostgresArchive(db,config)
    val fresh=restored.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assertEquals(fresh.profile,catalog.preferred.profile)
    assertEquals(fresh.runId,old.runId); assertEquals(fresh.targetEpoch,old.targetEpoch); assert(fresh.fence>old.fence)
    val namespace=restored.checkpointNamespace(fresh,catalog.preferred.embedding.id)
    assertEquals(namespace,CheckpointNamespace(profile,spaceId))
    assertEquals(namespace.key(fresh,IndexingStage.Annotation,0,0,ProblemPassages.identity,input),annotation)
    assertEquals(namespace.key(fresh,IndexingStage.Embedding,0,0,catalog.preferred.embedding.id,input),embedding)
    assertEquals(restored.checkpoint(fresh,annotation),Some(input)); assertEquals(restored.checkpoint(fresh,embedding),Some(accepted))
    db.transaction(c=>ModelIdentityMigration(c,catalog,plan))
    assertEquals(restored.checkpointNamespace(fresh,catalog.preferred.embedding.id),namespace)
    db.transaction { c=>
      IndexProfiles.semantic(c,"a",restored.visible,catalog.preferred.embedding)
      Sql.exec(c,"UPDATE ch_jobs SET run_id=?,state='Queued',lease_until=NULL WHERE id=?",UUID.randomUUID(),receipt.jobId)
    }
    val replacement=restored.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assertNotEquals(replacement.runId,old.runId)
    assertEquals(restored.checkpointNamespace(replacement,catalog.preferred.embedding.id),CheckpointNamespace(replacement.profile,catalog.preferred.embedding.id))
    assertEquals(restored.checkpoint(replacement,annotation),None)
  }}
  test("BG: model metadata migration preserves published vectors and original rebuild replay while work continues") { withDatabase { (config,db,archive,catalog)=>
    archive.ingest("a",Fixtures.snapshot())
    val first=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    val chunks=Fragments.split(first.snapshot.messages).map(value=>IndexedChunk(value.copy(sessionId=first.sessionId,summary="synthetic problem"),List(1.0,0.0,0.0)))
    assert(archive.publish(first,chunks))
    val previous=db.transaction(c=>Sql.one(c,"SELECT published FROM ch_sources WHERE id=?",first.sessionId)(_.getObject(1,classOf[UUID])).get)
    val rebuild=new PostgresOwnerReindex(db); val preview=rebuild.preview("a"); val request=UUID.randomUUID()
    rebuild("a",request,preview.targetProfile,preview.selectionHash,true)
    val (spaceId,space,profile,descriptor)=legacy(config,catalog)
    db.transaction { c=>
      Sql.exec(c,"INSERT INTO ch_embedding_spaces VALUES(?,?::jsonb)",spaceId,space.noSpaces)
      Sql.exec(c,"INSERT INTO ch_index_profiles VALUES(?,?,'ContextAwareProblemsV1',?::jsonb)",profile,spaceId,descriptor.noSpaces)
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=? WHERE owner='a'",profile)
      List("ch_jobs","ch_generations","ch_search_chunks").foreach(table=>Sql.exec(c,s"UPDATE $table SET profile=? WHERE session_id=?",profile,first.sessionId))
      // Stored v1 receipts bind the original target and an opaque committed selection token.
      Sql.exec(c,"UPDATE ch_reindex_requests SET target_profile=?,result=jsonb_set(result,'{targetProfile}',to_jsonb(?::text)) WHERE owner='a' AND request_id=?",profile,profile,request)
    }
    def content= db.transaction { c=>List("ch_chunks","ch_search_chunks","ch_generations","ch_problem_passages","ch_problem_spans","ch_problem_pieces","ch_context_spans","ch_generation_tags").flatMap(table=>Sql.rows(c,s"SELECT (to_jsonb(t)-'profile')::text FROM $table t ORDER BY (to_jsonb(t)-'profile')::text")(_.getString(1))) }
    val before=content
    val receipt=db.transaction(c=>Sql.one(c,"SELECT result FROM ch_reindex_requests WHERE owner='a' AND request_id=?",request)(r=>Sql.json(r,"result")).get)
    assert(before.nonEmpty)
    assertEquals(intercept[DomainError](db.transaction(c=>IndexProfiles.semantic(c,"a",archive.visible,catalog.preferred.embedding))).code,"unavailable")
    db.transaction(c=>ModelIdentityMigration(c,catalog,ModelIdentityPlan(Set(profile),Vector.empty,catalog.preferred.profile)))
    assertEquals(content,before)
    db.transaction(c=>IndexProfiles.semantic(c,"a",archive.visible,catalog.preferred.embedding))
    assertEquals(rebuild("a",request,profile,preview.selectionHash,true).targetProfile,profile)
    assertEquals(db.transaction(c=>Sql.one(c,"SELECT result FROM ch_reindex_requests WHERE owner='a' AND request_id=?",request)(r=>Sql.json(r,"result")).get),receipt)
    assertEquals(rebuild.status("a",request).pending,1L)
    assertEquals(rebuild.status("a",request).superseded,0L)
    val resumed=archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get
    assert(archive.publish(resumed,Nil))
    assertEquals(rebuild.status("a",request).complete,1L)
    assertEquals(db.transaction(c=>Sql.one(c,"SELECT retired FROM ch_generations WHERE id=?",previous)(_.getBoolean(1)).get),true)
  }}
  test("BG: model identity migration preserves readable publications from older non-executable policies") { withDatabase { (config,db,archive,catalog)=>
    List.fill(2)(archive.ingest("a",Fixtures.snapshot()))
    val claims=List.fill(2)(archive.claim(catalog.knownProfiles,ClaimScope.Owner("a"),300).get)
    claims.foreach { claim=>
      val chunks=Fragments.split(claim.snapshot.messages).map(value=>IndexedChunk(value.copy(sessionId=claim.sessionId,summary="retained synthetic problem"),List(1.0,0.0,0.0)))
      assert(archive.publish(claim,chunks))
    }
    val (spaceId,space,active,activeDescriptor)=legacy(config,catalog)
    val olderConfig=config.copy(annotation=config.annotation.copy(maxResponseBytes=config.annotation.maxResponseBytes-1))
    val (_,_,retained,retainedDescriptor)=legacy(olderConfig,IndexProfileCatalog.current(olderConfig))
    db.transaction { c=>
      Sql.exec(c,"INSERT INTO ch_embedding_spaces VALUES(?,?::jsonb)",spaceId,space.noSpaces)
      List(active->activeDescriptor,retained->retainedDescriptor).foreach { (profile,descriptor)=>
        Sql.exec(c,"INSERT INTO ch_index_profiles VALUES(?,?,'ContextAwareProblemsV1',?::jsonb)",profile,spaceId,descriptor.noSpaces)
      }
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=? WHERE owner='a'",active)
      claims.zip(List(active,retained)).foreach { (claim,profile)=>
        List("ch_jobs","ch_generations","ch_search_chunks").foreach(table=>Sql.exec(c,s"UPDATE $table SET profile=? WHERE session_id=?",profile,claim.sessionId))
      }
      assertEquals(Sql.one(c,"SELECT count(*) FROM ch_sources WHERE published IS NOT NULL")(_.getLong(1)).get,2L)
      ModelIdentityMigration(c,catalog,ModelIdentityPlan(Set(active),Vector(RetainedReadApproval(retained,spaceId,ReadableIndexPolicy.ContextAwareProblemsV1,Wire.hash(retainedDescriptor.noSpacesSortKeys))),catalog.preferred.profile))
    }
    db.transaction(c=>IndexProfiles.semantic(c,"a",archive.visible,catalog.preferred.embedding))
  }}
  test("BG: retained read approvals preserve every original row and never authorize historical execution") {
    ReadableIndexPolicy.values.foreach { policy=>withDatabase { (config,db,archive,catalog)=>
      val approval=retainedFixture(config,db,archive,catalog,policy)
      val before=retainedContent(db)
      val plan=ModelIdentityPlan(Set.empty,Vector(approval),catalog.preferred.profile)
      assertEquals(intercept[DomainError](db.transaction(c=>IndexProfiles.semantic(c,"a",archive.visible,catalog.preferred.embedding))).code,"unavailable")
      db.transaction(c=>ModelIdentityMigration(c,catalog,plan))
      db.transaction(c=>ModelIdentityMigration(c,catalog,plan))
      assertEquals(retainedContent(db),before)
      db.transaction { c=>
        IndexProfiles.semantic(c,"a",archive.visible,catalog.preferred.embedding)
        assertEquals(Sql.one(c,s"SELECT count(*) FROM ch_generations g WHERE ${IndexProfiles.compatibleSql("g.profile")}",catalog.preferred.embedding.id)(_.getLong(1)).get,1L)
        assertEquals(Sql.one(c,"SELECT count(*) FROM ch_retained_profile_reads")(_.getLong(1)).get,1L)
      }
      val search=new PostgresSearch(db,archive,config)
      List(SearchMode.Semantic,SearchMode.Hybrid).foreach { mode=>
        val query=SearchQuery("retained",mode,SearchFilter(None,None,None,None,Nil),20,0)
        assertEquals(search.search("a",query,Some(List(1.0,0.0,0.0))).total,1)
        assertEquals(search.searchLegacy("a",query,Some(List(1.0,0.0,0.0))).total,1)
        val browse=ArchiveQuery(s"mode:${mode.toString.toLowerCase(java.util.Locale.ROOT)} retained",ArchiveSort.Title,SortDirection.Asc,None,20,false)
        assertEquals(new PostgresArchiveIndex(db,archive,config).browse("a",browse,ArchiveExpression.parse(browse.expression),List(ArchiveVector("retained",List(1.0,0.0,0.0)))).total,1L)
      }
      db.transaction(c=>Sql.exec(c,"DELETE FROM ch_retained_profile_reads"))
      val rejected=SearchQuery("retained",SearchMode.Semantic,SearchFilter(None,None,None,None,Nil),20,0)
      assertEquals(intercept[DomainError](search.search("a",rejected,Some(List(1.0,0.0,0.0)))).code,"unavailable")
      assertEquals(intercept[DomainError](search.searchLegacy("a",rejected,Some(List(1.0,0.0,0.0)))).code,"unavailable")
      assert(!catalog.knownProfiles.contains(approval.profile))
      assertEquals(intercept[DomainError](archive.claim(Set(approval.profile),ClaimScope.Owner("a"),300)).code,"unavailable")
    }}
  }
  test("BG: retained approvals are per profile and malformed proofs fail the whole semantic read") { withDatabase { (config,db,archive,catalog)=>
    val approval=retainedFixture(config,db,archive,catalog,ReadableIndexPolicy.ContextAwareProblemsV1)
    val plan=ModelIdentityPlan(Set.empty,Vector(approval),catalog.preferred.profile)
    db.transaction(c=>ModelIdentityMigration(c,catalog,plan))
    val other=Wire.hash("synthetic-unapproved-retained")
    db.transaction(c=>Sql.exec(c,"INSERT INTO ch_index_profiles SELECT ?,embedding_space,policy,descriptor FROM ch_index_profiles WHERE profile=?",other,approval.profile))
    val changes=List(
      "DELETE FROM ch_retained_profile_reads",
      "UPDATE ch_retained_profile_reads SET policy='LegacyV4'",
      "UPDATE ch_retained_profile_reads SET profile_descriptor='[]'::jsonb",
      "UPDATE ch_retained_profile_reads SET legacy_descriptor='[]'::jsonb",
      "UPDATE ch_retained_profile_reads SET canonical_descriptor='[]'::jsonb",
      "UPDATE ch_retained_profile_reads SET canonical_profile=profile",
      s"UPDATE ch_generations SET profile='$other'",
      s"UPDATE ch_owner_targets SET profile='$other' WHERE owner='a'",
      "UPDATE ch_index_profiles SET descriptor='[]'::jsonb WHERE profile=(SELECT profile FROM ch_retained_profile_reads)",
      "UPDATE ch_embedding_spaces SET descriptor='[]'::jsonb WHERE id=(SELECT legacy_space FROM ch_retained_profile_reads)",
      "UPDATE ch_embedding_spaces SET descriptor='[]'::jsonb WHERE id=(SELECT canonical_space FROM ch_retained_profile_reads)",
    )
    changes.foreach { sql=>
      assertEquals(intercept[DomainError](db.transaction { c=>Sql.exec(c,sql); IndexProfiles.semantic(c,"a",archive.visible,catalog.preferred.embedding) }).code,"unavailable",sql)
      db.transaction(c=>IndexProfiles.semantic(c,"a",archive.visible,catalog.preferred.embedding))
    }
    assertEquals(intercept[DomainError](db.transaction { c=>Sql.exec(c,"UPDATE ch_retained_profile_reads SET profile_descriptor='[]'::jsonb"); ModelIdentityMigration(c,catalog,plan) }).code,"internal")
  }}
  test("BG: forged retained read proof cannot bridge different model identities") { withDatabase { (config,db,archive,catalog)=>
    val approval=retainedFixture(config,db,archive,catalog,ReadableIndexPolicy.ContextAwareProblemsV1)
    val foreignConfig=config.copy(embedding=config.embedding.copy(revision="different-model-artifact"))
    val (spaceId,space,_,_)=legacy(foreignConfig,IndexProfileCatalog.current(foreignConfig))
    db.transaction { c=>
      Sql.exec(c,"INSERT INTO ch_embedding_spaces VALUES(?,?::jsonb)",spaceId,space.noSpaces)
      Sql.exec(c,"UPDATE ch_index_profiles SET embedding_space=? WHERE profile=?",spaceId,approval.profile)
      Sql.exec(c,"INSERT INTO ch_retained_profile_reads SELECT profile,embedding_space,?,?,policy,descriptor,?::jsonb,?::jsonb FROM ch_index_profiles WHERE profile=?",catalog.preferred.profile,catalog.preferred.embedding.id,space.noSpaces,catalog.preferred.embedding.json.noSpaces,approval.profile)
    }
    assertEquals(intercept[DomainError](db.transaction(c=>IndexProfiles.semantic(c,"a",archive.visible,catalog.preferred.embedding))).code,"unavailable")
  }}
  test("BG: retained approvals reject changed models, stale snapshots and active worker leases atomically") { withDatabase { (config,db,archive,catalog)=>
    val approval=retainedFixture(config,db,archive,catalog,ReadableIndexPolicy.ContiguousPassagesV1)
    val plan=ModelIdentityPlan(Set.empty,Vector(approval),catalog.preferred.profile)
    assertEquals(intercept[DomainError](db.transaction(c=>ModelIdentityMigration(c,catalog,plan.copy(retainedProfiles=Vector(approval.copy(descriptorSha256="0"*64)))))).code,"conflict")
    val variants=List(
      config.copy(embedding=config.embedding.copy(model="different-model")),
      config.copy(embedding=config.embedding.copy(revision="different-revision")),
      config.copy(embedding=config.embedding.copy(dimensions=4)),
      config.copy(embedding=config.embedding.copy(sendDimensions= !config.embedding.sendDimensions)),
      config.copy(embedding=config.embedding.copy(queryPrefix="different query")),
      config.copy(embedding=config.embedding.copy(documentPrefix="different document")),
    )
    variants.foreach { changed=>
      val target=IndexProfileCatalog.current(changed)
      assertEquals(intercept[DomainError](db.transaction(c=>ModelIdentityMigration(c,target,plan.copy(canonicalProfile=target.preferred.profile)))).code,"unavailable")
    }
    db.transaction(c=>Sql.exec(c,"UPDATE ch_jobs SET state='Running',lease_until=clock_timestamp()+interval '1 minute'"))
    assertEquals(intercept[DomainError](db.transaction(c=>ModelIdentityMigration(c,catalog,plan))).code,"conflict")
    assertEquals(db.transaction(c=>Sql.one(c,"SELECT count(*) FROM ch_retained_profile_reads")(_.getLong(1)).get),0L)
  }}
  test("BG: changed artifacts or semantic policies cannot be approved as a transport-only migration") { withDatabase { (config,db,archive,catalog)=>
    val (spaceId,space,profile,descriptor)=legacy(config,catalog)
    db.transaction { c=>
      Sql.exec(c,"INSERT INTO ch_embedding_spaces VALUES(?,?::jsonb)",spaceId,space.noSpaces)
      Sql.exec(c,"INSERT INTO ch_index_profiles VALUES(?,?,'ContextAwareProblemsV1',?::jsonb)",profile,spaceId,descriptor.noSpaces)
    }
    val variants=List(
      config.copy(embedding=config.embedding.copy(model="other")),
      config.copy(embedding=config.embedding.copy(revision="other-immutable-revision")),
      config.copy(embedding=config.embedding.copy(dimensions=4)),
      config.copy(embedding=config.embedding.copy(queryPrefix="other query")),
      config.copy(embedding=config.embedding.copy(documentPrefix="other document")),
      config.copy(embedding=config.embedding.copy(sendDimensions= !config.embedding.sendDimensions)),
      config.copy(annotation=config.annotation.copy(model="other")),
      config.copy(annotation=config.annotation.copy(revision="other-immutable-revision")),
      config.copy(annotation=config.annotation.copy(maxResponseBytes=config.annotation.maxResponseBytes+1)),
    )
    variants.foreach { changed=>
      val target=IndexProfileCatalog.current(changed)
      assertEquals(intercept[DomainError](db.transaction(c=>ModelIdentityMigration(c,target,ModelIdentityPlan(Set(profile),Vector.empty,target.preferred.profile)))).code,"unavailable")
    }
    assertEquals(db.transaction(c=>Sql.one(c,"SELECT count(*) FROM ch_model_identity_migrations")(_.getLong(1)).get),0L)
  }}
  test("BG: corrupted legacy model identity aborts transactionally instead of relabeling existing work") { withDatabase { (config,db,archive,catalog)=>
    val (spaceId,space,profile,descriptor)=legacy(config,catalog)
    db.transaction { c=>
      Sql.exec(c,"INSERT INTO ch_embedding_spaces VALUES(?,?::jsonb)","0"*64,space.noSpaces)
      Sql.exec(c,"INSERT INTO ch_index_profiles VALUES(?,?,'ContextAwareProblemsV1',?::jsonb)",profile,"0"*64,descriptor.noSpaces)
    }
    assertEquals(intercept[DomainError](db.transaction(c=>ModelIdentityMigration(c,catalog,ModelIdentityPlan(Set(profile),Vector.empty,catalog.preferred.profile)))).code,"unavailable")
    assertEquals(db.transaction(c=>Sql.one(c,"SELECT count(*) FROM ch_model_identity_migrations")(_.getLong(1)).get),0L)
    assertEquals(db.transaction(c=>Sql.one(c,"SELECT profile FROM ch_owner_targets WHERE owner='a'")(_.getString(1)).get),catalog.preferred.profile)
  }}
}
