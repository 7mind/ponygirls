import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum EvidenceField {
    Name = "Name",
    ManifestPath = "ManifestPath"
}

export const EvidenceField_values: ReadonlyArray<EvidenceField> = [
    EvidenceField.Name,
    EvidenceField.ManifestPath
] as const;

export function EvidenceField_parse(s: string): EvidenceField {
    const found = EvidenceField_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown EvidenceField variant: " + s);
    }
    return found;
}

export class EvidenceField_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: EvidenceField): unknown {
        if (this !== EvidenceField_JsonCodec.lazyInstance.value) {
          return EvidenceField_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): EvidenceField {
        if (this !== EvidenceField_JsonCodec .lazyInstance.value) {
            return EvidenceField_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return EvidenceField_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return EvidenceField_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return EvidenceField_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#EvidenceField'
    public baboonTypeIdentifier() {
        return EvidenceField_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new EvidenceField_JsonCodec())
    public static get instance(): EvidenceField_JsonCodec {
        return EvidenceField_JsonCodec.lazyInstance.value
    }
}