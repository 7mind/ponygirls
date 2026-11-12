import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export type PresentedSelection = PresentedSelection_Whole | PresentedSelection_Alternative

export const PresentedSelection = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#PresentedSelection',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#PresentedSelection',
    jsonCodec(): PresentedSelection_JsonCodec {
        return PresentedSelection_JsonCodec.instance
    }
} as const

export class PresentedSelection_Whole implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#PresentedSelection]#Whole' as const;
    private readonly _target: Ref;

    constructor(target: Ref) {
        this._target = target
    }

    public get target(): Ref {
        return this._target;
    }

    public toJSON(): Record<string, unknown> {
        return {
            target: this._target
        };
    }

    public with(overrides: {target?: Ref}): PresentedSelection_Whole {
        return new PresentedSelection_Whole(
            'target' in overrides ? overrides.target! : this._target
        );
    }

    public static fromPlain(obj: {target: Ref}): PresentedSelection_Whole {
        return new PresentedSelection_Whole(
            obj.target
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentedSelection_Whole.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentedSelection_Whole.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#PresentedSelection]#Whole'
    public baboonTypeIdentifier() {
        return PresentedSelection_Whole.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return PresentedSelection_Whole.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return PresentedSelection_Whole.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return PresentedSelection_Whole.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#PresentedSelection'
    public baboonAdtTypeIdentifier() {
        return PresentedSelection_Whole.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): PresentedSelection_Whole_JsonCodec {
        return PresentedSelection_Whole_JsonCodec.instance
    }
}

export class PresentedSelection_Whole_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PresentedSelection_Whole): unknown {
        if (this !== PresentedSelection_Whole_JsonCodec.lazyInstance.value) {
          return PresentedSelection_Whole_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "target": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.target),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PresentedSelection_Whole {
        if (this !== PresentedSelection_Whole_JsonCodec .lazyInstance.value) {
            return PresentedSelection_Whole_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PresentedSelection_Whole (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["target"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentedSelection_Whole_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentedSelection_Whole_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#PresentedSelection]#Whole'
    public baboonTypeIdentifier() {
        return PresentedSelection_Whole_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#PresentedSelection'
    public baboonAdtTypeIdentifier() {
        return PresentedSelection_Whole_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PresentedSelection_Whole_JsonCodec())
    public static get instance(): PresentedSelection_Whole_JsonCodec {
        return PresentedSelection_Whole_JsonCodec.lazyInstance.value
    }
}

export class PresentedSelection_Alternative implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#PresentedSelection]#Alternative' as const;
    private readonly _target: Ref;
    private readonly _definition: Ref;
    private readonly _index: number;
    private readonly _label: string;

    constructor(target: Ref, definition: Ref, index: number, label: string) {
        this._target = target
        this._definition = definition
        this._index = index
        this._label = label
    }

    public get target(): Ref {
        return this._target;
    }
    public get definition(): Ref {
        return this._definition;
    }
    public get index(): number {
        return this._index;
    }
    public get label(): string {
        return this._label;
    }

    public toJSON(): Record<string, unknown> {
        return {
            target: this._target,
            definition: this._definition,
            index: this._index,
            label: this._label
        };
    }

    public with(overrides: {target?: Ref; definition?: Ref; index?: number; label?: string}): PresentedSelection_Alternative {
        return new PresentedSelection_Alternative(
            'target' in overrides ? overrides.target! : this._target,
            'definition' in overrides ? overrides.definition! : this._definition,
            'index' in overrides ? overrides.index! : this._index,
            'label' in overrides ? overrides.label! : this._label
        );
    }

    public static fromPlain(obj: {target: Ref; definition: Ref; index: number; label: string}): PresentedSelection_Alternative {
        return new PresentedSelection_Alternative(
            obj.target,
            obj.definition,
            obj.index,
            obj.label
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentedSelection_Alternative.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentedSelection_Alternative.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#PresentedSelection]#Alternative'
    public baboonTypeIdentifier() {
        return PresentedSelection_Alternative.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return PresentedSelection_Alternative.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return PresentedSelection_Alternative.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return PresentedSelection_Alternative.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#PresentedSelection'
    public baboonAdtTypeIdentifier() {
        return PresentedSelection_Alternative.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): PresentedSelection_Alternative_JsonCodec {
        return PresentedSelection_Alternative_JsonCodec.instance
    }
}

export class PresentedSelection_Alternative_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PresentedSelection_Alternative): unknown {
        if (this !== PresentedSelection_Alternative_JsonCodec.lazyInstance.value) {
          return PresentedSelection_Alternative_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "target": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.target),
            "definition": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.definition),
            "index": value.index,
            "label": value.label,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PresentedSelection_Alternative {
        if (this !== PresentedSelection_Alternative_JsonCodec .lazyInstance.value) {
            return PresentedSelection_Alternative_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PresentedSelection_Alternative (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["target"]),
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["definition"]),
            obj["index"] as number,
            obj["label"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentedSelection_Alternative_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentedSelection_Alternative_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#PresentedSelection]#Alternative'
    public baboonTypeIdentifier() {
        return PresentedSelection_Alternative_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#PresentedSelection'
    public baboonAdtTypeIdentifier() {
        return PresentedSelection_Alternative_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PresentedSelection_Alternative_JsonCodec())
    public static get instance(): PresentedSelection_Alternative_JsonCodec {
        return PresentedSelection_Alternative_JsonCodec.lazyInstance.value
    }
}


export class PresentedSelection_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PresentedSelection): unknown {
        if (this !== PresentedSelection_JsonCodec.lazyInstance.value) {
          return PresentedSelection_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof PresentedSelection_Whole) {
                return { "Whole": PresentedSelection_Whole_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof PresentedSelection_Alternative) {
                return { "Alternative": PresentedSelection_Alternative_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PresentedSelection {
        if (this !== PresentedSelection_JsonCodec .lazyInstance.value) {
            return PresentedSelection_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Whole": return PresentedSelection_Whole_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Alternative": return PresentedSelection_Alternative_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentedSelection_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentedSelection_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#PresentedSelection'
    public baboonTypeIdentifier() {
        return PresentedSelection_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#PresentedSelection'
    public baboonAdtTypeIdentifier() {
        return PresentedSelection_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PresentedSelection_JsonCodec())
    public static get instance(): PresentedSelection_JsonCodec {
        return PresentedSelection_JsonCodec.lazyInstance.value
    }
}