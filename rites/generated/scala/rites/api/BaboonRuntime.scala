import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, Lazy}

package rites.api {
  trait RequiredConversions {
      
  }
  
  class BaboonConversions(@scala.annotation.unused required: RequiredConversions) extends AbstractBaboonConversions {
      
  
      override def versionsFrom: List[String] = List()
      override def versionTo: String = "0.2.0"
  }
  
  object BaboonCodecsUeba extends AbstractBaboonUebaCodecs{
    
  }
  
  object BaboonCodecsJson extends AbstractBaboonJsonCodecs{
    register("rites.api/:#SaveRiteRequest", Lazy(SaveRiteRequest_JsonCodec))
    register("rites.api/:#ForgeKind", Lazy(ForgeKind_JsonCodec))
    register("rites.api/:#CredentialsResult", Lazy(CredentialsResult_JsonCodec))
    register("rites.api/:#OAuthClientsResult", Lazy(OAuthClientsResult_JsonCodec))
    register("rites.api/:#RiteInfo", Lazy(RiteInfo_JsonCodec))
    register("rites.api/:#RunState", Lazy(RunState_JsonCodec))
    register("rites.api/:#LoginResponse", Lazy(LoginResponse_JsonCodec))
    register("rites.api/:#GrantInfo", Lazy(GrantInfo_JsonCodec))
    register("rites.api/:#OAuthClientInfo", Lazy(OAuthClientInfo_JsonCodec))
    register("rites.api/:#DeleteCredentialRequest", Lazy(DeleteCredentialRequest_JsonCodec))
    register("rites.api/:#Ack", Lazy(Ack_JsonCodec))
    register("rites.api/:#RunInfo", Lazy(RunInfo_JsonCodec))
    register("rites.api/:#RepositoriesResult", Lazy(RepositoriesResult_JsonCodec))
    register("rites.api/:#ManualRunRequest", Lazy(ManualRunRequest_JsonCodec))
    register("rites.api/:#LoginRequest", Lazy(LoginRequest_JsonCodec))
    register("rites.api/:#RiteResult", Lazy(RiteResult_JsonCodec))
    register("rites.api/:#RepositoryInfo", Lazy(RepositoryInfo_JsonCodec))
    register("rites.api/:#RunResult", Lazy(RunResult_JsonCodec))
    register("rites.api/:#VersionInfo", Lazy(VersionInfo_JsonCodec))
    register("rites.api/:#CredentialMode", Lazy(CredentialMode_JsonCodec))
    register("rites.api/:#CredentialInfo", Lazy(CredentialInfo_JsonCodec))
    register("rites.api/:#UsersResult", Lazy(UsersResult_JsonCodec))
    register("rites.api/:#SaveCredentialRequest", Lazy(SaveCredentialRequest_JsonCodec))
    register("rites.api/:#RunTrigger", Lazy(RunTrigger_JsonCodec))
    register("rites.api/:#ModelInfo", Lazy(ModelInfo_JsonCodec))
    register("rites.api/:#CredentialResult", Lazy(CredentialResult_JsonCodec))
    register("rites.api/:#RefreshHealth", Lazy(RefreshHealth_JsonCodec))
    register("rites.api/:#GrantRole", Lazy(GrantRole_JsonCodec))
    register("rites.api/:#RunsResult", Lazy(RunsResult_JsonCodec))
    register("rites.api/:#StatusInfo", Lazy(StatusInfo_JsonCodec))
    register("rites.api/:#RepositoryResult", Lazy(RepositoryResult_JsonCodec))
    register("rites.api/:#UserInfo", Lazy(UserInfo_JsonCodec))
    register("rites.api/:#Failure", Lazy(Failure_JsonCodec))
    register("rites.api/:#ModelsResult", Lazy(ModelsResult_JsonCodec))
    register("rites.api/:#DeleteRepositoryRequest", Lazy(DeleteRepositoryRequest_JsonCodec))
    register("rites.api/:#SaveRepositoryRequest", Lazy(SaveRepositoryRequest_JsonCodec))
    register("rites.api/:#SetGrantRequest", Lazy(SetGrantRequest_JsonCodec))
    register("rites.api/:#RitesResult", Lazy(RitesResult_JsonCodec))
    register("rites.api/:#DeleteRiteRequest", Lazy(DeleteRiteRequest_JsonCodec))
  }
}