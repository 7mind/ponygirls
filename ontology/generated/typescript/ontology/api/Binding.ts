import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Provenance, Provenance_JsonCodec} from './Provenance.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class Binding implements BaboonGeneratedLatest {
    private readonly _ref: Ref;
    private readonly _scope: string;
    private readonly _definition: Ref;
    private readonly _context: Array<Ref>;
    private readonly _provenance: Provenance;

    constructor(ref: Ref, scope: string, definition: Ref, context: Array<Ref>, provenance: Provenance) {
        this._ref = ref
        this._scope = scope
        this._definition = definition
        this._context = context
        this._provenance = provenance
    }

    public get ref(): Ref {
        return this._ref;
    }
    public get scope(): string {
        return this._scope;
    }
    public get definition(): Ref {
        return this._definition;
    }
    public get context(): Array<Ref> {
        return this._context;
    }
    public get provenance(): Provenance {
        return this._provenance;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ref: this._ref,
            scope: this._scope,
            definition: this._definition,
            context: this._context,
            provenance: this._provenance
        };
    }

    public with(overrides: {ref?: Ref; scope?: string; definition?: Ref; context?: Array<Ref>; provenance?: Provenance}): Binding {
        return new Binding(
            'ref' in overrides ? overrides.ref! : this._ref,
            'scope' in overrides ? overrides.scope! : this._scope,
            'definition' in overrides ? overrides.definition! : this._definition,
            'context' in overrides ? overrides.context! : this._context,
            'provenance' in overrides ? overrides.provenance! : this._provenance
        );
    }

    public static fromPlain(obj: {ref: Ref; scope: string; definition: Ref; context: Array<Ref>; provenance: Provenance}): Binding {
        return new Binding(
            obj.ref,
            obj.scope,
            obj.definition,
            obj.context,
            obj.provenance
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Binding.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Binding.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Binding'
    public baboonTypeIdentifier() {
        return Binding.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Binding.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Binding.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Binding.BaboonMinReaderVersions
    }
    public static jsonCodec(): Binding_JsonCodec {
        return Binding_JsonCodec.instance
    }
}

export class Binding_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Binding): unknown {
        if (this !== Binding_JsonCodec.lazyInstance.value) {
          return Binding_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
            "scope": value.scope,
            "definition": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.definition),
            "context": Array.from(value.context).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "provenance": Provenance_JsonCodec.instance.encode(BaboonCodecContext.Default, value.provenance),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Binding {
        if (this !== Binding_JsonCodec .lazyInstance.value) {
            return Binding_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Binding (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
            obj["scope"] as string,
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["definition"]),
            (obj["context"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            Provenance_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["provenance"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Binding_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Binding_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Binding'
    public baboonTypeIdentifier() {
        return Binding_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Binding_JsonCodec())
    public static get instance(): Binding_JsonCodec {
        return Binding_JsonCodec.lazyInstance.value
    }
}