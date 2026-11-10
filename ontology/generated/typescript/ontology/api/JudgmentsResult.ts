import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Judgment, Judgment_JsonCodec} from './Judgment.js'

export class JudgmentsResult implements BaboonGeneratedLatest {
    private readonly _items: Array<Judgment>;

    constructor(items: Array<Judgment>) {
        this._items = items
    }

    public get items(): Array<Judgment> {
        return this._items;
    }

    public toJSON(): Record<string, unknown> {
        return {
            items: this._items
        };
    }

    public with(overrides: {items?: Array<Judgment>}): JudgmentsResult {
        return new JudgmentsResult(
            'items' in overrides ? overrides.items! : this._items
        );
    }

    public static fromPlain(obj: {items: Array<Judgment>}): JudgmentsResult {
        return new JudgmentsResult(
            obj.items
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return JudgmentsResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return JudgmentsResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#JudgmentsResult'
    public baboonTypeIdentifier() {
        return JudgmentsResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return JudgmentsResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return JudgmentsResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return JudgmentsResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): JudgmentsResult_JsonCodec {
        return JudgmentsResult_JsonCodec.instance
    }
}

export class JudgmentsResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: JudgmentsResult): unknown {
        if (this !== JudgmentsResult_JsonCodec.lazyInstance.value) {
          return JudgmentsResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "items": Array.from(value.items).map(item => Judgment_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): JudgmentsResult {
        if (this !== JudgmentsResult_JsonCodec .lazyInstance.value) {
            return JudgmentsResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new JudgmentsResult (
            (obj["items"] as unknown[]).map(item => Judgment_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return JudgmentsResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return JudgmentsResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#JudgmentsResult'
    public baboonTypeIdentifier() {
        return JudgmentsResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new JudgmentsResult_JsonCodec())
    public static get instance(): JudgmentsResult_JsonCodec {
        return JudgmentsResult_JsonCodec.lazyInstance.value
    }
}