import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {SourceRepresentation, SourceRepresentation_JsonCodec} from './SourceRepresentation.js'

export class CaptureMetadata implements BaboonGeneratedLatest {
    private readonly _sourceId: string;
    private readonly _parentSourceId: string | undefined;
    private readonly _observedAt: string | undefined;
    private readonly _representation: SourceRepresentation;
    private readonly _omissions: Array<string>;
    private readonly _exposedDeliveries: Array<string>;

    constructor(sourceId: string, parentSourceId: string | undefined, observedAt: string | undefined, representation: SourceRepresentation, omissions: Array<string>, exposedDeliveries: Array<string>) {
        this._sourceId = sourceId
        this._parentSourceId = parentSourceId
        this._observedAt = observedAt
        this._representation = representation
        this._omissions = omissions
        this._exposedDeliveries = exposedDeliveries
    }

    public get sourceId(): string {
        return this._sourceId;
    }
    public get parentSourceId(): string | undefined {
        return this._parentSourceId;
    }
    public get observedAt(): string | undefined {
        return this._observedAt;
    }
    public get representation(): SourceRepresentation {
        return this._representation;
    }
    public get omissions(): Array<string> {
        return this._omissions;
    }
    public get exposedDeliveries(): Array<string> {
        return this._exposedDeliveries;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sourceId: this._sourceId,
            parentSourceId: this._parentSourceId !== undefined ? this._parentSourceId : undefined,
            observedAt: this._observedAt !== undefined ? this._observedAt : undefined,
            representation: this._representation,
            omissions: this._omissions,
            exposedDeliveries: this._exposedDeliveries
        };
    }

    public with(overrides: {sourceId?: string; parentSourceId?: string | undefined; observedAt?: string | undefined; representation?: SourceRepresentation; omissions?: Array<string>; exposedDeliveries?: Array<string>}): CaptureMetadata {
        return new CaptureMetadata(
            'sourceId' in overrides ? overrides.sourceId! : this._sourceId,
            'parentSourceId' in overrides ? overrides.parentSourceId! : this._parentSourceId,
            'observedAt' in overrides ? overrides.observedAt! : this._observedAt,
            'representation' in overrides ? overrides.representation! : this._representation,
            'omissions' in overrides ? overrides.omissions! : this._omissions,
            'exposedDeliveries' in overrides ? overrides.exposedDeliveries! : this._exposedDeliveries
        );
    }

    public static fromPlain(obj: {sourceId: string; parentSourceId: string | undefined; observedAt: string | undefined; representation: SourceRepresentation; omissions: Array<string>; exposedDeliveries: Array<string>}): CaptureMetadata {
        return new CaptureMetadata(
            obj.sourceId,
            obj.parentSourceId,
            obj.observedAt,
            obj.representation,
            obj.omissions,
            obj.exposedDeliveries
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CaptureMetadata.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CaptureMetadata.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CaptureMetadata'
    public baboonTypeIdentifier() {
        return CaptureMetadata.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CaptureMetadata.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CaptureMetadata.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CaptureMetadata.BaboonMinReaderVersions
    }
    public static jsonCodec(): CaptureMetadata_JsonCodec {
        return CaptureMetadata_JsonCodec.instance
    }
}

export class CaptureMetadata_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CaptureMetadata): unknown {
        if (this !== CaptureMetadata_JsonCodec.lazyInstance.value) {
          return CaptureMetadata_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sourceId": value.sourceId,
            "parentSourceId": value.parentSourceId === undefined ? null : value.parentSourceId,
            "observedAt": value.observedAt === undefined ? null : value.observedAt,
            "representation": SourceRepresentation_JsonCodec.instance.encode(BaboonCodecContext.Default, value.representation),
            "omissions": Array.from(value.omissions),
            "exposedDeliveries": Array.from(value.exposedDeliveries),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CaptureMetadata {
        if (this !== CaptureMetadata_JsonCodec .lazyInstance.value) {
            return CaptureMetadata_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CaptureMetadata (
            obj["sourceId"] as string,
            obj["parentSourceId"] === undefined || obj["parentSourceId"] === null ? undefined : obj["parentSourceId"] === undefined || obj["parentSourceId"] === null ? undefined : obj["parentSourceId"] as string,
            obj["observedAt"] === undefined || obj["observedAt"] === null ? undefined : obj["observedAt"] === undefined || obj["observedAt"] === null ? undefined : obj["observedAt"] as string,
            SourceRepresentation_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["representation"]),
            (obj["omissions"] as unknown[]).map(item => item as string),
            (obj["exposedDeliveries"] as unknown[]).map(item => item as string),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CaptureMetadata_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CaptureMetadata_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CaptureMetadata'
    public baboonTypeIdentifier() {
        return CaptureMetadata_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CaptureMetadata_JsonCodec())
    public static get instance(): CaptureMetadata_JsonCodec {
        return CaptureMetadata_JsonCodec.lazyInstance.value
    }
}