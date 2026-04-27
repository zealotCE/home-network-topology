import { useEffect, useMemo, useState } from 'react';
import type { OverlayGraph, TopologyEdge } from '@home-network-topology/shared';

import type { TopologyNodeData, TopologySummary } from '../types/topology';

type TopologyInspectorProps = Readonly<{
  selected: TopologyNodeData | null;
  selectedEdge: TopologyEdge | null;
  summary: TopologySummary;
  overlay: OverlayGraph;
  allNodes: ReadonlyMap<string, TopologyNodeData>;
  allEdges: ReadonlyMap<string, TopologyEdge>;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onSaveOverlay: (overlay: OverlayGraph, message: string) => void;
}>;

export function TopologyInspector({ selected, selectedEdge, summary, overlay, allNodes, allEdges, onSelectNode, onSelectEdge, onSaveOverlay }: TopologyInspectorProps) {
  return (
    <aside className="inspector-panel" aria-label="Topology inspector">
      <section className="summary-card">
        <p className="eyebrow">Network summary</p>
        <div className="summary-grid">
          <SummaryMetric label="Routers" value={summary.routerCount} />
          <SummaryMetric label="APs" value={summary.accessPointCount} />
          <SummaryMetric label="Manual switches" value={summary.manualSwitchCount} />
          <SummaryMetric label="Wi‑Fi devices" value={summary.wifiDeviceCount} />
          <SummaryMetric label="Wired devices" value={summary.wiredDeviceCount} />
          <SummaryMetric label="Links" value={summary.linkCount} />
        </div>
      </section>

      <section className="detail-card" data-testid="topology-inspector">
        <p className="eyebrow">Selection detail</p>
        {selected ? <NodeDetail selected={selected} overlay={overlay} onSelectEdge={onSelectEdge} onSaveOverlay={onSaveOverlay} /> : null}
        {!selected && selectedEdge ? <EdgeDetail edge={selectedEdge} overlay={overlay} onSaveOverlay={onSaveOverlay} /> : null}
        {!selected && !selectedEdge ? <EmptySelection overlay={overlay} allNodes={allNodes} allEdges={allEdges} onSelectNode={onSelectNode} onSelectEdge={onSelectEdge} onSaveOverlay={onSaveOverlay} /> : null}
      </section>
    </aside>
  );
}

function SummaryMetric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="summary-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function EmptySelection({ overlay, allNodes, allEdges, onSelectNode, onSelectEdge, onSaveOverlay }: Readonly<{
  overlay: OverlayGraph;
  allNodes: ReadonlyMap<string, TopologyNodeData>;
  allEdges: ReadonlyMap<string, TopologyEdge>;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onSaveOverlay: (overlay: OverlayGraph, message: string) => void;
}>) {
  const visibleNodeIds = new Set(allNodes.keys());
  const visibleEdgeIds = new Set(allEdges.keys());
  const hiddenNodeIds = (overlay.hiddenNodeIds ?? []).filter((nodeId) => !visibleNodeIds.has(nodeId));
  const hiddenEdgeIds = (overlay.hiddenEdgeIds ?? []).filter((edgeId) => !visibleEdgeIds.has(edgeId));
  const hiddenDeviceIds = overlay.deviceOverlays.filter((entry) => entry.hidden).map((entry) => entry.deviceId);
  const hiddenManualSwitchIds = overlay.manualSwitches.filter((entry) => entry.hidden).map((entry) => entry.id);

  return (
    <div className="empty-selection">
      <h2>Select a node or link</h2>
      <p>Choose a router, device, manual switch, or link to edit labels, notes, tags, visibility, and manual topology corrections.</p>
      <RestoreList
        hiddenNodeIds={hiddenNodeIds}
        hiddenEdgeIds={hiddenEdgeIds}
        hiddenDeviceIds={hiddenDeviceIds}
        hiddenManualSwitchIds={hiddenManualSwitchIds}
        onRestoreNode={(nodeId) => {
          onSaveOverlay({ ...overlay, hiddenNodeIds: (overlay.hiddenNodeIds ?? []).filter((id) => id !== nodeId) }, 'Node shown');
          onSelectNode(nodeId);
        }}
        onRestoreDevice={(deviceId) => {
          onSaveOverlay({ ...overlay, deviceOverlays: overlay.deviceOverlays.map((entry) => entry.deviceId === deviceId ? { ...entry, hidden: false } : entry) }, 'Device shown');
        }}
        onRestoreManualSwitch={(switchId) => {
          onSaveOverlay({ ...overlay, manualSwitches: overlay.manualSwitches.map((entry) => entry.id === switchId ? { ...entry, hidden: false } : entry) }, 'Switch shown');
          onSelectNode(switchId);
        }}
        onRestoreEdge={(edgeId) => {
          onSaveOverlay({ ...overlay, hiddenEdgeIds: (overlay.hiddenEdgeIds ?? []).filter((id) => id !== edgeId) }, 'Link shown');
          onSelectEdge(edgeId);
        }}
      />
    </div>
  );
}

function NodeDetail({ selected, overlay, onSelectEdge, onSaveOverlay }: Readonly<{
  selected: TopologyNodeData;
  overlay: OverlayGraph;
  onSelectEdge: (edgeId: string) => void;
  onSaveOverlay: (overlay: OverlayGraph, message: string) => void;
}>) {
  const { node, device, router, connectedEdges } = selected;
  const manualSwitch = overlay.manualSwitches.find((entry) => entry.id === node.id);
  const deviceOverlay = node.deviceId ? overlay.deviceOverlays.find((entry) => entry.deviceId === node.deviceId) : undefined;
  const [label, setLabel] = useState(deviceOverlay?.displayName ?? manualSwitch?.label ?? node.label);
  const [notes, setNotes] = useState(deviceOverlay?.notes ?? manualSwitch?.notes ?? '');
  const [tags, setTags] = useState((deviceOverlay?.tags ?? manualSwitch?.tags ?? []).join(', '));

  useEffect(() => {
    setLabel(deviceOverlay?.displayName ?? manualSwitch?.label ?? node.label);
    setNotes(deviceOverlay?.notes ?? manualSwitch?.notes ?? '');
    setTags((deviceOverlay?.tags ?? manualSwitch?.tags ?? []).join(', '));
  }, [deviceOverlay?.displayName, deviceOverlay?.notes, deviceOverlay?.tags, manualSwitch?.label, manualSwitch?.notes, manualSwitch?.tags, node.label]);

  const save = () => {
    if (node.kind === 'manualSwitch') {
      onSaveOverlay({
        ...overlay,
        manualSwitches: overlay.manualSwitches.map((entry) => entry.id === node.id ? { ...entry, label, notes, tags: parseTags(tags) } : entry),
      }, 'Switch edits saved');
      return;
    }

    if (!node.deviceId) {
      return;
    }

    onSaveOverlay({
      ...overlay,
      deviceOverlays: upsertDeviceOverlay(overlay, node.deviceId, { displayName: label, notes, tags: parseTags(tags) }),
    }, 'Device edits saved');
  };

  const hideNode = () => {
    if (node.kind === 'manualSwitch') {
      onSaveOverlay({ ...overlay, manualSwitches: overlay.manualSwitches.map((entry) => entry.id === node.id ? { ...entry, hidden: true } : entry) }, 'Switch hidden');
      return;
    }

    if (node.deviceId) {
      onSaveOverlay({ ...overlay, deviceOverlays: upsertDeviceOverlay(overlay, node.deviceId, { hidden: true }) }, 'Device hidden');
      return;
    }

    onSaveOverlay({ ...overlay, hiddenNodeIds: addUnique(overlay.hiddenNodeIds ?? [], node.id) }, 'Node hidden');
  };

  const deleteManualSwitch = () => {
    onSaveOverlay({
      ...overlay,
      manualSwitches: overlay.manualSwitches.filter((entry) => entry.id !== node.id),
      edges: overlay.edges.filter((edge) => edge.sourceNodeId !== node.id && edge.targetNodeId !== node.id),
      nodePositions: (overlay.nodePositions ?? []).filter((position) => position.nodeId !== node.id),
    }, 'Manual switch removed');
  };

  return (
    <div className="node-detail">
      <div>
        <h2>{node.label}</h2>
        <p>{node.kind === 'manualSwitch' ? 'Manual topology element' : 'Discovered topology element'}</p>
      </div>

      <div className="edit-form">
        <label>
          <span>Display label</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} disabled={node.kind === 'router'} />
        </label>
        <label>
          <span>Notes</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Rack, room, port notes…" />
        </label>
        <label>
          <span>Tags</span>
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="office, poe, critical" />
        </label>
        <div className="button-row">
          <button type="button" onClick={save} disabled={node.kind === 'router'}>Save edits</button>
          <button type="button" className="ghost-button" onClick={hideNode}>Hide node</button>
          {node.kind === 'manualSwitch' ? <button type="button" className="danger-button" onClick={deleteManualSwitch}>Delete switch</button> : null}
        </div>
      </div>

      <dl className="metadata-list">
        <Metadata label="Hostname" value={device?.discoveredHostname ?? device?.dhcpHostname ?? node.label} />
        <Metadata label="MAC" value={device?.macAddress} />
        <Metadata label="IP" value={device?.ipAddresses.join(', ')} />
        <Metadata label="Vendor" value={device?.vendor} />
        <Metadata label="Router ID" value={node.routerId ?? selected.device?.wifiAssociations[0]?.routerId} />
        <Metadata label="WebUI" value={router?.baseUrl} href={router?.baseUrl} />
        <Metadata label="Last seen" value={device ? formatDate(device.lastSeenAt) : undefined} />
      </dl>

      <div className="link-list">
        <h3>Links</h3>
        {connectedEdges.length > 0 ? connectedEdges.map((edge) => <LinkItem key={edge.id} edge={edge} currentNodeId={node.id} overlay={overlay} onSelectEdge={onSelectEdge} onSaveOverlay={onSaveOverlay} />) : <p>No links are attached to this node yet. Drag from one node handle to another to create a manual link.</p>}
      </div>
    </div>
  );
}

function EdgeDetail({ edge, overlay, onSaveOverlay }: Readonly<{
  edge: TopologyEdge;
  overlay: OverlayGraph;
  onSaveOverlay: (overlay: OverlayGraph, message: string) => void;
}>) {
  const remove = () => {
    if (edge.kind === 'manual') {
      onSaveOverlay({ ...overlay, edges: overlay.edges.filter((entry) => entry.id !== edge.id) }, 'Manual link removed');
      return;
    }

    onSaveOverlay({ ...overlay, hiddenEdgeIds: addUnique(overlay.hiddenEdgeIds ?? [], edge.id) }, 'Link hidden');
  };

  return (
    <div className="node-detail">
      <div>
        <h2>{edge.kind} link</h2>
        <p>{edge.kind === 'manual' ? 'Manual correction link' : 'Discovered link'}</p>
      </div>
      <dl className="metadata-list">
        <Metadata label="Source" value={edge.sourceNodeId} />
        <Metadata label="Target" value={edge.targetNodeId} />
        <Metadata label="Band" value={edge.band} />
      </dl>
      <div className="button-row">
        <button type="button" className={edge.kind === 'manual' ? 'danger-button' : 'ghost-button'} onClick={remove}>{edge.kind === 'manual' ? 'Remove manual link' : 'Hide link'}</button>
      </div>
    </div>
  );
}

function Metadata({ label, value, href }: Readonly<{ label: string; value?: string; href?: string }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ? (href ? <a href={href}>{value}</a> : value) : '—'}</dd>
    </div>
  );
}

function LinkItem({ edge, currentNodeId, overlay, onSelectEdge, onSaveOverlay }: Readonly<{
  edge: TopologyEdge;
  currentNodeId: string;
  overlay: OverlayGraph;
  onSelectEdge: (edgeId: string) => void;
  onSaveOverlay: (overlay: OverlayGraph, message: string) => void;
}>) {
  const peer = edge.sourceNodeId === currentNodeId ? edge.targetNodeId : edge.sourceNodeId;
  const remove = () => {
    if (edge.kind === 'manual') {
      onSaveOverlay({ ...overlay, edges: overlay.edges.filter((entry) => entry.id !== edge.id) }, 'Manual link removed');
      return;
    }
    onSaveOverlay({ ...overlay, hiddenEdgeIds: addUnique(overlay.hiddenEdgeIds ?? [], edge.id) }, 'Link hidden');
  };

  return (
    <article className={`link-item link-item--${edge.kind}`}>
      <button type="button" className="link-button" onClick={() => onSelectEdge(edge.id)}>
        <span>{edge.kind}{edge.band ? ` · ${edge.band}` : ''}</span>
        <strong>{peer}</strong>
      </button>
      <button type="button" className="ghost-button" onClick={remove}>{edge.kind === 'manual' ? 'Remove' : 'Hide'}</button>
    </article>
  );
}

function RestoreList({ hiddenNodeIds, hiddenEdgeIds, hiddenDeviceIds, hiddenManualSwitchIds, onRestoreNode, onRestoreDevice, onRestoreManualSwitch, onRestoreEdge }: Readonly<{
  hiddenNodeIds: readonly string[];
  hiddenEdgeIds: readonly string[];
  hiddenDeviceIds: readonly string[];
  hiddenManualSwitchIds: readonly string[];
  onRestoreNode: (nodeId: string) => void;
  onRestoreDevice: (deviceId: string) => void;
  onRestoreManualSwitch: (switchId: string) => void;
  onRestoreEdge: (edgeId: string) => void;
}>) {
  if (hiddenNodeIds.length === 0 && hiddenEdgeIds.length === 0 && hiddenDeviceIds.length === 0 && hiddenManualSwitchIds.length === 0) {
    return null;
  }

  return (
    <div className="restore-list">
      <h3>Hidden items</h3>
      {[...hiddenNodeIds].map((nodeId) => <button type="button" key={nodeId} onClick={() => onRestoreNode(nodeId)}>Show node {nodeId}</button>)}
      {[...hiddenDeviceIds].map((deviceId) => <button type="button" key={deviceId} onClick={() => onRestoreDevice(deviceId)}>Show device {deviceId}</button>)}
      {[...hiddenManualSwitchIds].map((switchId) => <button type="button" key={switchId} onClick={() => onRestoreManualSwitch(switchId)}>Show switch {switchId}</button>)}
      {[...hiddenEdgeIds].map((edgeId) => <button type="button" key={edgeId} onClick={() => onRestoreEdge(edgeId)}>Show link {edgeId}</button>)}
    </div>
  );
}

function upsertDeviceOverlay(overlay: OverlayGraph, deviceId: string, patch: Partial<NonNullable<OverlayGraph['deviceOverlays'][number]>>): OverlayGraph['deviceOverlays'] {
  const existing = overlay.deviceOverlays.find((entry) => entry.deviceId === deviceId);
  if (!existing) {
    return [...overlay.deviceOverlays, { deviceId, ...patch }];
  }

  return overlay.deviceOverlays.map((entry) => entry.deviceId === deviceId ? { ...entry, ...patch } : entry);
}

function parseTags(value: string): string[] | undefined {
  const tags = [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))];
  return tags.length > 0 ? tags : undefined;
}

function addUnique(values: readonly string[], next: string): string[] {
  return [...new Set([...values, next])];
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
