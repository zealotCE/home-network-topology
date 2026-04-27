import type { Device, DiscoveredGraph, DiscoverySnapshot, OverlayGraph, RouterConnection, TopologyEdge, TopologyNode } from '@home-network-topology/shared';
import type { Node } from '@xyflow/react';

export type ComposedTopologyGraph = Readonly<{
  discoveredGraph: DiscoveredGraph;
  overlayGraph: OverlayGraph;
  mergedGraph: DiscoveredGraph;
}>;

export type TopologyData = Readonly<{
  graph: ComposedTopologyGraph;
  snapshot: DiscoverySnapshot | null;
  routers: readonly RouterConnection[];
}>;

export type DeviceConnectionMode = 'wifi' | 'wired' | 'mixed' | 'unknown';

export type VisualNodeRole = TopologyNode['kind'] | 'accessPoint';

export type TopologyNodeData = Readonly<{
  node: TopologyNode;
  role: VisualNodeRole;
  connectionMode: DeviceConnectionMode;
  device?: Device;
  router?: RouterConnection;
  connectedEdges: readonly TopologyEdge[];
}>;

export type TopologySummary = Readonly<{
  routerCount: number;
  accessPointCount: number;
  manualSwitchCount: number;
  wiredDeviceCount: number;
  wifiDeviceCount: number;
  mixedDeviceCount: number;
  linkCount: number;
}>;

export type TopologyFlowNode = Node<TopologyNodeData, 'topologyNode'>;
