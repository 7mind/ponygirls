import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { Artifact_JsonCodec } from './Artifact.js';
import { SearchEvidence_JsonCodec } from './SearchEvidence.js';
export class SearchHit {
    _artifact;
    _sourceVersion;
    _generationId;
    _policyId;
    _embeddingProfile;
    _embeddingSpace;
    _evidence;
    _score;
    constructor(artifact, sourceVersion, generationId, policyId, embeddingProfile, embeddingSpace, evidence, score) {
        this._artifact = artifact;
        this._sourceVersion = sourceVersion;
        this._generationId = generationId;
        this._policyId = policyId;
        this._embeddingProfile = embeddingProfile;
        this._embeddingSpace = embeddingSpace;
        this._evidence = evidence;
        this._score = score;
    }
    get artifact() {
        return this._artifact;
    }
    get sourceVersion() {
        return this._sourceVersion;
    }
    get generationId() {
        return this._generationId;
    }
    get policyId() {
        return this._policyId;
    }
    get embeddingProfile() {
        return this._embeddingProfile;
    }
    get embeddingSpace() {
        return this._embeddingSpace;
    }
    get evidence() {
        return this._evidence;
    }
    get score() {
        return this._score;
    }
    toJSON() {
        return {
            artifact: this._artifact,
            sourceVersion: this._sourceVersion,
            generationId: this._generationId,
            policyId: this._policyId,
            embeddingProfile: this._embeddingProfile !== undefined ? this._embeddingProfile : undefined,
            embeddingSpace: this._embeddingSpace !== undefined ? this._embeddingSpace : undefined,
            evidence: this._evidence,
            score: this._score
        };
    }
    with(overrides) {
        return new SearchHit('artifact' in overrides ? overrides.artifact : this._artifact, 'sourceVersion' in overrides ? overrides.sourceVersion : this._sourceVersion, 'generationId' in overrides ? overrides.generationId : this._generationId, 'policyId' in overrides ? overrides.policyId : this._policyId, 'embeddingProfile' in overrides ? overrides.embeddingProfile : this._embeddingProfile, 'embeddingSpace' in overrides ? overrides.embeddingSpace : this._embeddingSpace, 'evidence' in overrides ? overrides.evidence : this._evidence, 'score' in overrides ? overrides.score : this._score);
    }
    static fromPlain(obj) {
        return new SearchHit(obj.artifact, obj.sourceVersion, obj.generationId, obj.policyId, obj.embeddingProfile, obj.embeddingSpace, obj.evidence, obj.score);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return SearchHit.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return SearchHit.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#SearchHit';
    baboonTypeIdentifier() {
        return SearchHit.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return SearchHit.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return SearchHit.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return SearchHit.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return SearchHit_JsonCodec.instance;
    }
}
export class SearchHit_JsonCodec {
    encode(ctx, value) {
        if (this !== SearchHit_JsonCodec.lazyInstance.value) {
            return SearchHit_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "artifact": Artifact_JsonCodec.instance.encode(BaboonCodecContext.Default, value.artifact),
            "sourceVersion": value.sourceVersion,
            "generationId": value.generationId,
            "policyId": value.policyId,
            "embeddingProfile": value.embeddingProfile === undefined ? null : value.embeddingProfile,
            "embeddingSpace": value.embeddingSpace === undefined ? null : value.embeddingSpace,
            "evidence": Array.from(value.evidence).map(item => SearchEvidence_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "score": value.score,
        };
    }
    decode(ctx, json) {
        if (this !== SearchHit_JsonCodec.lazyInstance.value) {
            return SearchHit_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new SearchHit(Artifact_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["artifact"]), obj["sourceVersion"], obj["generationId"], obj["policyId"], obj["embeddingProfile"] === undefined || obj["embeddingProfile"] === null ? undefined : obj["embeddingProfile"] === undefined || obj["embeddingProfile"] === null ? undefined : obj["embeddingProfile"], obj["embeddingSpace"] === undefined || obj["embeddingSpace"] === null ? undefined : obj["embeddingSpace"] === undefined || obj["embeddingSpace"] === null ? undefined : obj["embeddingSpace"], obj["evidence"].map(item => SearchEvidence_JsonCodec.instance.decode(BaboonCodecContext.Default, item)), obj["score"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return SearchHit_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return SearchHit_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#SearchHit';
    baboonTypeIdentifier() {
        return SearchHit_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new SearchHit_JsonCodec());
    static get instance() {
        return SearchHit_JsonCodec.lazyInstance.value;
    }
}
