import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

import { validateRuntimeConfig, type RuntimeConfig } from '@home-network-topology/shared';

import type { DatabaseOptions } from './db/connection.js';
import type { TopologyRepository } from './repositories/topologyRepository.js';

export type LoadedRuntimeConfig = Readonly<{
  path?: string;
  config: RuntimeConfig;
}>;

export type RuntimeConfigSummary = Readonly<{
  loaded: boolean;
  path?: string;
  routerCount: number;
  dataDirectory?: string;
  discoveryIntervalSeconds?: number;
  ui: NonNullable<RuntimeConfig['ui']>;
}>;

export function loadRuntimeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LoadedRuntimeConfig {
  const configPath = env.TOPOLOGY_CONFIG_PATH?.trim();
  if (!configPath) {
    return { config: {} };
  }

  if (!existsSync(configPath)) {
    throw new Error(`Runtime config file not found at TOPOLOGY_CONFIG_PATH=${configPath}`);
  }

  const parsed = YAML.parse(readFileSync(configPath, 'utf8')) as unknown;
  const result = validateRuntimeConfig(parsed ?? {});
  if (!result.ok) {
    throw new Error(`Runtime config validation failed: ${result.errors.join('; ')}`);
  }

  return { path: configPath, config: result.value };
}

export function databaseOptionsFromRuntimeConfig(loaded: LoadedRuntimeConfig, fallback?: DatabaseOptions): DatabaseOptions | undefined {
  if (fallback?.path || process.env.TOPOLOGY_DB_PATH || !loaded.config.dataDirectory) {
    return fallback;
  }

  return { ...fallback, path: join(loaded.config.dataDirectory, 'topology.sqlite') };
}

export function bootstrapRuntimeConfig(repository: TopologyRepository, loaded: LoadedRuntimeConfig): void {
  for (const router of loaded.config.routers ?? []) {
    repository.upsertRouterConnection(router);
  }
}

export function summarizeRuntimeConfig(loaded: LoadedRuntimeConfig): RuntimeConfigSummary {
  return {
    loaded: Boolean(loaded.path),
    path: loaded.path,
    routerCount: loaded.config.routers?.length ?? 0,
    dataDirectory: loaded.config.dataDirectory,
    discoveryIntervalSeconds: loaded.config.discoveryIntervalSeconds,
    ui: loaded.config.ui ?? {},
  };
}
