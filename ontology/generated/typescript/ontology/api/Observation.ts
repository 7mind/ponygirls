import {type BaboonAdtMemberMeta, type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export type Observation = Observation_None | Observation_FileVersion | Observation_FileAbsent | Observation_Execution

export const Observation = {
    BaboonDomainVersion: '0.1.0',
    BaboonDomainIdentifier: 'ontology.api',
    BaboonTypeIdentifier: 'ontology.api/:#Observation',
    BaboonSameInVersions: ["0.1.0"],
    BaboonForwardReadable: { "0.1.0": "identical" } as { readonly [version: string]: string },
    BaboonMinReaderVersions: { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" } as { readonly [tier: string]: string },
    BaboonAdtTypeIdentifier: 'ontology.api/:#Observation',
    jsonCodec(): Observation_JsonCodec {
        return Observation_JsonCodec.instance
    }
} as const

export class Observation_None implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Observation]#None' as const;

    constructor() {
        
    }

    

    public toJSON(): Record<string, unknown> {
        return {
            
        };
    }

    public with(overrides: {}): Observation_None {
        return new Observation_None(
            
        );
    }

    public static fromPlain(obj: {}): Observation_None {
        return new Observation_None(
            
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Observation_None.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Observation_None.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Observation]#None'
    public baboonTypeIdentifier() {
        return Observation_None.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Observation_None.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Observation_None.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Observation_None.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Observation'
    public baboonAdtTypeIdentifier() {
        return Observation_None.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Observation_None_JsonCodec {
        return Observation_None_JsonCodec.instance
    }
}

export class Observation_None_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Observation_None): unknown {
        if (this !== Observation_None_JsonCodec.lazyInstance.value) {
          return Observation_None_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Observation_None {
        if (this !== Observation_None_JsonCodec .lazyInstance.value) {
            return Observation_None_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Observation_None (
            
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Observation_None_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Observation_None_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Observation]#None'
    public baboonTypeIdentifier() {
        return Observation_None_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Observation'
    public baboonAdtTypeIdentifier() {
        return Observation_None_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Observation_None_JsonCodec())
    public static get instance(): Observation_None_JsonCodec {
        return Observation_None_JsonCodec.lazyInstance.value
    }
}

export class Observation_FileVersion implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Observation]#FileVersion' as const;
    private readonly _path: string;
    private readonly _generation: bigint;
    private readonly _digest: string;
    private readonly _length: bigint;

    constructor(path: string, generation: bigint, digest: string, length: bigint) {
        this._path = path
        this._generation = generation
        this._digest = digest
        this._length = length
    }

    public get path(): string {
        return this._path;
    }
    public get generation(): bigint {
        return this._generation;
    }
    public get digest(): string {
        return this._digest;
    }
    public get length(): bigint {
        return this._length;
    }

    public toJSON(): Record<string, unknown> {
        return {
            path: this._path,
            generation: this._generation,
            digest: this._digest,
            length: this._length
        };
    }

    public with(overrides: {path?: string; generation?: bigint; digest?: string; length?: bigint}): Observation_FileVersion {
        return new Observation_FileVersion(
            'path' in overrides ? overrides.path! : this._path,
            'generation' in overrides ? overrides.generation! : this._generation,
            'digest' in overrides ? overrides.digest! : this._digest,
            'length' in overrides ? overrides.length! : this._length
        );
    }

    public static fromPlain(obj: {path: string; generation: bigint; digest: string; length: bigint}): Observation_FileVersion {
        return new Observation_FileVersion(
            obj.path,
            obj.generation,
            obj.digest,
            obj.length
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Observation_FileVersion.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Observation_FileVersion.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Observation]#FileVersion'
    public baboonTypeIdentifier() {
        return Observation_FileVersion.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Observation_FileVersion.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Observation_FileVersion.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Observation_FileVersion.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Observation'
    public baboonAdtTypeIdentifier() {
        return Observation_FileVersion.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Observation_FileVersion_JsonCodec {
        return Observation_FileVersion_JsonCodec.instance
    }
}

export class Observation_FileVersion_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Observation_FileVersion): unknown {
        if (this !== Observation_FileVersion_JsonCodec.lazyInstance.value) {
          return Observation_FileVersion_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "path": value.path,
            "generation": value.generation.toString(),
            "digest": value.digest,
            "length": value.length.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Observation_FileVersion {
        if (this !== Observation_FileVersion_JsonCodec .lazyInstance.value) {
            return Observation_FileVersion_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Observation_FileVersion (
            obj["path"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            obj["digest"] as string,
            BaboonInt64.read(obj["length"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Observation_FileVersion_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Observation_FileVersion_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Observation]#FileVersion'
    public baboonTypeIdentifier() {
        return Observation_FileVersion_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Observation'
    public baboonAdtTypeIdentifier() {
        return Observation_FileVersion_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Observation_FileVersion_JsonCodec())
    public static get instance(): Observation_FileVersion_JsonCodec {
        return Observation_FileVersion_JsonCodec.lazyInstance.value
    }
}

export class Observation_FileAbsent implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Observation]#FileAbsent' as const;
    private readonly _path: string;
    private readonly _generation: bigint;

    constructor(path: string, generation: bigint) {
        this._path = path
        this._generation = generation
    }

    public get path(): string {
        return this._path;
    }
    public get generation(): bigint {
        return this._generation;
    }

    public toJSON(): Record<string, unknown> {
        return {
            path: this._path,
            generation: this._generation
        };
    }

    public with(overrides: {path?: string; generation?: bigint}): Observation_FileAbsent {
        return new Observation_FileAbsent(
            'path' in overrides ? overrides.path! : this._path,
            'generation' in overrides ? overrides.generation! : this._generation
        );
    }

    public static fromPlain(obj: {path: string; generation: bigint}): Observation_FileAbsent {
        return new Observation_FileAbsent(
            obj.path,
            obj.generation
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Observation_FileAbsent.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Observation_FileAbsent.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Observation]#FileAbsent'
    public baboonTypeIdentifier() {
        return Observation_FileAbsent.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Observation_FileAbsent.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Observation_FileAbsent.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Observation_FileAbsent.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Observation'
    public baboonAdtTypeIdentifier() {
        return Observation_FileAbsent.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Observation_FileAbsent_JsonCodec {
        return Observation_FileAbsent_JsonCodec.instance
    }
}

export class Observation_FileAbsent_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Observation_FileAbsent): unknown {
        if (this !== Observation_FileAbsent_JsonCodec.lazyInstance.value) {
          return Observation_FileAbsent_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "path": value.path,
            "generation": value.generation.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Observation_FileAbsent {
        if (this !== Observation_FileAbsent_JsonCodec .lazyInstance.value) {
            return Observation_FileAbsent_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Observation_FileAbsent (
            obj["path"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Observation_FileAbsent_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Observation_FileAbsent_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Observation]#FileAbsent'
    public baboonTypeIdentifier() {
        return Observation_FileAbsent_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Observation'
    public baboonAdtTypeIdentifier() {
        return Observation_FileAbsent_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Observation_FileAbsent_JsonCodec())
    public static get instance(): Observation_FileAbsent_JsonCodec {
        return Observation_FileAbsent_JsonCodec.lazyInstance.value
    }
}

export class Observation_Execution implements BaboonAdtMemberMeta, BaboonGeneratedLatest {
    public readonly $type = 'ontology.api/[ontology.api/:#Observation]#Execution' as const;
    private readonly _action: string;
    private readonly _checker: string;
    private readonly _contract: Ref | undefined;
    private readonly _artifacts: Array<Ref>;
    private readonly _exitCode: number | undefined;
    private readonly _complete: boolean;

    constructor(action: string, checker: string, contract: Ref | undefined, artifacts: Array<Ref>, exitCode: number | undefined, complete: boolean) {
        this._action = action
        this._checker = checker
        this._contract = contract
        this._artifacts = artifacts
        this._exitCode = exitCode
        this._complete = complete
    }

    public get action(): string {
        return this._action;
    }
    public get checker(): string {
        return this._checker;
    }
    public get contract(): Ref | undefined {
        return this._contract;
    }
    public get artifacts(): Array<Ref> {
        return this._artifacts;
    }
    public get exitCode(): number | undefined {
        return this._exitCode;
    }
    public get complete(): boolean {
        return this._complete;
    }

    public toJSON(): Record<string, unknown> {
        return {
            action: this._action,
            checker: this._checker,
            contract: this._contract !== undefined ? this._contract : undefined,
            artifacts: this._artifacts,
            exitCode: this._exitCode !== undefined ? this._exitCode : undefined,
            complete: this._complete
        };
    }

    public with(overrides: {action?: string; checker?: string; contract?: Ref | undefined; artifacts?: Array<Ref>; exitCode?: number | undefined; complete?: boolean}): Observation_Execution {
        return new Observation_Execution(
            'action' in overrides ? overrides.action! : this._action,
            'checker' in overrides ? overrides.checker! : this._checker,
            'contract' in overrides ? overrides.contract! : this._contract,
            'artifacts' in overrides ? overrides.artifacts! : this._artifacts,
            'exitCode' in overrides ? overrides.exitCode! : this._exitCode,
            'complete' in overrides ? overrides.complete! : this._complete
        );
    }

    public static fromPlain(obj: {action: string; checker: string; contract: Ref | undefined; artifacts: Array<Ref>; exitCode: number | undefined; complete: boolean}): Observation_Execution {
        return new Observation_Execution(
            obj.action,
            obj.checker,
            obj.contract,
            obj.artifacts,
            obj.exitCode,
            obj.complete
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Observation_Execution.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Observation_Execution.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Observation]#Execution'
    public baboonTypeIdentifier() {
        return Observation_Execution.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return Observation_Execution.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return Observation_Execution.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return Observation_Execution.BaboonMinReaderVersions
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Observation'
    public baboonAdtTypeIdentifier() {
        return Observation_Execution.BaboonAdtTypeIdentifier
    }
    
    public static jsonCodec(): Observation_Execution_JsonCodec {
        return Observation_Execution_JsonCodec.instance
    }
}

export class Observation_Execution_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Observation_Execution): unknown {
        if (this !== Observation_Execution_JsonCodec.lazyInstance.value) {
          return Observation_Execution_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "action": value.action,
            "checker": value.checker,
            "contract": value.contract === undefined ? null : Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.contract),
            "artifacts": Array.from(value.artifacts).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "exitCode": value.exitCode === undefined ? null : value.exitCode,
            "complete": value.complete,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Observation_Execution {
        if (this !== Observation_Execution_JsonCodec .lazyInstance.value) {
            return Observation_Execution_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Observation_Execution (
            obj["action"] as string,
            obj["checker"] as string,
            obj["contract"] === undefined || obj["contract"] === null ? undefined : obj["contract"] === undefined || obj["contract"] === null ? undefined : Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["contract"]),
            (obj["artifacts"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["exitCode"] === undefined || obj["exitCode"] === null ? undefined : obj["exitCode"] === undefined || obj["exitCode"] === null ? undefined : obj["exitCode"] as number,
            obj["complete"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Observation_Execution_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Observation_Execution_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/[ontology.api/:#Observation]#Execution'
    public baboonTypeIdentifier() {
        return Observation_Execution_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Observation'
    public baboonAdtTypeIdentifier() {
        return Observation_Execution_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Observation_Execution_JsonCodec())
    public static get instance(): Observation_Execution_JsonCodec {
        return Observation_Execution_JsonCodec.lazyInstance.value
    }
}


export class Observation_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Observation): unknown {
        if (this !== Observation_JsonCodec.lazyInstance.value) {
          return Observation_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        if (value instanceof Observation_None) {
                return { "None": Observation_None_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Observation_FileVersion) {
                return { "FileVersion": Observation_FileVersion_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Observation_FileAbsent) {
                return { "FileAbsent": Observation_FileAbsent_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
            if (value instanceof Observation_Execution) {
                return { "Execution": Observation_Execution_JsonCodec.instance.encode(BaboonCodecContext.Default, value) }
            }
        throw new Error("Unhandled ADT branch: " + (value as {constructor?: {name?: string}}).constructor?.name);
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Observation {
        if (this !== Observation_JsonCodec .lazyInstance.value) {
            return Observation_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        const key = Object.keys(obj)[0];
        switch (key) {
            case "None": return Observation_None_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "FileVersion": return Observation_FileVersion_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "FileAbsent": return Observation_FileAbsent_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
                case "Execution": return Observation_Execution_JsonCodec.instance.decode(BaboonCodecContext.Default, obj[key])
            default: throw new Error("Unknown ADT branch: " + key);
        }
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return Observation_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return Observation_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#Observation'
    public baboonTypeIdentifier() {
        return Observation_JsonCodec.BaboonTypeIdentifier
    }
    public static readonly BaboonAdtTypeIdentifier = 'ontology.api/:#Observation'
    public baboonAdtTypeIdentifier() {
        return Observation_JsonCodec.BaboonAdtTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Observation_JsonCodec())
    public static get instance(): Observation_JsonCodec {
        return Observation_JsonCodec.lazyInstance.value
    }
}