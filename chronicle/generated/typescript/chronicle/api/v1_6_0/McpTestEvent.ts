import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'
import {McpTestItem, McpTestItem_JsonCodec} from './McpTestItem.js'

export class McpTestEvent implements BaboonGenerated {
    private readonly _sequence: bigint;
    private readonly _observedAt: string;
    private readonly _item: McpTestItem;

    constructor(sequence: bigint, observedAt: string, item: McpTestItem) {
        this._sequence = sequence
        this._observedAt = observedAt
        this._item = item
    }

    public get sequence(): bigint {
        return this._sequence;
    }
    public get observedAt(): string {
        return this._observedAt;
    }
    public get item(): McpTestItem {
        return this._item;
    }

    public toJSON(): Record<string, unknown> {
        return {
            sequence: this._sequence,
            observedAt: this._observedAt,
            item: this._item
        };
    }

    public with(overrides: {sequence?: bigint; observedAt?: string; item?: McpTestItem}): McpTestEvent {
        return new McpTestEvent(
            'sequence' in overrides ? overrides.sequence! : this._sequence,
            'observedAt' in overrides ? overrides.observedAt! : this._observedAt,
            'item' in overrides ? overrides.item! : this._item
        );
    }

    public static fromPlain(obj: {sequence: bigint; observedAt: string; item: McpTestItem}): McpTestEvent {
        return new McpTestEvent(
            obj.sequence,
            obj.observedAt,
            obj.item
        );
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return McpTestEvent.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestEvent.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#McpTestEvent'
    public baboonTypeIdentifier() {
        return McpTestEvent.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0", "1.8.0"]
    public baboonSameInVersions() {
        return McpTestEvent.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.6.0": "identical", "1.7.0": "identical", "1.8.0": "identical" }
    public baboonForwardReadable() {
        return McpTestEvent.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return McpTestEvent.BaboonMinReaderVersions
    }
    public static jsonCodec(): McpTestEvent_JsonCodec {
        return McpTestEvent_JsonCodec.instance
    }
}

/** @deprecated Version 1.6.0 is deprecated, you should migrate to 1.8.0 */
export class McpTestEvent_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: McpTestEvent): unknown {
        if (this !== McpTestEvent_JsonCodec.lazyInstance.value) {
          return McpTestEvent_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "sequence": value.sequence.toString(),
            "observedAt": value.observedAt,
            "item": McpTestItem_JsonCodec.instance.encode(BaboonCodecContext.Default, value.item),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): McpTestEvent {
        if (this !== McpTestEvent_JsonCodec .lazyInstance.value) {
            return McpTestEvent_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new McpTestEvent (
            BaboonInt64.read(obj["sequence"], "i64/u64"),
            obj["observedAt"] as string,
            McpTestItem_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["item"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.6.0'
    public baboonDomainVersion() {
        return McpTestEvent_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestEvent_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#McpTestEvent'
    public baboonTypeIdentifier() {
        return McpTestEvent_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new McpTestEvent_JsonCodec())
    public static get instance(): McpTestEvent_JsonCodec {
        return McpTestEvent_JsonCodec.lazyInstance.value
    }
}