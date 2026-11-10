import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'
import {Standing, Standing_JsonCodec} from './Standing.js'

export class SearchHit implements BaboonGeneratedLatest {
    private readonly _ref: Ref;
    private readonly _kind: string;
    private readonly _text: string;
    private readonly _standing: Standing;

    constructor(ref: Ref, kind: string, text: string, standing: Standing) {
        this._ref = ref
        this._kind = kind
        this._text = text
        this._standing = standing
    }

    public get ref(): Ref {
        return this._ref;
    }
    public get kind(): string {
        return this._kind;
    }
    public get text(): string {
        return this._text;
    }
    public get standing(): Standing {
        return this._standing;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ref: this._ref,
            kind: this._kind,
            text: this._text,
            standing: this._standing
        };
    }

    public with(overrides: {ref?: Ref; kind?: string; text?: string; standing?: Standing}): SearchHit {
        return new SearchHit(
            'ref' in overrides ? overrides.ref! : this._ref,
            'kind' in overrides ? overrides.kind! : this._kind,
            'text' in overrides ? overrides.text! : this._text,
            'standing' in overrides ? overrides.standing! : this._standing
        );
    }

    public static fromPlain(obj: {ref: Ref; kind: string; text: string; standing: Standing}): SearchHit {
        return new SearchHit(
            obj.ref,
            obj.kind,
            obj.text,
            obj.standing
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SearchHit.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return SearchHit.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#SearchHit'
    public baboonTypeIdentifier() {
        return SearchHit.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return SearchHit.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return SearchHit.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return SearchHit.BaboonMinReaderVersions
    }
    public static jsonCodec(): SearchHit_JsonCodec {
        return SearchHit_JsonCodec.instance
    }
}

export class SearchHit_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SearchHit): unknown {
        if (this !== SearchHit_JsonCodec.lazyInstance.value) {
          return SearchHit_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
            "kind": value.kind,
            "text": value.text,
            "standing": Standing_JsonCodec.instance.encode(BaboonCodecContext.Default, value.standing),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SearchHit {
        if (this !== SearchHit_JsonCodec .lazyInstance.value) {
            return SearchHit_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SearchHit (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
            obj["kind"] as string,
            obj["text"] as string,
            Standing_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["standing"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SearchHit_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return SearchHit_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#SearchHit'
    public baboonTypeIdentifier() {
        return SearchHit_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SearchHit_JsonCodec())
    public static get instance(): SearchHit_JsonCodec {
        return SearchHit_JsonCodec.lazyInstance.value
    }
}