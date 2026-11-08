

import { AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, BaboonBinCodec, BaboonJsonCodec, BaboonDomainVersion, BaboonMeta, Lazy } from '../../BaboonSharedRuntime.js';
import type { AbstractBaboonConversions } from '../../BaboonSharedRuntime.js';
import { BaboonCodecsFacade } from '../../BaboonCodecsFacade.js';
import { ModelSelection, ModelSelection_JsonCodec } from './ModelSelection.js';
import { RunOutcome, RunOutcome_JsonCodec } from './RunOutcome.js';
import { RunRequest, RunRequest_JsonCodec } from './RunRequest.js';
import { RunResult, RunResult_JsonCodec } from './RunResult.js';
import { VersionInfo, VersionInfo_JsonCodec } from './VersionInfo.js';

class DomainRitesWorkerV0_1_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(ModelSelection_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelSelection_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RunOutcome_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RunOutcome_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RunRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RunRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RunResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RunResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
    }
}

class DomainRitesWorkerV0_1_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainRitesWorkerV0_1_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '0.1.0'; }
}

class DomainRitesWorkerV0_1_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "rites.worker/:#ModelSelection": ['0.1.0'],
        "rites.worker/:#RunOutcome": ['0.1.0'],
        "rites.worker/:#RunRequest": ['0.1.0'],
        "rites.worker/:#RunResult": ['0.1.0'],
        "rites.worker/:#VersionInfo": ['0.1.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "rites.worker/:#ModelSelection": { '0.1.0': 'identical' },
        "rites.worker/:#RunOutcome": { '0.1.0': 'identical' },
        "rites.worker/:#RunRequest": { '0.1.0': 'identical' },
        "rites.worker/:#RunResult": { '0.1.0': 'identical' },
        "rites.worker/:#VersionInfo": { '0.1.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainRitesWorkerV0_1_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainRitesWorkerV0_1_0Meta.FORWARD[typeId] ?? {}; }
}

export class DomainRitesWorkerFacade extends BaboonCodecsFacade {
    constructor() {
        super();
        this.register(
            new BaboonDomainVersion('rites.worker', '0.1.0'),
            () => new DomainRitesWorkerV0_1_0JsonCodecs(),
            () => new DomainRitesWorkerV0_1_0UebaCodecs(),
            () => new DomainRitesWorkerV0_1_0Conversions(),
            () => new DomainRitesWorkerV0_1_0Meta(),
        );
    }
}