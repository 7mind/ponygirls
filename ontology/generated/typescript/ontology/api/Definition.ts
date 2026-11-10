import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Content, Content_JsonCodec} from './Content.js'
import {Provenance, Provenance_JsonCodec} from './Provenance.js'
import {Ref, Ref_JsonCodec} from './Ref.js'
import {Standing, Standing_JsonCodec} from './Standing.js'

export class Definition implements BaboonGeneratedLatest {
    private readonly _ref: Ref;
    private readonly _scope: string;
    private readonly _content: Content;
    private readonly _standing: Standing;
    private readonly _basis: Array<Ref>;
    private readonly _changeReason: string | undefined;
    private readonly _provenance: Provenance;

    constructor(ref: Ref, scope: string, content: Content, standing: Standing, basis: Array<Ref>, changeReason: string | undefined, provenance: Provenance) {
        this._ref = ref
        this._scope = scope
        this._content = content
        this._standing = standing
        this._basis = basis
        this._changeReason = changeReason
        this._provenance = provenance
    }

    public get ref(): Ref {
        return this._ref;
    }
    public get scope(): string {
        return this._scope;
    }
    public get content(): Content {
        return this._content;
    }
    public get standing(): Standing {
        return this._standing;
    }
    public get basis(): Array<Ref> {
        return this._basis;
    }
    public get changeReason(): string | undefined {
        return this._changeReason;
    }
    public get provenance(): Provenance {
        return this._provenance;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ref: this._ref,
            scope: this._scope,
            content: this._content,
            standing: this._standing,
            basis: this._basis,
            changeReason: this._changeReason !== undefined ? this._changeReason : undefined,
            provenance: this._provenance
        };
    }

    public with(overrides: {ref?: Ref; scope?: string; content?: Content; standing?: Standing; basis?: Array<Ref>; changeReason?: string | undefined; provenance?: Provenance}): Definition {
        return new Definition(
            'ref' in overrides ? overrides.ref! : this._ref,
            'scope' in overrides ? overrides.scope! : this._scope,
            'content' in overrides ? overrides.content! : this._content,
            'standing' in overrides ? overrides.standing! : this._standing,
            'basis' in overrides ? overrides.basis! : this._basis,
            'changeReason' in overrides ? overrides.changeReason! : this._changeReason,
            'provenance' in overrides ? overrides.provenance! : this._provenance
        );
    }

    public static fromPlain(obj: {ref: Ref; scope: string; content: Content; standing: Standing; basis: Array<Ref>; changeReason: string | undefined; provenance: Provenance}): Definition {
        return new Definition(
            obj.ref,
            obj.scope,
            obj.content,
            obj.standing,
            obj.basis,
            obj.changeReason,
            obj.provenance
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Definition.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Definition.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Definition'
    public baboonTypeIdentifier() {
        return Definition.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Definition.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Definition.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Definition.BaboonMinReaderVersions
    }
    public static jsonCodec(): Definition_JsonCodec {
        return Definition_JsonCodec.instance
    }
}

export class Definition_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Definition): unknown {
        if (this !== Definition_JsonCodec.lazyInstance.value) {
          return Definition_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
            "scope": value.scope,
            "content": Content_JsonCodec.instance.encode(BaboonCodecContext.Default, value.content),
            "standing": Standing_JsonCodec.instance.encode(BaboonCodecContext.Default, value.standing),
            "basis": Array.from(value.basis).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "changeReason": value.changeReason === undefined ? null : value.changeReason,
            "provenance": Provenance_JsonCodec.instance.encode(BaboonCodecContext.Default, value.provenance),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Definition {
        if (this !== Definition_JsonCodec .lazyInstance.value) {
            return Definition_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Definition (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
            obj["scope"] as string,
            Content_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["content"]),
            Standing_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["standing"]),
            (obj["basis"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["changeReason"] === undefined || obj["changeReason"] === null ? undefined : obj["changeReason"] === undefined || obj["changeReason"] === null ? undefined : obj["changeReason"] as string,
            Provenance_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["provenance"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Definition_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Definition_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Definition'
    public baboonTypeIdentifier() {
        return Definition_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Definition_JsonCodec())
    public static get instance(): Definition_JsonCodec {
        return Definition_JsonCodec.lazyInstance.value
    }
}