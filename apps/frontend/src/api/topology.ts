import type { DiscoverySnapshot, OverlayGraph, RouterConnection } from '@home-network-topology/shared';

import type { ComposedTopologyGraph, TopologyData } from '../types/topology';

type ApiErrorBody = Readonly<{
  message?: string;
  errors?: readonly string[];
}>;

export async function fetchTopologyData(signal?: AbortSignal): Promise<TopologyData> {
  const [graph, snapshot, routers] = await Promise.all([
    requestJson<ComposedTopologyGraph>('/api/topology/graph', signal),
    requestOptionalJson<DiscoverySnapshot>('/api/topology/snapshots/latest', signal),
    requestJson<RouterConnection[]>('/api/routers', signal),
  ]);

  return { graph, snapshot, routers };
}

export async function fetchRouterConnections(signal?: AbortSignal): Promise<RouterConnection[]> {
  return requestJson<RouterConnection[]>('/api/routers', signal);
}

export async function saveOverlayGraph(overlay: OverlayGraph, signal?: AbortSignal): Promise<OverlayGraph> {
  const response = await fetch('/api/topology/overlay', {
    method: 'PUT',
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(overlay),
  });

  return parseResponse<OverlayGraph>(response, '/api/topology/overlay');
}

export type RuntimeConfigSummary = Readonly<{
  loaded: boolean;
  path?: string;
  routerCount: number;
  dataDirectory?: string;
  discoveryIntervalSeconds?: number;
  ui: Readonly<{
    defaultView?: 'topology' | 'setup';
    setupHelpText?: string;
  }>;
}>;

export type RouterConnectionTestResult = Readonly<{
  routerId: string;
  reachable: boolean;
}>;

export async function fetchRuntimeConfig(signal?: AbortSignal): Promise<RuntimeConfigSummary> {
  return requestJson<RuntimeConfigSummary>('/api/runtime-config', signal);
}

export async function createRouterConnection(router: RouterConnection, signal?: AbortSignal): Promise<RouterConnection> {
  const response = await fetch('/api/routers', {
    method: 'POST',
    signal,
    headers: jsonHeaders(),
    body: JSON.stringify(router),
  });

  return parseResponse<RouterConnection>(response, '/api/routers');
}

export async function testRouterConnection(routerId: string, signal?: AbortSignal): Promise<RouterConnectionTestResult> {
  const response = await fetch(`/api/routers/${encodeURIComponent(routerId)}/test-connection`, {
    method: 'POST',
    signal,
    headers: jsonHeaders(),
  });

  return parseResponse<RouterConnectionTestResult>(response, `/api/routers/${routerId}/test-connection`);
}

export async function runRouterDiscovery(routerId: string, signal?: AbortSignal): Promise<DiscoverySnapshot> {
  const response = await fetch(`/api/routers/${encodeURIComponent(routerId)}/discovery-runs`, {
    method: 'POST',
    signal,
    headers: jsonHeaders(),
  });

  return parseResponse<DiscoverySnapshot>(response, `/api/routers/${routerId}/discovery-runs`);
}

async function requestOptionalJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const response = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  if (response.status === 404) {
    return null;
  }

  return parseResponse<T>(response, path);
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  return parseResponse<T>(response, path);
}

function jsonHeaders(): HeadersInit {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function parseResponse<T>(response: Response, path: string): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }

  let details = response.statusText;
  try {
    const body = (await response.json()) as ApiErrorBody;
    details = body.errors?.join(', ') || body.message || details;
  } catch {
    details = response.statusText || 'Unexpected API response';
  }

  throw new Error(`${path} failed (${response.status}): ${details}`);
}
