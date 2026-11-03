import { BaboonCodecContext, Lazy } from '../../BaboonSharedRuntime.js';
import { EvidenceField_JsonCodec } from './EvidenceField.js';
export class SearchEvidence {
    _field;
    _path;
    _text;
    _score;
    constructor(field, path, text, score) {
        this._field = field;
        this._path = path;
        this._text = text;
        this._score = score;
    }
    get field() {
        return this._field;
    }
    get path() {
        return this._path;
    }
    get text() {
        return this._text;
    }
    get score() {
        return this._score;
    }
    toJSON() {
        return {
            field: this._field,
            path: this._path !== undefined ? this._path : undefined,
            text: this._text,
            score: this._score
        };
    }
    with(overrides) {
        return new SearchEvidence('field' in overrides ? overrides.field : this._field, 'path' in overrides ? overrides.path : this._path, 'text' in overrides ? overrides.text : this._text, 'score' in overrides ? overrides.score : this._score);
    }
    static fromPlain(obj) {
        return new SearchEvidence(obj.field, obj.path, obj.text, obj.score);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return SearchEvidence.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return SearchEvidence.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#SearchEvidence';
    baboonTypeIdentifier() {
        return SearchEvidence.BaboonTypeIdentifier;
    }
    static BaboonSameInVersions = ["1.0.0"];
    baboonSameInVersions() {
        return SearchEvidence.BaboonSameInVersions;
    }
    static BaboonForwardReadable = { "1.0.0": "identical" };
    baboonForwardReadable() {
        return SearchEvidence.BaboonForwardReadable;
    }
    static BaboonMinReaderVersions = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" };
    baboonMinReaderVersions() {
        return SearchEvidence.BaboonMinReaderVersions;
    }
    static jsonCodec() {
        return SearchEvidence_JsonCodec.instance;
    }
}
export class SearchEvidence_JsonCodec {
    encode(ctx, value) {
        if (this !== SearchEvidence_JsonCodec.lazyInstance.value) {
            return SearchEvidence_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return {
            "field": EvidenceField_JsonCodec.instance.encode(BaboonCodecContext.Default, value.field),
            "path": value.path === undefined ? null : value.path,
            "text": value.text,
            "score": value.score,
        };
    }
    decode(ctx, json) {
        if (this !== SearchEvidence_JsonCodec.lazyInstance.value) {
            return SearchEvidence_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        const obj = json;
        return new SearchEvidence(EvidenceField_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["field"]), obj["path"] === undefined || obj["path"] === null ? undefined : obj["path"] === undefined || obj["path"] === null ? undefined : obj["path"], obj["text"], obj["score"]);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return SearchEvidence_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return SearchEvidence_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#SearchEvidence';
    baboonTypeIdentifier() {
        return SearchEvidence_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new SearchEvidence_JsonCodec());
    static get instance() {
        return SearchEvidence_JsonCodec.lazyInstance.value;
    }
}
