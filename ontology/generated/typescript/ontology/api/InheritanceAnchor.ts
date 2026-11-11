import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export type InheritanceAnchor = InheritanceAnchor_ReportedEpoch | InheritanceAnchor_ReportedParent

export const InheritanceAnchor = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#InheritanceAnchor',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#InheritanceAnchor',
    jsonCodec(): InheritanceAnchor_JsonCodec {
        return InheritanceAnchor_JsonCodec.instance
    }
} as const

export class InheritanceAnchor_ReportedEpoch implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#InheritanceAnchor]#ReportedEpoch' as const;
    private readonly _source: Ref;
    private readonly _epoch: string;

    constructor(source: Ref, epoch: string) {
        this._source = source
        this._epoch = epoch
    }

    public get source(): Ref {
        return this._source;
    }
    public get epoch(): string {
        return this._epoch;
    }

    public toJSON(): Record<string, unknown> {
        return {
            source: this._source,
            epoch: this._epoch
        };
    }

    public with(overrides: {source?: Ref; epoch?: string}): InheritanceAnchor_ReportedEpoch {
        return new InheritanceAnchor_ReportedEpoch(
            'source' in overrides ? overrides.source! : this._source,
            'epoch' in overrides ? overrides.epoch! : this._epoch
        );
    }

    public static fromPlain(obj: {source: Ref; epoch: string}): InheritanceAnchor_ReportedEpoch {
        return new InheritanceAnchor_ReportedEpoch(
            obj.source,
            obj.epoch
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return InheritanceAnchor_ReportedEpoch.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return InheritanceAnchor_ReportedEpoch.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#InheritanceAnchor]#ReportedEpoch'
    public baboonTypeIdentifier() {
        return InheritanceAnchor_ReportedEpoch.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return InheritanceAnchor_ReportedEpoch.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return InheritanceAnchor_ReportedEpoch.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return InheritanceAnchor_ReportedEpoch.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#InheritanceAnchor'
    public baboonAdtTypeIdentifier() {
        return InheritanceAnchor_ReportedEpoch.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): InheritanceAnchor_ReportedEpoch_JsonCodec {
        return InheritanceAnchor_ReportedEpoch_JsonCodec.instance
    }
}

export class InheritanceAnchor_ReportedEpoch_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: InheritanceAnchor_ReportedEpoch): unknown {
        if (this !== InheritanceAnchor_ReportedEpoch_JsonCodec.lazyInstance.value) {
          return InheritanceAnchor_ReportedEpoch_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "source": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.source),
            "epoch": value.epoch,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): InheritanceAnchor_ReportedEpoch {
        if (this !== InheritanceAnchor_ReportedEpoch_JsonCodec .lazyInstance.value) {
            return InheritanceAnchor_ReportedEpoch_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new InheritanceAnchor_ReportedEpoch (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["source"]),
            obj["epoch"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return InheritanceAnchor_ReportedEpoch_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return InheritanceAnchor_ReportedEpoch_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#InheritanceAnchor]#ReportedEpoch'
    public baboonTypeIdentifier() {
        return InheritanceAnchor_ReportedEpoch_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#InheritanceAnchor'
    public baboonAdtTypeIdentifier() {
        return InheritanceAnchor_ReportedEpoch_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new InheritanceAnchor_ReportedEpoch_JsonCodec())
    public static get instance(): InheritanceAnchor_ReportedEpoch_JsonCodec {
        return InheritanceAnchor_ReportedEpoch_JsonCodec.lazyInstance.value
    }
}

export class InheritanceAnchor_ReportedParent implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#InheritanceAnchor]#ReportedParent' as const;
    private readonly _source: Ref;
    private readonly _epoch: string;

    constructor(source: Ref, epoch: string) {
        this._source = source
        this._epoch = epoch
    }

    public get source(): Ref {
        return this._source;
    }
    public get epoch(): string {
        return this._epoch;
    }

    public toJSON(): Record<string, unknown> {
        return {
            source: this._source,
            epoch: this._epoch
        };
    }

    public with(overrides: {source?: Ref; epoch?: string}): InheritanceAnchor_ReportedParent {
        return new InheritanceAnchor_ReportedParent(
            'source' in overrides ? overrides.source! : this._source,
            'epoch' in overrides ? overrides.epoch! : this._epoch
        );
    }

    public static fromPlain(obj: {source: Ref; epoch: string}): InheritanceAnchor_ReportedParent {
        return new InheritanceAnchor_ReportedParent(
            obj.source,
            obj.epoch
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return InheritanceAnchor_ReportedParent.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return InheritanceAnchor_ReportedParent.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#InheritanceAnchor]#ReportedParent'
    public baboonTypeIdentifier() {
        return InheritanceAnchor_ReportedParent.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return InheritanceAnchor_ReportedParent.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return InheritanceAnchor_ReportedParent.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return InheritanceAnchor_ReportedParent.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#InheritanceAnchor'
    public baboonAdtTypeIdentifier() {
        return InheritanceAnchor_ReportedParent.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): InheritanceAnchor_ReportedParent_JsonCodec {
        return InheritanceAnchor_ReportedParent_JsonCodec.instance
    }
}

export class InheritanceAnchor_ReportedParent_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: InheritanceAnchor_ReportedParent): unknown {
        if (this !== InheritanceAnchor_ReportedParent_JsonCodec.lazyInstance.value) {
          return InheritanceAnchor_ReportedParent_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "source": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.source),
            "epoch": value.epoch,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): InheritanceAnchor_ReportedParent {
        if (this !== InheritanceAnchor_ReportedParent_JsonCodec .lazyInstance.value) {
            return InheritanceAnchor_ReportedParent_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new InheritanceAnchor_ReportedParent (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["source"]),
            obj["epoch"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return InheritanceAnchor_ReportedParent_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return InheritanceAnchor_ReportedParent_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#InheritanceAnchor]#ReportedParent'
    public baboonTypeIdentifier() {
        return InheritanceAnchor_ReportedParent_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#InheritanceAnchor'
    public baboonAdtTypeIdentifier() {
        return InheritanceAnchor_ReportedParent_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new InheritanceAnchor_ReportedParent_JsonCodec())
    public static get instance(): InheritanceAnchor_ReportedParent_JsonCodec {
        return InheritanceAnchor_ReportedParent_JsonCodec.lazyInstance.value
    }
}


export class InheritanceAnchor_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: InheritanceAnchor): unknown {
        if (this !== InheritanceAnchor_JsonCodec.lazyInstance.value) {
          return InheritanceAnchor_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof InheritanceAnchor_ReportedEpoch) {
                return { "ReportedEpoch": InheritanceAnchor_ReportedEpoch_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof InheritanceAnchor_ReportedParent) {
                return { "ReportedParent": InheritanceAnchor_ReportedParent_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): InheritanceAnchor {
        if (this !== InheritanceAnchor_JsonCodec .lazyInstance.value) {
            return InheritanceAnchor_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "ReportedEpoch": return InheritanceAnchor_ReportedEpoch_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "ReportedParent": return InheritanceAnchor_ReportedParent_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return InheritanceAnchor_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return InheritanceAnchor_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#InheritanceAnchor'
    public baboonTypeIdentifier() {
        return InheritanceAnchor_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#InheritanceAnchor'
    public baboonAdtTypeIdentifier() {
        return InheritanceAnchor_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new InheritanceAnchor_JsonCodec())
    public static get instance(): InheritanceAnchor_JsonCodec {
        return InheritanceAnchor_JsonCodec.lazyInstance.value
    }
}