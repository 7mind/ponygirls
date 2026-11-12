import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum InheritanceKind {
    Fork = "Fork",
    Import = "Import"
}

export const InheritanceKind_values: ReadonlyArray<InheritanceKind> = [
    InheritanceKind.Fork,
    InheritanceKind.Import
] as const;

export function InheritanceKind_parse(s: string): InheritanceKind {
    const found = InheritanceKind_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown InheritanceKind variant: " + s);
    }
    return found;
}

export class InheritanceKind_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: InheritanceKind): unknown {
        if (this !== InheritanceKind_JsonCodec.lazyInstance.value) {
          return InheritanceKind_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): InheritanceKind {
        if (this !== InheritanceKind_JsonCodec .lazyInstance.value) {
            return InheritanceKind_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return InheritanceKind_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return InheritanceKind_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return InheritanceKind_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#InheritanceKind'
    public baboonTypeIdentifier() {
        return InheritanceKind_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new InheritanceKind_JsonCodec())
    public static get instance(): InheritanceKind_JsonCodec {
        return InheritanceKind_JsonCodec.lazyInstance.value
    }
}