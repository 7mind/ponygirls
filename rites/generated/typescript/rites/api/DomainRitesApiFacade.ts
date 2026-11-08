

import { AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, BaboonBinCodec, BaboonJsonCodec, BaboonDomainVersion, BaboonMeta, Lazy } from '../../BaboonSharedRuntime.js';
import type { AbstractBaboonConversions } from '../../BaboonSharedRuntime.js';
import { BaboonCodecsFacade } from '../../BaboonCodecsFacade.js';
import { Ack, Ack_JsonCodec } from './Ack.js';
import { CredentialInfo, CredentialInfo_JsonCodec } from './CredentialInfo.js';
import { CredentialMode, CredentialMode_JsonCodec } from './CredentialMode.js';
import { CredentialResult, CredentialResult_JsonCodec } from './CredentialResult.js';
import { CredentialsResult, CredentialsResult_JsonCodec } from './CredentialsResult.js';
import { DeleteCredentialRequest, DeleteCredentialRequest_JsonCodec } from './DeleteCredentialRequest.js';
import { DeleteRepositoryRequest, DeleteRepositoryRequest_JsonCodec } from './DeleteRepositoryRequest.js';
import { DeleteRiteRequest, DeleteRiteRequest_JsonCodec } from './DeleteRiteRequest.js';
import { Failure, Failure_JsonCodec } from './Failure.js';
import { ForgeKind, ForgeKind_JsonCodec } from './ForgeKind.js';
import { GrantInfo, GrantInfo_JsonCodec } from './GrantInfo.js';
import { GrantRole, GrantRole_JsonCodec } from './GrantRole.js';
import { LoginRequest, LoginRequest_JsonCodec } from './LoginRequest.js';
import { LoginResponse, LoginResponse_JsonCodec } from './LoginResponse.js';
import { ManualRunRequest, ManualRunRequest_JsonCodec } from './ManualRunRequest.js';
import { ModelInfo, ModelInfo_JsonCodec } from './ModelInfo.js';
import { ModelsResult, ModelsResult_JsonCodec } from './ModelsResult.js';
import { OAuthClientInfo, OAuthClientInfo_JsonCodec } from './OAuthClientInfo.js';
import { OAuthClientsResult, OAuthClientsResult_JsonCodec } from './OAuthClientsResult.js';
import { RefreshHealth, RefreshHealth_JsonCodec } from './RefreshHealth.js';
import { RepositoriesResult, RepositoriesResult_JsonCodec } from './RepositoriesResult.js';
import { RepositoryInfo, RepositoryInfo_JsonCodec } from './RepositoryInfo.js';
import { RepositoryResult, RepositoryResult_JsonCodec } from './RepositoryResult.js';
import { RiteInfo, RiteInfo_JsonCodec } from './RiteInfo.js';
import { RiteResult, RiteResult_JsonCodec } from './RiteResult.js';
import { RitesResult, RitesResult_JsonCodec } from './RitesResult.js';
import { RunInfo, RunInfo_JsonCodec } from './RunInfo.js';
import { RunResult, RunResult_JsonCodec } from './RunResult.js';
import { RunState, RunState_JsonCodec } from './RunState.js';
import { RunTrigger, RunTrigger_JsonCodec } from './RunTrigger.js';
import { RunsResult, RunsResult_JsonCodec } from './RunsResult.js';
import { SaveCredentialRequest, SaveCredentialRequest_JsonCodec } from './SaveCredentialRequest.js';
import { SaveRepositoryRequest, SaveRepositoryRequest_JsonCodec } from './SaveRepositoryRequest.js';
import { SaveRiteRequest, SaveRiteRequest_JsonCodec } from './SaveRiteRequest.js';
import { SetGrantRequest, SetGrantRequest_JsonCodec } from './SetGrantRequest.js';
import { StatusInfo, StatusInfo_JsonCodec } from './StatusInfo.js';
import { UserInfo, UserInfo_JsonCodec } from './UserInfo.js';
import { UsersResult, UsersResult_JsonCodec } from './UsersResult.js';
import { VersionInfo, VersionInfo_JsonCodec } from './VersionInfo.js';

class DomainRitesApiV0_2_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(Ack_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Ack_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CredentialInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CredentialInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CredentialMode_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CredentialMode_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CredentialResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CredentialResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CredentialsResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CredentialsResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(DeleteCredentialRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => DeleteCredentialRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(DeleteRepositoryRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => DeleteRepositoryRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(DeleteRiteRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => DeleteRiteRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Failure_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Failure_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ForgeKind_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ForgeKind_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GrantInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GrantInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GrantRole_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GrantRole_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginResponse_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginResponse_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ManualRunRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ManualRunRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ModelsResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ModelsResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OAuthClientInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OAuthClientInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(OAuthClientsResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => OAuthClientsResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RefreshHealth_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RefreshHealth_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RepositoriesResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RepositoriesResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RepositoryInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RepositoryInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RepositoryResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RepositoryResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RiteInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RiteInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RiteResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RiteResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RitesResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RitesResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RunInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RunInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RunResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RunResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RunState_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RunState_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RunTrigger_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RunTrigger_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RunsResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RunsResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SaveCredentialRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SaveCredentialRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SaveRepositoryRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SaveRepositoryRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SaveRiteRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SaveRiteRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SetGrantRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SetGrantRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(StatusInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => StatusInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(UserInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => UserInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(UsersResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => UsersResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
    }
}

class DomainRitesApiV0_2_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainRitesApiV0_2_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '0.2.0'; }
}

class DomainRitesApiV0_2_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "rites.api/:#Ack": ['0.2.0'],
        "rites.api/:#CredentialInfo": ['0.2.0'],
        "rites.api/:#CredentialMode": ['0.2.0'],
        "rites.api/:#CredentialResult": ['0.2.0'],
        "rites.api/:#CredentialsResult": ['0.2.0'],
        "rites.api/:#DeleteCredentialRequest": ['0.2.0'],
        "rites.api/:#DeleteRepositoryRequest": ['0.2.0'],
        "rites.api/:#DeleteRiteRequest": ['0.2.0'],
        "rites.api/:#Failure": ['0.2.0'],
        "rites.api/:#ForgeKind": ['0.2.0'],
        "rites.api/:#GrantInfo": ['0.2.0'],
        "rites.api/:#GrantRole": ['0.2.0'],
        "rites.api/:#LoginRequest": ['0.2.0'],
        "rites.api/:#LoginResponse": ['0.2.0'],
        "rites.api/:#ManualRunRequest": ['0.2.0'],
        "rites.api/:#ModelInfo": ['0.2.0'],
        "rites.api/:#ModelsResult": ['0.2.0'],
        "rites.api/:#OAuthClientInfo": ['0.2.0'],
        "rites.api/:#OAuthClientsResult": ['0.2.0'],
        "rites.api/:#RefreshHealth": ['0.2.0'],
        "rites.api/:#RepositoriesResult": ['0.2.0'],
        "rites.api/:#RepositoryInfo": ['0.2.0'],
        "rites.api/:#RepositoryResult": ['0.2.0'],
        "rites.api/:#RiteInfo": ['0.2.0'],
        "rites.api/:#RiteResult": ['0.2.0'],
        "rites.api/:#RitesResult": ['0.2.0'],
        "rites.api/:#RunInfo": ['0.2.0'],
        "rites.api/:#RunResult": ['0.2.0'],
        "rites.api/:#RunState": ['0.2.0'],
        "rites.api/:#RunTrigger": ['0.2.0'],
        "rites.api/:#RunsResult": ['0.2.0'],
        "rites.api/:#SaveCredentialRequest": ['0.2.0'],
        "rites.api/:#SaveRepositoryRequest": ['0.2.0'],
        "rites.api/:#SaveRiteRequest": ['0.2.0'],
        "rites.api/:#SetGrantRequest": ['0.2.0'],
        "rites.api/:#StatusInfo": ['0.2.0'],
        "rites.api/:#UserInfo": ['0.2.0'],
        "rites.api/:#UsersResult": ['0.2.0'],
        "rites.api/:#VersionInfo": ['0.2.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "rites.api/:#Ack": { '0.2.0': 'identical' },
        "rites.api/:#CredentialInfo": { '0.2.0': 'identical' },
        "rites.api/:#CredentialMode": { '0.2.0': 'identical' },
        "rites.api/:#CredentialResult": { '0.2.0': 'identical' },
        "rites.api/:#CredentialsResult": { '0.2.0': 'identical' },
        "rites.api/:#DeleteCredentialRequest": { '0.2.0': 'identical' },
        "rites.api/:#DeleteRepositoryRequest": { '0.2.0': 'identical' },
        "rites.api/:#DeleteRiteRequest": { '0.2.0': 'identical' },
        "rites.api/:#Failure": { '0.2.0': 'identical' },
        "rites.api/:#ForgeKind": { '0.2.0': 'identical' },
        "rites.api/:#GrantInfo": { '0.2.0': 'identical' },
        "rites.api/:#GrantRole": { '0.2.0': 'identical' },
        "rites.api/:#LoginRequest": { '0.2.0': 'identical' },
        "rites.api/:#LoginResponse": { '0.2.0': 'identical' },
        "rites.api/:#ManualRunRequest": { '0.2.0': 'identical' },
        "rites.api/:#ModelInfo": { '0.2.0': 'identical' },
        "rites.api/:#ModelsResult": { '0.2.0': 'identical' },
        "rites.api/:#OAuthClientInfo": { '0.2.0': 'identical' },
        "rites.api/:#OAuthClientsResult": { '0.2.0': 'identical' },
        "rites.api/:#RefreshHealth": { '0.2.0': 'identical' },
        "rites.api/:#RepositoriesResult": { '0.2.0': 'identical' },
        "rites.api/:#RepositoryInfo": { '0.2.0': 'identical' },
        "rites.api/:#RepositoryResult": { '0.2.0': 'identical' },
        "rites.api/:#RiteInfo": { '0.2.0': 'identical' },
        "rites.api/:#RiteResult": { '0.2.0': 'identical' },
        "rites.api/:#RitesResult": { '0.2.0': 'identical' },
        "rites.api/:#RunInfo": { '0.2.0': 'identical' },
        "rites.api/:#RunResult": { '0.2.0': 'identical' },
        "rites.api/:#RunState": { '0.2.0': 'identical' },
        "rites.api/:#RunTrigger": { '0.2.0': 'identical' },
        "rites.api/:#RunsResult": { '0.2.0': 'identical' },
        "rites.api/:#SaveCredentialRequest": { '0.2.0': 'identical' },
        "rites.api/:#SaveRepositoryRequest": { '0.2.0': 'identical' },
        "rites.api/:#SaveRiteRequest": { '0.2.0': 'identical' },
        "rites.api/:#SetGrantRequest": { '0.2.0': 'identical' },
        "rites.api/:#StatusInfo": { '0.2.0': 'identical' },
        "rites.api/:#UserInfo": { '0.2.0': 'identical' },
        "rites.api/:#UsersResult": { '0.2.0': 'identical' },
        "rites.api/:#VersionInfo": { '0.2.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainRitesApiV0_2_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainRitesApiV0_2_0Meta.FORWARD[typeId] ?? {}; }
}

export class DomainRitesApiFacade extends BaboonCodecsFacade {
    constructor() {
        super();
        this.register(
            new BaboonDomainVersion('rites.api', '0.2.0'),
            () => new DomainRitesApiV0_2_0JsonCodecs(),
            () => new DomainRitesApiV0_2_0UebaCodecs(),
            () => new DomainRitesApiV0_2_0Conversions(),
            () => new DomainRitesApiV0_2_0Meta(),
        );
    }
}