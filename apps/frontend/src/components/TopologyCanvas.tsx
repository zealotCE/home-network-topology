import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type NodeTypes,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import type { Device, NodePosition, OverlayGraph, RouterConnection, TopologyEdge, TopologyNode } from '@home-network-topology/shared';

import { fetchTopologyData, saveOverlayGraph } from '../api/topology';
import { layoutTopology } from '../layout/elkLayout';
import type { DeviceConnectionMode, TopologyData, TopologyFlowNode, TopologyNodeData, TopologySummary, VisualNodeRole } from '../types/topology';
import { TopologyInspector } from './TopologyInspector';
import { TopologyNodeCard } from './TopologyNodeCard';

const nodeTypes: NodeTypes = {
  topologyNode: TopologyNodeCard as NodeTypes[string],
};

const edgeLabels: Record<TopologyEdge['kind'], string> = {
  ethernet: 'Ethernet',
  wifi: 'Wi‑Fi',
  inferred: 'Inferred',
  manual: 'Manual',
};

type TopologyCanvasProps = Readonly<{
  data: TopologyData;
  onDataChange: (data: TopologyData) => void;
}>;

type SelectionState =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | null;

export function TopologyCanvas({ data, onDataChange }: TopologyCanvasProps) {
  const graph = data.graph.mergedGraph;
  const prepared = useMemo(() => prepareGraph(data), [data]);
  const [nodes, setNodes, onNodesChange] = useNodesState<TopologyFlowNode>(prepared.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(prepared.edges);
  const [selection, setSelection] = useState<SelectionState>(prepared.nodes[0] ? { kind: 'node', id: prepared.nodes[0].id } : null);
  const [saveStatus, setSaveStatus] = useState('Ready');
  const selected = selection?.kind === 'node' ? prepared.nodeDataById.get(selection.id) ?? null : null;
  const selectedEdge = selection?.kind === 'edge' ? prepared.edgeById.get(selection.id) ?? null : null;

  useEffect(() => {
    let cancelled = false;
    setEdges(prepared.edges);
    setSelection((current) => isSelectionVisible(current, prepared) ? current : prepared.nodes[0] ? { kind: 'node', id: prepared.nodes[0].id } : null);

    layoutTopology(prepared.nodes, prepared.edges).then((laidOutNodes) => {
      if (!cancelled) {
        setNodes(applyPinnedPositions(laidOutNodes, data.graph.overlayGraph));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [data.graph.overlayGraph, prepared, setEdges, setNodes]);

  const persistOverlay = async (overlay: OverlayGraph, successMessage: string) => {
    setSaveStatus('Saving edits…');
    try {
      await saveOverlayGraph(cleanOverlay(overlay));
      const refreshed = await fetchTopologyData();
      onDataChange(refreshed);
      setSaveStatus(successMessage);
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Unable to save edits');
    }
  };

  const onNodeClick: NodeMouseHandler<TopologyFlowNode> = (_event, node) => {
    setSelection({ kind: 'node', id: node.id });
  };

  const onEdgeClick: EdgeMouseHandler = (_event, edge) => {
    setSelection({ kind: 'edge', id: edge.id });
  };

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) {
      return;
    }

    const id = `manual-${stableSegment(connection.source)}-${stableSegment(connection.target)}`;
    void persistOverlay({
      ...data.graph.overlayGraph,
      edges: [...data.graph.overlayGraph.edges.filter((edge) => edge.id !== id), { id, sourceNodeId: connection.source, targetNodeId: connection.target, kind: 'manual' }],
      hiddenEdgeIds: (data.graph.overlayGraph.hiddenEdgeIds ?? []).filter((edgeId) => edgeId !== id),
    }, 'Manual link saved');
    setSelection({ kind: 'edge', id });
  };

  const onNodeDragStop = (_event: MouseEvent, node: TopologyFlowNode) => {
    void persistOverlay({
      ...data.graph.overlayGraph,
      nodePositions: upsertPosition(data.graph.overlayGraph.nodePositions ?? [], { nodeId: node.id, x: node.position.x, y: node.position.y }),
    }, 'Position pinned');
  };

  const addManualSwitch = () => {
    const id = `manual-switch-${Date.now().toString(36)}`;
    void persistOverlay({
      ...data.graph.overlayGraph,
      manualSwitches: [...data.graph.overlayGraph.manualSwitches, { id, label: 'Unmanaged switch', portCount: 8 }],
      hiddenNodeIds: (data.graph.overlayGraph.hiddenNodeIds ?? []).filter((nodeId) => nodeId !== id),
      nodePositions: upsertPosition(data.graph.overlayGraph.nodePositions ?? [], { nodeId: id, x: 96, y: 96 }),
    }, 'Manual switch saved');
    setSelection({ kind: 'node', id });
  };

  const relayout = () => {
    void persistOverlay({ ...data.graph.overlayGraph, nodePositions: [] }, 'Layout reset');
  };

  if (graph.nodes.length === 0) {
    return (
      <section className="canvas-empty" data-testid="topology-empty-state">
        <p className="eyebrow">No topology yet</p>
        <h2>Run discovery to populate the canvas.</h2>
        <p>The backend responded, but the composed graph has no visible nodes. Add routers through discovery, then use manual switches and links to correct unmanaged physical topology.</p>
      </section>
    );
  }

  return (
    <div className="topology-workspace" data-testid="topology-workspace">
      <section className="canvas-panel" aria-label="Topology canvas">
        <div className="canvas-toolbar">
          <div>
            <p className="eyebrow">Editable overlay graph</p>
            <h2>{graph.nodes.length} nodes · {graph.edges.length} links</h2>
            <span className="save-status" role="status">{saveStatus}</span>
          </div>
          <div className="toolbar-actions">
            <button type="button" onClick={addManualSwitch}>Add switch</button>
            <button type="button" onClick={relayout}>Re-layout</button>
            <div className="legend" aria-label="Topology legend">
              <span><i className="legend-dot legend-dot--router" />Router</span>
              <span><i className="legend-dot legend-dot--accessPoint" />AP</span>
              <span><i className="legend-dot legend-dot--device" />Device</span>
              <span><i className="legend-dot legend-dot--manualSwitch" />Manual</span>
            </div>
          </div>
        </div>

        <div className="flow-frame">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onPaneClick={() => setSelection(null)}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.25}
            nodesDraggable
            nodesConnectable
            elementsSelectable
          >
            <Background color="rgba(148, 163, 184, 0.18)" gap={24} variant={BackgroundVariant.Dots} />
            <MiniMap pannable zoomable nodeColor={(node) => miniMapColor(node.data as TopologyNodeData)} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </section>
      <TopologyInspector
        selected={selected}
        selectedEdge={selectedEdge}
        summary={prepared.summary}
        overlay={data.graph.overlayGraph}
        allNodes={prepared.nodeDataById}
        allEdges={prepared.edgeById}
        onSelectNode={(nodeId) => setSelection({ kind: 'node', id: nodeId })}
        onSelectEdge={(edgeId) => setSelection({ kind: 'edge', id: edgeId })}
        onSaveOverlay={(overlay, message) => persistOverlay(overlay, message)}
      />
    </div>
  );
}

function prepareGraph(data: TopologyData): Readonly<{
  nodes: TopologyFlowNode[];
  edges: Edge[];
  nodeDataById: ReadonlyMap<string, TopologyNodeData>;
  edgeById: ReadonlyMap<string, TopologyEdge>;
  summary: TopologySummary;
}> {
  const devicesById = new Map(data.snapshot?.devices.map((device) => [device.id, device]) ?? []);
  const routers = data.snapshot?.routers.length ? data.snapshot.routers : data.routers;
  const routersById = new Map(routers.map((router) => [router.id, router]));
  const manualSwitchIds = new Set(data.graph.overlayGraph.manualSwitches.map((manualSwitch) => manualSwitch.id));
  const positionsByNodeId = new Map((data.graph.overlayGraph.nodePositions ?? []).map((position) => [position.nodeId, position]));
  const connectedEdgesByNodeId = indexEdges(data.graph.mergedGraph.edges);
  const nodeDataById = new Map<string, TopologyNodeData>();

  const nodes = data.graph.mergedGraph.nodes.map<TopologyFlowNode>((node, index) => {
    const device = node.deviceId ? devicesById.get(node.deviceId) : undefined;
    const router = node.routerId ? routersById.get(node.routerId) : undefined;
    const connectedEdges = connectedEdgesByNodeId.get(node.id) ?? [];
    const pinnedPosition = positionsByNodeId.get(node.id);
    const nodeData: TopologyNodeData = {
      node,
      role: roleForNode(node, router),
      connectionMode: connectionModeForNode(node, device, connectedEdges),
      device,
      router,
      connectedEdges,
    };
    nodeDataById.set(node.id, nodeData);

    return {
      id: node.id,
      type: 'topologyNode',
      position: pinnedPosition ? { x: pinnedPosition.x, y: pinnedPosition.y } : initialPosition(index),
      data: nodeData,
      className: manualSwitchIds.has(node.id) ? 'react-flow-node--manual' : undefined,
    };
  });

  const edges = data.graph.mergedGraph.edges.map<Edge>((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: edge.band ? `${edgeLabels[edge.kind]} · ${edge.band}` : edgeLabels[edge.kind],
    type: edge.kind === 'wifi' ? 'smoothstep' : 'default',
    animated: edge.kind === 'wifi',
    className: `topology-edge topology-edge--${edge.kind}`,
    labelClassName: 'topology-edge__label',
  }));
  const edgeById = new Map(data.graph.mergedGraph.edges.map((edge) => [edge.id, edge]));

  return { nodes, edges, nodeDataById, edgeById, summary: summarize([...nodeDataById.values()], edges) };
}

function indexEdges(edges: readonly TopologyEdge[]): Map<string, TopologyEdge[]> {
  const indexed = new Map<string, TopologyEdge[]>();
  for (const edge of edges) {
    indexed.set(edge.sourceNodeId, [...indexed.get(edge.sourceNodeId) ?? [], edge]);
    indexed.set(edge.targetNodeId, [...indexed.get(edge.targetNodeId) ?? [], edge]);
  }
  return indexed;
}

function roleForNode(node: TopologyNode, router: RouterConnection | undefined): VisualNodeRole {
  if (node.kind !== 'router') {
    return node.kind;
  }

  const label = `${node.label} ${node.routerId ?? ''} ${router?.label ?? ''}`;
  return /\b(ap|access point|mesh)\b/iu.test(label) ? 'accessPoint' : 'router';
}

function connectionModeForNode(node: TopologyNode, device: Device | undefined, edges: readonly TopologyEdge[]): DeviceConnectionMode {
  if (node.kind !== 'device') {
    return 'wired';
  }

  const hasWifi = edges.some((edge) => edge.kind === 'wifi') || Boolean(device?.wifiAssociations.length);
  const hasWired = edges.some((edge) => edge.kind === 'ethernet' || edge.kind === 'manual' || edge.kind === 'inferred');
  if (hasWifi && hasWired) return 'mixed';
  if (hasWifi) return 'wifi';
  if (hasWired) return 'wired';
  return 'unknown';
}

function summarize(nodes: readonly TopologyNodeData[], edges: readonly Edge[]): TopologySummary {
  return {
    routerCount: nodes.filter((node) => node.role === 'router').length,
    accessPointCount: nodes.filter((node) => node.role === 'accessPoint').length,
    manualSwitchCount: nodes.filter((node) => node.role === 'manualSwitch').length,
    wiredDeviceCount: nodes.filter((node) => node.role === 'device' && node.connectionMode === 'wired').length,
    wifiDeviceCount: nodes.filter((node) => node.role === 'device' && node.connectionMode === 'wifi').length,
    mixedDeviceCount: nodes.filter((node) => node.role === 'device' && node.connectionMode === 'mixed').length,
    linkCount: edges.length,
  };
}

function isSelectionVisible(selection: SelectionState, prepared: ReturnType<typeof prepareGraph>): boolean {
  if (!selection) {
    return true;
  }

  return selection.kind === 'node' ? prepared.nodeDataById.has(selection.id) : prepared.edgeById.has(selection.id);
}

function applyPinnedPositions(nodes: TopologyFlowNode[], overlay: OverlayGraph): TopologyFlowNode[] {
  const positionsByNodeId = new Map((overlay.nodePositions ?? []).map((position) => [position.nodeId, position]));
  return nodes.map((node) => {
    const pinned = positionsByNodeId.get(node.id);
    return pinned ? { ...node, position: { x: pinned.x, y: pinned.y } } : node;
  });
}

function upsertPosition(positions: readonly NodePosition[], next: NodePosition): NodePosition[] {
  return [...positions.filter((position) => position.nodeId !== next.nodeId), next];
}

function initialPosition(index: number): { x: number; y: number } {
  return {
    x: (index % 3) * 280,
    y: Math.floor(index / 3) * 180,
  };
}

function cleanOverlay(overlay: OverlayGraph): OverlayGraph {
  return {
    manualSwitches: overlay.manualSwitches.map((manualSwitch) => ({
      ...manualSwitch,
      label: manualSwitch.label.trim() || 'Unmanaged switch',
      tags: cleanTags(manualSwitch.tags),
      notes: cleanText(manualSwitch.notes),
    })),
    deviceOverlays: overlay.deviceOverlays.map((deviceOverlay) => ({
      ...deviceOverlay,
      displayName: cleanText(deviceOverlay.displayName),
      notes: cleanText(deviceOverlay.notes),
      tags: cleanTags(deviceOverlay.tags),
    })),
    edges: overlay.edges,
    nodePositions: overlay.nodePositions ?? [],
    hiddenNodeIds: uniqueStrings(overlay.hiddenNodeIds ?? []),
    hiddenEdgeIds: uniqueStrings(overlay.hiddenEdgeIds ?? []),
  };
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanTags(tags: readonly string[] | undefined): string[] | undefined {
  const cleaned = uniqueStrings((tags ?? []).map((tag) => tag.trim()).filter(Boolean));
  return cleaned.length > 0 ? cleaned : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' }));
}

function stableSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]+/gu, '-').replace(/^-+|-+$/gu, '').toLowerCase() || 'unknown';
}

function miniMapColor(data: TopologyNodeData): string {
  if (data.role === 'router') return '#60a5fa';
  if (data.role === 'accessPoint') return '#22d3ee';
  if (data.role === 'manualSwitch') return '#f59e0b';
  if (data.connectionMode === 'wifi') return '#a78bfa';
  return '#34d399';
}
