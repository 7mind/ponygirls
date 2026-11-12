import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient } from './client.js';
import App from './App.js';
import { WireValidation } from './wire-validation.js';
import { wirePlan } from '../../generated/typescript/GeneratedWirePlan.js';

function createApiClient(fetcher: typeof fetch): ApiClient {
  return new ApiClient(fetcher, new WireValidation(wirePlan));
}

function mount(): void {
  const container = document.getElementById('root');
  if (!container) throw new Error('Missing application root');
  const client = createApiClient(window.fetch.bind(window));
  const newRequestId = window.crypto.randomUUID.bind(window.crypto);
  createRoot(container).render(
    <StrictMode><App client={client} newRequestId={newRequestId} /></StrictMode>,
  );
}

mount();
