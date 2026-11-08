import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum GrantRole {
    Owner = "Owner",
    Editor = "Editor",
    Viewer = "Viewer"
}

export const GrantRole_values: ReadonlyArray<GrantRole> = [
    GrantRole.Owner,
    GrantRole.Editor,
    GrantRole.Viewer
] as const;

export function GrantRole_parse(s: string): GrantRole {
    const found = GrantRole_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown GrantRole variant: " + s);
    }
    return found;
}

export class GrantRole_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: GrantRole): unknown {
        if (this !== GrantRole_JsonCodec.lazyInstance.value) {
          return GrantRole_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): GrantRole {
        if (this !== GrantRole_JsonCodec .lazyInstance.value) {
            return GrantRole_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return GrantRole_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return GrantRole_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return GrantRole_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#GrantRole'
    public baboonTypeIdentifier() {
        return GrantRole_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new GrantRole_JsonCodec())
    public static get instance(): GrantRole_JsonCodec {
        return GrantRole_JsonCodec.lazyInstance.value
    }
}