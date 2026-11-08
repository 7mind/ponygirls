import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ForgeKind {
    Github = "Github",
    Gitlab = "Gitlab"
}

export const ForgeKind_values: ReadonlyArray<ForgeKind> = [
    ForgeKind.Github,
    ForgeKind.Gitlab
] as const;

export function ForgeKind_parse(s: string): ForgeKind {
    const found = ForgeKind_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ForgeKind variant: " + s);
    }
    return found;
}

export class ForgeKind_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ForgeKind): unknown {
        if (this !== ForgeKind_JsonCodec.lazyInstance.value) {
          return ForgeKind_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ForgeKind {
        if (this !== ForgeKind_JsonCodec .lazyInstance.value) {
            return ForgeKind_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ForgeKind_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return ForgeKind_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return ForgeKind_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#ForgeKind'
    public baboonTypeIdentifier() {
        return ForgeKind_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ForgeKind_JsonCodec())
    public static get instance(): ForgeKind_JsonCodec {
        return ForgeKind_JsonCodec.lazyInstance.value
    }
}