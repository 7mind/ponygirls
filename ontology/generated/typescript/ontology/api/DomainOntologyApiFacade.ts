

import { AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, BaboonBinCodec, BaboonJsonCodec, BaboonDomainVersion, BaboonMeta, Lazy } from '../../BaboonSharedRuntime.js';
import type { AbstractBaboonConversions } from '../../BaboonSharedRuntime.js';
import { BaboonCodecsFacade } from '../../BaboonCodecsFacade.js';
import { Acceptance, Acceptance_JsonCodec } from './Acceptance.js';
import { AcceptanceInput, AcceptanceInput_JsonCodec } from './AcceptanceInput.js';
import { Ack, Ack_JsonCodec } from './Ack.js';
import { Actor, Actor_JsonCodec } from './Actor.js';
import { ActorKind, ActorKind_JsonCodec } from './ActorKind.js';
import { ActorRecord, ActorRecord_JsonCodec } from './ActorRecord.js';
import { AdoptionOrigin, AdoptionOrigin_JsonCodec } from './AdoptionOrigin.js';
import { AliasRef, AliasRef_JsonCodec } from './AliasRef.js';
import { Applicability, Applicability_JsonCodec } from './Applicability.js';
import { ApplicabilityContext, ApplicabilityContext_JsonCodec } from './ApplicabilityContext.js';
import { ApplicabilityContextInput, ApplicabilityContextInput_JsonCodec } from './ApplicabilityContextInput.js';
import { ApplicabilityInput, ApplicabilityInput_JsonCodec } from './ApplicabilityInput.js';
import { ApplyRequest, ApplyRequest_JsonCodec } from './ApplyRequest.js';
import { ApplyResult, ApplyResult_JsonCodec } from './ApplyResult.js';
import { Assessment, Assessment_JsonCodec } from './Assessment.js';
import { AssessmentUseDisposition, AssessmentUseDisposition_JsonCodec } from './AssessmentUseDisposition.js';
import { Binding, Binding_JsonCodec } from './Binding.js';
import { BindingSelection, BindingSelection_JsonCodec } from './BindingSelection.js';
import { Capability, Capability_JsonCodec } from './Capability.js';
import { Capsule, Capsule_JsonCodec } from './Capsule.js';
import { CapsuleRequest, CapsuleRequest_JsonCodec } from './CapsuleRequest.js';
import { CaptureContext, CaptureContext_JsonCodec } from './CaptureContext.js';
import { CaptureMetadata, CaptureMetadata_JsonCodec } from './CaptureMetadata.js';
import { CapturedEvent, CapturedEvent_JsonCodec } from './CapturedEvent.js';
import { ConflictState, ConflictState_JsonCodec } from './ConflictState.js';
import { Consumption, Consumption_JsonCodec } from './Consumption.js';
import { Content, Content_JsonCodec } from './Content.js';
import { ContentInput, ContentInput_JsonCodec } from './ContentInput.js';
import { Correction, Correction_JsonCodec } from './Correction.js';
import { CurationProposal, CurationProposal_JsonCodec } from './CurationProposal.js';
import { CurationState, CurationState_JsonCodec } from './CurationState.js';
import { CurationStatus, CurationStatus_JsonCodec } from './CurationStatus.js';
import { Definition, Definition_JsonCodec } from './Definition.js';
import { DefinitionKind, DefinitionKind_JsonCodec } from './DefinitionKind.js';
import { DeliveryReceipt, DeliveryReceipt_JsonCodec } from './DeliveryReceipt.js';
import { DeliveryRequest, DeliveryRequest_JsonCodec } from './DeliveryRequest.js';
import { Escalation, Escalation_JsonCodec } from './Escalation.js';
import { EventOrigin, EventOrigin_JsonCodec } from './EventOrigin.js';
import { Execution, Execution_JsonCodec } from './Execution.js';
import { Failure, Failure_JsonCodec } from './Failure.js';
import { FindRequest, FindRequest_JsonCodec } from './FindRequest.js';
import { FindResult, FindResult_JsonCodec } from './FindResult.js';
import { Force, Force_JsonCodec } from './Force.js';
import { Gate, Gate_JsonCodec } from './Gate.js';
import { GateBasis, GateBasis_JsonCodec } from './GateBasis.js';
import { GoverningChange, GoverningChange_JsonCodec } from './GoverningChange.js';
import { GraphRecord, GraphRecord_JsonCodec } from './GraphRecord.js';
import { GraphSnapshot, GraphSnapshot_JsonCodec } from './GraphSnapshot.js';
import { Grouping, Grouping_JsonCodec } from './Grouping.js';
import { Identity, Identity_JsonCodec } from './Identity.js';
import { IngestRequest, IngestRequest_JsonCodec } from './IngestRequest.js';
import { IngestResult, IngestResult_JsonCodec } from './IngestResult.js';
import { InputKind, InputKind_JsonCodec } from './InputKind.js';
import { InputReceipt, InputReceipt_JsonCodec } from './InputReceipt.js';
import { Judgment, Judgment_JsonCodec } from './Judgment.js';
import { JudgmentKind, JudgmentKind_JsonCodec } from './JudgmentKind.js';
import { JudgmentRequest, JudgmentRequest_JsonCodec } from './JudgmentRequest.js';
import { JudgmentsResult, JudgmentsResult_JsonCodec } from './JudgmentsResult.js';
import { LineageStatus, LineageStatus_JsonCodec } from './LineageStatus.js';
import { LoginRequest, LoginRequest_JsonCodec } from './LoginRequest.js';
import { LoginResult, LoginResult_JsonCodec } from './LoginResult.js';
import { Modality, Modality_JsonCodec } from './Modality.js';
import { Observation, Observation_JsonCodec } from './Observation.js';
import { Operation, Operation_JsonCodec } from './Operation.js';
import { Phase, Phase_JsonCodec } from './Phase.js';
import { Polarity, Polarity_JsonCodec } from './Polarity.js';
import { PresentRequest, PresentRequest_JsonCodec } from './PresentRequest.js';
import { Presentation, Presentation_JsonCodec } from './Presentation.js';
import { Provenance, Provenance_JsonCodec } from './Provenance.js';
import { ReadRequest, ReadRequest_JsonCodec } from './ReadRequest.js';
import { ReadResult, ReadResult_JsonCodec } from './ReadResult.js';
import { ReadView, ReadView_JsonCodec } from './ReadView.js';
import { Ref, Ref_JsonCodec } from './Ref.js';
import { Relation, Relation_JsonCodec } from './Relation.js';
import { RelationDetail, RelationDetail_JsonCodec } from './RelationDetail.js';
import { RelationDetailInput, RelationDetailInput_JsonCodec } from './RelationDetailInput.js';
import { RelationKind, RelationKind_JsonCodec } from './RelationKind.js';
import { Resolution, Resolution_JsonCodec } from './Resolution.js';
import { ScopeRequest, ScopeRequest_JsonCodec } from './ScopeRequest.js';
import { ScopeSummary, ScopeSummary_JsonCodec } from './ScopeSummary.js';
import { ScopesResult, ScopesResult_JsonCodec } from './ScopesResult.js';
import { SearchHit, SearchHit_JsonCodec } from './SearchHit.js';
import { SourceRepresentation, SourceRepresentation_JsonCodec } from './SourceRepresentation.js';
import { SourceRequest, SourceRequest_JsonCodec } from './SourceRequest.js';
import { SourceResult, SourceResult_JsonCodec } from './SourceResult.js';
import { Standing, Standing_JsonCodec } from './Standing.js';
import { StateEvent, StateEvent_JsonCodec } from './StateEvent.js';
import { Target, Target_JsonCodec } from './Target.js';
import { VersionInfo, VersionInfo_JsonCodec } from './VersionInfo.js';

class DomainOntologyApiV0_1_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(Acceptance_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Acceptance_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(AcceptanceInput_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => AcceptanceInput_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Ack_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Ack_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Actor_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Actor_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActorKind_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActorKind_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ActorRecord_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ActorRecord_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(AdoptionOrigin_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => AdoptionOrigin_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(AliasRef_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => AliasRef_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Applicability_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Applicability_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ApplicabilityContext_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ApplicabilityContext_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ApplicabilityContextInput_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ApplicabilityContextInput_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ApplicabilityInput_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ApplicabilityInput_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ApplyRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ApplyRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ApplyResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ApplyResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Assessment_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Assessment_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(AssessmentUseDisposition_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => AssessmentUseDisposition_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Binding_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Binding_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(BindingSelection_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => BindingSelection_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Capability_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Capability_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Capsule_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Capsule_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CapsuleRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CapsuleRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CaptureContext_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CaptureContext_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CaptureMetadata_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CaptureMetadata_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CapturedEvent_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CapturedEvent_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ConflictState_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ConflictState_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Consumption_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Consumption_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Content_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Content_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ContentInput_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ContentInput_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Correction_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Correction_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CurationProposal_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CurationProposal_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CurationState_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CurationState_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CurationStatus_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CurationStatus_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Definition_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Definition_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(DefinitionKind_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => DefinitionKind_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(DeliveryReceipt_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => DeliveryReceipt_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(DeliveryRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => DeliveryRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Escalation_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Escalation_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(EventOrigin_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => EventOrigin_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Execution_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Execution_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Failure_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Failure_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FindRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FindRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(FindResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => FindResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Force_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Force_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Gate_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Gate_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GateBasis_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GateBasis_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GoverningChange_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GoverningChange_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GraphRecord_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GraphRecord_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GraphSnapshot_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GraphSnapshot_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Grouping_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Grouping_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Identity_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Identity_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(IngestResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => IngestResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(InputKind_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => InputKind_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(InputReceipt_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => InputReceipt_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Judgment_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Judgment_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JudgmentKind_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JudgmentKind_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JudgmentRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JudgmentRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(JudgmentsResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => JudgmentsResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LineageStatus_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LineageStatus_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Modality_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Modality_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Observation_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Observation_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Operation_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Operation_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Phase_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Phase_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Polarity_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Polarity_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PresentRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PresentRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Presentation_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Presentation_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Provenance_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Provenance_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ReadRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ReadRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ReadResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ReadResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ReadView_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ReadView_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Ref_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Ref_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Relation_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Relation_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RelationDetail_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RelationDetail_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RelationDetailInput_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RelationDetailInput_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RelationKind_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RelationKind_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Resolution_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Resolution_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ScopeRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ScopeRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ScopeSummary_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ScopeSummary_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ScopesResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ScopesResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchHit_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchHit_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceRepresentation_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceRepresentation_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SourceResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SourceResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Standing_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Standing_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(StateEvent_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => StateEvent_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Target_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Target_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
    }
}

class DomainOntologyApiV0_1_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainOntologyApiV0_1_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '0.1.0'; }
}

class DomainOntologyApiV0_1_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "ontology.api/:#Acceptance": ['0.1.0'],
        "ontology.api/:#AcceptanceInput": ['0.1.0'],
        "ontology.api/:#Ack": ['0.1.0'],
        "ontology.api/:#Actor": ['0.1.0'],
        "ontology.api/:#ActorKind": ['0.1.0'],
        "ontology.api/:#ActorRecord": ['0.1.0'],
        "ontology.api/:#AdoptionOrigin": ['0.1.0'],
        "ontology.api/:#AliasRef": ['0.1.0'],
        "ontology.api/:#Applicability": ['0.1.0'],
        "ontology.api/:#ApplicabilityContext": ['0.1.0'],
        "ontology.api/:#ApplicabilityContextInput": ['0.1.0'],
        "ontology.api/:#ApplicabilityInput": ['0.1.0'],
        "ontology.api/:#ApplyRequest": ['0.1.0'],
        "ontology.api/:#ApplyResult": ['0.1.0'],
        "ontology.api/:#Assessment": ['0.1.0'],
        "ontology.api/:#AssessmentUseDisposition": ['0.1.0'],
        "ontology.api/:#Binding": ['0.1.0'],
        "ontology.api/:#BindingSelection": ['0.1.0'],
        "ontology.api/:#Capability": ['0.1.0'],
        "ontology.api/:#Capsule": ['0.1.0'],
        "ontology.api/:#CapsuleRequest": ['0.1.0'],
        "ontology.api/:#CaptureContext": ['0.1.0'],
        "ontology.api/:#CaptureMetadata": ['0.1.0'],
        "ontology.api/:#CapturedEvent": ['0.1.0'],
        "ontology.api/:#ConflictState": ['0.1.0'],
        "ontology.api/:#Consumption": ['0.1.0'],
        "ontology.api/:#Content": ['0.1.0'],
        "ontology.api/:#ContentInput": ['0.1.0'],
        "ontology.api/:#Correction": ['0.1.0'],
        "ontology.api/:#CurationProposal": ['0.1.0'],
        "ontology.api/:#CurationState": ['0.1.0'],
        "ontology.api/:#CurationStatus": ['0.1.0'],
        "ontology.api/:#Definition": ['0.1.0'],
        "ontology.api/:#DefinitionKind": ['0.1.0'],
        "ontology.api/:#DeliveryReceipt": ['0.1.0'],
        "ontology.api/:#DeliveryRequest": ['0.1.0'],
        "ontology.api/:#Escalation": ['0.1.0'],
        "ontology.api/:#EventOrigin": ['0.1.0'],
        "ontology.api/:#Execution": ['0.1.0'],
        "ontology.api/:#Failure": ['0.1.0'],
        "ontology.api/:#FindRequest": ['0.1.0'],
        "ontology.api/:#FindResult": ['0.1.0'],
        "ontology.api/:#Force": ['0.1.0'],
        "ontology.api/:#Gate": ['0.1.0'],
        "ontology.api/:#GateBasis": ['0.1.0'],
        "ontology.api/:#GoverningChange": ['0.1.0'],
        "ontology.api/:#GraphRecord": ['0.1.0'],
        "ontology.api/:#GraphSnapshot": ['0.1.0'],
        "ontology.api/:#Grouping": ['0.1.0'],
        "ontology.api/:#Identity": ['0.1.0'],
        "ontology.api/:#IngestRequest": ['0.1.0'],
        "ontology.api/:#IngestResult": ['0.1.0'],
        "ontology.api/:#InputKind": ['0.1.0'],
        "ontology.api/:#InputReceipt": ['0.1.0'],
        "ontology.api/:#Judgment": ['0.1.0'],
        "ontology.api/:#JudgmentKind": ['0.1.0'],
        "ontology.api/:#JudgmentRequest": ['0.1.0'],
        "ontology.api/:#JudgmentsResult": ['0.1.0'],
        "ontology.api/:#LineageStatus": ['0.1.0'],
        "ontology.api/:#LoginRequest": ['0.1.0'],
        "ontology.api/:#LoginResult": ['0.1.0'],
        "ontology.api/:#Modality": ['0.1.0'],
        "ontology.api/:#Observation": ['0.1.0'],
        "ontology.api/:#Operation": ['0.1.0'],
        "ontology.api/:#Phase": ['0.1.0'],
        "ontology.api/:#Polarity": ['0.1.0'],
        "ontology.api/:#PresentRequest": ['0.1.0'],
        "ontology.api/:#Presentation": ['0.1.0'],
        "ontology.api/:#Provenance": ['0.1.0'],
        "ontology.api/:#ReadRequest": ['0.1.0'],
        "ontology.api/:#ReadResult": ['0.1.0'],
        "ontology.api/:#ReadView": ['0.1.0'],
        "ontology.api/:#Ref": ['0.1.0'],
        "ontology.api/:#Relation": ['0.1.0'],
        "ontology.api/:#RelationDetail": ['0.1.0'],
        "ontology.api/:#RelationDetailInput": ['0.1.0'],
        "ontology.api/:#RelationKind": ['0.1.0'],
        "ontology.api/:#Resolution": ['0.1.0'],
        "ontology.api/:#ScopeRequest": ['0.1.0'],
        "ontology.api/:#ScopeSummary": ['0.1.0'],
        "ontology.api/:#ScopesResult": ['0.1.0'],
        "ontology.api/:#SearchHit": ['0.1.0'],
        "ontology.api/:#SourceRepresentation": ['0.1.0'],
        "ontology.api/:#SourceRequest": ['0.1.0'],
        "ontology.api/:#SourceResult": ['0.1.0'],
        "ontology.api/:#Standing": ['0.1.0'],
        "ontology.api/:#StateEvent": ['0.1.0'],
        "ontology.api/:#Target": ['0.1.0'],
        "ontology.api/:#VersionInfo": ['0.1.0'],
        "ontology.api/[ontology.api/:#ApplicabilityContextInput]#Capture": ['0.1.0'],
        "ontology.api/[ontology.api/:#ApplicabilityContextInput]#Subject": ['0.1.0'],
        "ontology.api/[ontology.api/:#ApplicabilityContext]#Capture": ['0.1.0'],
        "ontology.api/[ontology.api/:#ApplicabilityContext]#Subject": ['0.1.0'],
        "ontology.api/[ontology.api/:#ApplicabilityInput]#Declared": ['0.1.0'],
        "ontology.api/[ontology.api/:#ApplicabilityInput]#Unresolved": ['0.1.0'],
        "ontology.api/[ontology.api/:#Applicability]#Captured": ['0.1.0'],
        "ontology.api/[ontology.api/:#Applicability]#Declared": ['0.1.0'],
        "ontology.api/[ontology.api/:#Applicability]#Unresolved": ['0.1.0'],
        "ontology.api/[ontology.api/:#ContentInput]#Conflict": ['0.1.0'],
        "ontology.api/[ontology.api/:#ContentInput]#Constraint": ['0.1.0'],
        "ontology.api/[ontology.api/:#ContentInput]#Decision": ['0.1.0'],
        "ontology.api/[ontology.api/:#ContentInput]#Defect": ['0.1.0'],
        "ontology.api/[ontology.api/:#ContentInput]#Hypothesis": ['0.1.0'],
        "ontology.api/[ontology.api/:#ContentInput]#Outcome": ['0.1.0'],
        "ontology.api/[ontology.api/:#ContentInput]#Question": ['0.1.0'],
        "ontology.api/[ontology.api/:#ContentInput]#Review": ['0.1.0'],
        "ontology.api/[ontology.api/:#ContentInput]#Statement": ['0.1.0'],
        "ontology.api/[ontology.api/:#ContentInput]#Task": ['0.1.0'],
        "ontology.api/[ontology.api/:#Content]#Artifact": ['0.1.0'],
        "ontology.api/[ontology.api/:#Content]#Conflict": ['0.1.0'],
        "ontology.api/[ontology.api/:#Content]#Constraint": ['0.1.0'],
        "ontology.api/[ontology.api/:#Content]#Decision": ['0.1.0'],
        "ontology.api/[ontology.api/:#Content]#Defect": ['0.1.0'],
        "ontology.api/[ontology.api/:#Content]#Hypothesis": ['0.1.0'],
        "ontology.api/[ontology.api/:#Content]#Outcome": ['0.1.0'],
        "ontology.api/[ontology.api/:#Content]#Question": ['0.1.0'],
        "ontology.api/[ontology.api/:#Content]#Review": ['0.1.0'],
        "ontology.api/[ontology.api/:#Content]#Source": ['0.1.0'],
        "ontology.api/[ontology.api/:#Content]#Statement": ['0.1.0'],
        "ontology.api/[ontology.api/:#Content]#Task": ['0.1.0'],
        "ontology.api/[ontology.api/:#GraphRecord]#Contract": ['0.1.0'],
        "ontology.api/[ontology.api/:#GraphRecord]#Edge": ['0.1.0'],
        "ontology.api/[ontology.api/:#GraphRecord]#Input": ['0.1.0'],
        "ontology.api/[ontology.api/:#GraphRecord]#Node": ['0.1.0'],
        "ontology.api/[ontology.api/:#GraphRecord]#Person": ['0.1.0'],
        "ontology.api/[ontology.api/:#GraphRecord]#Progress": ['0.1.0'],
        "ontology.api/[ontology.api/:#GraphRecord]#Selection": ['0.1.0'],
        "ontology.api/[ontology.api/:#Observation]#Execution": ['0.1.0'],
        "ontology.api/[ontology.api/:#Observation]#FileAbsent": ['0.1.0'],
        "ontology.api/[ontology.api/:#Observation]#FileVersion": ['0.1.0'],
        "ontology.api/[ontology.api/:#Observation]#None": ['0.1.0'],
        "ontology.api/[ontology.api/:#Operation]#Bind": ['0.1.0'],
        "ontology.api/[ontology.api/:#Operation]#Create": ['0.1.0'],
        "ontology.api/[ontology.api/:#Operation]#Relate": ['0.1.0'],
        "ontology.api/[ontology.api/:#Operation]#Revise": ['0.1.0'],
        "ontology.api/[ontology.api/:#Operation]#ReviseRelation": ['0.1.0'],
        "ontology.api/[ontology.api/:#Operation]#SelectBinding": ['0.1.0'],
        "ontology.api/[ontology.api/:#Operation]#State": ['0.1.0'],
        "ontology.api/[ontology.api/:#RelationDetailInput]#Adoption": ['0.1.0'],
        "ontology.api/[ontology.api/:#RelationDetailInput]#AssessmentUse": ['0.1.0'],
        "ontology.api/[ontology.api/:#RelationDetailInput]#Decomposition": ['0.1.0'],
        "ontology.api/[ontology.api/:#RelationDetailInput]#Delegation": ['0.1.0'],
        "ontology.api/[ontology.api/:#RelationDetailInput]#Dependency": ['0.1.0'],
        "ontology.api/[ontology.api/:#RelationDetailInput]#Empty": ['0.1.0'],
        "ontology.api/[ontology.api/:#RelationDetail]#Adoption": ['0.1.0'],
        "ontology.api/[ontology.api/:#RelationDetail]#AssessmentUse": ['0.1.0'],
        "ontology.api/[ontology.api/:#RelationDetail]#Decomposition": ['0.1.0'],
        "ontology.api/[ontology.api/:#RelationDetail]#Delegation": ['0.1.0'],
        "ontology.api/[ontology.api/:#RelationDetail]#Dependency": ['0.1.0'],
        "ontology.api/[ontology.api/:#RelationDetail]#Empty": ['0.1.0'],
        "ontology.api/[ontology.api/:#Target]#Created": ['0.1.0'],
        "ontology.api/[ontology.api/:#Target]#Exact": ['0.1.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "ontology.api/:#Acceptance": { '0.1.0': 'identical' },
        "ontology.api/:#AcceptanceInput": { '0.1.0': 'identical' },
        "ontology.api/:#Ack": { '0.1.0': 'identical' },
        "ontology.api/:#Actor": { '0.1.0': 'identical' },
        "ontology.api/:#ActorKind": { '0.1.0': 'identical' },
        "ontology.api/:#ActorRecord": { '0.1.0': 'identical' },
        "ontology.api/:#AdoptionOrigin": { '0.1.0': 'identical' },
        "ontology.api/:#AliasRef": { '0.1.0': 'identical' },
        "ontology.api/:#Applicability": { '0.1.0': 'identical' },
        "ontology.api/:#ApplicabilityContext": { '0.1.0': 'identical' },
        "ontology.api/:#ApplicabilityContextInput": { '0.1.0': 'identical' },
        "ontology.api/:#ApplicabilityInput": { '0.1.0': 'identical' },
        "ontology.api/:#ApplyRequest": { '0.1.0': 'identical' },
        "ontology.api/:#ApplyResult": { '0.1.0': 'identical' },
        "ontology.api/:#Assessment": { '0.1.0': 'identical' },
        "ontology.api/:#AssessmentUseDisposition": { '0.1.0': 'identical' },
        "ontology.api/:#Binding": { '0.1.0': 'identical' },
        "ontology.api/:#BindingSelection": { '0.1.0': 'identical' },
        "ontology.api/:#Capability": { '0.1.0': 'identical' },
        "ontology.api/:#Capsule": { '0.1.0': 'identical' },
        "ontology.api/:#CapsuleRequest": { '0.1.0': 'identical' },
        "ontology.api/:#CaptureContext": { '0.1.0': 'identical' },
        "ontology.api/:#CaptureMetadata": { '0.1.0': 'identical' },
        "ontology.api/:#CapturedEvent": { '0.1.0': 'identical' },
        "ontology.api/:#ConflictState": { '0.1.0': 'identical' },
        "ontology.api/:#Consumption": { '0.1.0': 'identical' },
        "ontology.api/:#Content": { '0.1.0': 'identical' },
        "ontology.api/:#ContentInput": { '0.1.0': 'identical' },
        "ontology.api/:#Correction": { '0.1.0': 'identical' },
        "ontology.api/:#CurationProposal": { '0.1.0': 'identical' },
        "ontology.api/:#CurationState": { '0.1.0': 'identical' },
        "ontology.api/:#CurationStatus": { '0.1.0': 'identical' },
        "ontology.api/:#Definition": { '0.1.0': 'identical' },
        "ontology.api/:#DefinitionKind": { '0.1.0': 'identical' },
        "ontology.api/:#DeliveryReceipt": { '0.1.0': 'identical' },
        "ontology.api/:#DeliveryRequest": { '0.1.0': 'identical' },
        "ontology.api/:#Escalation": { '0.1.0': 'identical' },
        "ontology.api/:#EventOrigin": { '0.1.0': 'identical' },
        "ontology.api/:#Execution": { '0.1.0': 'identical' },
        "ontology.api/:#Failure": { '0.1.0': 'identical' },
        "ontology.api/:#FindRequest": { '0.1.0': 'identical' },
        "ontology.api/:#FindResult": { '0.1.0': 'identical' },
        "ontology.api/:#Force": { '0.1.0': 'identical' },
        "ontology.api/:#Gate": { '0.1.0': 'identical' },
        "ontology.api/:#GateBasis": { '0.1.0': 'identical' },
        "ontology.api/:#GoverningChange": { '0.1.0': 'identical' },
        "ontology.api/:#GraphRecord": { '0.1.0': 'identical' },
        "ontology.api/:#GraphSnapshot": { '0.1.0': 'identical' },
        "ontology.api/:#Grouping": { '0.1.0': 'identical' },
        "ontology.api/:#Identity": { '0.1.0': 'identical' },
        "ontology.api/:#IngestRequest": { '0.1.0': 'identical' },
        "ontology.api/:#IngestResult": { '0.1.0': 'identical' },
        "ontology.api/:#InputKind": { '0.1.0': 'identical' },
        "ontology.api/:#InputReceipt": { '0.1.0': 'identical' },
        "ontology.api/:#Judgment": { '0.1.0': 'identical' },
        "ontology.api/:#JudgmentKind": { '0.1.0': 'identical' },
        "ontology.api/:#JudgmentRequest": { '0.1.0': 'identical' },
        "ontology.api/:#JudgmentsResult": { '0.1.0': 'identical' },
        "ontology.api/:#LineageStatus": { '0.1.0': 'identical' },
        "ontology.api/:#LoginRequest": { '0.1.0': 'identical' },
        "ontology.api/:#LoginResult": { '0.1.0': 'identical' },
        "ontology.api/:#Modality": { '0.1.0': 'identical' },
        "ontology.api/:#Observation": { '0.1.0': 'identical' },
        "ontology.api/:#Operation": { '0.1.0': 'identical' },
        "ontology.api/:#Phase": { '0.1.0': 'identical' },
        "ontology.api/:#Polarity": { '0.1.0': 'identical' },
        "ontology.api/:#PresentRequest": { '0.1.0': 'identical' },
        "ontology.api/:#Presentation": { '0.1.0': 'identical' },
        "ontology.api/:#Provenance": { '0.1.0': 'identical' },
        "ontology.api/:#ReadRequest": { '0.1.0': 'identical' },
        "ontology.api/:#ReadResult": { '0.1.0': 'identical' },
        "ontology.api/:#ReadView": { '0.1.0': 'identical' },
        "ontology.api/:#Ref": { '0.1.0': 'identical' },
        "ontology.api/:#Relation": { '0.1.0': 'identical' },
        "ontology.api/:#RelationDetail": { '0.1.0': 'identical' },
        "ontology.api/:#RelationDetailInput": { '0.1.0': 'identical' },
        "ontology.api/:#RelationKind": { '0.1.0': 'identical' },
        "ontology.api/:#Resolution": { '0.1.0': 'identical' },
        "ontology.api/:#ScopeRequest": { '0.1.0': 'identical' },
        "ontology.api/:#ScopeSummary": { '0.1.0': 'identical' },
        "ontology.api/:#ScopesResult": { '0.1.0': 'identical' },
        "ontology.api/:#SearchHit": { '0.1.0': 'identical' },
        "ontology.api/:#SourceRepresentation": { '0.1.0': 'identical' },
        "ontology.api/:#SourceRequest": { '0.1.0': 'identical' },
        "ontology.api/:#SourceResult": { '0.1.0': 'identical' },
        "ontology.api/:#Standing": { '0.1.0': 'identical' },
        "ontology.api/:#StateEvent": { '0.1.0': 'identical' },
        "ontology.api/:#Target": { '0.1.0': 'identical' },
        "ontology.api/:#VersionInfo": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ApplicabilityContextInput]#Capture": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ApplicabilityContextInput]#Subject": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ApplicabilityContext]#Capture": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ApplicabilityContext]#Subject": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ApplicabilityInput]#Declared": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ApplicabilityInput]#Unresolved": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Applicability]#Captured": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Applicability]#Declared": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Applicability]#Unresolved": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ContentInput]#Conflict": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ContentInput]#Constraint": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ContentInput]#Decision": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ContentInput]#Defect": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ContentInput]#Hypothesis": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ContentInput]#Outcome": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ContentInput]#Question": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ContentInput]#Review": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ContentInput]#Statement": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#ContentInput]#Task": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Content]#Artifact": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Content]#Conflict": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Content]#Constraint": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Content]#Decision": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Content]#Defect": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Content]#Hypothesis": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Content]#Outcome": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Content]#Question": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Content]#Review": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Content]#Source": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Content]#Statement": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Content]#Task": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#GraphRecord]#Contract": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#GraphRecord]#Edge": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#GraphRecord]#Input": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#GraphRecord]#Node": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#GraphRecord]#Person": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#GraphRecord]#Progress": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#GraphRecord]#Selection": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Observation]#Execution": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Observation]#FileAbsent": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Observation]#FileVersion": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Observation]#None": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Operation]#Bind": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Operation]#Create": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Operation]#Relate": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Operation]#Revise": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Operation]#ReviseRelation": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Operation]#SelectBinding": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Operation]#State": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#RelationDetailInput]#Adoption": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#RelationDetailInput]#AssessmentUse": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#RelationDetailInput]#Decomposition": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#RelationDetailInput]#Delegation": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#RelationDetailInput]#Dependency": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#RelationDetailInput]#Empty": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#RelationDetail]#Adoption": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#RelationDetail]#AssessmentUse": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#RelationDetail]#Decomposition": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#RelationDetail]#Delegation": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#RelationDetail]#Dependency": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#RelationDetail]#Empty": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Target]#Created": { '0.1.0': 'identical' },
        "ontology.api/[ontology.api/:#Target]#Exact": { '0.1.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainOntologyApiV0_1_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainOntologyApiV0_1_0Meta.FORWARD[typeId] ?? {}; }
}

export class DomainOntologyApiFacade extends BaboonCodecsFacade {
    constructor() {
        super();
        this.register(
            new BaboonDomainVersion('ontology.api', '0.1.0'),
            () => new DomainOntologyApiV0_1_0JsonCodecs(),
            () => new DomainOntologyApiV0_1_0UebaCodecs(),
            () => new DomainOntologyApiV0_1_0Conversions(),
            () => new DomainOntologyApiV0_1_0Meta(),
        );
    }
}