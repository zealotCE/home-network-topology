export const APP_NAME = 'Home Network Topology';

export type HealthStatus = {
  status: 'ok';
  service: 'backend';
};

export const WIFI_BANDS = ['2.4G', '5G', 'Unknown'] as const;
export type WifiBand = (typeof WIFI_BANDS)[number];

export const NAMING_FALLBACK_ORDER = [
  'discoveredHostname',
  'dhcpHostname',
  'ipAddress',
  'macShort',
] as const;
export type NamingFallbackSource = (typeof NAMING_FALLBACK_ORDER)[number];

export type RouterConnection = {
  id: string;
  label: string;
  baseUrl: string;
  username: string;
  passwordEnvVar?: string;
  sshHost?: string;
  sshPort?: number;
  identityFileEnvVar?: string;
};

export type RuntimeConfig = {
  routers?: RouterConnection[];
  dataDirectory?: string;
  discoveryIntervalSeconds?: number;
  ui?: RuntimeUiConfig;
};

export type RuntimeUiConfig = {
  defaultView?: 'topology' | 'setup';
  setupHelpText?: string;
};

export type DeviceId = string;
export type RouterId = string;
export type TopologyNodeId = string;

export type WifiAssociation = {
  routerId: RouterId;
  interfaceName?: string;
  ssid?: string;
  band: WifiBand;
  signalDbm?: number;
  txRateMbps?: number;
  rxRateMbps?: number;
  connectedSeconds?: number;
};

export type Device = {
  id: DeviceId;
  macAddress: string;
  ipAddresses: string[];
  discoveredHostname?: string;
  dhcpHostname?: string;
  vendor?: string;
  wifiAssociations: WifiAssociation[];
  lastSeenAt: string;
};

export type DiscoverySnapshot = Readonly<{
  id: string;
  capturedAt: string;
  routers: readonly RouterConnection[];
  devices: readonly Device[];
  topology: DiscoveredGraph;
  rawCommands?: readonly DiscoveryCommandResult[];
}>;

export type DiscoveryCommandResult = Readonly<{
  label: string;
  command: readonly string[];
  startedAt: string;
  completedAt: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}>;

export type TopologyNodeKind = 'router' | 'device' | 'manualSwitch';

export type TopologyNode = Readonly<{
  id: TopologyNodeId;
  kind: TopologyNodeKind;
  label: string;
  deviceId?: DeviceId;
  routerId?: RouterId;
}>;

export type TopologyEdgeKind = 'ethernet' | 'wifi' | 'inferred' | 'manual';

export type TopologyEdge = Readonly<{
  id: string;
  sourceNodeId: TopologyNodeId;
  targetNodeId: TopologyNodeId;
  kind: TopologyEdgeKind;
  band?: WifiBand;
}>;

export type DiscoveredGraph = Readonly<{
  nodes: readonly TopologyNode[];
  edges: readonly TopologyEdge[];
}>;

export type ManualSwitch = {
  id: string;
  label: string;
  portCount?: number;
  notes?: string;
  tags?: string[];
  hidden?: boolean;
};

export type DeviceOverlay = {
  deviceId: DeviceId;
  displayName?: string;
  hidden?: boolean;
  notes?: string;
  tags?: string[];
};

export type NodePosition = {
  nodeId: TopologyNodeId;
  x: number;
  y: number;
};

export type OverlayGraph = {
  manualSwitches: ManualSwitch[];
  deviceOverlays: DeviceOverlay[];
  edges: TopologyEdge[];
  nodePositions?: NodePosition[];
  hiddenNodeIds?: TopologyNodeId[];
  hiddenEdgeIds?: string[];
};

export type ResolvedDeviceName = {
  name: string;
  source: NamingFallbackSource;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export function resolveDeviceName(device: Pick<Device, 'discoveredHostname' | 'dhcpHostname' | 'ipAddresses' | 'macAddress'>): ResolvedDeviceName {
  const discoveredHostname = firstNonBlank(device.discoveredHostname);
  if (discoveredHostname) {
    return { name: discoveredHostname, source: 'discoveredHostname' };
  }

  const dhcpHostname = firstNonBlank(device.dhcpHostname);
  if (dhcpHostname) {
    return { name: dhcpHostname, source: 'dhcpHostname' };
  }

  const ipAddress = device.ipAddresses.find((address) => firstNonBlank(address));
  if (ipAddress) {
    return { name: ipAddress, source: 'ipAddress' };
  }

  return { name: macShortForm(device.macAddress), source: 'macShort' };
}

export function macShortForm(macAddress: string): string {
  const hex = macAddress.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (hex.length >= 4) {
    return hex.slice(-4);
  }

  return macAddress.trim() || 'Unknown device';
}

export function validateRuntimeConfig(input: unknown): ValidationResult<RuntimeConfig> {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ['config must be an object'] };
  }

  const routers = input.routers;
  if (routers !== undefined && !Array.isArray(routers)) {
    errors.push('routers must be an array when provided');
  } else if (Array.isArray(routers)) {
    routers.forEach((router, index) => validateRouterConnection(router, `routers[${index}]`, errors));
  }

  if (input.dataDirectory !== undefined && !isNonBlankString(input.dataDirectory)) {
    errors.push('dataDirectory must be a non-empty string when provided');
  }

  if (input.discoveryIntervalSeconds !== undefined && !isPositiveInteger(input.discoveryIntervalSeconds)) {
    errors.push('discoveryIntervalSeconds must be a positive integer when provided');
  }

  if (input.ui !== undefined) {
    validateRuntimeUiConfig(input.ui, 'ui', errors);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: input as RuntimeConfig };
}

function validateRuntimeUiConfig(input: unknown, path: string, errors: string[]): void {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object when provided`);
    return;
  }

  if (input.defaultView !== undefined && input.defaultView !== 'topology' && input.defaultView !== 'setup') {
    errors.push(`${path}.defaultView must be topology or setup when provided`);
  }

  if (input.setupHelpText !== undefined && !isNonBlankString(input.setupHelpText)) {
    errors.push(`${path}.setupHelpText must be a non-empty string when provided`);
  }
}

function validateRouterConnection(input: unknown, path: string, errors: string[]): void {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object`);
    return;
  }

  for (const key of ['id', 'label', 'baseUrl', 'username'] as const) {
    if (!isNonBlankString(input[key])) {
      errors.push(`${path}.${key} must be a non-empty string`);
    }
  }

  if (input.passwordEnvVar !== undefined && !isNonBlankString(input.passwordEnvVar)) {
    errors.push(`${path}.passwordEnvVar must be a non-empty string when provided`);
  }

  if (isNonBlankString(input.baseUrl) && !isHttpUrl(input.baseUrl)) {
    errors.push(`${path}.baseUrl must be an http(s) URL`);
  }

  if (input.sshHost !== undefined && !isNonBlankString(input.sshHost)) {
    errors.push(`${path}.sshHost must be a non-empty string when provided`);
  }

  if (input.sshPort !== undefined && (typeof input.sshPort !== 'number' || !Number.isInteger(input.sshPort) || input.sshPort < 1 || input.sshPort > 65_535)) {
    errors.push(`${path}.sshPort must be an integer from 1 to 65535 when provided`);
  }

  if (input.identityFileEnvVar !== undefined && !isNonBlankString(input.identityFileEnvVar)) {
    errors.push(`${path}.identityFileEnvVar must be a non-empty string when provided`);
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isNonBlankString(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0;
}

function isPositiveInteger(input: unknown): input is number {
  return typeof input === 'number' && Number.isInteger(input) && input > 0;
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\/\S+$/u.test(input);
}

function firstNonBlank(input: string | undefined): string | undefined {
  const value = input?.trim();
  return value ? value : undefined;
}
