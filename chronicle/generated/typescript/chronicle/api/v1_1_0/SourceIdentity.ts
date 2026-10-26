import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {SourceFormat, SourceFormat_JsonCodec} from './SourceFormat.js'

export class SourceIdentity implements BaboonGenerated {
    private readonly _collectorNamespace: string;
    private readonly _discoveryRootId: string;
    private readonly _format: SourceFormat;
    private readonly _producerSessionId: string;
    private readonly _subagentId: string | undefined;

    constructor(collectorNamespace: string, discoveryRootId: string, format: SourceFormat, producerSessionId: string, subagentId: string | undefined) {
        this._collectorNamespace = collectorNamespace
        this._discoveryRootId = discoveryRootId
        this._format = format
        this._producerSessionId = producerSessionId
        this._subagentId = subagentId
    }

    public get collectorNamespace(): string {
        return this._collectorNamespace;
    }
    public get discoveryRootId(): string {
        return this._discoveryRootId;
    }
    public get format(): SourceFormat {
        return this._format;
    }
    public get producerSessionId(): string {
        return this._producerSessionId;
    }
    public get subagentId(): string | undefined {
        return this._subagentId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            collectorNamespace: this._collectorNamespace,
            discoveryRootId: this._discoveryRootId,
            format: this._format,
            producerSessionId: this._producerSessionId,
            subagentId: this._subagentId !== undefined ? this._subagentId : undefined
        };
    }

    public with(overrides: {collectorNamespace?: string; discoveryRootId?: string; format?: SourceFormat; producerSessionId?: string; subagentId?: string | undefined}): SourceIdentity {
        return new SourceIdentity(
            'collectorNamespace' in overrides ? overrides.collectorNamespace! : this._collectorNamespace,
            'discoveryRootId' in overrides ? overrides.discoveryRootId! : this._discoveryRootId,
            'format' in overrides ? overrides.format! : this._format,
            'producerSessionId' in overrides ? overrides.producerSessionId! : this._producerSessionId,
            'subagentId' in overrides ? overrides.subagentId! : this._subagentId
        );
    }

    public static fromPlain(obj: {collectorNamespace: string; discoveryRootId: string; format: SourceFormat; producerSessionId: string; subagentId: string | undefined}): SourceIdentity {
        return new SourceIdentity(
            obj.collectorNamespace,
            obj.discoveryRootId,
            obj.format,
            obj.producerSessionId,
            obj.subagentId
        );
    }

    public static readonly BaboonDomainVersion = '1.1.0'
    public baboonDomainVersion() {
        return SourceIdentity.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SourceIdentity.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SourceIdentity'
    public baboonTypeIdentifier() {
        return SourceIdentity.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return SourceIdentity.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical", "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical" }
    public baboonForwardReadable() {
        return SourceIdentity.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return SourceIdentity.BaboonMinReaderVersions
    }
    public static jsonCodec(): SourceIdentity_JsonCodec {
        return SourceIdentity_JsonCodec.instance
    }
}

/** @deprecated Version 1.1.0 is deprecated, you should migrate to 1.4.0 */
export class SourceIdentity_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SourceIdentity): unknown {
        if (this !== SourceIdentity_JsonCodec.lazyInstance.value) {
          return SourceIdentity_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "collectorNamespace": value.collectorNamespace,
            "discoveryRootId": value.discoveryRootId,
            "format": SourceFormat_JsonCodec.instance.encode(BaboonCodecContext.Default, value.format),
            "producerSessionId": value.producerSessionId,
            "subagentId": value.subagentId === undefined ? null : value.subagentId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SourceIdentity {
        if (this !== SourceIdentity_JsonCodec .lazyInstance.value) {
            return SourceIdentity_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SourceIdentity (
            obj["collectorNamespace"] as string,
            obj["discoveryRootId"] as string,
            SourceFormat_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["format"]),
            obj["producerSessionId"] as string,
            obj["subagentId"] === undefined || obj["subagentId"] === null ? undefined : obj["subagentId"] === undefined || obj["subagentId"] === null ? undefined : obj["subagentId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.1.0'
    public baboonDomainVersion() {
        return SourceIdentity_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return SourceIdentity_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#SourceIdentity'
    public baboonTypeIdentifier() {
        return SourceIdentity_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SourceIdentity_JsonCodec())
    public static get instance(): SourceIdentity_JsonCodec {
        return SourceIdentity_JsonCodec.lazyInstance.value
    }
}