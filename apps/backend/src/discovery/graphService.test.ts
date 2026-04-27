import assert from 'node:assert/strict';
import test from 'node:test';

import type { DiscoveryCommandResult, DiscoverySnapshot, OverlayGraph } from '@home-network-topology/shared';

import { buildMergedTopologyGraph, mergeDiscoveredGraphWithOverlay, normalizeDiscoverySnapshot } from './graphService.js';

test('normalizes discovery snapshots into stable router, device, and Wi-Fi edges', () => {
  const normalized = normalizeDiscoverySnapshot(snapshotWithRawEvidence());

  assert.deepEqual(normalized, {
    nodes: [
      { id: 'router-main-router', kind: 'router', label: 'Main router', routerId: 'main-router' },
      { id: 'device-mac-aabbccddeeff', kind: 'device', label: 'laptop', deviceId: 'mac-aabbccddeeff' },
    ],
    edges: [
      {
        id: 'wifi-main-router-mac-aabbccddeeff-5g-wlan1',
        sourceNodeId: 'router-main-router',
        targetNodeId: 'device-mac-aabbccddeeff',
        kind: 'wifi',
        band: '5G',
      },
    ],
  });

  assert.deepEqual(normalizeDiscoverySnapshot(snapshotWithRawEvidence()), normalized);
});

test('reuses existing discovered node and edge IDs during normalization', () => {
  const snapshot = snapshotWithRawEvidence({
    topology: {
      nodes: [
        { id: 'existing-router-node', kind: 'router', label: 'Existing router label', routerId: 'main-router' },
        { id: 'existing-device-node', kind: 'device', label: 'Existing device label', deviceId: 'mac-aabbccddeeff' },
      ],
      edges: [
        {
          id: 'existing-wifi-edge',
          sourceNodeId: 'existing-router-node',
          targetNodeId: 'existing-device-node',
          kind: 'wifi',
          band: '5G',
        },
      ],
    },
  });

  const normalized = normalizeDiscoverySnapshot(snapshot);

  assert.deepEqual(normalized.nodes, [
    { id: 'existing-router-node', kind: 'router', label: 'Existing router label', routerId: 'main-router' },
    { id: 'existing-device-node', kind: 'device', label: 'Existing device label', deviceId: 'mac-aabbccddeeff' },
  ]);
  assert.deepEqual(normalized.edges, [
    {
      id: 'existing-wifi-edge',
      sourceNodeId: 'existing-router-node',
      targetNodeId: 'existing-device-node',
      kind: 'wifi',
      band: '5G',
    },
  ]);
});

test('overlay rename and hide rules take precedence without mutating discovered graph', () => {
  const discoveredGraph = {
    nodes: [
      { id: 'router-main-router', kind: 'router' as const, label: 'Main router', routerId: 'main-router' },
      { id: 'device-laptop', kind: 'device' as const, label: 'laptop', deviceId: 'device-laptop' },
      { id: 'device-phone', kind: 'device' as const, label: 'phone', deviceId: 'device-phone' },
    ],
    edges: [
      { id: 'wifi-laptop', sourceNodeId: 'router-main-router', targetNodeId: 'device-laptop', kind: 'wifi' as const, band: '5G' as const },
      { id: 'wifi-phone', sourceNodeId: 'router-main-router', targetNodeId: 'device-phone', kind: 'wifi' as const, band: '2.4G' as const },
    ],
  };
  const originalDiscoveredGraph = structuredClone(discoveredGraph);

  const merged = mergeDiscoveredGraphWithOverlay(discoveredGraph, {
    manualSwitches: [],
    deviceOverlays: [
      { deviceId: 'device-laptop', displayName: 'Work laptop' },
      { deviceId: 'device-phone', displayName: 'Hidden phone', hidden: true },
    ],
    edges: [],
    hiddenEdgeIds: ['wifi-laptop'],
  });

  assert.deepEqual(merged.nodes, [
    { id: 'router-main-router', kind: 'router', label: 'Main router', routerId: 'main-router' },
    { id: 'device-laptop', kind: 'device', label: 'Work laptop', deviceId: 'device-laptop' },
  ]);
  assert.deepEqual(merged.edges, []);
  assert.deepEqual(discoveredGraph, originalDiscoveredGraph);
});

test('preserves manual switches and overlay edges in the merged graph', () => {
  const snapshot = snapshotWithRawEvidence();
  const overlay: OverlayGraph = {
    manualSwitches: [{ id: 'switch-office', label: 'Office switch', portCount: 8 }],
    deviceOverlays: [{ deviceId: 'mac-aabbccddeeff', displayName: 'Work laptop' }],
    edges: [
      { id: 'manual-switch-link', sourceNodeId: 'switch-office', targetNodeId: 'device-mac-aabbccddeeff', kind: 'manual' },
      { id: 'manual-hidden-endpoint', sourceNodeId: 'switch-office', targetNodeId: 'missing-node', kind: 'manual' },
    ],
    nodePositions: [{ nodeId: 'switch-office', x: 100, y: 200 }],
  };

  const result = buildMergedTopologyGraph(snapshot, overlay);

  assert.deepEqual(result.mergedGraph.nodes, [
    { id: 'router-main-router', kind: 'router', label: 'Main router', routerId: 'main-router' },
    { id: 'switch-office', kind: 'manualSwitch', label: 'Office switch' },
    { id: 'device-mac-aabbccddeeff', kind: 'device', label: 'Work laptop', deviceId: 'mac-aabbccddeeff' },
  ]);
  assert.deepEqual(result.mergedGraph.edges, [
    { id: 'manual-switch-link', sourceNodeId: 'switch-office', targetNodeId: 'device-mac-aabbccddeeff', kind: 'manual' },
    {
      id: 'wifi-main-router-mac-aabbccddeeff-5g-wlan1',
      sourceNodeId: 'router-main-router',
      targetNodeId: 'device-mac-aabbccddeeff',
      kind: 'wifi',
      band: '5G',
    },
  ]);
  assert.deepEqual(result.overlayGraph, { ...overlay, hiddenEdgeIds: [], hiddenNodeIds: [] });
});

test('overlay edge IDs take precedence over discovered edge IDs during merge', () => {
  const merged = mergeDiscoveredGraphWithOverlay(
    {
      nodes: [
        { id: 'router-main-router', kind: 'router', label: 'Main router', routerId: 'main-router' },
        { id: 'device-laptop', kind: 'device', label: 'laptop', deviceId: 'device-laptop' },
        { id: 'switch-office', kind: 'manualSwitch', label: 'Office switch' },
      ],
      edges: [
        { id: 'shared-edge-id', sourceNodeId: 'router-main-router', targetNodeId: 'device-laptop', kind: 'wifi', band: '5G' },
      ],
    },
    {
      manualSwitches: [{ id: 'switch-office', label: 'Office switch' }],
      deviceOverlays: [],
      edges: [
        { id: 'shared-edge-id', sourceNodeId: 'switch-office', targetNodeId: 'device-laptop', kind: 'manual' },
      ],
    },
  );

  assert.deepEqual(merged.edges, [
    { id: 'shared-edge-id', sourceNodeId: 'switch-office', targetNodeId: 'device-laptop', kind: 'manual' },
  ]);
});

test('dedupes repeated raw evidence into stable node and edge IDs', () => {
  const snapshot = snapshotWithRawEvidence({
    rawCommands: [
      command('dhcp_leases', '0 AA:BB:CC:DD:EE:FF 192.168.1.20 laptop *\n0 aa:bb:cc:dd:ee:ff 192.168.1.20 laptop *\n'),
      command('ip_neighbors', '192.168.1.20 dev br-lan lladdr aa:bb:cc:dd:ee:ff REACHABLE\n'),
      command('iwinfo_summary', 'wlan1 ESSID: "Home"\n          Channel: 36\n'),
      command('iwinfo_assoclist', '## wlan1\nAA:BB:CC:DD:EE:FF  -54 dBm / -95 dBm\nAA:BB:CC:DD:EE:FF  -54 dBm / -95 dBm\n'),
    ],
  });

  const normalized = normalizeDiscoverySnapshot(snapshot);

  assert.equal(normalized.nodes.filter((node) => node.deviceId === 'mac-aabbccddeeff').length, 1);
  assert.deepEqual(normalized.edges, [
    {
      id: 'wifi-main-router-mac-aabbccddeeff-5g-wlan1',
      sourceNodeId: 'router-main-router',
      targetNodeId: 'device-mac-aabbccddeeff',
      kind: 'wifi',
      band: '5G',
    },
  ]);
});

function snapshotWithRawEvidence(overrides: Partial<DiscoverySnapshot> = {}): DiscoverySnapshot {
  return {
    id: 'snapshot-1',
    capturedAt: '2026-04-27T10:00:00.000Z',
    routers: [
      {
        id: 'main-router',
        label: 'Main router',
        baseUrl: 'https://router.local',
        username: 'root',
        passwordEnvVar: 'ROUTER_PASSWORD',
      },
    ],
    devices: [],
    topology: { nodes: [], edges: [] },
    rawCommands: [
      command('dhcp_leases', '0 AA:BB:CC:DD:EE:FF 192.168.1.20 laptop *\n'),
      command('ip_neighbors', '192.168.1.20 dev br-lan lladdr aa:bb:cc:dd:ee:ff REACHABLE\n'),
      command('iwinfo_summary', 'wlan1 ESSID: "Home"\n          Channel: 36\n'),
      command('iwinfo_assoclist', '## wlan1\nAA:BB:CC:DD:EE:FF  -54 dBm / -95 dBm\n'),
    ],
    ...overrides,
  };
}

function command(label: string, stdout: string): DiscoveryCommandResult {
  return {
    label,
    command: [label],
    startedAt: '2026-04-27T10:00:00.000Z',
    completedAt: '2026-04-27T10:00:01.000Z',
    exitCode: 0,
    signal: null,
    stdout,
    stderr: '',
    timedOut: false,
  };
}
