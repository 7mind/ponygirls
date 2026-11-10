import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum LineageStatus {
    Unknown = "Unknown",
    Recorded = "Recorded"
}

export const LineageStatus_values: ReadonlyArray<LineageStatus> = [
    LineageStatus.Unknown,
    LineageStatus.Recorded
] as const;

export function LineageStatus_parse(s: string): LineageStatus {
    const found = LineageStatus_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown LineageStatus variant: " + s);
    }
    return found;
}

export class LineageStatus_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: LineageStatus): unknown {
        if (this !== LineageStatus_JsonCodec.lazyInstance.value) {
          return LineageStatus_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): LineageStatus {
        if (this !== LineageStatus_JsonCodec .lazyInstance.value) {
            return LineageStatus_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return LineageStatus_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return LineageStatus_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return LineageStatus_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#LineageStatus'
    public baboonTypeIdentifier() {
        return LineageStatus_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new LineageStatus_JsonCodec())
    public static get instance(): LineageStatus_JsonCodec {
        return LineageStatus_JsonCodec.lazyInstance.value
    }
}