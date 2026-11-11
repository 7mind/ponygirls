"""Behavioral-Active / Blackbox-Group, specified sole-current codec boundary."""
from dataclasses import replace
import json
from pathlib import Path
import unittest
from uuid import UUID

from manure import current_protocol as p

FIXTURES = Path(__file__).resolve().parents[1] / 'models/fixtures'
RID = UUID('01234567-89ab-4def-8123-456789abcdef')


class CurrentProtocolTests(unittest.TestCase):
    def test_recoverable_password_command_and_explicit_optional_result(self):
        command = {'requestId':str(RID), 'apiVersion':p.API_VERSION,
                   'command':{'GetExternalPassword':{'artifactId':'a'*32}}}
        self.assertEqual(p.encode(p.decode(p.ClientEnvelope,command)),command)
        for password in [None, 'synthetic-current-password']:
            result = {'requestId':str(RID),
                      'result':{'ExternalPasswordRetrieved':{'externalPassword':password}}}
            self.assertEqual(p.encode(p.decode(p.ServerEnvelope,result)),result)

    def test_all_golden_vectors_match_typed_bridge(self):
        count = 0
        for name, t in [('commands',p.ClientEnvelope),('results',p.ServerEnvelope),
                        ('content',p.ContentEnvelope),('chunks',p.ChunkReceipt)]:
            for vector in json.loads((FIXTURES/(name+'.json')).read_text()):
                with self.subTest(name=name, vector=count):
                    self.assertEqual(p.encode(p.decode(t,vector)),vector)
                    count += 1
        self.assertGreaterEqual(count,70)

    def test_every_command_result_content_branch_and_error_code_has_vector(self):
        for name,group,field in [('commands',p.Command,'command'),('results',p.Result,'result'),
                                 ('content',p.ContentCommand,'command')]:
            vectors=json.loads((FIXTURES/(name+'.json')).read_text())
            self.assertEqual({next(iter(v[field])) for v in vectors},
                             {cls._variant for cls in p._ADTS[group].values()})
        codes={v['result']['Error']['failure']['code'] for v in json.loads((FIXTURES/'results.json').read_text()) if 'Error' in v['result']}
        self.assertEqual(codes,{v.value for v in p.ErrorCode})

    def test_strict_unknown_missing_duplicate_and_multiple_adt_keys(self):
        valid=p.encode(p.ClientEnvelope(RID,p.API_VERSION,p.Command_Whoami()))
        for obj in [dict(valid,extra=1),{k:v for k,v in valid.items() if k!='apiVersion'},
                    dict(valid,command={'Whoami':{},'Logout':{}}),
                    dict(valid,command={'Whoami':{'extra':1}}),
                    dict(valid,command={'RemovedCommand':{}})]:
            with self.subTest(obj=obj),self.assertRaises(p.ProtocolError): p.decode(p.ClientEnvelope,obj)
        with self.assertRaises(p.ProtocolError): p.loads(b'{"requestId":1,"requestId":2}')
        with self.assertRaises(p.ProtocolError): p.loads(b'{"x":{"a":1,"a":2}}')

    def test_exact_i64_strings_and_bounds_not_lossy_numbers(self):
        vector=p.encode(p.ChunkReceipt('f',9007199254740993,1,2**63-1))
        self.assertEqual(p.decode(p.ChunkReceipt,vector).offset,9007199254740993)
        for value in [True,1,1.0,'01','-0','+1','1.0',str(2**63),str(-2**63-1),' 1']:
            with self.subTest(value=value),self.assertRaises(p.ProtocolError):
                p.decode(p.ChunkReceipt,dict(vector,offset=value))
        for value in [True,1.0,'1',2**31]:
            with self.subTest(length=value),self.assertRaises(p.ProtocolError):
                p.decode(p.ChunkReceipt,dict(vector,length=value))

    def test_utf8_surrogates_nonfinite_and_noncanonical_uuid_rejected(self):
        for raw in [b'\xff',b'{"x":NaN}',b'{"x":Infinity}']:
            with self.subTest(raw=raw),self.assertRaises(p.ProtocolError): p.loads(raw)
        vector=p.encode(p.ClientEnvelope(RID,p.API_VERSION,p.Command_Login('safe')))
        for rid in [str(RID).upper(),str(RID).replace('-',''),1,None]:
            with self.subTest(rid=rid),self.assertRaises(p.ProtocolError):
                p.decode(p.ClientEnvelope,dict(vector,requestId=rid))
        vector['command']['Login']['token']='\ud800'
        with self.assertRaises(p.ProtocolError): p.decode(p.ClientEnvelope,vector)

    def test_response_correlation_and_result_type_are_enforced(self):
        valid=p.ServerEnvelope(RID,p.Result_Ok())
        self.assertIsInstance(p.response(p.dumps(valid),RID,p.Result_Ok),p.Result_Ok)
        for value in [replace(valid,requestId=UUID(int=0)),replace(valid,result=p.Result_Version(p.VersionInfo('1.0.0',['1.0.0'])))]:
            with self.assertRaises(p.ProtocolError): p.response(p.dumps(value),RID,p.Result_Ok)

    def test_tri_state_expiry_and_directory_adts_are_distinct(self):
        for expiry,key in [(p.ExpiryChange_Keep(),'Keep'),(p.ExpiryChange_Clear(),'Clear'),(p.ExpiryChange_Set(60),'Set')]:
            self.assertEqual(next(iter(p.encode(expiry))),key)
            self.assertEqual(p.decode(p.ExpiryChange,p.encode(expiry)),expiry)
        self.assertEqual(p.encode(p.ManifestEntry_Directory('empty')),{'Directory':{'path':'empty'}})
        with self.assertRaises(p.ProtocolError): p.decode(p.ManifestEntry,{'Directory':{'path':'empty','size':'0'}})

    def test_search_goldens_distinguish_published_space_from_lexical_head(self):
        vectors=json.loads((FIXTURES/'results.json').read_text())
        pages=[p.decode(p.ServerEnvelope,v).result.page for v in vectors if 'SearchResults' in v['result']]
        self.assertEqual(len(pages),2)
        published,head=pages
        semantic=published.hits[0];lexical=head.hits[0]
        self.assertEqual(semantic.embeddingProfile,'b'*64)
        self.assertEqual(semantic.embeddingSpace,'c'*64)
        self.assertNotEqual(semantic.embeddingProfile,semantic.embeddingSpace)
        self.assertEqual(published.countScope,p.SearchCountScope.CandidateWindow)
        self.assertEqual(published.rankingLimit,1000)
        self.assertIsNone(lexical.embeddingProfile);self.assertIsNone(lexical.embeddingSpace)
        self.assertEqual(head.countScope,p.SearchCountScope.ExactMatches)
        self.assertIsNone(head.rankingLimit)
        for hit in [semantic,lexical]:
            self.assertTrue(hit.sourceVersion);self.assertTrue(hit.generationId)
            self.assertEqual(hit.policyId,'manure-metadata-paths-v2')
            self.assertEqual([e.field for e in hit.evidence],[p.EvidenceField.Name,p.EvidenceField.ManifestPath,p.EvidenceField.Tag,p.EvidenceField.Hostname,p.EvidenceField.ProjectPath])
        wire=next(v for v in vectors if 'SearchResults' in v['result'])
        del wire['result']['SearchResults']['page']['hits'][0]['embeddingSpace']
        with self.assertRaises(p.ProtocolError):p.decode(p.ServerEnvelope,wire)

    def test_current_version_has_no_retained_chain(self):
        self.assertEqual(p.API_VERSION,'1.0.0')
        self.assertEqual([f.name for f in FIXTURES.parent.glob('*.baboon')],['manure.baboon'])
        self.assertEqual(p.encode(p.VersionInfo(p.API_VERSION,[p.API_VERSION])),{'current':'1.0.0','supported':['1.0.0']})
        # Version rejection is a server boundary invariant, not a codec parser's
        # job: the codec must faithfully carry unsupported requests to the gate.
        for version in ['0.2.0','0.9.0','2.0.0']:
            obj=p.ClientEnvelope(RID,version,p.Command_DeleteArtifact('a'*32))
            self.assertEqual(p.decode(p.ClientEnvelope,p.encode(obj)).apiVersion,version)


if __name__ == '__main__': unittest.main()
