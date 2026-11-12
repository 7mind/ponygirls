import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum CurationAuditStage {
    RequestPrepared = "RequestPrepared",
    DispatchPossible = "DispatchPossible",
    ResponseObserved = "ResponseObserved"
}

export const CurationAuditStage_values: ReadonlyArray<CurationAuditStage> = [
    CurationAuditStage.RequestPrepared,
    CurationAuditStage.DispatchPossible,
    CurationAuditStage.ResponseObserved
] as const;

export function CurationAuditStage_parse(s: string): CurationAuditStage {
    const found = CurationAuditStage_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown CurationAuditStage variant: " + s);
    }
    return found;
}

export class CurationAuditStage_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationAuditStage): unknown {
        if (this !== CurationAuditStage_JsonCodec.lazyInstance.value) {
          return CurationAuditStage_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationAuditStage {
        if (this !== CurationAuditStage_JsonCodec .lazyInstance.value) {
            return CurationAuditStage_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return CurationAuditStage_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationAuditStage_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationAuditStage_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationAuditStage'
    public baboonTypeIdentifier() {
        return CurationAuditStage_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationAuditStage_JsonCodec())
    public static get instance(): CurationAuditStage_JsonCodec {
        return CurationAuditStage_JsonCodec.lazyInstance.value
    }
}