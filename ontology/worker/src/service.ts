import {
  Capsule, CapsuleRequest, CurationStatus, DeliveryReceipt, DeliveryRequest,
  Identity, IngestRequest, IngestResult, ScopeRequest,
} from '../../generated/typescript/ontology/api/index.js';
import { OntologyHttp } from './http.js';

export interface WorkerService {
  identity(signal: AbortSignal): Promise<Identity>;
  status(scope: string, signal: AbortSignal): Promise<CurationStatus>;
  ingest(request: IngestRequest, signal: AbortSignal): Promise<IngestResult>;
  capsule(request: CapsuleRequest, signal: AbortSignal): Promise<Capsule>;
  delivery(request: DeliveryRequest, signal: AbortSignal): Promise<DeliveryReceipt>;
}
export class HttpWorkerService implements WorkerService {
  constructor(private readonly http: OntologyHttp) {}
  identity(signal: AbortSignal): Promise<Identity> {
    return this.http.get('whoami', Identity.jsonCodec(), signal);
  }
  status(scope: string, signal: AbortSignal): Promise<CurationStatus> {
    return this.http.post('status', new ScopeRequest(scope), ScopeRequest.jsonCodec(), CurationStatus.jsonCodec(), signal);
  }
  ingest(request: IngestRequest, signal: AbortSignal): Promise<IngestResult> {
    return this.http.post('ingest', request, IngestRequest.jsonCodec(), IngestResult.jsonCodec(), signal);
  }
  capsule(request: CapsuleRequest, signal: AbortSignal): Promise<Capsule> {
    return this.http.post('capsule', request, CapsuleRequest.jsonCodec(), Capsule.jsonCodec(), signal);
  }
  delivery(request: DeliveryRequest, signal: AbortSignal): Promise<DeliveryReceipt> {
    return this.http.post('delivery', request, DeliveryRequest.jsonCodec(), DeliveryReceipt.jsonCodec(), signal);
  }
}
