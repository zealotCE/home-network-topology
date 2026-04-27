import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_NAME } from '@home-network-topology/shared';

import { openDatabase, type DatabaseOptions } from './db/connection.js';
import type { OpenWrtDiscoveryCollector } from './discovery/openWrtCollector.js';
import { TopologyRepository } from './repositories/topologyRepository.js';
import { apiRoutes } from './routes/api.js';
import { bootstrapRuntimeConfig, databaseOptionsFromRuntimeConfig, loadRuntimeConfigFromEnv, type LoadedRuntimeConfig } from './runtimeConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const frontendDistDir = resolve(__dirname, '../../frontend/dist');
const frontendIndexPath = join(frontendDistDir, 'index.html');
const frontendAssetsDir = join(frontendDistDir, 'assets');

export type BuildServerOptions = {
  database?: DatabaseOptions;
  discoveryCollector?: Pick<OpenWrtDiscoveryCollector, 'testConnection' | 'collectSnapshot'>;
  logger?: boolean;
  runtimeConfig?: LoadedRuntimeConfig;
};

export function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const runtimeConfig = options.runtimeConfig ?? loadRuntimeConfigFromEnv();
  const db = openDatabase(databaseOptionsFromRuntimeConfig(runtimeConfig, options.database));
  const repository = new TopologyRepository(db);
  bootstrapRuntimeConfig(repository, runtimeConfig);

  app.addHook('onClose', async () => {
    db.close();
  });

  app.register(apiRoutes, {
    prefix: '/api',
    repository,
    discoveryCollector: options.discoveryCollector,
    runtimeConfig,
  });

  if (existsSync(frontendAssetsDir)) {
    app.register(fastifyStatic, {
      root: frontendAssetsDir,
      prefix: '/assets/'
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (!request.url.startsWith('/api/') && existsSync(frontendIndexPath)) {
        return reply.type('text/html; charset=utf-8').send(readFileSync(frontendIndexPath, 'utf8'));
      }

      return reply.code(404).send({ message: 'Not found' });
    });
  }

  app.get('/', async (_request, reply) => {
    if (existsSync(frontendIndexPath)) {
      return reply.type('text/html; charset=utf-8').send(readFileSync(frontendIndexPath, 'utf8'));
    }

    return reply.type('application/json').send({
      app: APP_NAME,
      message: 'Frontend assets have not been built yet.'
    });
  });

  return app;
}

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

if (process.env.NODE_ENV !== 'test') {
  const app = buildServer();

  app.listen({ host, port }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}
