import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {EvidenceField, EvidenceField_JsonCodec} from './EvidenceField.js'

export class SearchEvidence implements BaboonGeneratedLatest {
    private readonly _field: EvidenceField;
    private readonly _path: string | undefined;
    private readonly _text: string;
    private readonly _score: number;

    constructor(field: EvidenceField, path: string | undefined, text: string, score: number) {
        this._field = field
        this._path = path
        this._text = text
        this._score = score
    }

    public get field(): EvidenceField {
        return this._field;
    }
    public get path(): string | undefined {
        return this._path;
    }
    public get text(): string {
        return this._text;
    }
    public get score(): number {
        return this._score;
    }

    public toJSON(): Record<string, unknown> {
        return {
            field: this._field,
            path: this._path !== undefined ? this._path : undefined,
            text: this._text,
            score: this._score
        };
    }

    public with(overrides: {field?: EvidenceField; path?: string | undefined; text?: string; score?: number}): SearchEvidence {
        return new SearchEvidence(
            'field' in overrides ? overrides.field! : this._field,
            'path' in overrides ? overrides.path! : this._path,
            'text' in overrides ? overrides.text! : this._text,
            'score' in overrides ? overrides.score! : this._score
        );
    }

    public static fromPlain(obj: {field: EvidenceField; path: string | undefined; text: string; score: number}): SearchEvidence {
        return new SearchEvidence(
            obj.field,
            obj.path,
            obj.text,
            obj.score
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchEvidence.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return SearchEvidence.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#SearchEvidence'
    public baboonTypeIdentifier() {
        return SearchEvidence.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return SearchEvidence.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return SearchEvidence.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return SearchEvidence.BaboonMinReaderVersions
    }
    public static jsonCodec(): SearchEvidence_JsonCodec {
        return SearchEvidence_JsonCodec.instance
    }
}

export class SearchEvidence_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchEvidence): unknown {
        if (this !== SearchEvidence_JsonCodec.lazyInstance.value) {
          return SearchEvidence_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "field": EvidenceField_JsonCodec.instance.encode(BaboonCodecContext.Default, value.field),
            "path": value.path === undefined ? null : value.path,
            "text": value.text,
            "score": value.score,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchEvidence {
        if (this !== SearchEvidence_JsonCodec .lazyInstance.value) {
            return SearchEvidence_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SearchEvidence (
            EvidenceField_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["field"]),
            obj["path"] === undefined || obj["path"] === null ? undefined : obj["path"] === undefined || obj["path"] === null ? undefined : obj["path"] as string,
            obj["text"] as string,
            obj["score"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return SearchEvidence_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return SearchEvidence_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#SearchEvidence'
    public baboonTypeIdentifier() {
        return SearchEvidence_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchEvidence_JsonCodec())
    public static get instance(): SearchEvidence_JsonCodec {
        return SearchEvidence_JsonCodec.lazyInstance.value
    }
}