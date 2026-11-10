import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Actor, Actor_JsonCodec} from './Actor.js'

export class Provenance implements BaboonGeneratedLatest {
    private readonly _contributor: Actor;
    private readonly _recorder: Actor;
    private readonly _input: string;
    private readonly _recordedAt: string;

    constructor(contributor: Actor, recorder: Actor, input: string, recordedAt: string) {
        this._contributor = contributor
        this._recorder = recorder
        this._input = input
        this._recordedAt = recordedAt
    }

    public get contributor(): Actor {
        return this._contributor;
    }
    public get recorder(): Actor {
        return this._recorder;
    }
    public get input(): string {
        return this._input;
    }
    public get recordedAt(): string {
        return this._recordedAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            contributor: this._contributor,
            recorder: this._recorder,
            input: this._input,
            recordedAt: this._recordedAt
        };
    }

    public with(overrides: {contributor?: Actor; recorder?: Actor; input?: string; recordedAt?: string}): Provenance {
        return new Provenance(
            'contributor' in overrides ? overrides.contributor! : this._contributor,
            'recorder' in overrides ? overrides.recorder! : this._recorder,
            'input' in overrides ? overrides.input! : this._input,
            'recordedAt' in overrides ? overrides.recordedAt! : this._recordedAt
        );
    }

    public static fromPlain(obj: {contributor: Actor; recorder: Actor; input: string; recordedAt: string}): Provenance {
        return new Provenance(
            obj.contributor,
            obj.recorder,
            obj.input,
            obj.recordedAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Provenance.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Provenance.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Provenance'
    public baboonTypeIdentifier() {
        return Provenance.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Provenance.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Provenance.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Provenance.BaboonMinReaderVersions
    }
    public static jsonCodec(): Provenance_JsonCodec {
        return Provenance_JsonCodec.instance
    }
}

export class Provenance_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Provenance): unknown {
        if (this !== Provenance_JsonCodec.lazyInstance.value) {
          return Provenance_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "contributor": Actor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.contributor),
            "recorder": Actor_JsonCodec.instance.encode(BaboonCodecContext.Default, value.recorder),
            "input": value.input,
            "recordedAt": value.recordedAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Provenance {
        if (this !== Provenance_JsonCodec .lazyInstance.value) {
            return Provenance_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Provenance (
            Actor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["contributor"]),
            Actor_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["recorder"]),
            obj["input"] as string,
            obj["recordedAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Provenance_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Provenance_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Provenance'
    public baboonTypeIdentifier() {
        return Provenance_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Provenance_JsonCodec())
    public static get instance(): Provenance_JsonCodec {
        return Provenance_JsonCodec.lazyInstance.value
    }
}