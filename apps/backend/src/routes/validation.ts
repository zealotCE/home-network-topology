import type {
  Device,
  DeviceOverlay,
  DiscoveryCommandResult,
  DiscoverySnapshot,
  ManualSwitch,
  NodePosition,
  OverlayGraph,
  RouterConnection,
  TopologyEdge,
  TopologyEdgeKind,
  TopologyNode,
  TopologyNodeKind,
  WifiAssociation,
  WifiBand,
} from '@home-network-topology/shared';
import { WIFI_BANDS } from '@home-network-topology/shared';

const TOPOLOGY_NODE_KINDS = ['router', 'device', 'manualSwitch'] as const satisfies readonly TopologyNodeKind[];
const TOPOLOGY_EDGE_KINDS = ['ethernet', 'wifi', 'inferred', 'manual'] as const satisfies readonly TopologyEdgeKind[];

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export function parseRouterConnection(input: unknown): ParseResult<RouterConnection> {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ['body must be an object'] };
  }

  const router = {
    id: requiredString(input.id, 'id', errors),
    label: requiredString(input.label, 'label', errors),
    baseUrl: requiredString(input.baseUrl, 'baseUrl', errors),
    username: requiredString(input.username, 'username', errors),
    passwordEnvVar: optionalNonBlankString(input.passwordEnvVar, 'passwordEnvVar', errors),
    sshHost: optionalString(input.sshHost, 'sshHost', errors),
    sshPort: optionalPort(input.sshPort, 'sshPort', errors),
    identityFileEnvVar: optionalString(input.identityFileEnvVar, 'identityFileEnvVar', errors),
  };

  if (router.baseUrl && !/^https?:\/\/\S+$/u.test(router.baseUrl)) {
    errors.push('baseUrl must be an http(s) URL');
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: router };
}

export function parseDiscoverySnapshot(input: unknown): ParseResult<DiscoverySnapshot> {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ['body must be an object'] };
  }

  const routers = parseArray(input.routers, 'routers', errors, parseRouterConnectionValue);
  const devices = parseArray(input.devices, 'devices', errors, parseDeviceValue);
  const topology = parseDiscoveredGraph(input.topology, errors);
  const snapshot = {
    id: requiredString(input.id, 'id', errors),
    capturedAt: requiredString(input.capturedAt, 'capturedAt', errors),
    routers,
    devices,
    topology,
    rawCommands: input.rawCommands === undefined ? undefined : parseArray(input.rawCommands, 'rawCommands', errors, parseDiscoveryCommandResultValue),
  };

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: snapshot };
}

export function parseOverlayGraph(input: unknown): ParseResult<OverlayGraph> {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ['body must be an object'] };
  }

  const overlay = {
    manualSwitches: parseArray(input.manualSwitches, 'manualSwitches', errors, parseManualSwitchValue),
    deviceOverlays: parseArray(input.deviceOverlays, 'deviceOverlays', errors, parseDeviceOverlayValue),
    edges: parseArray(input.edges, 'edges', errors, parseTopologyEdgeValue),
    nodePositions: input.nodePositions === undefined ? undefined : parseArray(input.nodePositions, 'nodePositions', errors, parseNodePositionValue),
    hiddenNodeIds: input.hiddenNodeIds === undefined ? undefined : parseStringArray(input.hiddenNodeIds, 'hiddenNodeIds', errors),
    hiddenEdgeIds: input.hiddenEdgeIds === undefined ? undefined : parseStringArray(input.hiddenEdgeIds, 'hiddenEdgeIds', errors),
  };

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: overlay };
}

function parseDiscoveredGraph(input: unknown, errors: string[]): DiscoverySnapshot['topology'] {
  if (!isRecord(input)) {
    errors.push('topology must be an object');
    return { nodes: [], edges: [] };
  }

  return {
    nodes: parseArray(input.nodes, 'topology.nodes', errors, parseTopologyNodeValue),
    edges: parseArray(input.edges, 'topology.edges', errors, parseTopologyEdgeValue),
  };
}

function parseRouterConnectionValue(input: unknown, path: string, errors: string[]): RouterConnection {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object`);
    return emptyRouterConnection();
  }

  const router = {
    id: requiredString(input.id, `${path}.id`, errors),
    label: requiredString(input.label, `${path}.label`, errors),
    baseUrl: requiredString(input.baseUrl, `${path}.baseUrl`, errors),
    username: requiredString(input.username, `${path}.username`, errors),
    passwordEnvVar: optionalNonBlankString(input.passwordEnvVar, `${path}.passwordEnvVar`, errors),
    sshHost: optionalString(input.sshHost, `${path}.sshHost`, errors),
    sshPort: optionalPort(input.sshPort, `${path}.sshPort`, errors),
    identityFileEnvVar: optionalString(input.identityFileEnvVar, `${path}.identityFileEnvVar`, errors),
  };

  if (router.baseUrl && !/^https?:\/\/\S+$/u.test(router.baseUrl)) {
    errors.push(`${path}.baseUrl must be an http(s) URL`);
  }

  return router;
}

function parseDiscoveryCommandResultValue(input: unknown, path: string, errors: string[]): DiscoveryCommandResult {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object`);
    return emptyDiscoveryCommandResult();
  }

  return {
    label: requiredString(input.label, `${path}.label`, errors),
    command: parseStringArray(input.command, `${path}.command`, errors),
    startedAt: requiredString(input.startedAt, `${path}.startedAt`, errors),
    completedAt: requiredString(input.completedAt, `${path}.completedAt`, errors),
    exitCode: nullableNumber(input.exitCode, `${path}.exitCode`, errors),
    signal: nullableString(input.signal, `${path}.signal`, errors),
    stdout: requiredStringAllowEmpty(input.stdout, `${path}.stdout`, errors),
    stderr: requiredStringAllowEmpty(input.stderr, `${path}.stderr`, errors),
    timedOut: requiredBoolean(input.timedOut, `${path}.timedOut`, errors),
  };
}

function parseDeviceValue(input: unknown, path: string, errors: string[]): Device {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object`);
    return { id: '', macAddress: '', ipAddresses: [], wifiAssociations: [], lastSeenAt: '' };
  }

  return {
    id: requiredString(input.id, `${path}.id`, errors),
    macAddress: requiredString(input.macAddress, `${path}.macAddress`, errors),
    ipAddresses: parseStringArray(input.ipAddresses, `${path}.ipAddresses`, errors),
    discoveredHostname: optionalString(input.discoveredHostname, `${path}.discoveredHostname`, errors),
    dhcpHostname: optionalString(input.dhcpHostname, `${path}.dhcpHostname`, errors),
    vendor: optionalString(input.vendor, `${path}.vendor`, errors),
    wifiAssociations: parseArray(input.wifiAssociations, `${path}.wifiAssociations`, errors, parseWifiAssociationValue),
    lastSeenAt: requiredString(input.lastSeenAt, `${path}.lastSeenAt`, errors),
  };
}

function parseWifiAssociationValue(input: unknown, path: string, errors: string[]): WifiAssociation {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object`);
    return { routerId: '', band: 'Unknown' };
  }

  const band = parseEnum(input.band, `${path}.band`, WIFI_BANDS, errors) ?? 'Unknown';
  return {
    routerId: requiredString(input.routerId, `${path}.routerId`, errors),
    interfaceName: optionalString(input.interfaceName, `${path}.interfaceName`, errors),
    ssid: optionalString(input.ssid, `${path}.ssid`, errors),
    band,
    signalDbm: optionalNumber(input.signalDbm, `${path}.signalDbm`, errors),
    txRateMbps: optionalNumber(input.txRateMbps, `${path}.txRateMbps`, errors),
    rxRateMbps: optionalNumber(input.rxRateMbps, `${path}.rxRateMbps`, errors),
    connectedSeconds: optionalNumber(input.connectedSeconds, `${path}.connectedSeconds`, errors),
  };
}

function parseTopologyNodeValue(input: unknown, path: string, errors: string[]): TopologyNode {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object`);
    return { id: '', kind: 'device', label: '' };
  }

  return {
    id: requiredString(input.id, `${path}.id`, errors),
    kind: parseEnum(input.kind, `${path}.kind`, TOPOLOGY_NODE_KINDS, errors) ?? 'device',
    label: requiredString(input.label, `${path}.label`, errors),
    deviceId: optionalString(input.deviceId, `${path}.deviceId`, errors),
    routerId: optionalString(input.routerId, `${path}.routerId`, errors),
  };
}

function parseTopologyEdgeValue(input: unknown, path: string, errors: string[]): TopologyEdge {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object`);
    return { id: '', sourceNodeId: '', targetNodeId: '', kind: 'manual' };
  }

  return {
    id: requiredString(input.id, `${path}.id`, errors),
    sourceNodeId: requiredString(input.sourceNodeId, `${path}.sourceNodeId`, errors),
    targetNodeId: requiredString(input.targetNodeId, `${path}.targetNodeId`, errors),
    kind: parseEnum(input.kind, `${path}.kind`, TOPOLOGY_EDGE_KINDS, errors) ?? 'manual',
    band: parseOptionalEnum(input.band, `${path}.band`, WIFI_BANDS, errors),
  };
}

function parseManualSwitchValue(input: unknown, path: string, errors: string[]): ManualSwitch {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object`);
    return { id: '', label: '' };
  }

  return {
    id: requiredString(input.id, `${path}.id`, errors),
    label: requiredString(input.label, `${path}.label`, errors),
    portCount: optionalNumber(input.portCount, `${path}.portCount`, errors),
    notes: optionalString(input.notes, `${path}.notes`, errors),
    tags: input.tags === undefined ? undefined : parseStringArray(input.tags, `${path}.tags`, errors),
    hidden: optionalBoolean(input.hidden, `${path}.hidden`, errors),
  };
}

function parseDeviceOverlayValue(input: unknown, path: string, errors: string[]): DeviceOverlay {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object`);
    return { deviceId: '' };
  }

  return {
    deviceId: requiredString(input.deviceId, `${path}.deviceId`, errors),
    displayName: optionalString(input.displayName, `${path}.displayName`, errors),
    hidden: optionalBoolean(input.hidden, `${path}.hidden`, errors),
    notes: optionalString(input.notes, `${path}.notes`, errors),
    tags: input.tags === undefined ? undefined : parseStringArray(input.tags, `${path}.tags`, errors),
  };
}

function parseNodePositionValue(input: unknown, path: string, errors: string[]): NodePosition {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object`);
    return { nodeId: '', x: 0, y: 0 };
  }

  return {
    nodeId: requiredString(input.nodeId, `${path}.nodeId`, errors),
    x: requiredNumber(input.x, `${path}.x`, errors),
    y: requiredNumber(input.y, `${path}.y`, errors),
  };
}

function parseArray<T>(input: unknown, path: string, errors: string[], parser: (item: unknown, path: string, errors: string[]) => T): T[] {
  if (!Array.isArray(input)) {
    errors.push(`${path} must be an array`);
    return [];
  }

  return input.map((item, index) => parser(item, `${path}[${index}]`, errors));
}

function parseStringArray(input: unknown, path: string, errors: string[]): string[] {
  if (!Array.isArray(input)) {
    errors.push(`${path} must be an array`);
    return [];
  }

  return input.map((item, index) => requiredString(item, `${path}[${index}]`, errors));
}

function parseEnum<T extends string>(input: unknown, path: string, values: readonly T[], errors: string[]): T | undefined {
  if (typeof input === 'string' && values.includes(input as T)) {
    return input as T;
  }

  errors.push(`${path} must be one of ${values.join(', ')}`);
  return undefined;
}

function parseOptionalEnum<T extends string>(input: unknown, path: string, values: readonly T[], errors: string[]): T | undefined {
  if (input === undefined) {
    return undefined;
  }

  return parseEnum(input, path, values, errors);
}

function requiredString(input: unknown, path: string, errors: string[]): string {
  if (typeof input === 'string' && input.trim().length > 0) {
    return input;
  }

  errors.push(`${path} must be a non-empty string`);
  return '';
}

function optionalString(input: unknown, path: string, errors: string[]): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === 'string') {
    return input;
  }

  errors.push(`${path} must be a string when provided`);
  return undefined;
}

function optionalNonBlankString(input: unknown, path: string, errors: string[]): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === 'string' && input.trim().length > 0) {
    return input;
  }

  errors.push(`${path} must be a non-empty string when provided`);
  return undefined;
}

function optionalNumber(input: unknown, path: string, errors: string[]): number | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }

  errors.push(`${path} must be a finite number when provided`);
  return undefined;
}

function requiredNumber(input: unknown, path: string, errors: string[]): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }

  errors.push(`${path} must be a finite number`);
  return 0;
}

function optionalPort(input: unknown, path: string, errors: string[]): number | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === 'number' && Number.isInteger(input) && input >= 1 && input <= 65_535) {
    return input;
  }

  errors.push(`${path} must be an integer from 1 to 65535 when provided`);
  return undefined;
}

function nullableNumber(input: unknown, path: string, errors: string[]): number | null {
  if (input === null) {
    return null;
  }

  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }

  errors.push(`${path} must be a finite number or null`);
  return null;
}

function nullableString(input: unknown, path: string, errors: string[]): string | null {
  if (input === null) {
    return null;
  }

  if (typeof input === 'string') {
    return input;
  }

  errors.push(`${path} must be a string or null`);
  return null;
}

function requiredStringAllowEmpty(input: unknown, path: string, errors: string[]): string {
  if (typeof input === 'string') {
    return input;
  }

  errors.push(`${path} must be a string`);
  return '';
}

function requiredBoolean(input: unknown, path: string, errors: string[]): boolean {
  if (typeof input === 'boolean') {
    return input;
  }

  errors.push(`${path} must be a boolean`);
  return false;
}

function optionalBoolean(input: unknown, path: string, errors: string[]): boolean | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (typeof input === 'boolean') {
    return input;
  }

  errors.push(`${path} must be a boolean when provided`);
  return undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function emptyRouterConnection(): RouterConnection {
  return { id: '', label: '', baseUrl: '', username: '' };
}

function emptyDiscoveryCommandResult(): DiscoveryCommandResult {
  return {
    label: '',
    command: [],
    startedAt: '',
    completedAt: '',
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
  };
}
