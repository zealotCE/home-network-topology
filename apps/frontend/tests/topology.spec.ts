import { expect, test, type Page } from '@playwright/test';
import type { OverlayGraph } from '@home-network-topology/shared';

const snapshot = {
  id: 'snapshot-qa',
  capturedAt: '2026-04-27T12:00:00.000Z',
  routers: [
    { id: 'main-router', label: 'Main Router', baseUrl: 'https://router.local', username: 'admin', passwordEnvVar: 'ROUTER_PASSWORD' },
    { id: 'garage-ap', label: 'Garage AP', baseUrl: 'https://garage-ap.local', username: 'admin', passwordEnvVar: 'AP_PASSWORD' },
  ],
  devices: [
    {
      id: 'device-laptop',
      macAddress: 'AA:BB:CC:DD:EE:01',
      ipAddresses: ['192.168.1.22'],
      discoveredHostname: 'work-laptop',
      vendor: 'Framework',
      wifiAssociations: [{ routerId: 'garage-ap', band: '5G', ssid: 'Home WiFi', signalDbm: -48 }],
      lastSeenAt: '2026-04-27T12:00:00.000Z',
    },
    {
      id: 'device-nas',
      macAddress: 'AA:BB:CC:DD:EE:02',
      ipAddresses: ['192.168.1.40'],
      dhcpHostname: 'media-nas',
      wifiAssociations: [],
      lastSeenAt: '2026-04-27T12:00:00.000Z',
    },
  ],
  topology: { nodes: [], edges: [] },
  rawCommands: [],
};

const graph = {
  discoveredGraph: {
    nodes: [
      { id: 'router-main-router', kind: 'router', label: 'Main Router', routerId: 'main-router' },
      { id: 'router-garage-ap', kind: 'router', label: 'Garage AP', routerId: 'garage-ap' },
      { id: 'device-laptop', kind: 'device', label: 'work-laptop', deviceId: 'device-laptop' },
      { id: 'device-nas', kind: 'device', label: 'media-nas', deviceId: 'device-nas' },
    ],
    edges: [
      { id: 'wifi-garage-laptop', sourceNodeId: 'router-garage-ap', targetNodeId: 'device-laptop', kind: 'wifi', band: '5G' },
      { id: 'ethernet-router-nas', sourceNodeId: 'router-main-router', targetNodeId: 'device-nas', kind: 'ethernet' },
    ],
  },
  overlayGraph: {
    manualSwitches: [{ id: 'switch-office', label: 'Office Switch', portCount: 8 }],
    deviceOverlays: [],
    edges: [{ id: 'manual-office-nas', sourceNodeId: 'switch-office', targetNodeId: 'device-nas', kind: 'manual' }],
  },
  mergedGraph: {
    nodes: [
      { id: 'router-main-router', kind: 'router', label: 'Main Router', routerId: 'main-router' },
      { id: 'router-garage-ap', kind: 'router', label: 'Garage AP', routerId: 'garage-ap' },
      { id: 'switch-office', kind: 'manualSwitch', label: 'Office Switch' },
      { id: 'device-laptop', kind: 'device', label: 'work-laptop', deviceId: 'device-laptop' },
      { id: 'device-nas', kind: 'device', label: 'media-nas', deviceId: 'device-nas' },
    ],
    edges: [
      { id: 'wifi-garage-laptop', sourceNodeId: 'router-garage-ap', targetNodeId: 'device-laptop', kind: 'wifi', band: '5G' },
      { id: 'ethernet-router-nas', sourceNodeId: 'router-main-router', targetNodeId: 'device-nas', kind: 'ethernet' },
      { id: 'manual-office-nas', sourceNodeId: 'switch-office', targetNodeId: 'device-nas', kind: 'manual' },
    ],
  },
};

const runtimeConfig = {
  loaded: false,
  routerCount: 0,
  ui: {},
};

test('renders the composed topology and inspector metadata', async ({ page }) => {
  await mockTopology(page, { graph, snapshot, routers: snapshot.routers });

  await page.goto('/');

  await expect(page.getByTestId('topology-workspace')).toBeVisible();
  await expect(page.getByText('5 nodes · 3 links')).toBeVisible();
  await expect(page.getByTestId('topology-node-router-main-router')).toContainText('Main Router');
  await expect(page.getByTestId('topology-node-router-garage-ap')).toContainText('Garage AP');
  await expect(page.getByTestId('topology-node-switch-office')).toContainText('Office Switch');
  await expect(page.getByText('Wi‑Fi devices')).toBeVisible();

  await page.getByTestId('topology-node-device-laptop').click();
  await expect(page.getByTestId('topology-inspector')).toContainText('AA:BB:CC:DD:EE:01');
  await expect(page.getByTestId('topology-inspector')).toContainText('192.168.1.22');
  await expect(page.getByTestId('topology-inspector')).toContainText('wifi · 5G');
});

test('renders an empty composed graph state', async ({ page }) => {
  await mockTopology(page, {
    graph: {
      discoveredGraph: { nodes: [], edges: [] },
      overlayGraph: { manualSwitches: [], deviceOverlays: [], edges: [] },
      mergedGraph: { nodes: [], edges: [] },
    },
    snapshot: { ...snapshot, devices: [], topology: { nodes: [], edges: [] } },
    routers: [],
  });

  await page.goto('/');

  await expect(page.getByTestId('topology-empty-state')).toBeVisible();
  await expect(page.getByText('Run discovery to populate the canvas.')).toBeVisible();
});

test('keeps setup reachable when the graph API is unavailable', async ({ page }) => {
  await page.route('**/api/runtime-config', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runtimeConfig) });
  });
  await page.route('**/api/topology/graph', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'database unavailable' }) });
  });
  await page.route('**/api/topology/snapshots/latest', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'none' }) });
  });
  await page.route('**/api/routers', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.goto('/');

  await expect(page.getByTestId('router-setup-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Topology' }).click();
  await expect(page.getByTestId('topology-missing-state')).toBeVisible();
  await expect(page.getByTestId('topology-missing-state')).toContainText('database unavailable');
});

test('creates a router, tests connection, and runs discovery from setup', async ({ page }) => {
  const routers = [...snapshot.routers];
  let discoveryRuns = 0;

  await page.route('**/api/runtime-config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        loaded: true,
        path: '/etc/topology/config.yaml',
        routerCount: 1,
        dataDirectory: '/data',
        ui: { defaultView: 'setup', setupHelpText: 'Mounted config can prefill router definitions.' },
      }),
    });
  });
  await page.route('**/api/routers', async (route) => {
    if (route.request().method() === 'POST') {
      const router = await route.request().postDataJSON();
      routers.push(router);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(router) });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(routers) });
  });
  await page.route('**/api/routers/**/test-connection', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ routerId: 'lab-router', reachable: true }) });
  });
  await page.route('**/api/routers/**/discovery-runs', async (route) => {
    discoveryRuns += 1;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...snapshot, id: 'snapshot-discovered' }) });
  });
  await page.route('**/api/topology/graph', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) });
  });
  await page.route('**/api/topology/snapshots/latest', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) });
  });

  await page.goto('/');

  await expect(page.getByTestId('router-setup-panel')).toBeVisible();
  await expect(page.getByTestId('runtime-config-summary')).toContainText('Mounted');
  await page.getByLabel('Router ID').fill('lab-router');
  await page.getByLabel('Display label').fill('Lab Router');
  await page.getByLabel('Web UI URL').fill('https://192.168.1.2');
  await page.getByLabel('SSH username').fill('root');
  await page.getByLabel('Password env var').fill('LAB_OPENWRT_PASSWORD');
  await page.getByRole('button', { name: 'Create router' }).click();
  await expect(page.getByRole('status')).toContainText('Lab Router saved');
  await expect(page.getByTestId('router-card-lab-router')).toContainText('secret from LAB_OPENWRT_PASSWORD');

  await page.getByTestId('router-card-lab-router').getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('status')).toContainText('Lab Router is reachable');

  await page.getByTestId('router-card-lab-router').getByRole('button', { name: 'Run discovery' }).click();
  await expect(page.getByRole('status')).toContainText('Discovery finished for Lab Router');
  expect(discoveryRuns).toBe(1);
});

test('adds a manual switch and keeps it after reload', async ({ page }) => {
  const api = await mockEditableTopology(page);

  await page.goto('/');

  await page.getByRole('button', { name: 'Add switch' }).click();

  await expect(page.getByRole('status')).toContainText('Manual switch saved');
  expect(api.overlay.manualSwitches).toHaveLength(2);
  expect(api.overlay.manualSwitches[1]).toMatchObject({ label: 'Unmanaged switch', portCount: 8 });
  expect(api.overlay.nodePositions?.some((position) => position.nodeId === api.overlay.manualSwitches[1].id)).toBe(true);
  await expect(page.getByTestId(`topology-node-${api.overlay.manualSwitches[1].id}`)).toContainText('Unmanaged switch');

  await page.reload();

  await expect(page.getByTestId(`topology-node-${api.overlay.manualSwitches[1].id}`)).toContainText('Unmanaged switch');
});

test('persists inspector labels, notes, tags, hidden links, and relayout state', async ({ page }) => {
  const api = await mockEditableTopology(page);

  await page.goto('/');
  await page.getByTestId('topology-node-device-laptop').click();

  await page.getByLabel('Display label').fill('Studio laptop');
  await page.getByLabel('Notes').fill('Lives on the office desk');
  await page.getByLabel('Tags').fill('office, critical');
  await page.getByRole('button', { name: 'Save edits' }).click();

  await expect(page.getByRole('status')).toContainText('Device edits saved');
  expect(api.overlay.deviceOverlays).toContainEqual({
    deviceId: 'device-laptop',
    displayName: 'Studio laptop',
    notes: 'Lives on the office desk',
    tags: ['critical', 'office'],
  });
  await expect(page.getByTestId('topology-node-device-laptop')).toContainText('Studio laptop');

  await page.getByRole('button', { name: 'Hide' }).nth(1).click();
  await expect(page.getByRole('status')).toContainText('Link hidden');
  expect(api.overlay.hiddenEdgeIds).toContain('wifi-garage-laptop');

  api.overlay.nodePositions = [{ nodeId: 'device-laptop', x: 320, y: 180 }];
  await page.getByRole('button', { name: 'Re-layout' }).click();
  await expect(page.getByRole('status')).toContainText('Layout reset');
  expect(api.overlay.nodePositions).toEqual([]);

  await page.reload();

  await expect(page.getByTestId('topology-node-device-laptop')).toContainText('Studio laptop');
});

async function mockTopology(page: Page, payload: { graph: unknown; snapshot: unknown; routers: unknown }) {
  await page.route('**/api/runtime-config', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runtimeConfig) });
  });
  await page.route('**/api/topology/graph', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload.graph) });
  });
  await page.route('**/api/topology/snapshots/latest', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload.snapshot) });
  });
  await page.route('**/api/routers', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload.routers) });
  });
}

async function mockEditableTopology(page: Page) {
  const state = {
    overlay: structuredClone(graph.overlayGraph) as OverlayGraph,
  };

  await page.route('**/api/runtime-config', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runtimeConfig) });
  });

  await page.route('**/api/topology/overlay', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.overlay) });
      return;
    }

    state.overlay = await route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.overlay) });
  });
  await page.route('**/api/topology/graph', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(composeGraph(state.overlay)) });
  });
  await page.route('**/api/topology/snapshots/latest', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) });
  });
  await page.route('**/api/routers', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot.routers) });
  });

  return state;
}

function composeGraph(overlay: OverlayGraph) {
  const deviceOverlays = new Map(overlay.deviceOverlays.map((entry) => [entry.deviceId, entry]));
  const hiddenDeviceIds = new Set(overlay.deviceOverlays.filter((entry) => entry.hidden).map((entry) => entry.deviceId));
  const hiddenNodeIds = new Set(overlay.hiddenNodeIds ?? []);
  const hiddenEdgeIds = new Set(overlay.hiddenEdgeIds ?? []);
  const discoveredNodes = graph.discoveredGraph.nodes
    .filter((node) => !hiddenNodeIds.has(node.id) && (!node.deviceId || !hiddenDeviceIds.has(node.deviceId)))
    .map((node) => {
      const displayName = node.deviceId ? deviceOverlays.get(node.deviceId)?.displayName : undefined;
      return displayName ? { ...node, label: displayName } : node;
    });
  const manualNodes = overlay.manualSwitches
    .filter((manualSwitch) => !manualSwitch.hidden && !hiddenNodeIds.has(manualSwitch.id))
    .map((manualSwitch) => ({ id: manualSwitch.id, kind: 'manualSwitch', label: manualSwitch.label }));
  const visibleNodeIds = new Set([...discoveredNodes, ...manualNodes].map((node) => node.id));
  const isVisibleEdge = (edge: { id: string; sourceNodeId: string; targetNodeId: string }) => !hiddenEdgeIds.has(edge.id) && visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId);

  return {
    discoveredGraph: graph.discoveredGraph,
    overlayGraph: overlay,
    mergedGraph: {
      nodes: [...discoveredNodes, ...manualNodes],
      edges: [...graph.discoveredGraph.edges.filter(isVisibleEdge), ...overlay.edges.filter(isVisibleEdge)],
    },
  };
}
