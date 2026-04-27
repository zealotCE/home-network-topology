import type {
  Device,
  DeviceOverlay,
  DiscoverySnapshot,
  ManualSwitch,
  NodePosition,
  OverlayGraph,
  RouterConnection,
  TopologyEdge,
  WifiAssociation,
} from '@home-network-topology/shared';

import type { SqliteDatabase } from '../db/connection.js';

type RouterRow = {
  id: string;
  label: string;
  base_url: string;
  username: string;
  password_env_var: string;
  ssh_host: string | null;
  ssh_port: number | null;
  identity_file_env_var: string | null;
};

type SnapshotRow = {
  id: string;
  captured_at: string;
  topology_json: string;
  raw_commands_json: string;
};

type SnapshotDeviceRow = {
  device_id: string;
  mac_address: string;
  ip_addresses_json: string;
  discovered_hostname: string | null;
  dhcp_hostname: string | null;
  vendor: string | null;
  wifi_associations_json: string;
  last_seen_at: string;
};

type ManualSwitchRow = {
  id: string;
  label: string;
  port_count: number | null;
  notes: string | null;
  tags_json: string;
  hidden: number;
};

type DeviceOverlayRow = {
  device_id: string;
  display_name: string | null;
  hidden: number;
  notes: string | null;
  tags_json: string;
};

type OverlayEdgeRow = {
  id: string;
  source_node_id: string;
  target_node_id: string;
  kind: TopologyEdge['kind'];
  band: TopologyEdge['band'] | null;
};

type OverlayNodePositionRow = {
  node_id: string;
  x: number;
  y: number;
};

type OverlayHiddenNodeRow = {
  node_id: string;
};

type OverlayHiddenEdgeRow = {
  edge_id: string;
};

export type SnapshotSummary = Pick<DiscoverySnapshot, 'id' | 'capturedAt'>;

export class TopologyRepository {
  constructor(private readonly db: SqliteDatabase) {}

  listRouterConnections(): RouterConnection[] {
    const rows = this.db.prepare(`
      SELECT id, label, base_url, username, password_env_var, ssh_host, ssh_port, identity_file_env_var
      FROM router_connections
      ORDER BY label
    `).all() as RouterRow[];
    return rows.map(toRouterConnection);
  }

  upsertRouterConnection(router: RouterConnection): RouterConnection {
    this.db.prepare(`
      INSERT INTO router_connections (id, label, base_url, username, password_env_var, ssh_host, ssh_port, identity_file_env_var, created_at, updated_at)
      VALUES (@id, @label, @baseUrl, @username, @passwordEnvVar, @sshHost, @sshPort, @identityFileEnvVar, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        base_url = excluded.base_url,
        username = excluded.username,
        password_env_var = excluded.password_env_var,
        ssh_host = excluded.ssh_host,
        ssh_port = excluded.ssh_port,
        identity_file_env_var = excluded.identity_file_env_var,
        updated_at = CURRENT_TIMESTAMP
    `).run(toRouterParams(router));

    return router;
  }

  deleteRouterConnection(id: string): boolean {
    const result = this.db.prepare('DELETE FROM router_connections WHERE id = ?').run(id);
    return result.changes > 0;
  }

  listSnapshotSummaries(limit = 20): SnapshotSummary[] {
    const rows = this.db.prepare('SELECT id, captured_at, topology_json, raw_commands_json FROM discovery_snapshots ORDER BY captured_at DESC LIMIT ?').all(limit) as SnapshotRow[];
    return rows.map((row) => ({ id: row.id, capturedAt: row.captured_at }));
  }

  getLatestSnapshot(): DiscoverySnapshot | undefined {
    const row = this.db.prepare('SELECT id, captured_at, topology_json, raw_commands_json FROM discovery_snapshots ORDER BY captured_at DESC LIMIT 1').get() as SnapshotRow | undefined;
    return row ? this.getSnapshot(row.id) : undefined;
  }

  getSnapshot(id: string): DiscoverySnapshot | undefined {
    const snapshot = this.db.prepare('SELECT id, captured_at, topology_json, raw_commands_json FROM discovery_snapshots WHERE id = ?').get(id) as SnapshotRow | undefined;
    if (!snapshot) {
      return undefined;
    }

    const routerRows = this.db.prepare(`
      SELECT router_id AS id, label, base_url, username, password_env_var, ssh_host, ssh_port, identity_file_env_var
      FROM snapshot_routers
      WHERE snapshot_id = ?
      ORDER BY label
    `).all(id) as RouterRow[];
    const deviceRows = this.db.prepare(`
      SELECT device_id, mac_address, ip_addresses_json, discovered_hostname, dhcp_hostname, vendor, wifi_associations_json, last_seen_at
      FROM snapshot_devices
      WHERE snapshot_id = ?
      ORDER BY device_id
    `).all(id) as SnapshotDeviceRow[];

    return {
      id: snapshot.id,
      capturedAt: snapshot.captured_at,
      routers: routerRows.map(toRouterConnection),
      devices: deviceRows.map(toSnapshotDevice),
      topology: JSON.parse(snapshot.topology_json) as DiscoverySnapshot['topology'],
      rawCommands: JSON.parse(snapshot.raw_commands_json) as DiscoverySnapshot['rawCommands'],
    };
  }

  saveSnapshot(snapshot: DiscoverySnapshot): DiscoverySnapshot {
    const insertSnapshot = this.db.prepare(`
      INSERT INTO discovery_snapshots (id, captured_at, topology_json, raw_commands_json, created_at)
      VALUES (@id, @capturedAt, @topologyJson, @rawCommandsJson, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        captured_at = excluded.captured_at,
        topology_json = excluded.topology_json,
        raw_commands_json = excluded.raw_commands_json
    `);
    const deleteRouters = this.db.prepare('DELETE FROM snapshot_routers WHERE snapshot_id = ?');
    const deleteDevices = this.db.prepare('DELETE FROM snapshot_devices WHERE snapshot_id = ?');
    const insertRouter = this.db.prepare(`
      INSERT INTO snapshot_routers (snapshot_id, router_id, label, base_url, username, password_env_var, ssh_host, ssh_port, identity_file_env_var)
      VALUES (@snapshotId, @id, @label, @baseUrl, @username, @passwordEnvVar, @sshHost, @sshPort, @identityFileEnvVar)
    `);
    const insertDevice = this.db.prepare(`
      INSERT INTO snapshot_devices (
        snapshot_id,
        device_id,
        mac_address,
        ip_addresses_json,
        discovered_hostname,
        dhcp_hostname,
        vendor,
        wifi_associations_json,
        last_seen_at
      ) VALUES (
        @snapshotId,
        @id,
        @macAddress,
        @ipAddressesJson,
        @discoveredHostname,
        @dhcpHostname,
        @vendor,
        @wifiAssociationsJson,
        @lastSeenAt
      )
    `);

    const transaction = this.db.transaction(() => {
      insertSnapshot.run({
        id: snapshot.id,
        capturedAt: snapshot.capturedAt,
        topologyJson: JSON.stringify(snapshot.topology),
        rawCommandsJson: JSON.stringify(snapshot.rawCommands ?? []),
      });
      deleteRouters.run(snapshot.id);
      deleteDevices.run(snapshot.id);

      snapshot.routers.forEach((router) => insertRouter.run({ snapshotId: snapshot.id, ...toRouterParams(router) }));
      snapshot.devices.forEach((device) => insertDevice.run({
        snapshotId: snapshot.id,
        id: device.id,
        macAddress: device.macAddress,
        ipAddressesJson: JSON.stringify(device.ipAddresses),
        discoveredHostname: device.discoveredHostname ?? null,
        dhcpHostname: device.dhcpHostname ?? null,
        vendor: device.vendor ?? null,
        wifiAssociationsJson: JSON.stringify(device.wifiAssociations),
        lastSeenAt: device.lastSeenAt,
      }));
    });

    transaction();
    return snapshot;
  }

  getOverlay(): OverlayGraph {
    const manualSwitches = this.db.prepare('SELECT id, label, port_count, notes, tags_json, hidden FROM manual_switches ORDER BY label').all() as ManualSwitchRow[];
    const deviceOverlays = this.db.prepare('SELECT device_id, display_name, hidden, notes, tags_json FROM device_overlays ORDER BY device_id').all() as DeviceOverlayRow[];
    const edges = this.db.prepare('SELECT id, source_node_id, target_node_id, kind, band FROM overlay_edges ORDER BY id').all() as OverlayEdgeRow[];
    const nodePositions = this.db.prepare('SELECT node_id, x, y FROM overlay_node_positions ORDER BY node_id').all() as OverlayNodePositionRow[];
    const hiddenNodeIds = this.db.prepare('SELECT node_id FROM overlay_hidden_nodes ORDER BY node_id').all() as OverlayHiddenNodeRow[];
    const hiddenEdgeIds = this.db.prepare('SELECT edge_id FROM overlay_hidden_edges ORDER BY edge_id').all() as OverlayHiddenEdgeRow[];

    return {
      manualSwitches: manualSwitches.map(toManualSwitch),
      deviceOverlays: deviceOverlays.map(toDeviceOverlay),
      edges: edges.map(toOverlayEdge),
      nodePositions: nodePositions.map(toNodePosition),
      hiddenNodeIds: hiddenNodeIds.map((row) => row.node_id),
      hiddenEdgeIds: hiddenEdgeIds.map((row) => row.edge_id),
    };
  }

  replaceOverlay(overlay: OverlayGraph): OverlayGraph {
    const deleteManualSwitches = this.db.prepare('DELETE FROM manual_switches');
    const deleteDeviceOverlays = this.db.prepare('DELETE FROM device_overlays');
    const deleteEdges = this.db.prepare('DELETE FROM overlay_edges');
    const deleteNodePositions = this.db.prepare('DELETE FROM overlay_node_positions');
    const deleteHiddenNodes = this.db.prepare('DELETE FROM overlay_hidden_nodes');
    const deleteHiddenEdges = this.db.prepare('DELETE FROM overlay_hidden_edges');
    const insertManualSwitch = this.db.prepare(`
      INSERT INTO manual_switches (id, label, port_count, notes, tags_json, hidden, created_at, updated_at)
      VALUES (@id, @label, @portCount, @notes, @tagsJson, @hidden, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const insertDeviceOverlay = this.db.prepare(`
      INSERT INTO device_overlays (device_id, display_name, hidden, notes, tags_json, updated_at)
      VALUES (@deviceId, @displayName, @hidden, @notes, @tagsJson, CURRENT_TIMESTAMP)
    `);
    const insertEdge = this.db.prepare(`
      INSERT INTO overlay_edges (id, source_node_id, target_node_id, kind, band, created_at, updated_at)
      VALUES (@id, @sourceNodeId, @targetNodeId, @kind, @band, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const insertNodePosition = this.db.prepare(`
      INSERT INTO overlay_node_positions (node_id, x, y, updated_at)
      VALUES (@nodeId, @x, @y, CURRENT_TIMESTAMP)
    `);
    const insertHiddenNode = this.db.prepare('INSERT INTO overlay_hidden_nodes (node_id, updated_at) VALUES (?, CURRENT_TIMESTAMP)');
    const insertHiddenEdge = this.db.prepare('INSERT INTO overlay_hidden_edges (edge_id, updated_at) VALUES (?, CURRENT_TIMESTAMP)');

    const transaction = this.db.transaction(() => {
      deleteManualSwitches.run();
      deleteDeviceOverlays.run();
      deleteEdges.run();
      deleteNodePositions.run();
      deleteHiddenNodes.run();
      deleteHiddenEdges.run();

      overlay.manualSwitches.forEach((manualSwitch) => insertManualSwitch.run({
        id: manualSwitch.id,
        label: manualSwitch.label,
        portCount: manualSwitch.portCount ?? null,
        notes: manualSwitch.notes ?? null,
        tagsJson: JSON.stringify(manualSwitch.tags ?? []),
        hidden: manualSwitch.hidden ? 1 : 0,
      }));
      overlay.deviceOverlays.forEach((deviceOverlay) => insertDeviceOverlay.run({
        deviceId: deviceOverlay.deviceId,
        displayName: deviceOverlay.displayName ?? null,
        hidden: deviceOverlay.hidden ? 1 : 0,
        notes: deviceOverlay.notes ?? null,
        tagsJson: JSON.stringify(deviceOverlay.tags ?? []),
      }));
      overlay.edges.forEach((edge) => insertEdge.run({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        kind: edge.kind,
        band: edge.band ?? null,
      }));
      overlay.nodePositions?.forEach((position) => insertNodePosition.run(position));
      overlay.hiddenNodeIds?.forEach((nodeId) => insertHiddenNode.run(nodeId));
      overlay.hiddenEdgeIds?.forEach((edgeId) => insertHiddenEdge.run(edgeId));
    });

    transaction();
    return overlay;
  }

  ping(): void {
    this.db.prepare('SELECT 1').get();
  }
}

function toRouterConnection(row: RouterRow): RouterConnection {
  return {
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    username: row.username,
    passwordEnvVar: row.password_env_var,
    sshHost: row.ssh_host ?? undefined,
    sshPort: row.ssh_port ?? undefined,
    identityFileEnvVar: row.identity_file_env_var ?? undefined,
  };
}

function toRouterParams(router: RouterConnection) {
  return {
    id: router.id,
    label: router.label,
    baseUrl: router.baseUrl,
    username: router.username,
    passwordEnvVar: router.passwordEnvVar,
    sshHost: router.sshHost ?? null,
    sshPort: router.sshPort ?? null,
    identityFileEnvVar: router.identityFileEnvVar ?? null,
  };
}

function toSnapshotDevice(row: SnapshotDeviceRow): Device {
  return {
    id: row.device_id,
    macAddress: row.mac_address,
    ipAddresses: JSON.parse(row.ip_addresses_json) as string[],
    discoveredHostname: row.discovered_hostname ?? undefined,
    dhcpHostname: row.dhcp_hostname ?? undefined,
    vendor: row.vendor ?? undefined,
    wifiAssociations: JSON.parse(row.wifi_associations_json) as WifiAssociation[],
    lastSeenAt: row.last_seen_at,
  };
}

function toManualSwitch(row: ManualSwitchRow): ManualSwitch {
  return {
    id: row.id,
    label: row.label,
    portCount: row.port_count ?? undefined,
    notes: row.notes ?? undefined,
    tags: parseStringList(row.tags_json),
    hidden: row.hidden === 1,
  };
}

function toDeviceOverlay(row: DeviceOverlayRow): DeviceOverlay {
  return {
    deviceId: row.device_id,
    displayName: row.display_name ?? undefined,
    hidden: row.hidden === 1,
    notes: row.notes ?? undefined,
    tags: parseStringList(row.tags_json),
  };
}

function toOverlayEdge(row: OverlayEdgeRow): TopologyEdge {
  return {
    id: row.id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    kind: row.kind,
    band: row.band ?? undefined,
  };
}

function toNodePosition(row: OverlayNodePositionRow): NodePosition {
  return {
    nodeId: row.node_id,
    x: row.x,
    y: row.y,
  };
}

function parseStringList(value: string): string[] | undefined {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    return undefined;
  }

  const strings = parsed.filter((item): item is string => typeof item === 'string');
  return strings.length > 0 ? strings : undefined;
}
