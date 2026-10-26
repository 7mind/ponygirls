import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class MutationReceipt implements BaboonGenerated {
    private readonly _requestId: string;
    private readonly _operation: string;
    private readonly _entityId: string | undefined;

    constructor(requestId: string, operation: string, entityId: string | undefined) {
        this._requestId = requestId
        this._operation = operation
        this._entityId = entityId
    }

    public get requestId(): string {
        return this._requestId;
    }
    public get operation(): string {
        return this._operation;
    }
    public get entityId(): string | undefined {
        return this._entityId;
    }

    public toJSON(): Record<string, unknown> {
        return {
            requestId: this._requestId,
            operation: this._operation,
            entityId: this._entityId !== undefined ? this._entityId : undefined
        };
    }

    public with(overrides: {requestId?: string; operation?: string; entityId?: string | undefined}): MutationReceipt {
        return new MutationReceipt(
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'operation' in overrides ? overrides.operation! : this._operation,
            'entityId' in overrides ? overrides.entityId! : this._entityId
        );
    }

    public static fromPlain(obj: {requestId: string; operation: string; entityId: string | undefined}): MutationReceipt {
        return new MutationReceipt(
            obj.requestId,
            obj.operation,
            obj.entityId
        );
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return MutationReceipt.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return MutationReceipt.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#MutationReceipt'
    public baboonTypeIdentifier() {
        return MutationReceipt.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    public baboonSameInVersions() {
        return MutationReceipt.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical" }
    public baboonForwardReadable() {
        return MutationReceipt.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return MutationReceipt.BaboonMinReaderVersions
    }
    public static jsonCodec(): MutationReceipt_JsonCodec {
        return MutationReceipt_JsonCodec.instance
    }
}

/** @deprecated Version 1.2.0 is deprecated, you should migrate to 1.4.0 */
export class MutationReceipt_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: MutationReceipt): unknown {
        if (this !== MutationReceipt_JsonCodec.lazyInstance.value) {
          return MutationReceipt_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "requestId": value.requestId,
            "operation": value.operation,
            "entityId": value.entityId === undefined ? null : value.entityId,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): MutationReceipt {
        if (this !== MutationReceipt_JsonCodec .lazyInstance.value) {
            return MutationReceipt_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new MutationReceipt (
            obj["requestId"] as string,
            obj["operation"] as string,
            obj["entityId"] === undefined || obj["entityId"] === null ? undefined : obj["entityId"] === undefined || obj["entityId"] === null ? undefined : obj["entityId"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '1.2.0'
    public baboonDomainVersion() {
        return MutationReceipt_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return MutationReceipt_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#MutationReceipt'
    public baboonTypeIdentifier() {
        return MutationReceipt_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new MutationReceipt_JsonCodec())
    public static get instance(): MutationReceipt_JsonCodec {
        return MutationReceipt_JsonCodec.lazyInstance.value
    }
}