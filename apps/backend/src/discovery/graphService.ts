import type {
  Device,
  DiscoveredGraph,
  DiscoveryCommandResult,
  DiscoverySnapshot,
  OverlayGraph,
  RouterConnection,
  TopologyEdge,
  TopologyNode,
  WifiAssociation,
  WifiBand,
} from '@home-network-topology/shared';
import { resolveDeviceName } from '@home-network-topology/shared';

type MutableDevice = Device & { wifiAssociations: WifiAssociation[]; ipAddresses: string[] };

type NodeIndexes = Readonly<{
  byRouterId: ReadonlyMap<string, TopologyNode>;
  byDeviceId: ReadonlyMap<string, TopologyNode>;
}>;

export type MergedTopologyGraph = Readonly<{
  discoveredGraph: DiscoveredGraph;
  overlayGraph: OverlayGraph;
  mergedGraph: DiscoveredGraph;
}>;

export function buildMergedTopologyGraph(snapshot: DiscoverySnapshot, overlay: OverlayGraph): MergedTopologyGraph {
  const discoveredGraph = normalizeDiscoverySnapshot(snapshot);
  return {
    discoveredGraph,
    overlayGraph: cloneOverlayGraph(overlay),
    mergedGraph: mergeDiscoveredGraphWithOverlay(discoveredGraph, overlay),
  };
}

export function normalizeDiscoverySnapshot(snapshot: DiscoverySnapshot): DiscoveredGraph {
  const routers = [...snapshot.routers].sort(compareRouterConnection);
  const devices = normalizeDevices(snapshot).sort(compareDevice);
  const existingNodes = indexExistingNodes(snapshot.topology.nodes);
  const routerNodes = routers.map((router) => existingNodes.byRouterId.get(router.id) ?? routerNode(router));
  const deviceNodes = devices.map((device) => existingNodes.byDeviceId.get(device.id) ?? deviceNode(device));
  const nodes = sortNodes(dedupeNodes([...routerNodes, ...deviceNodes, ...snapshot.topology.nodes]));
  const nodeIndexes = indexExistingNodes(nodes);
  const existingEdges = new Map(snapshot.topology.edges.map((edge) => [edgeSignature(edge), edge]));
  const derivedWifiEdges = devices.flatMap((device) => wifiEdgesForDevice(device, nodeIndexes, existingEdges));
  const edges = sortEdges(dedupeEdges([...snapshot.topology.edges, ...derivedWifiEdges]));

  return { nodes, edges };
}

export function mergeDiscoveredGraphWithOverlay(discoveredGraph: DiscoveredGraph, overlay: OverlayGraph): DiscoveredGraph {
  const deviceOverlays = new Map(overlay.deviceOverlays.map((deviceOverlay) => [deviceOverlay.deviceId, deviceOverlay]));
  const hiddenDeviceIds = new Set(overlay.deviceOverlays.filter((deviceOverlay) => deviceOverlay.hidden).map((deviceOverlay) => deviceOverlay.deviceId));
  const hiddenNodeIds = new Set(overlay.hiddenNodeIds ?? []);
  const hiddenEdgeIds = new Set(overlay.hiddenEdgeIds ?? []);
  const discoveredNodes = discoveredGraph.nodes
    .filter((node) => !hiddenNodeIds.has(node.id) && (!node.deviceId || !hiddenDeviceIds.has(node.deviceId)))
    .map((node) => {
      if (!node.deviceId) {
        return node;
      }

      const displayName = deviceOverlays.get(node.deviceId)?.displayName?.trim();
      return displayName ? { ...node, label: displayName } : node;
    });
  const manualSwitchNodes = overlay.manualSwitches
    .filter((manualSwitch) => !manualSwitch.hidden && !hiddenNodeIds.has(manualSwitch.id))
    .map<TopologyNode>((manualSwitch) => ({
      id: manualSwitch.id,
      kind: 'manualSwitch',
      label: manualSwitch.label,
    }));
  const nodes = sortNodes(dedupeNodes([...discoveredNodes, ...manualSwitchNodes]));
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const isVisibleEdge = (edge: TopologyEdge) => !hiddenEdgeIds.has(edge.id) && visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId);
  const discoveredEdges = discoveredGraph.edges.filter(isVisibleEdge);
  const overlayEdges = overlay.edges.filter(isVisibleEdge);

  return {
    nodes,
    edges: sortEdges(dedupeEdgesPreferLast([...discoveredEdges, ...overlayEdges])),
  };
}

function normalizeDevices(snapshot: DiscoverySnapshot): MutableDevice[] {
  const devicesById = new Map<string, MutableDevice>();
  const devicesByMac = new Map<string, MutableDevice>();

  for (const device of snapshot.devices) {
    const mutableDevice: MutableDevice = {
      ...device,
      ipAddresses: uniqueSorted(device.ipAddresses.map(normalizeIpAddress).filter(isNonBlank)),
      wifiAssociations: [...device.wifiAssociations].sort(compareWifiAssociation),
    };
    devicesById.set(mutableDevice.id, mutableDevice);
    const macKey = normalizeMacAddress(mutableDevice.macAddress);
    if (macKey) {
      devicesByMac.set(macKey, mutableDevice);
    }
  }

  for (const rawDevice of parseRawDevices(snapshot)) {
    const macKey = normalizeMacAddress(rawDevice.macAddress);
    const existing = (macKey && devicesByMac.get(macKey)) || devicesById.get(rawDevice.id);
    if (existing) {
      mergeDeviceEvidence(existing, rawDevice);
      continue;
    }

    devicesById.set(rawDevice.id, rawDevice);
    if (macKey) {
      devicesByMac.set(macKey, rawDevice);
    }
  }

  return [...devicesById.values()].map((device) => ({
    ...device,
    ipAddresses: uniqueSorted(device.ipAddresses),
    wifiAssociations: dedupeWifiAssociations(device.wifiAssociations).sort(compareWifiAssociation),
  }));
}

function parseRawDevices(snapshot: DiscoverySnapshot): MutableDevice[] {
  const router = [...snapshot.routers].sort(compareRouterConnection)[0];
  if (!router || !snapshot.rawCommands) {
    return [];
  }

  const devices = new Map<string, MutableDevice>();
  const bandByInterface = parseInterfaceBands(snapshot.rawCommands);
  for (const command of snapshot.rawCommands) {
    if (command.exitCode !== 0 || command.timedOut) {
      continue;
    }

    if (command.label === 'dhcp_leases') {
      parseDhcpLeases(command.stdout, snapshot.capturedAt).forEach((device) => upsertRawDevice(devices, device));
    }

    if (command.label === 'ip_neighbors') {
      parseIpNeighbors(command.stdout, snapshot.capturedAt).forEach((device) => upsertRawDevice(devices, device));
    }

    if (command.label === 'iwinfo_assoclist') {
      parseIwinfoAssoclist(command.stdout, router.id, bandByInterface, snapshot.capturedAt).forEach((device) => upsertRawDevice(devices, device));
    }
  }

  return [...devices.values()];
}

function parseDhcpLeases(stdout: string, lastSeenAt: string): MutableDevice[] {
  return stdout.split(/\r?\n/u).flatMap((line) => {
    const parts = line.trim().split(/\s+/u);
    if (parts.length < 4 || !isMacAddress(parts[1])) {
      return [];
    }

    const hostname = parts[3] && parts[3] !== '*' ? parts[3] : undefined;
    return [createRawDevice(parts[1], lastSeenAt, { ipAddresses: [parts[2]], dhcpHostname: hostname })];
  });
}

function parseIpNeighbors(stdout: string, lastSeenAt: string): MutableDevice[] {
  return stdout.split(/\r?\n/u).flatMap((line) => {
    const parts = line.trim().split(/\s+/u);
    const macIndex = parts.findIndex((part) => part === 'lladdr');
    if (parts.length === 0 || macIndex === -1 || !isMacAddress(parts[macIndex + 1])) {
      return [];
    }

    return [createRawDevice(parts[macIndex + 1], lastSeenAt, { ipAddresses: [parts[0]] })];
  });
}

function parseIwinfoAssoclist(stdout: string, routerId: string, bandByInterface: ReadonlyMap<string, WifiBand>, lastSeenAt: string): MutableDevice[] {
  const devices: MutableDevice[] = [];
  let interfaceName: string | undefined;
  for (const line of stdout.split(/\r?\n/u)) {
    const section = /^##\s*(\S+)/u.exec(line.trim());
    if (section) {
      interfaceName = section[1];
      continue;
    }

    const mac = /\b([0-9a-f]{2}(?::[0-9a-f]{2}){5})\b/iu.exec(line)?.[1];
    if (!mac) {
      continue;
    }

    const signalDbm = /(-?\d+)\s*dBm/u.exec(line)?.[1];
    devices.push(createRawDevice(mac, lastSeenAt, {
      wifiAssociations: [{
        routerId,
        interfaceName,
        band: interfaceName ? bandByInterface.get(interfaceName) ?? 'Unknown' : 'Unknown',
        signalDbm: signalDbm ? Number(signalDbm) : undefined,
      }],
    }));
  }

  return devices;
}

function parseInterfaceBands(rawCommands: readonly DiscoveryCommandResult[]): Map<string, WifiBand> {
  const bands = new Map<string, WifiBand>();
  for (const command of rawCommands) {
    if (command.exitCode !== 0 || command.timedOut || command.label !== 'iwinfo_summary') {
      continue;
    }

    let interfaceName: string | undefined;
    for (const line of command.stdout.split(/\r?\n/u)) {
      const header = /^(\S+)\s+ESSID:/u.exec(line.trim());
      if (header) {
        interfaceName = header[1];
        continue;
      }

      if (!interfaceName) {
        continue;
      }

      const channel = /Channel:\s*(\d+)/u.exec(line)?.[1];
      if (channel) {
        bands.set(interfaceName, Number(channel) <= 14 ? '2.4G' : '5G');
      }
    }
  }

  return bands;
}

function createRawDevice(macAddress: string, lastSeenAt: string, overrides: Partial<MutableDevice> = {}): MutableDevice {
  const canonicalMac = canonicalMacAddress(macAddress);
  const ipAddresses = uniqueSorted((overrides.ipAddresses ?? []).map(normalizeIpAddress).filter(isNonBlank));
  const wifiAssociations = overrides.wifiAssociations ?? [];

  return {
    id: deviceIdFromMac(canonicalMac),
    macAddress: canonicalMac,
    lastSeenAt,
    ...overrides,
    ipAddresses,
    wifiAssociations,
  };
}

function upsertRawDevice(devices: Map<string, MutableDevice>, device: MutableDevice): void {
  const existing = devices.get(device.id);
  if (existing) {
    mergeDeviceEvidence(existing, device);
  } else {
    devices.set(device.id, device);
  }
}

function mergeDeviceEvidence(target: MutableDevice, source: MutableDevice): void {
  target.ipAddresses = uniqueSorted([...target.ipAddresses, ...source.ipAddresses]);
  target.wifiAssociations = dedupeWifiAssociations([...target.wifiAssociations, ...source.wifiAssociations]);
  target.discoveredHostname ??= source.discoveredHostname;
  target.dhcpHostname ??= source.dhcpHostname;
  target.vendor ??= source.vendor;
  if (source.lastSeenAt > target.lastSeenAt) {
    target.lastSeenAt = source.lastSeenAt;
  }
}

function routerNode(router: RouterConnection): TopologyNode {
  return { id: `router-${stableSegment(router.id)}`, kind: 'router', label: router.label, routerId: router.id };
}

function deviceNode(device: Device): TopologyNode {
  return { id: `device-${stableSegment(device.id)}`, kind: 'device', label: resolveDeviceName(device).name, deviceId: device.id };
}

function wifiEdgesForDevice(device: Device, nodeIndexes: NodeIndexes, existingEdges: ReadonlyMap<string, TopologyEdge>): TopologyEdge[] {
  const deviceNodeForEdge = nodeIndexes.byDeviceId.get(device.id);
  if (!deviceNodeForEdge) {
    return [];
  }

  return dedupeWifiAssociations(device.wifiAssociations).flatMap((association) => {
    const routerNodeForEdge = nodeIndexes.byRouterId.get(association.routerId);
    if (!routerNodeForEdge) {
      return [];
    }

    const generatedEdge: TopologyEdge = {
      id: `wifi-${stableSegment(association.routerId)}-${stableSegment(device.id)}-${stableSegment(association.band)}-${stableSegment(association.interfaceName ?? association.ssid ?? 'wireless')}`,
      sourceNodeId: routerNodeForEdge.id,
      targetNodeId: deviceNodeForEdge.id,
      kind: 'wifi',
      band: association.band,
    };

    return [existingEdges.get(edgeSignature(generatedEdge)) ?? generatedEdge];
  });
}

function cloneOverlayGraph(overlay: OverlayGraph): OverlayGraph {
  return {
    manualSwitches: [...overlay.manualSwitches].sort((left, right) => compareString(left.id, right.id)).map((manualSwitch) => ({ ...manualSwitch })),
    deviceOverlays: [...overlay.deviceOverlays].sort((left, right) => compareString(left.deviceId, right.deviceId)).map((deviceOverlay) => ({ ...deviceOverlay })),
    edges: sortEdges(overlay.edges).map((edge) => ({ ...edge })),
    nodePositions: [...overlay.nodePositions ?? []].sort((left, right) => compareString(left.nodeId, right.nodeId)).map((position) => ({ ...position })),
    hiddenNodeIds: [...overlay.hiddenNodeIds ?? []].sort(compareString),
    hiddenEdgeIds: [...overlay.hiddenEdgeIds ?? []].sort(compareString),
  };
}

function indexExistingNodes(nodes: readonly TopologyNode[]): NodeIndexes {
  const byRouterId = new Map<string, TopologyNode>();
  const byDeviceId = new Map<string, TopologyNode>();
  for (const node of nodes) {
    if (node.routerId && !byRouterId.has(node.routerId)) {
      byRouterId.set(node.routerId, node);
    }
    if (node.deviceId && !byDeviceId.has(node.deviceId)) {
      byDeviceId.set(node.deviceId, node);
    }
  }

  return { byRouterId, byDeviceId };
}

function dedupeNodes(nodes: readonly TopologyNode[]): TopologyNode[] {
  const deduped = new Map<string, TopologyNode>();
  for (const node of nodes) {
    if (!deduped.has(node.id)) {
      deduped.set(node.id, node);
    }
  }

  return [...deduped.values()];
}

function dedupeEdges(edges: readonly TopologyEdge[]): TopologyEdge[] {
  const deduped = new Map<string, TopologyEdge>();
  for (const edge of edges) {
    if (!deduped.has(edge.id)) {
      deduped.set(edge.id, edge);
    }
  }

  return [...deduped.values()];
}

function dedupeEdgesPreferLast(edges: readonly TopologyEdge[]): TopologyEdge[] {
  const deduped = new Map<string, TopologyEdge>();
  for (const edge of edges) {
    deduped.set(edge.id, edge);
  }

  return [...deduped.values()];
}

function dedupeWifiAssociations(associations: readonly WifiAssociation[]): WifiAssociation[] {
  const deduped = new Map<string, WifiAssociation>();
  for (const association of associations) {
    const key = [association.routerId, association.interfaceName ?? '', association.ssid ?? '', association.band].join('|');
    if (!deduped.has(key)) {
      deduped.set(key, association);
    }
  }

  return [...deduped.values()];
}

function sortNodes(nodes: readonly TopologyNode[]): TopologyNode[] {
  const kindRank: Record<TopologyNode['kind'], number> = { router: 0, manualSwitch: 1, device: 2 };
  return [...nodes].sort((left, right) => kindRank[left.kind] - kindRank[right.kind] || compareString(left.label, right.label) || compareString(left.id, right.id));
}

function sortEdges(edges: readonly TopologyEdge[]): TopologyEdge[] {
  return [...edges].sort((left, right) => compareString(edgeSignature(left), edgeSignature(right)) || compareString(left.id, right.id));
}

function compareRouterConnection(left: RouterConnection, right: RouterConnection): number {
  return compareString(left.label, right.label) || compareString(left.id, right.id);
}

function compareDevice(left: Device, right: Device): number {
  return compareString(resolveDeviceName(left).name, resolveDeviceName(right).name) || compareString(left.id, right.id);
}

function compareWifiAssociation(left: WifiAssociation, right: WifiAssociation): number {
  return compareString(left.routerId, right.routerId) || compareString(left.band, right.band) || compareString(left.interfaceName ?? '', right.interfaceName ?? '') || compareString(left.ssid ?? '', right.ssid ?? '');
}

function edgeSignature(edge: TopologyEdge): string {
  return [edge.kind, edge.sourceNodeId, edge.targetNodeId, edge.band ?? ''].join('|');
}

function deviceIdFromMac(macAddress: string): string {
  return `mac-${normalizeMacAddress(macAddress)}`;
}

function canonicalMacAddress(macAddress: string): string {
  const hex = normalizeMacAddress(macAddress);
  return hex.match(/.{1,2}/gu)?.join(':').toUpperCase() ?? macAddress.trim().toUpperCase();
}

function normalizeMacAddress(macAddress: string): string {
  return macAddress.replace(/[^a-fA-F0-9]/gu, '').toLowerCase();
}

function normalizeIpAddress(ipAddress: string): string {
  return ipAddress.trim();
}

function isMacAddress(value: string | undefined): value is string {
  return typeof value === 'string' && /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/iu.test(value);
}

function isNonBlank(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareString);
}

function stableSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]+/gu, '-').replace(/^-+|-+$/gu, '').toLowerCase() || 'unknown';
}

function compareString(left: string, right: string): number {
  return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });
}
