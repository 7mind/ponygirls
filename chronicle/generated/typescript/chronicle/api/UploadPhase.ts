import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum UploadPhase {
    Open = "Open",
    Committed = "Committed",
    Aborted = "Aborted",
    Expired = "Expired",
    Failed = "Failed"
}

export const UploadPhase_values: ReadonlyArray<UploadPhase> = [
    UploadPhase.Open,
    UploadPhase.Committed,
    UploadPhase.Aborted,
    UploadPhase.Expired,
    UploadPhase.Failed
] as const;

export function UploadPhase_parse(s: string): UploadPhase {
    const found = UploadPhase_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown UploadPhase variant: " + s);
    }
    return found;
}

export class UploadPhase_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: UploadPhase): unknown {
        if (this !== UploadPhase_JsonCodec.lazyInstance.value) {
          return UploadPhase_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): UploadPhase {
        if (this !== UploadPhase_JsonCodec .lazyInstance.value) {
            return UploadPhase_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return UploadPhase_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.9.0'
    public baboonDomainVersion() {
        return UploadPhase_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return UploadPhase_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#UploadPhase'
    public baboonTypeIdentifier() {
        return UploadPhase_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new UploadPhase_JsonCodec())
    public static get instance(): UploadPhase_JsonCodec {
        return UploadPhase_JsonCodec.lazyInstance.value
    }
}