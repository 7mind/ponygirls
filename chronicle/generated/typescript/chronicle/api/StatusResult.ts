import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {JobInfo, JobInfo_JsonCodec} from './JobInfo.js'

export class StatusResult implements BaboonGeneratedLatest {
    private readonly _jobs: Array<JobInfo>;
    private readonly _total: number;

    constructor(jobs: Array<JobInfo>, total: number) {
        this._jobs = jobs
        this._total = total
    }

    public get jobs(): Array<JobInfo> {
        return this._jobs;
    }
    public get total(): number {
        return this._total;
    }

    public toJSON(): Record<string, unknown> {
        return {
            jobs: this._jobs,
            total: this._total
        };
    }

    public with(overrides: {jobs?: Array<JobInfo>; total?: number}): StatusResult {
        return new StatusResult(
            'jobs' in overrides ? overrides.jobs! : this._jobs,
            'total' in overrides ? overrides.total! : this._total
        );
    }

    public static fromPlain(obj: {jobs: Array<JobInfo>; total: number}): StatusResult {
        return new StatusResult(
            obj.jobs,
            obj.total
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return StatusResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return StatusResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#StatusResult'
    public baboonTypeIdentifier() {
        return StatusResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.2.0", "1.3.0", "1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return StatusResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical" }
    public baboonForwardReadable() {
        return StatusResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.2.0", "prefix-any-mode": "1.2.0", "identical": "1.2.0" }
    public baboonMinReaderVersions() {
        return StatusResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): StatusResult_JsonCodec {
        return StatusResult_JsonCodec.instance
    }
}

export class StatusResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: StatusResult): unknown {
        if (this !== StatusResult_JsonCodec.lazyInstance.value) {
          return StatusResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "jobs": Array.from(value.jobs).map(item => JobInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "total": value.total,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): StatusResult {
        if (this !== StatusResult_JsonCodec .lazyInstance.value) {
            return StatusResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new StatusResult (
            (obj["jobs"] as unknown[]).map(item => JobInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["total"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return StatusResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return StatusResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#StatusResult'
    public baboonTypeIdentifier() {
        return StatusResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new StatusResult_JsonCodec())
    public static get instance(): StatusResult_JsonCodec {
        return StatusResult_JsonCodec.lazyInstance.value
    }
}