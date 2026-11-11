import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Provenance, Provenance_JsonCodec} from './Provenance.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class BindingSelection implements BaboonGeneratedLatest {
    private readonly _ref: Ref;
    private readonly _scope: string;
    private readonly _binding: Ref;
    private readonly _selected: boolean;
    private readonly _reason: string;
    private readonly _basis: Array<Ref>;
    private readonly _provenance: Provenance;

    constructor(ref: Ref, scope: string, binding: Ref, selected: boolean, reason: string, basis: Array<Ref>, provenance: Provenance) {
        this._ref = ref
        this._scope = scope
        this._binding = binding
        this._selected = selected
        this._reason = reason
        this._basis = basis
        this._provenance = provenance
    }

    public get ref(): Ref {
        return this._ref;
    }
    public get scope(): string {
        return this._scope;
    }
    public get binding(): Ref {
        return this._binding;
    }
    public get selected(): boolean {
        return this._selected;
    }
    public get reason(): string {
        return this._reason;
    }
    public get basis(): Array<Ref> {
        return this._basis;
    }
    public get provenance(): Provenance {
        return this._provenance;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ref: this._ref,
            scope: this._scope,
            binding: this._binding,
            selected: this._selected,
            reason: this._reason,
            basis: this._basis,
            provenance: this._provenance
        };
    }

    public with(overrides: {ref?: Ref; scope?: string; binding?: Ref; selected?: boolean; reason?: string; basis?: Array<Ref>; provenance?: Provenance}): BindingSelection {
        return new BindingSelection(
            'ref' in overrides ? overrides.ref! : this._ref,
            'scope' in overrides ? overrides.scope! : this._scope,
            'binding' in overrides ? overrides.binding! : this._binding,
            'selected' in overrides ? overrides.selected! : this._selected,
            'reason' in overrides ? overrides.reason! : this._reason,
            'basis' in overrides ? overrides.basis! : this._basis,
            'provenance' in overrides ? overrides.provenance! : this._provenance
        );
    }

    public static fromPlain(obj: {ref: Ref; scope: string; binding: Ref; selected: boolean; reason: string; basis: Array<Ref>; provenance: Provenance}): BindingSelection {
        return new BindingSelection(
            obj.ref,
            obj.scope,
            obj.binding,
            obj.selected,
            obj.reason,
            obj.basis,
            obj.provenance
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return BindingSelection.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return BindingSelection.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#BindingSelection'
    public baboonTypeIdentifier() {
        return BindingSelection.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return BindingSelection.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return BindingSelection.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return BindingSelection.BaboonMinReaderVersions
    }
    public static jsonCodec(): BindingSelection_JsonCodec {
        return BindingSelection_JsonCodec.instance
    }
}

export class BindingSelection_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: BindingSelection): unknown {
        if (this !== BindingSelection_JsonCodec.lazyInstance.value) {
          return BindingSelection_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
            "scope": value.scope,
            "binding": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.binding),
            "selected": value.selected,
            "reason": value.reason,
            "basis": Array.from(value.basis).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "provenance": Provenance_JsonCodec.instance.encode(BaboonCodecContext.Default, value.provenance),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): BindingSelection {
        if (this !== BindingSelection_JsonCodec .lazyInstance.value) {
            return BindingSelection_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new BindingSelection (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
            obj["scope"] as string,
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["binding"]),
            obj["selected"] as boolean,
            obj["reason"] as string,
            (obj["basis"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            Provenance_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["provenance"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return BindingSelection_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return BindingSelection_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#BindingSelection'
    public baboonTypeIdentifier() {
        return BindingSelection_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new BindingSelection_JsonCodec())
    public static get instance(): BindingSelection_JsonCodec {
        return BindingSelection_JsonCodec.lazyInstance.value
    }
}