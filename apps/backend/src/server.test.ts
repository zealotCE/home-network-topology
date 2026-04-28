import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { DiscoveryCommandResult, DiscoverySnapshot, OverlayGraph, RouterConnection } from '@home-network-topology/shared';

import { buildServer } from './server.js';

test('health endpoint reports backend status', async (t) => {
  const app = buildServer({ database: { path: ':memory:' }, logger: false });
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({ method: 'GET', url: '/api/health' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok', service: 'backend' });
});

test('router connections are persisted through the REST API', async (t) => {
  const app = buildServer({ database: { path: ':memory:' }, logger: false });
  t.after(async () => {
    await app.close();
  });

  const router: RouterConnection = {
    id: 'main-router',
    label: 'Main router',
    baseUrl: 'https://router.local',
    username: 'admin',
    identityFileEnvVar: 'MAIN_ROUTER_IDENTITY_FILE',
  };

  const createResponse = await app.inject({ method: 'POST', url: '/api/routers', payload: router });
  assert.equal(createResponse.statusCode, 201);
  assert.deepEqual(createResponse.json(), router);

  const listResponse = await app.inject({ method: 'GET', url: '/api/routers' });
  assert.equal(listResponse.statusCode, 200);
  assert.deepEqual(listResponse.json(), [router]);

  const deleteResponse = await app.inject({ method: 'DELETE', url: '/api/routers/main-router' });
  assert.equal(deleteResponse.statusCode, 204);

  const emptyListResponse = await app.inject({ method: 'GET', url: '/api/routers' });
  assert.deepEqual(emptyListResponse.json(), []);
});

test('runtime YAML config bootstraps routers and exposes safe UI defaults', async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'topology-config-test-'));
  t.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
  const configPath = join(tempDir, 'config.yaml');
  writeFileSync(configPath, `
dataDirectory: ${tempDir}
discoveryIntervalSeconds: 900
ui:
  defaultView: setup
  setupHelpText: 已挂载 YAML 配置作为路由器默认值。
routers:
  - id: config-router
    label: 配置路由器
    baseUrl: https://192.168.1.1
    username: root
    sshHost: 192.168.1.1
    sshPort: 22
    identityFileEnvVar: OPENWRT_IDENTITY_FILE
`);

  const previousConfigPath = process.env.TOPOLOGY_CONFIG_PATH;
  process.env.TOPOLOGY_CONFIG_PATH = configPath;
  const app = buildServer({ logger: false });
  t.after(async () => {
    await app.close();
    if (previousConfigPath === undefined) {
      delete process.env.TOPOLOGY_CONFIG_PATH;
    } else {
      process.env.TOPOLOGY_CONFIG_PATH = previousConfigPath;
    }
  });

  const routersResponse = await app.inject({ method: 'GET', url: '/api/routers' });
  assert.equal(routersResponse.statusCode, 200);
  assert.deepEqual(routersResponse.json(), [{
    id: 'config-router',
    label: '配置路由器',
    baseUrl: 'https://192.168.1.1',
    username: 'root',
    sshHost: '192.168.1.1',
    sshPort: 22,
    identityFileEnvVar: 'OPENWRT_IDENTITY_FILE',
  }]);

  const configResponse = await app.inject({ method: 'GET', url: '/api/runtime-config' });
  assert.equal(configResponse.statusCode, 200);
  assert.deepEqual(configResponse.json(), {
    loaded: true,
    path: configPath,
    routerCount: 1,
    dataDirectory: tempDir,
    discoveryIntervalSeconds: 900,
    ui: {
      defaultView: 'setup',
      setupHelpText: '已挂载 YAML 配置作为路由器默认值。',
    },
  });
});

test('snapshots and overlays round-trip through SQLite-backed routes', async (t) => {
  const app = buildServer({ database: { path: ':memory:' }, logger: false });
  t.after(async () => {
    await app.close();
  });

  const snapshot: DiscoverySnapshot = {
    id: 'snapshot-1',
    capturedAt: '2026-04-27T10:00:00.000Z',
    routers: [
      {
        id: 'main-router',
        label: 'Main router',
        baseUrl: 'https://router.local',
        username: 'admin',
        identityFileEnvVar: 'MAIN_ROUTER_IDENTITY_FILE',
      },
    ],
    devices: [
      {
        id: 'device-1',
        macAddress: 'AA:BB:CC:DD:EE:FF',
        ipAddresses: ['192.168.1.20'],
        discoveredHostname: 'laptop',
        wifiAssociations: [
          {
            routerId: 'main-router',
            band: '5G',
            ssid: 'Home WiFi',
          },
        ],
        lastSeenAt: '2026-04-27T10:00:00.000Z',
      },
    ],
    topology: {
      nodes: [
        { id: 'router-node', kind: 'router', label: 'Main router', routerId: 'main-router' },
        { id: 'device-node', kind: 'device', label: 'laptop', deviceId: 'device-1' },
      ],
      edges: [
        { id: 'wifi-edge', sourceNodeId: 'router-node', targetNodeId: 'device-node', kind: 'wifi', band: '5G' },
      ],
    },
  };

  const overlay: OverlayGraph = {
    manualSwitches: [{ id: 'switch-1', label: 'Office switch', portCount: 8, notes: 'desk', tags: ['office'] }],
    deviceOverlays: [{ deviceId: 'device-1', displayName: 'Work laptop', notes: 'Pinned name', tags: ['work'] }],
    edges: [{ id: 'manual-edge', sourceNodeId: 'switch-1', targetNodeId: 'device-node', kind: 'manual' }],
    nodePositions: [{ nodeId: 'device-node', x: 120, y: 240 }],
    hiddenNodeIds: ['router-node-hidden'],
    hiddenEdgeIds: ['wifi-edge-hidden'],
  };

  const createSnapshotResponse = await app.inject({ method: 'POST', url: '/api/topology/snapshots', payload: snapshot });
  assert.equal(createSnapshotResponse.statusCode, 201);
  assert.deepEqual(createSnapshotResponse.json(), snapshot);

  const latestSnapshotResponse = await app.inject({ method: 'GET', url: '/api/topology/snapshots/latest' });
  assert.equal(latestSnapshotResponse.statusCode, 200);
  assert.deepEqual(latestSnapshotResponse.json(), { ...snapshot, rawCommands: [] });

  const updateOverlayResponse = await app.inject({ method: 'PUT', url: '/api/topology/overlay', payload: overlay });
  assert.equal(updateOverlayResponse.statusCode, 200);
  assert.deepEqual(updateOverlayResponse.json(), overlay);

  const getOverlayResponse = await app.inject({ method: 'GET', url: '/api/topology/overlay' });
  assert.equal(getOverlayResponse.statusCode, 200);
  assert.deepEqual(getOverlayResponse.json(), {
    ...overlay,
    manualSwitches: [{ ...overlay.manualSwitches[0], hidden: false }],
    deviceOverlays: [{ ...overlay.deviceOverlays[0], hidden: false }],
  });
});

test('topology graph composes the latest snapshot for each router', async (t) => {
  const app = buildServer({ database: { path: ':memory:' }, logger: false });
  t.after(async () => {
    await app.close();
  });

  const mainSnapshot = snapshotForRouter('snapshot-main-old', '2026-04-27T10:00:00.000Z', 'main-router', 'Main router', 'device-laptop', 'Laptop');
  const staleMainSnapshot = snapshotForRouter('snapshot-main-stale', '2026-04-27T09:00:00.000Z', 'main-router', 'Main router stale', 'device-old', 'Old laptop');
  const garageSnapshot = snapshotForRouter('snapshot-garage', '2026-04-27T11:00:00.000Z', 'garage-ap', 'Garage AP', 'device-camera', 'Camera');

  for (const snapshot of [staleMainSnapshot, mainSnapshot, garageSnapshot]) {
    const response = await app.inject({ method: 'POST', url: '/api/topology/snapshots', payload: snapshot });
    assert.equal(response.statusCode, 201);
  }

  const graphResponse = await app.inject({ method: 'GET', url: '/api/topology/graph' });

  assert.equal(graphResponse.statusCode, 200);
  const graph = graphResponse.json() as { discoveredGraph: { nodes: Array<{ id: string }> } };
  assert.deepEqual(graph.discoveredGraph.nodes.map((node) => node.id), [
    'router-garage-ap',
    'router-main-router',
    'device-camera',
    'device-laptop',
  ]);
});

test('discovery route runs collector and persists raw command results', async (t) => {
  const rawCommand: DiscoveryCommandResult = {
    label: 'network_interfaces',
    command: ['ubus', 'call', 'network.interface', 'dump'],
    startedAt: '2026-04-27T10:00:00.000Z',
    completedAt: '2026-04-27T10:00:01.000Z',
    exitCode: 0,
    signal: null,
    stdout: '{"interface":[]}\n',
    stderr: '',
    timedOut: false,
  };
  const router: RouterConnection = {
    id: 'main-router',
    label: 'Main router',
    baseUrl: 'https://router.local',
    username: 'root',
    identityFileEnvVar: 'ROUTER_IDENTITY_FILE',
    sshHost: '192.168.1.1',
    sshPort: 22,
  };
  const snapshot: DiscoverySnapshot = {
    id: 'snapshot-from-collector',
    capturedAt: '2026-04-27T10:00:00.000Z',
    routers: [router],
    devices: [],
    topology: { nodes: [{ id: 'router-main-router', kind: 'router', label: 'Main router', routerId: 'main-router' }], edges: [] },
    rawCommands: [rawCommand],
  };
  const app = buildServer({
    database: { path: ':memory:' },
    logger: false,
    discoveryCollector: {
      testConnection: async () => ({ routerId: router.id, reachable: true, command: rawCommand }),
      collectSnapshot: async (inputRouter) => ({ ...snapshot, routers: [inputRouter] }),
    },
  });
  t.after(async () => {
    await app.close();
  });

  assert.equal((await app.inject({ method: 'POST', url: '/api/routers', payload: router })).statusCode, 201);

  const testResponse = await app.inject({ method: 'POST', url: '/api/routers/main-router/test-connection' });
  assert.equal(testResponse.statusCode, 200);
  assert.equal(testResponse.json().reachable, true);

  const discoveryResponse = await app.inject({ method: 'POST', url: '/api/routers/main-router/discovery-runs' });
  assert.equal(discoveryResponse.statusCode, 201);
  assert.deepEqual(discoveryResponse.json().rawCommands, [rawCommand]);

  const latestSnapshotResponse = await app.inject({ method: 'GET', url: '/api/topology/snapshots/latest' });
  assert.equal(latestSnapshotResponse.statusCode, 200);
  assert.deepEqual(latestSnapshotResponse.json().rawCommands, [rawCommand]);
});

test('candidate router connection test does not persist unsaved routers', async (t) => {
  const router: RouterConnection = {
    id: 'candidate-router',
    label: 'Candidate router',
    baseUrl: 'https://192.168.1.2',
    username: 'root',
    sshPort: 22,
  };
  const app = buildServer({
    database: { path: ':memory:' },
    logger: false,
    discoveryCollector: {
      testConnection: async (inputRouter) => ({ routerId: inputRouter.id, reachable: true, command: emptyCommandResult() }),
      collectSnapshot: async () => ({ id: 'unused', capturedAt: new Date(0).toISOString(), routers: [], devices: [], topology: { nodes: [], edges: [] } }),
    },
  });
  t.after(async () => {
    await app.close();
  });

  const testResponse = await app.inject({ method: 'POST', url: '/api/routers/test-connection', payload: router });
  assert.equal(testResponse.statusCode, 200);
  assert.deepEqual(testResponse.json(), { routerId: 'candidate-router', reachable: true, command: emptyCommandResult() });

  const listResponse = await app.inject({ method: 'GET', url: '/api/routers' });
  assert.equal(listResponse.statusCode, 200);
  assert.deepEqual(listResponse.json(), []);
});

function snapshotForRouter(snapshotId: string, capturedAt: string, routerId: string, routerLabel: string, deviceId: string, deviceLabel: string): DiscoverySnapshot {
  return {
    id: snapshotId,
    capturedAt,
    routers: [{ id: routerId, label: routerLabel, baseUrl: `https://${routerId}.local`, username: 'root', identityFileEnvVar: `${routerId.toUpperCase().replace(/-/gu, '_')}_IDENTITY_FILE` }],
    devices: [{ id: deviceId, macAddress: 'AA:BB:CC:DD:EE:FF', ipAddresses: [], discoveredHostname: deviceLabel, wifiAssociations: [{ routerId, band: '5G' }], lastSeenAt: capturedAt }],
    topology: {
      nodes: [
        { id: `router-${routerId}`, kind: 'router', label: routerLabel, routerId },
        { id: deviceId, kind: 'device', label: deviceLabel, deviceId },
      ],
      edges: [{ id: `wifi-${routerId}-${deviceId}`, sourceNodeId: `router-${routerId}`, targetNodeId: deviceId, kind: 'wifi', band: '5G' }],
    },
  };
}

function emptyCommandResult(): DiscoveryCommandResult {
  return {
    label: 'connection_test',
    command: ['ubus', 'call', 'system', 'board'],
    startedAt: '2026-04-27T10:00:00.000Z',
    completedAt: '2026-04-27T10:00:01.000Z',
    exitCode: 0,
    signal: null,
    stdout: '{}',
    stderr: '',
    timedOut: false,
  };
}
