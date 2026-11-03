import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class RetrievedSource implements BaboonGeneratedLatest {
    private readonly _key: string;
    private readonly _revision: number;
    private readonly _pointer: string;
    private readonly _text: string;
    private readonly _score: number;
    private readonly _generation: string;
    private readonly _profile: string | undefined;
    private readonly _embeddingSpace: string | undefined;
    private readonly _policy: string;
    private readonly _field: string;
    private readonly _start: number | undefined;
    private readonly _end: number | undefined;

    constructor(key: string, revision: number, pointer: string, text: string, score: number, generation: string, profile: string | undefined, embeddingSpace: string | undefined, policy: string, field: string, start: number | undefined, end: number | undefined) {
        this._key = key
        this._revision = revision
        this._pointer = pointer
        this._text = text
        this._score = score
        this._generation = generation
        this._profile = profile
        this._embeddingSpace = embeddingSpace
        this._policy = policy
        this._field = field
        this._start = start
        this._end = end
    }

    public get key(): string {
        return this._key;
    }
    public get revision(): number {
        return this._revision;
    }
    public get pointer(): string {
        return this._pointer;
    }
    public get text(): string {
        return this._text;
    }
    public get score(): number {
        return this._score;
    }
    public get generation(): string {
        return this._generation;
    }
    public get profile(): string | undefined {
        return this._profile;
    }
    public get embeddingSpace(): string | undefined {
        return this._embeddingSpace;
    }
    public get policy(): string {
        return this._policy;
    }
    public get field(): string {
        return this._field;
    }
    public get start(): number | undefined {
        return this._start;
    }
    public get end(): number | undefined {
        return this._end;
    }

    public toJSON(): Record<string, unknown> {
        return {
            key: this._key,
            revision: this._revision,
            pointer: this._pointer,
            text: this._text,
            score: this._score,
            generation: this._generation,
            profile: this._profile !== undefined ? this._profile : undefined,
            embeddingSpace: this._embeddingSpace !== undefined ? this._embeddingSpace : undefined,
            policy: this._policy,
            field: this._field,
            start: this._start !== undefined ? this._start : undefined,
            end: this._end !== undefined ? this._end : undefined
        };
    }

    public with(overrides: {key?: string; revision?: number; pointer?: string; text?: string; score?: number; generation?: string; profile?: string | undefined; embeddingSpace?: string | undefined; policy?: string; field?: string; start?: number | undefined; end?: number | undefined}): RetrievedSource {
        return new RetrievedSource(
            'key' in overrides ? overrides.key! : this._key,
            'revision' in overrides ? overrides.revision! : this._revision,
            'pointer' in overrides ? overrides.pointer! : this._pointer,
            'text' in overrides ? overrides.text! : this._text,
            'score' in overrides ? overrides.score! : this._score,
            'generation' in overrides ? overrides.generation! : this._generation,
            'profile' in overrides ? overrides.profile! : this._profile,
            'embeddingSpace' in overrides ? overrides.embeddingSpace! : this._embeddingSpace,
            'policy' in overrides ? overrides.policy! : this._policy,
            'field' in overrides ? overrides.field! : this._field,
            'start' in overrides ? overrides.start! : this._start,
            'end' in overrides ? overrides.end! : this._end
        );
    }

    public static fromPlain(obj: {key: string; revision: number; pointer: string; text: string; score: number; generation: string; profile: string | undefined; embeddingSpace: string | undefined; policy: string; field: string; start: number | undefined; end: number | undefined}): RetrievedSource {
        return new RetrievedSource(
            obj.key,
            obj.revision,
            obj.pointer,
            obj.text,
            obj.score,
            obj.generation,
            obj.profile,
            obj.embeddingSpace,
            obj.policy,
            obj.field,
            obj.start,
            obj.end
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return RetrievedSource.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return RetrievedSource.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#RetrievedSource'
    public baboonTypeIdentifier() {
        return RetrievedSource.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return RetrievedSource.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return RetrievedSource.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return RetrievedSource.BaboonMinReaderVersions
    }
    public static jsonCodec(): RetrievedSource_JsonCodec {
        return RetrievedSource_JsonCodec.instance
    }
}

export class RetrievedSource_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: RetrievedSource): unknown {
        if (this !== RetrievedSource_JsonCodec.lazyInstance.value) {
          return RetrievedSource_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "key": value.key,
            "revision": value.revision,
            "pointer": value.pointer,
            "text": value.text,
            "score": value.score,
            "generation": value.generation,
            "profile": value.profile === undefined ? null : value.profile,
            "embeddingSpace": value.embeddingSpace === undefined ? null : value.embeddingSpace,
            "policy": value.policy,
            "field": value.field,
            "start": value.start === undefined ? null : value.start,
            "end": value.end === undefined ? null : value.end,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): RetrievedSource {
        if (this !== RetrievedSource_JsonCodec .lazyInstance.value) {
            return RetrievedSource_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new RetrievedSource (
            obj["key"] as string,
            obj["revision"] as number,
            obj["pointer"] as string,
            obj["text"] as string,
            obj["score"] as number,
            obj["generation"] as string,
            obj["profile"] === undefined || obj["profile"] === null ? undefined : obj["profile"] === undefined || obj["profile"] === null ? undefined : obj["profile"] as string,
            obj["embeddingSpace"] === undefined || obj["embeddingSpace"] === null ? undefined : obj["embeddingSpace"] === undefined || obj["embeddingSpace"] === null ? undefined : obj["embeddingSpace"] as string,
            obj["policy"] as string,
            obj["field"] as string,
            obj["start"] === undefined || obj["start"] === null ? undefined : obj["start"] === undefined || obj["start"] === null ? undefined : obj["start"] as number,
            obj["end"] === undefined || obj["end"] === null ? undefined : obj["end"] === undefined || obj["end"] === null ? undefined : obj["end"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return RetrievedSource_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'haystack.api'
    public baboonDomainIdentifier() {
        return RetrievedSource_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'haystack.api/:#RetrievedSource'
    public baboonTypeIdentifier() {
        return RetrievedSource_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new RetrievedSource_JsonCodec())
    public static get instance(): RetrievedSource_JsonCodec {
        return RetrievedSource_JsonCodec.lazyInstance.value
    }
}