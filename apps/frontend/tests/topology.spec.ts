import { expect, test, type Page } from '@playwright/test';
import type { OverlayGraph } from '@home-network-topology/shared';

const snapshot = {
  id: 'snapshot-qa',
  capturedAt: '2026-04-27T12:00:00.000Z',
  routers: [
    { id: 'main-router', label: '主路由器', baseUrl: 'https://router.local', username: 'admin', identityFileEnvVar: 'ROUTER_IDENTITY_FILE' },
    { id: 'garage-ap', label: '车库 AP', baseUrl: 'https://garage-ap.local', username: 'admin', identityFileEnvVar: 'AP_IDENTITY_FILE' },
  ],
  devices: [
    {
      id: 'device-laptop',
      macAddress: 'AA:BB:CC:DD:EE:01',
      ipAddresses: ['192.168.1.22'],
      discoveredHostname: '工作笔记本',
      vendor: 'Framework',
      wifiAssociations: [{ routerId: 'garage-ap', band: '5G', ssid: '家庭 Wi‑Fi', signalDbm: -48 }],
      lastSeenAt: '2026-04-27T12:00:00.000Z',
    },
    {
      id: 'device-nas',
      macAddress: 'AA:BB:CC:DD:EE:02',
      ipAddresses: ['192.168.1.40'],
      dhcpHostname: '媒体 NAS',
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
      { id: 'router-main-router', kind: 'router', label: '主路由器', routerId: 'main-router' },
      { id: 'router-garage-ap', kind: 'router', label: '车库 AP', routerId: 'garage-ap' },
      { id: 'device-laptop', kind: 'device', label: '工作笔记本', deviceId: 'device-laptop' },
      { id: 'device-nas', kind: 'device', label: '媒体 NAS', deviceId: 'device-nas' },
    ],
    edges: [
      { id: 'wifi-garage-laptop', sourceNodeId: 'router-garage-ap', targetNodeId: 'device-laptop', kind: 'wifi', band: '5G' },
      { id: 'ethernet-router-nas', sourceNodeId: 'router-main-router', targetNodeId: 'device-nas', kind: 'ethernet' },
    ],
  },
  overlayGraph: {
    manualSwitches: [{ id: 'switch-office', label: '办公室交换机', portCount: 8 }],
    deviceOverlays: [],
    edges: [{ id: 'manual-office-nas', sourceNodeId: 'switch-office', targetNodeId: 'device-nas', kind: 'manual' }],
  },
  mergedGraph: {
    nodes: [
      { id: 'router-main-router', kind: 'router', label: '主路由器', routerId: 'main-router' },
      { id: 'router-garage-ap', kind: 'router', label: '车库 AP', routerId: 'garage-ap' },
      { id: 'switch-office', kind: 'manualSwitch', label: '办公室交换机' },
      { id: 'device-laptop', kind: 'device', label: '工作笔记本', deviceId: 'device-laptop' },
      { id: 'device-nas', kind: 'device', label: '媒体 NAS', deviceId: 'device-nas' },
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
  await expect(page.getByText('5 个节点 · 3 条连接')).toBeVisible();
  await expect(page.getByTestId('topology-node-router-main-router')).toContainText('主路由器');
  await expect(page.getByTestId('topology-node-router-garage-ap')).toContainText('车库 AP');
  await expect(page.getByTestId('topology-node-switch-office')).toContainText('办公室交换机');
  await expect(page.getByText('Wi‑Fi 设备')).toBeVisible();

  await page.getByLabel('搜索可见设备').fill('192.168.1.40');
  await page.getByTestId('device-search-list').getByRole('button', { name: /媒体 NAS/ }).click();
  await expect(page.getByTestId('topology-inspector')).toContainText('AA:BB:CC:DD:EE:02');

  await page.getByTestId('topology-node-device-laptop').click();
  await expect(page.getByTestId('topology-inspector')).toContainText('AA:BB:CC:DD:EE:01');
  await expect(page.getByTestId('topology-inspector')).toContainText('192.168.1.22');
  await expect(page.getByTestId('topology-inspector')).toContainText('Wi‑Fi · 5G');
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
  await expect(page.getByText('运行发现后即可生成网络图。')).toBeVisible();
});

test('keeps setup reachable when the graph API is unavailable', async ({ page }) => {
  await page.route('**/api/runtime-config', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runtimeConfig) });
  });
  await page.route('**/api/topology/graph', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '数据库不可用' }) });
  });
  await page.route('**/api/topology/snapshots/latest', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'none' }) });
  });
  await page.route('**/api/routers', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.goto('/');

  await expect(page.getByTestId('router-setup-panel')).toBeVisible();
  await page.getByRole('button', { name: '拓扑图' }).click();
  await expect(page.getByTestId('topology-missing-state')).toBeVisible();
  await expect(page.getByTestId('topology-missing-state')).toContainText('数据库不可用');
});

test('requires pre-save testing, normalizes host input, edits, deletes, and runs discovery from setup', async ({ page }) => {
  const routers = [...snapshot.routers];
  let discoveryRuns = 0;
  let candidateTests = 0;
  let savedPayload: unknown;

  await page.route('**/api/runtime-config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        loaded: true,
        path: '/etc/topology/config.yaml',
        routerCount: 1,
        dataDirectory: '/data',
        ui: { defaultView: 'setup', setupHelpText: '已挂载的配置可以预填路由器定义。' },
      }),
    });
  });
  await page.route('**/api/routers', async (route) => {
    if (route.request().method() === 'POST') {
      const router = await route.request().postDataJSON();
      savedPayload = router;
      routers.push(router);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(router) });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(routers) });
  });
  await page.route('**/api/routers/lab-router', async (route) => {
    if (route.request().method() === 'PUT') {
      const router = await route.request().postDataJSON();
      const index = routers.findIndex((entry) => entry.id === 'lab-router');
      routers[index] = router;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(router) });
      return;
    }

    if (route.request().method() === 'DELETE') {
      const index = routers.findIndex((entry) => entry.id === 'lab-router');
      routers.splice(index, 1);
      await route.fulfill({ status: 204 });
      return;
    }

    await route.fallback();
  });
  await page.route('**/api/routers/**/test-connection', async (route) => {
    if (route.request().url().endsWith('/api/routers/test-connection')) {
      candidateTests += 1;
      const router = await route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ routerId: router.id, reachable: true }) });
      return;
    }

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
  await expect(page.getByText('先测试，再保存，最后发现 OpenWrt 拓扑')).toBeVisible();
  await expect(page.getByTestId('runtime-config-summary')).toContainText('已挂载');
  await page.getByLabel('路由器 ID').fill('lab-router');
  await page.getByLabel('显示名称').fill('实验室路由');
  await page.getByLabel('WebUI 主机或 URL').fill('192.168.1.2');
  await page.getByLabel('SSH 用户名').fill('root');
  await page.getByLabel('密钥文件环境变量').fill('LAB_OPENWRT_IDENTITY_FILE');
  await expect(page.getByRole('button', { name: '添加路由器' })).toBeDisabled();

  await page.getByRole('button', { name: '测试连接' }).click();
  await expect(page.getByRole('status')).toContainText('已确认 WebUI 地址：https://192.168.1.2');
  await expect(page.getByLabel('WebUI 主机或 URL')).toHaveValue('https://192.168.1.2');
  expect(candidateTests).toBe(1);

  await page.getByRole('button', { name: '添加路由器' }).click();
  await expect(page.getByRole('status')).toContainText('实验室路由 已保存');
  expect(savedPayload).toMatchObject({ baseUrl: 'https://192.168.1.2' });
  await expect(page.getByTestId('router-card-lab-router')).toContainText('密钥来自 LAB_OPENWRT_IDENTITY_FILE');

  await page.getByTestId('router-card-lab-router').getByRole('button', { name: '编辑' }).click();
  await page.getByLabel('显示名称').fill('实验室路由二号');
  await expect(page.getByRole('button', { name: '保存修改' })).toBeDisabled();
  await page.getByRole('button', { name: '测试连接' }).click();
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('status')).toContainText('实验室路由二号 已保存');

  await page.getByTestId('router-card-lab-router').getByRole('button', { name: '测试' }).click();
  await expect(page.getByRole('status')).toContainText('实验室路由二号 可连接');

  await page.getByTestId('router-card-lab-router').getByRole('button', { name: '运行发现' }).click();
  await expect(page.getByRole('status')).toContainText('实验室路由二号 发现完成');
  expect(discoveryRuns).toBe(1);

  await page.getByTestId('router-card-lab-router').getByRole('button', { name: '删除' }).click();
  await expect(page.getByRole('status')).toContainText('实验室路由二号 已删除');
  await expect(page.getByTestId('router-card-lab-router')).toBeHidden();
});

test('adds a manual switch and keeps it after reload', async ({ page }) => {
  const api = await mockEditableTopology(page);

  await page.goto('/');

  await page.getByRole('button', { name: '添加交换机' }).click();

  await expect(page.getByRole('status')).toContainText('手动交换机已保存');
  expect(api.overlay.manualSwitches).toHaveLength(2);
  expect(api.overlay.manualSwitches[1]).toMatchObject({ label: '未命名交换机', portCount: 8 });
  expect(api.overlay.nodePositions?.some((position) => position.nodeId === api.overlay.manualSwitches[1].id)).toBe(true);
  await expect(page.getByTestId(`topology-node-${api.overlay.manualSwitches[1].id}`)).toContainText('未命名交换机');

  await page.reload();

  await expect(page.getByTestId(`topology-node-${api.overlay.manualSwitches[1].id}`)).toContainText('未命名交换机');
});

test('persists inspector labels, notes, tags, hidden links, and relayout state', async ({ page }) => {
  const api = await mockEditableTopology(page);

  await page.goto('/');
  await page.getByTestId('topology-node-device-laptop').click();

  await page.getByLabel('显示名称').fill('工作室笔记本');
  await page.getByLabel('备注').fill('放在办公室桌面上');
  await page.getByLabel('标签').fill('office, critical');
  await page.getByRole('button', { name: '保存修改' }).click();

  await expect(page.getByRole('status')).toContainText('设备修改已保存');
  expect(api.overlay.deviceOverlays).toContainEqual({
    deviceId: 'device-laptop',
    displayName: '工作室笔记本',
    notes: '放在办公室桌面上',
    tags: ['critical', 'office'],
  });
  await expect(page.getByTestId('topology-node-device-laptop')).toContainText('工作室笔记本');

  await page.getByRole('button', { name: '隐藏' }).nth(1).click();
  await expect(page.getByRole('status')).toContainText('连接已隐藏');
  expect(api.overlay.hiddenEdgeIds).toContain('wifi-garage-laptop');

  api.overlay.nodePositions = [{ nodeId: 'device-laptop', x: 320, y: 180 }];
  await page.getByRole('button', { name: '重新布局' }).click();
  await expect(page.getByRole('status')).toContainText('布局已重置');
  expect(api.overlay.nodePositions).toEqual([]);

  await page.reload();

  await expect(page.getByTestId('topology-node-device-laptop')).toContainText('工作室笔记本');
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
