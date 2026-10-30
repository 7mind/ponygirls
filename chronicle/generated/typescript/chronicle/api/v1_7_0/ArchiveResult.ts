import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'
import {ArchiveRow, ArchiveRow_JsonCodec} from './ArchiveRow.js'
import {ArchiveTextScope, ArchiveTextScope_JsonCodec} from './ArchiveTextScope.js'

export class ArchiveResult implements BaboonGenerated {
    private readonly _rows: Array<ArchiveRow>;
    private readonly _total: bigint;
    private readonly _nextCursor: string | undefined;
    private readonly _textScope: ArchiveTextScope;
    private readonly _annChunkLimitPerOperand: number | undefined;

    constructor(rows: Array<ArchiveRow>, total: bigint, nextCursor: string | undefined, textScope: ArchiveTextScope, annChunkLimitPerOperand: number | undefined) {
        this._rows = rows
        this._total = total
        this._nextCursor = nextCursor
        this._textScope = textScope
        this._annChunkLimitPerOperand = annChunkLimitPerOperand
    }

    public get rows(): Array<ArchiveRow> {
        return this._rows;
    }
    public get total(): bigint {
        return this._total;
    }
    public get nextCursor(): string | undefined {
        return this._nextCursor;
    }
    public get textScope(): ArchiveTextScope {
        return this._textScope;
    }
    public get annChunkLimitPerOperand(): number | undefined {
        return this._annChunkLimitPerOperand;
    }

    public toJSON(): Record<string, unknown> {
        return {
            rows: this._rows,
            total: this._total,
            nextCursor: this._nextCursor !== undefined ? this._nextCursor : undefined,
            textScope: this._textScope,
            annChunkLimitPerOperand: this._annChunkLimitPerOperand !== undefined ? this._annChunkLimitPerOperand : undefined
        };
    }

    public with(overrides: {rows?: Array<ArchiveRow>; total?: bigint; nextCursor?: string | undefined; textScope?: ArchiveTextScope; annChunkLimitPerOperand?: number | undefined}): ArchiveResult {
        return new ArchiveResult(
            'rows' in overrides ? overrides.rows! : this._rows,
            'total' in overrides ? overrides.total! : this._total,
            'nextCursor' in overrides ? overrides.nextCursor! : this._nextCursor,
            'textScope' in overrides ? overrides.textScope! : this._textScope,
            'annChunkLimitPerOperand' in overrides ? overrides.annChunkLimitPerOperand! : this._annChunkLimitPerOperand
        );
    }

    public static fromPlain(obj: {rows: Array<ArchiveRow>; total: bigint; nextCursor: string | undefined; textScope: ArchiveTextScope; annChunkLimitPerOperand: number | undefined}): ArchiveResult {
        return new ArchiveResult(
            obj.rows,
            obj.total,
            obj.nextCursor,
            obj.textScope,
            obj.annChunkLimitPerOperand
        );
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return ArchiveResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ArchiveResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ArchiveResult'
    public baboonTypeIdentifier() {
        return ArchiveResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.7.0"]
    public baboonSameInVersions() {
        return ArchiveResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.7.0": "identical", "1.8.0": "prefix-any-mode" }
    public baboonForwardReadable() {
        return ArchiveResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.7.0", "prefix-compact": "1.7.0", "prefix-any-mode": "1.7.0", "identical": "1.7.0" }
    public baboonMinReaderVersions() {
        return ArchiveResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ArchiveResult_JsonCodec {
        return ArchiveResult_JsonCodec.instance
    }
}

/** @deprecated Version 1.7.0 is deprecated, you should migrate to 1.8.0 */
export class ArchiveResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ArchiveResult): unknown {
        if (this !== ArchiveResult_JsonCodec.lazyInstance.value) {
          return ArchiveResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "rows": Array.from(value.rows).map(item => ArchiveRow_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "total": value.total.toString(),
            "nextCursor": value.nextCursor === undefined ? null : value.nextCursor,
            "textScope": ArchiveTextScope_JsonCodec.instance.encode(BaboonCodecContext.Default, value.textScope),
            "annChunkLimitPerOperand": value.annChunkLimitPerOperand === undefined ? null : value.annChunkLimitPerOperand,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ArchiveResult {
        if (this !== ArchiveResult_JsonCodec .lazyInstance.value) {
            return ArchiveResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ArchiveResult (
            (obj["rows"] as unknown[]).map(item => ArchiveRow_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            BaboonInt64.read(obj["total"], "i64/u64"),
            obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] === undefined || obj["nextCursor"] === null ? undefined : obj["nextCursor"] as string,
            ArchiveTextScope_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["textScope"]),
            obj["annChunkLimitPerOperand"] === undefined || obj["annChunkLimitPerOperand"] === null ? undefined : obj["annChunkLimitPerOperand"] === undefined || obj["annChunkLimitPerOperand"] === null ? undefined : obj["annChunkLimitPerOperand"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.7.0'
    public baboonDomainVersion() {
        return ArchiveResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return ArchiveResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#ArchiveResult'
    public baboonTypeIdentifier() {
        return ArchiveResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ArchiveResult_JsonCodec())
    public static get instance(): ArchiveResult_JsonCodec {
        return ArchiveResult_JsonCodec.lazyInstance.value
    }
}