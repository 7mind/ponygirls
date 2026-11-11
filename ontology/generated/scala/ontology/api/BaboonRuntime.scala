import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, Lazy}

package ontology.api {
  trait RequiredConversions {
      
  }
  
  class BaboonConversions(@scala.annotation.unused required: RequiredConversions) extends AbstractBaboonConversions {
      
  
      override def versionsFrom: List[String] = List()
      override def versionTo: String = "0.1.0"
  }
  
  object BaboonCodecsUeba extends AbstractBaboonUebaCodecs{
    
  }
  
  object BaboonCodecsJson extends AbstractBaboonJsonCodecs{
    register("ontology.api/:#Relation", Lazy(Relation_JsonCodec))
    register("ontology.api/:#Grouping", Lazy(Grouping_JsonCodec))
    register("ontology.api/:#JudgmentsResult", Lazy(JudgmentsResult_JsonCodec))
    register("ontology.api/:#CurationProposal", Lazy(CurationProposal_JsonCodec))
    register("ontology.api/:#ApplyRequest", Lazy(ApplyRequest_JsonCodec))
    register("ontology.api/:#InputKind", Lazy(InputKind_JsonCodec))
    register("ontology.api/:#ScopeRequest", Lazy(ScopeRequest_JsonCodec))
    register("ontology.api/:#Gate", Lazy(Gate_JsonCodec))
    register("ontology.api/:#JudgmentRequest", Lazy(JudgmentRequest_JsonCodec))
    register("ontology.api/:#CaptureMetadata", Lazy(CaptureMetadata_JsonCodec))
    register("ontology.api/:#ActorRecord", Lazy(ActorRecord_JsonCodec))
    register("ontology.api/:#ScopeSummary", Lazy(ScopeSummary_JsonCodec))
    register("ontology.api/:#GraphSnapshot", Lazy(GraphSnapshot_JsonCodec))
    register("ontology.api/:#Target", Lazy(Target_JsonCodec))
    register("ontology.api/:#Phase", Lazy(Phase_JsonCodec))
    register("ontology.api/:#Capsule", Lazy(Capsule_JsonCodec))
    register("ontology.api/:#Consumption", Lazy(Consumption_JsonCodec))
    register("ontology.api/:#JudgmentKind", Lazy(JudgmentKind_JsonCodec))
    register("ontology.api/:#Failure", Lazy(Failure_JsonCodec))
    register("ontology.api/:#CapsuleRequest", Lazy(CapsuleRequest_JsonCodec))
    register("ontology.api/:#Provenance", Lazy(Provenance_JsonCodec))
    register("ontology.api/:#Definition", Lazy(Definition_JsonCodec))
    register("ontology.api/:#SearchHit", Lazy(SearchHit_JsonCodec))
    register("ontology.api/:#FindRequest", Lazy(FindRequest_JsonCodec))
    register("ontology.api/:#ConflictState", Lazy(ConflictState_JsonCodec))
    register("ontology.api/:#ActorKind", Lazy(ActorKind_JsonCodec))
    register("ontology.api/:#Acceptance", Lazy(Acceptance_JsonCodec))
    register("ontology.api/:#CapturedEvent", Lazy(CapturedEvent_JsonCodec))
    register("ontology.api/:#RelationKind", Lazy(RelationKind_JsonCodec))
    register("ontology.api/:#StateEvent", Lazy(StateEvent_JsonCodec))
    register("ontology.api/:#AdoptionOrigin", Lazy(AdoptionOrigin_JsonCodec))
    register("ontology.api/:#Execution", Lazy(Execution_JsonCodec))
    register("ontology.api/:#CaptureContext", Lazy(CaptureContext_JsonCodec))
    register("ontology.api/:#RelationDetail", Lazy(RelationDetail_JsonCodec))
    register("ontology.api/:#DeliveryRequest", Lazy(DeliveryRequest_JsonCodec))
    register("ontology.api/:#IngestResult", Lazy(IngestResult_JsonCodec))
    register("ontology.api/:#Content", Lazy(Content_JsonCodec))
    register("ontology.api/:#Ref", Lazy(Ref_JsonCodec))
    register("ontology.api/:#Identity", Lazy(Identity_JsonCodec))
    register("ontology.api/:#DefinitionKind", Lazy(DefinitionKind_JsonCodec))
    register("ontology.api/:#Escalation", Lazy(Escalation_JsonCodec))
    register("ontology.api/:#Capability", Lazy(Capability_JsonCodec))
    register("ontology.api/:#LineageStatus", Lazy(LineageStatus_JsonCodec))
    register("ontology.api/:#Presentation", Lazy(Presentation_JsonCodec))
    register("ontology.api/:#ReadRequest", Lazy(ReadRequest_JsonCodec))
    register("ontology.api/:#Modality", Lazy(Modality_JsonCodec))
    register("ontology.api/:#SourceRequest", Lazy(SourceRequest_JsonCodec))
    register("ontology.api/:#EventOrigin", Lazy(EventOrigin_JsonCodec))
    register("ontology.api/:#VersionInfo", Lazy(VersionInfo_JsonCodec))
    register("ontology.api/:#PresentRequest", Lazy(PresentRequest_JsonCodec))
    register("ontology.api/:#Judgment", Lazy(Judgment_JsonCodec))
    register("ontology.api/:#CurationStatus", Lazy(CurationStatus_JsonCodec))
    register("ontology.api/:#Correction", Lazy(Correction_JsonCodec))
    register("ontology.api/:#SourceResult", Lazy(SourceResult_JsonCodec))
    register("ontology.api/:#Ack", Lazy(Ack_JsonCodec))
    register("ontology.api/:#Standing", Lazy(Standing_JsonCodec))
    register("ontology.api/:#Observation", Lazy(Observation_JsonCodec))
    register("ontology.api/:#Polarity", Lazy(Polarity_JsonCodec))
    register("ontology.api/:#Operation", Lazy(Operation_JsonCodec))
    register("ontology.api/:#ReadResult", Lazy(ReadResult_JsonCodec))
    register("ontology.api/:#DeliveryReceipt", Lazy(DeliveryReceipt_JsonCodec))
    register("ontology.api/:#IngestRequest", Lazy(IngestRequest_JsonCodec))
    register("ontology.api/:#SourceRepresentation", Lazy(SourceRepresentation_JsonCodec))
    register("ontology.api/:#LoginResult", Lazy(LoginResult_JsonCodec))
    register("ontology.api/:#Force", Lazy(Force_JsonCodec))
    register("ontology.api/:#FindResult", Lazy(FindResult_JsonCodec))
    register("ontology.api/:#GoverningChange", Lazy(GoverningChange_JsonCodec))
    register("ontology.api/:#Resolution", Lazy(Resolution_JsonCodec))
    register("ontology.api/:#ReadView", Lazy(ReadView_JsonCodec))
    register("ontology.api/:#Binding", Lazy(Binding_JsonCodec))
    register("ontology.api/:#AliasRef", Lazy(AliasRef_JsonCodec))
    register("ontology.api/:#ApplyResult", Lazy(ApplyResult_JsonCodec))
    register("ontology.api/:#LoginRequest", Lazy(LoginRequest_JsonCodec))
    register("ontology.api/:#Actor", Lazy(Actor_JsonCodec))
    register("ontology.api/:#InputReceipt", Lazy(InputReceipt_JsonCodec))
    register("ontology.api/:#ScopesResult", Lazy(ScopesResult_JsonCodec))
    register("ontology.api/:#GraphRecord", Lazy(GraphRecord_JsonCodec))
    register("ontology.api/:#CurationState", Lazy(CurationState_JsonCodec))
    register("ontology.api/:#Assessment", Lazy(Assessment_JsonCodec))
  }
}