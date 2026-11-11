import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Target, Target_JsonCodec} from './Target.js'

export type PresentedSelectionInput = PresentedSelectionInput_Whole | PresentedSelectionInput_Alternative

export const PresentedSelectionInput = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#PresentedSelectionInput',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#PresentedSelectionInput',
    jsonCodec(): PresentedSelectionInput_JsonCodec {
        return PresentedSelectionInput_JsonCodec.instance
    }
} as const

export class PresentedSelectionInput_Whole implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#PresentedSelectionInput]#Whole' as const;
    private readonly _target: Target;

    constructor(target: Target) {
        this._target = target
    }

    public get target(): Target {
        return this._target;
    }

    public toJSON(): Record<string, unknown> {
        return {
            target: this._target
        };
    }

    public with(overrides: {target?: Target}): PresentedSelectionInput_Whole {
        return new PresentedSelectionInput_Whole(
            'target' in overrides ? overrides.target! : this._target
        );
    }

    public static fromPlain(obj: {target: Target}): PresentedSelectionInput_Whole {
        return new PresentedSelectionInput_Whole(
            obj.target
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentedSelectionInput_Whole.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentedSelectionInput_Whole.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#PresentedSelectionInput]#Whole'
    public baboonTypeIdentifier() {
        return PresentedSelectionInput_Whole.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return PresentedSelectionInput_Whole.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return PresentedSelectionInput_Whole.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return PresentedSelectionInput_Whole.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#PresentedSelectionInput'
    public baboonAdtTypeIdentifier() {
        return PresentedSelectionInput_Whole.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): PresentedSelectionInput_Whole_JsonCodec {
        return PresentedSelectionInput_Whole_JsonCodec.instance
    }
}

export class PresentedSelectionInput_Whole_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PresentedSelectionInput_Whole): unknown {
        if (this !== PresentedSelectionInput_Whole_JsonCodec.lazyInstance.value) {
          return PresentedSelectionInput_Whole_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "target": Target_JsonCodec.instance.encode(BaboonCodecContext.Default, value.target),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PresentedSelectionInput_Whole {
        if (this !== PresentedSelectionInput_Whole_JsonCodec .lazyInstance.value) {
            return PresentedSelectionInput_Whole_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PresentedSelectionInput_Whole (
            Target_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["target"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentedSelectionInput_Whole_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentedSelectionInput_Whole_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#PresentedSelectionInput]#Whole'
    public baboonTypeIdentifier() {
        return PresentedSelectionInput_Whole_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#PresentedSelectionInput'
    public baboonAdtTypeIdentifier() {
        return PresentedSelectionInput_Whole_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PresentedSelectionInput_Whole_JsonCodec())
    public static get instance(): PresentedSelectionInput_Whole_JsonCodec {
        return PresentedSelectionInput_Whole_JsonCodec.lazyInstance.value
    }
}

export class PresentedSelectionInput_Alternative implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#PresentedSelectionInput]#Alternative' as const;
    private readonly _target: Target;
    private readonly _definition: Target;
    private readonly _index: number;
    private readonly _label: string;

    constructor(target: Target, definition: Target, index: number, label: string) {
        this._target = target
        this._definition = definition
        this._index = index
        this._label = label
    }

    public get target(): Target {
        return this._target;
    }
    public get definition(): Target {
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

    public with(overrides: {target?: Target; definition?: Target; index?: number; label?: string}): PresentedSelectionInput_Alternative {
        return new PresentedSelectionInput_Alternative(
            'target' in overrides ? overrides.target! : this._target,
            'definition' in overrides ? overrides.definition! : this._definition,
            'index' in overrides ? overrides.index! : this._index,
            'label' in overrides ? overrides.label! : this._label
        );
    }

    public static fromPlain(obj: {target: Target; definition: Target; index: number; label: string}): PresentedSelectionInput_Alternative {
        return new PresentedSelectionInput_Alternative(
            obj.target,
            obj.definition,
            obj.index,
            obj.label
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentedSelectionInput_Alternative.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentedSelectionInput_Alternative.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#PresentedSelectionInput]#Alternative'
    public baboonTypeIdentifier() {
        return PresentedSelectionInput_Alternative.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return PresentedSelectionInput_Alternative.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return PresentedSelectionInput_Alternative.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return PresentedSelectionInput_Alternative.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#PresentedSelectionInput'
    public baboonAdtTypeIdentifier() {
        return PresentedSelectionInput_Alternative.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): PresentedSelectionInput_Alternative_JsonCodec {
        return PresentedSelectionInput_Alternative_JsonCodec.instance
    }
}

export class PresentedSelectionInput_Alternative_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PresentedSelectionInput_Alternative): unknown {
        if (this !== PresentedSelectionInput_Alternative_JsonCodec.lazyInstance.value) {
          return PresentedSelectionInput_Alternative_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "target": Target_JsonCodec.instance.encode(BaboonCodecContext.Default, value.target),
            "definition": Target_JsonCodec.instance.encode(BaboonCodecContext.Default, value.definition),
            "index": value.index,
            "label": value.label,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PresentedSelectionInput_Alternative {
        if (this !== PresentedSelectionInput_Alternative_JsonCodec .lazyInstance.value) {
            return PresentedSelectionInput_Alternative_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PresentedSelectionInput_Alternative (
            Target_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["target"]),
            Target_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["definition"]),
            obj["index"] as number,
            obj["label"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentedSelectionInput_Alternative_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentedSelectionInput_Alternative_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#PresentedSelectionInput]#Alternative'
    public baboonTypeIdentifier() {
        return PresentedSelectionInput_Alternative_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#PresentedSelectionInput'
    public baboonAdtTypeIdentifier() {
        return PresentedSelectionInput_Alternative_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PresentedSelectionInput_Alternative_JsonCodec())
    public static get instance(): PresentedSelectionInput_Alternative_JsonCodec {
        return PresentedSelectionInput_Alternative_JsonCodec.lazyInstance.value
    }
}


export class PresentedSelectionInput_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PresentedSelectionInput): unknown {
        if (this !== PresentedSelectionInput_JsonCodec.lazyInstance.value) {
          return PresentedSelectionInput_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof PresentedSelectionInput_Whole) {
                return { "Whole": PresentedSelectionInput_Whole_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof PresentedSelectionInput_Alternative) {
                return { "Alternative": PresentedSelectionInput_Alternative_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PresentedSelectionInput {
        if (this !== PresentedSelectionInput_JsonCodec .lazyInstance.value) {
            return PresentedSelectionInput_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "Whole": return PresentedSelectionInput_Whole_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Alternative": return PresentedSelectionInput_Alternative_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentedSelectionInput_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentedSelectionInput_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#PresentedSelectionInput'
    public baboonTypeIdentifier() {
        return PresentedSelectionInput_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#PresentedSelectionInput'
    public baboonAdtTypeIdentifier() {
        return PresentedSelectionInput_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PresentedSelectionInput_JsonCodec())
    public static get instance(): PresentedSelectionInput_JsonCodec {
        return PresentedSelectionInput_JsonCodec.lazyInstance.value
    }
}