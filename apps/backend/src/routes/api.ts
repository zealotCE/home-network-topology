import type { FastifyPluginAsync } from 'fastify';
import type { HealthStatus } from '@home-network-topology/shared';

import { buildMergedTopologyGraph } from '../discovery/graphService.js';
import { OpenWrtDiscoveryCollector } from '../discovery/openWrtCollector.js';
import type { TopologyRepository } from '../repositories/topologyRepository.js';
import { summarizeRuntimeConfig, type LoadedRuntimeConfig } from '../runtimeConfig.js';
import { parseDiscoverySnapshot, parseOverlayGraph, parseRouterConnection } from './validation.js';

export type ApiRoutesOptions = {
  repository: TopologyRepository;
  discoveryCollector?: Pick<OpenWrtDiscoveryCollector, 'testConnection' | 'collectSnapshot'>;
  runtimeConfig: LoadedRuntimeConfig;
};

export const apiRoutes: FastifyPluginAsync<ApiRoutesOptions> = async (app, options) => {
  const { repository } = options;
  const discoveryCollector = options.discoveryCollector ?? new OpenWrtDiscoveryCollector();

  app.get('/health', async () => {
    repository.ping();
    const payload: HealthStatus = {
      status: 'ok',
      service: 'backend',
    };

    return payload;
  });

  app.get('/routers', async () => repository.listRouterConnections());

  app.get('/runtime-config', async () => summarizeRuntimeConfig(options.runtimeConfig));

  app.put('/routers/:id', async (request, reply) => {
    const params = parseIdParams(request.params);
    const parsed = parseRouterConnection(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ errors: parsed.errors });
    }

    if (parsed.value.id !== params.id) {
      return reply.code(400).send({ errors: ['router id must match route parameter'] });
    }

    return repository.upsertRouterConnection(parsed.value);
  });

  app.post('/routers', async (request, reply) => {
    const parsed = parseRouterConnection(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ errors: parsed.errors });
    }

    return reply.code(201).send(repository.upsertRouterConnection(parsed.value));
  });

  app.delete('/routers/:id', async (request, reply) => {
    const { id } = parseIdParams(request.params);
    const deleted = repository.deleteRouterConnection(id);
    return deleted ? reply.code(204).send() : reply.code(404).send({ message: 'Router connection not found' });
  });

  app.post('/routers/:id/test-connection', async (request, reply) => {
    const router = findRouter(repository, parseIdParams(request.params).id);
    if (!router) {
      return reply.code(404).send({ message: 'Router connection not found' });
    }

    return discoveryCollector.testConnection(router);
  });

  app.post('/routers/:id/discovery-runs', async (request, reply) => {
    const router = findRouter(repository, parseIdParams(request.params).id);
    if (!router) {
      return reply.code(404).send({ message: 'Router connection not found' });
    }

    const snapshot = await discoveryCollector.collectSnapshot(router);
    return reply.code(201).send(repository.saveSnapshot(snapshot));
  });

  app.get('/topology/snapshots', async () => repository.listSnapshotSummaries());

  app.get('/topology/snapshots/latest', async (request, reply) => {
    const snapshot = repository.getLatestSnapshot();
    return snapshot ?? reply.code(404).send({ message: 'No discovery snapshots have been captured yet' });
  });

  app.get('/topology/graph', async (request, reply) => {
    const snapshot = repository.getLatestSnapshot();
    if (!snapshot) {
      return reply.code(404).send({ message: 'No discovery snapshots have been captured yet' });
    }

    return buildMergedTopologyGraph(snapshot, repository.getOverlay());
  });

  app.get('/topology/snapshots/:id', async (request, reply) => {
    const { id } = parseIdParams(request.params);
    const snapshot = repository.getSnapshot(id);
    return snapshot ?? reply.code(404).send({ message: 'Discovery snapshot not found' });
  });

  app.post('/topology/snapshots', async (request, reply) => {
    const parsed = parseDiscoverySnapshot(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ errors: parsed.errors });
    }

    return reply.code(201).send(repository.saveSnapshot(parsed.value));
  });

  app.get('/topology/overlay', async () => repository.getOverlay());

  app.put('/topology/overlay', async (request, reply) => {
    const parsed = parseOverlayGraph(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ errors: parsed.errors });
    }

    return repository.replaceOverlay(parsed.value);
  });
};

function parseIdParams(params: unknown): { id: string } {
  if (typeof params === 'object' && params !== null && 'id' in params && typeof params.id === 'string') {
    return { id: params.id };
  }

  return { id: '' };
}

function findRouter(repository: TopologyRepository, id: string) {
  return repository.listRouterConnections().find((router) => router.id === id);
}
