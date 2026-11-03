"""Typed in-memory scenario seam for current client transport tests.

Not a new-to-old HTTP adapter: scenarios dispatch generated command labels and
artifact IDs and return domain fixture values (or generated Results). No legacy
URL is interpreted or sent, no Python server/storage is called. Raw streams stay
raw. The outer boundary always uses the actual current Baboon JSON codec.
"""
from functools import wraps
from urllib.parse import urlsplit
from uuid import UUID

from manure import current_protocol as p


def enum(t,value):
    return t('Directory' if value=='dir' else value[0].upper()+value[1:])


def artifact(value):
    return p.Artifact(value['artifact_id'],value['name'],enum(p.ArtifactKind,value['kind']),
        enum(p.Visibility,value['visibility']),enum(p.ArtifactState,value['state']),value['created_by_user'],
        value['created_at'],value['expires_at'],value['total_bytes'],value['file_count'],value['content_url'])


def manifest(value):
    return p.Manifest(value['artifact_id'],enum(p.ArtifactState,value['state']),[
        p.ManifestEntry_Directory(v['path']) if v['kind']=='dir' else p.ManifestEntry_File(v['path'],v['size'],v['sha256'])
        for v in value['files']])


def result(command,value):
    if isinstance(value,p.Result):return value
    if 'error' in value:
        error=value['error'];code=''.join(v.capitalize() for v in error['code'].split('-'))
        return p.Result_Error(p.Failure(p.ErrorCode(code),error.get('message',error['code']),None))
    if isinstance(command,(p.Command_Whoami,p.Command_Login)):
        return p.Result_Identity(p.Principal(value['user_id'],value['token_id'],enum(p.PrincipalType,value['type'])))
    if isinstance(command,p.Command_ListArtifacts):return p.Result_Catalogue(p.CataloguePage([artifact(v) for v in value['artifacts']],value.get('next_cursor')))
    if isinstance(command,p.Command_InitUpload):return p.Result_UploadInitialized(value['artifact_id'],value['chunk_bytes'],value['content_url'],value.get('external_password'))
    if isinstance(command,p.Command_GetArtifact):return p.Result_ArtifactInfo(artifact(value))
    if isinstance(command,p.Command_PatchArtifact):return p.Result_ArtifactPatched(artifact(value),value.get('external_password'))
    if isinstance(command,p.Command_RotateExternalPassword):return p.Result_PasswordRotated(value['external_password'])
    if isinstance(command,(p.Command_GetManifest,p.ContentCommand_GetManifest)):return p.Result_ArtifactManifest(manifest(value))
    if isinstance(command,p.Command_GetUploadStatus):
        return p.Result_UploadProgress(p.UploadStatus(value['artifact_id'],enum(p.ArtifactState,value['state']),value['chunk_bytes'],[
            p.FileProgress(v['path'],v['size'],v['received_bytes'],[p.ByteRange(*r) for r in v['received_ranges']]) for v in value['files']]))
    if isinstance(command,p.Command_FinishUpload):return p.Result_UploadFinished(value['artifact_id'],enum(p.ArtifactState,value['state']),value['content_url'])
    if isinstance(command,p.Command_CreateGrant):return p.Result_GrantCreated(value['grant'],value['expires_in_s'])
    if isinstance(command,(p.Command_DeleteArtifact,p.Command_Logout,p.ContentCommand_Unlock,p.ContentCommand_RedeemGrant,p.ContentCommand_Logout)):return p.Result_Ok()
    raise AssertionError('scenario omitted current result variant')


def _wrap(original):
    @wraps(original)
    def request(self,method,url,headers,body):
        # A subclass can call super with its already-decoded generated command.
        # That is an in-process scenario call, never a second wire conversion.
        if isinstance(body,(p.Command,p.ContentCommand)):
            return original(self,method,url,headers,body)
        path=urlsplit(url).path
        management=method=='POST' and path=='/api/current'
        content=method=='POST' and path.endswith('/__manure/current')
        command=None;request_id=UUID(int=0)
        before=len(getattr(self,'requests',[]))
        if management or content:
            envelope=p.decode(p.ContentEnvelope if content else p.ClientEnvelope,p.loads(body))
            command=envelope.command;request_id=envelope.requestId
            assert envelope.apiVersion==p.API_VERSION
            target=url if content else getattr(command,'artifactId','')
            status,response_headers,value=original(self,command._variant,target,headers,command)
        else:
            status,response_headers,value=original(self,method,url,headers,body)
        for record in getattr(self,'requests',[])[before:]:
            if isinstance(record,dict):
                record.update(method=method,url=url,body=body)
                if command is not None:record['operation']=command._variant
        if 300<=status<400:
            # Redirect status/Location are transport, not a typed application
            # result; preserve the actual redirect-body refusal scenarios.
            return status,response_headers,value
        if command is not None:
            return status,response_headers,p.dumps(p.ServerEnvelope(request_id,result(command,value)))
        if isinstance(value,dict):
            if 'error' in value:
                failure=result(p.Command_DeleteArtifact(''),value)
                return status,response_headers,p.dumps(p.ServerEnvelope(request_id,failure))
            if method=='PUT':
                return status,response_headers,p.dumps(p.ChunkReceipt(value['path'],value['offset'],value['length'],value['received_bytes']))
        return status,response_headers,value
    return request


def current_fixture(cls):
    cls.request=_wrap(cls.request)
    def subclass(sub,**kwargs):
        if 'request' in sub.__dict__:sub.request=_wrap(sub.__dict__['request'])
    cls.__init_subclass__=classmethod(subclass)
    return cls
