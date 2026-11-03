import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum CatalogueSort {
    Name = "Name",
    CreatedAt = "CreatedAt",
    ExpiresAt = "ExpiresAt",
    TotalBytes = "TotalBytes",
    FileCount = "FileCount",
    Visibility = "Visibility",
    State = "State",
    Kind = "Kind",
    CreatedByUser = "CreatedByUser"
}

export const CatalogueSort_values: ReadonlyArray<CatalogueSort> = [
    CatalogueSort.Name,
    CatalogueSort.CreatedAt,
    CatalogueSort.ExpiresAt,
    CatalogueSort.TotalBytes,
    CatalogueSort.FileCount,
    CatalogueSort.Visibility,
    CatalogueSort.State,
    CatalogueSort.Kind,
    CatalogueSort.CreatedByUser
] as const;

export function CatalogueSort_parse(s: string): CatalogueSort {
    const found = CatalogueSort_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown CatalogueSort variant: " + s);
    }
    return found;
}

export class CatalogueSort_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CatalogueSort): unknown {
        if (this !== CatalogueSort_JsonCodec.lazyInstance.value) {
          return CatalogueSort_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CatalogueSort {
        if (this !== CatalogueSort_JsonCodec .lazyInstance.value) {
            return CatalogueSort_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return CatalogueSort_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return CatalogueSort_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return CatalogueSort_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#CatalogueSort'
    public baboonTypeIdentifier() {
        return CatalogueSort_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CatalogueSort_JsonCodec())
    public static get instance(): CatalogueSort_JsonCodec {
        return CatalogueSort_JsonCodec.lazyInstance.value
    }
}