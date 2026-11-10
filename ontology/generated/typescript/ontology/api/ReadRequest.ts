import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ReadView, ReadView_JsonCodec} from './ReadView.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class ReadRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _view: ReadView;
    private readonly _targets: Array<Ref>;
    private readonly _cursor: string | undefined;
    private readonly _limit: number;

    constructor(scope: string, view: ReadView, targets: Array<Ref>, cursor: string | undefined, limit: number) {
        this._scope = scope
        this._view = view
        this._targets = targets
        this._cursor = cursor
        this._limit = limit
    }

    public get scope(): string {
        return this._scope;
    }
    public get view(): ReadView {
        return this._view;
    }
    public get targets(): Array<Ref> {
        return this._targets;
    }
    public get cursor(): string | undefined {
        return this._cursor;
    }
    public get limit(): number {
        return this._limit;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            view: this._view,
            targets: this._targets,
            cursor: this._cursor !== undefined ? this._cursor : undefined,
            limit: this._limit
        };
    }

    public with(overrides: {scope?: string; view?: ReadView; targets?: Array<Ref>; cursor?: string | undefined; limit?: number}): ReadRequest {
        return new ReadRequest(
            'scope' in overrides ? overrides.scope! : this._scope,
            'view' in overrides ? overrides.view! : this._view,
            'targets' in overrides ? overrides.targets! : this._targets,
            'cursor' in overrides ? overrides.cursor! : this._cursor,
            'limit' in overrides ? overrides.limit! : this._limit
        );
    }

    public static fromPlain(obj: {scope: string; view: ReadView; targets: Array<Ref>; cursor: string | undefined; limit: number}): ReadRequest {
        return new ReadRequest(
            obj.scope,
            obj.view,
            obj.targets,
            obj.cursor,
            obj.limit
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReadRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReadRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ReadRequest'
    public baboonTypeIdentifier() {
        return ReadRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ReadRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ReadRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ReadRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): ReadRequest_JsonCodec {
        return ReadRequest_JsonCodec.instance
    }
}

export class ReadRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ReadRequest): unknown {
        if (this !== ReadRequest_JsonCodec.lazyInstance.value) {
          return ReadRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "view": ReadView_JsonCodec.instance.encode(BaboonCodecContext.Default, value.view),
            "targets": Array.from(value.targets).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "cursor": value.cursor === undefined ? null : value.cursor,
            "limit": value.limit,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ReadRequest {
        if (this !== ReadRequest_JsonCodec .lazyInstance.value) {
            return ReadRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ReadRequest (
            obj["scope"] as string,
            ReadView_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["view"]),
            (obj["targets"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] as string,
            obj["limit"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReadRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReadRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ReadRequest'
    public baboonTypeIdentifier() {
        return ReadRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ReadRequest_JsonCodec())
    public static get instance(): ReadRequest_JsonCodec {
        return ReadRequest_JsonCodec.lazyInstance.value
    }
}