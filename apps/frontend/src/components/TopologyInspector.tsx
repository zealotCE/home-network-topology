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
    <aside className="inspector-panel" aria-label="拓扑详情面板">
      <section className="summary-card">
        <p className="eyebrow">网络概览</p>
        <div className="summary-grid">
          <SummaryMetric label="路由器" value={summary.routerCount} />
          <SummaryMetric label="AP" value={summary.accessPointCount} />
          <SummaryMetric label="手动交换机" value={summary.manualSwitchCount} />
          <SummaryMetric label="Wi‑Fi 设备" value={summary.wifiDeviceCount} />
          <SummaryMetric label="有线设备" value={summary.wiredDeviceCount} />
          <SummaryMetric label="连接" value={summary.linkCount} />
        </div>
      </section>

      <DeviceSearchList allNodes={allNodes} onSelectNode={onSelectNode} />

      <section className="detail-card" data-testid="topology-inspector">
        <p className="eyebrow">所选详情</p>
        {selected ? <NodeDetail selected={selected} overlay={overlay} onSelectEdge={onSelectEdge} onSaveOverlay={onSaveOverlay} /> : null}
        {!selected && selectedEdge ? <EdgeDetail edge={selectedEdge} overlay={overlay} onSaveOverlay={onSaveOverlay} /> : null}
        {!selected && !selectedEdge ? <EmptySelection overlay={overlay} allNodes={allNodes} allEdges={allEdges} onSelectNode={onSelectNode} onSelectEdge={onSelectEdge} onSaveOverlay={onSaveOverlay} /> : null}
      </section>
    </aside>
  );
}

function DeviceSearchList({ allNodes, onSelectNode }: Readonly<{
  allNodes: ReadonlyMap<string, TopologyNodeData>;
  onSelectNode: (nodeId: string) => void;
}>) {
  const [query, setQuery] = useState('');
  const devices = useMemo(() => [...allNodes.values()]
    .filter((entry) => entry.node.kind === 'device')
    .sort((left, right) => left.node.label.localeCompare(right.node.label, 'en', { numeric: true, sensitivity: 'base' })), [allNodes]);
  const normalizedQuery = query.trim().toLowerCase();
  const results = normalizedQuery
    ? devices.filter((entry) => searchableDeviceText(entry).includes(normalizedQuery))
    : devices;

  return (
    <section className="device-search-card" data-testid="device-search-list">
      <div>
        <p className="eyebrow">设备列表</p>
        <label>
          <span>搜索可见设备</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="主机名、IP、MAC、厂商…" />
        </label>
      </div>
      <div className="device-search-results" aria-live="polite">
        {results.length > 0 ? results.map((entry) => (
          <button type="button" className="device-search-result" key={entry.node.id} onClick={() => onSelectNode(entry.node.id)}>
            <strong>{entry.node.label}</strong>
            <span>{deviceSearchDetail(entry)}</span>
          </button>
        )) : <p>没有可见设备匹配当前搜索。</p>}
      </div>
    </section>
  );
}

function searchableDeviceText(entry: TopologyNodeData): string {
  return [
    entry.node.label,
    entry.node.deviceId,
    entry.device?.macAddress,
    entry.device?.discoveredHostname,
    entry.device?.dhcpHostname,
    entry.device?.vendor,
    ...(entry.device?.ipAddresses ?? []),
    ...(entry.device?.wifiAssociations.map((association) => association.routerId) ?? []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function deviceSearchDetail(entry: TopologyNodeData): string {
  return entry.device?.ipAddresses[0] ?? entry.device?.macAddress ?? entry.node.deviceId ?? entry.connectionMode;
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
      <h2>选择节点或连接</h2>
      <p>选择路由器、设备、手动交换机或连接后，可以编辑名称、备注、标签、可见性和手动拓扑修正。</p>
      <RestoreList
        hiddenNodeIds={hiddenNodeIds}
        hiddenEdgeIds={hiddenEdgeIds}
        hiddenDeviceIds={hiddenDeviceIds}
        hiddenManualSwitchIds={hiddenManualSwitchIds}
        onRestoreNode={(nodeId) => {
          onSaveOverlay({ ...overlay, hiddenNodeIds: (overlay.hiddenNodeIds ?? []).filter((id) => id !== nodeId) }, '节点已显示');
          onSelectNode(nodeId);
        }}
        onRestoreDevice={(deviceId) => {
          onSaveOverlay({ ...overlay, deviceOverlays: overlay.deviceOverlays.map((entry) => entry.deviceId === deviceId ? { ...entry, hidden: false } : entry) }, '设备已显示');
        }}
        onRestoreManualSwitch={(switchId) => {
          onSaveOverlay({ ...overlay, manualSwitches: overlay.manualSwitches.map((entry) => entry.id === switchId ? { ...entry, hidden: false } : entry) }, '交换机已显示');
          onSelectNode(switchId);
        }}
        onRestoreEdge={(edgeId) => {
          onSaveOverlay({ ...overlay, hiddenEdgeIds: (overlay.hiddenEdgeIds ?? []).filter((id) => id !== edgeId) }, '连接已显示');
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
      }, '交换机修改已保存');
      return;
    }

    if (!node.deviceId) {
      return;
    }

    onSaveOverlay({
      ...overlay,
      deviceOverlays: upsertDeviceOverlay(overlay, node.deviceId, { displayName: label, notes, tags: parseTags(tags) }),
    }, '设备修改已保存');
  };

  const hideNode = () => {
    if (node.kind === 'manualSwitch') {
      onSaveOverlay({ ...overlay, manualSwitches: overlay.manualSwitches.map((entry) => entry.id === node.id ? { ...entry, hidden: true } : entry) }, '交换机已隐藏');
      return;
    }

    if (node.deviceId) {
      onSaveOverlay({ ...overlay, deviceOverlays: upsertDeviceOverlay(overlay, node.deviceId, { hidden: true }) }, '设备已隐藏');
      return;
    }

    onSaveOverlay({ ...overlay, hiddenNodeIds: addUnique(overlay.hiddenNodeIds ?? [], node.id) }, '节点已隐藏');
  };

  const deleteManualSwitch = () => {
    onSaveOverlay({
      ...overlay,
      manualSwitches: overlay.manualSwitches.filter((entry) => entry.id !== node.id),
      edges: overlay.edges.filter((edge) => edge.sourceNodeId !== node.id && edge.targetNodeId !== node.id),
      nodePositions: (overlay.nodePositions ?? []).filter((position) => position.nodeId !== node.id),
    }, '手动交换机已删除');
  };

  return (
    <div className="node-detail">
      <div>
        <h2>{node.label}</h2>
        <p>{node.kind === 'manualSwitch' ? '手动拓扑元素' : '发现到的拓扑元素'}</p>
      </div>

      <div className="edit-form">
        <label>
          <span>显示名称</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} disabled={node.kind === 'router'} />
        </label>
        <label>
          <span>备注</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="机柜、房间、端口备注…" />
        </label>
        <label>
          <span>标签</span>
          <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="办公室、PoE、关键" />
        </label>
        <div className="button-row">
          <button type="button" onClick={save} disabled={node.kind === 'router'}>保存修改</button>
          <button type="button" className="ghost-button" onClick={hideNode}>隐藏节点</button>
          {node.kind === 'manualSwitch' ? <button type="button" className="danger-button" onClick={deleteManualSwitch}>删除交换机</button> : null}
        </div>
      </div>

      <dl className="metadata-list">
        <Metadata label="主机名" value={device?.discoveredHostname ?? device?.dhcpHostname ?? node.label} />
        <Metadata label="MAC" value={device?.macAddress} />
        <Metadata label="IP" value={device?.ipAddresses.join(', ')} />
        <Metadata label="厂商" value={device?.vendor} />
        <Metadata label="路由器 ID" value={node.routerId ?? selected.device?.wifiAssociations[0]?.routerId} />
        <Metadata label="WebUI" value={router?.baseUrl} href={router?.baseUrl} />
        <Metadata label="最后发现" value={device ? formatDate(device.lastSeenAt) : undefined} />
      </dl>

      <div className="link-list">
        <h3>连接</h3>
        {connectedEdges.length > 0 ? connectedEdges.map((edge) => <LinkItem key={edge.id} edge={edge} currentNodeId={node.id} overlay={overlay} onSelectEdge={onSelectEdge} onSaveOverlay={onSaveOverlay} />) : <p>该节点还没有连接。可从一个节点拖到另一个节点来创建手动连接。</p>}
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
      onSaveOverlay({ ...overlay, edges: overlay.edges.filter((entry) => entry.id !== edge.id) }, '手动连接已删除');
      return;
    }

    onSaveOverlay({ ...overlay, hiddenEdgeIds: addUnique(overlay.hiddenEdgeIds ?? [], edge.id) }, '连接已隐藏');
  };

  return (
    <div className="node-detail">
      <div>
        <h2>{edgeKindLabel(edge.kind)}连接</h2>
        <p>{edge.kind === 'manual' ? '手动修正连接' : '发现到的连接'}</p>
      </div>
      <dl className="metadata-list">
        <Metadata label="来源" value={edge.sourceNodeId} />
        <Metadata label="目标" value={edge.targetNodeId} />
        <Metadata label="频段" value={edge.band} />
      </dl>
      <div className="button-row">
        <button type="button" className={edge.kind === 'manual' ? 'danger-button' : 'ghost-button'} onClick={remove}>{edge.kind === 'manual' ? '删除手动连接' : '隐藏连接'}</button>
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
      onSaveOverlay({ ...overlay, edges: overlay.edges.filter((entry) => entry.id !== edge.id) }, '手动连接已删除');
      return;
    }
    onSaveOverlay({ ...overlay, hiddenEdgeIds: addUnique(overlay.hiddenEdgeIds ?? [], edge.id) }, '连接已隐藏');
  };

  return (
    <article className={`link-item link-item--${edge.kind}`}>
      <button type="button" className="link-button" onClick={() => onSelectEdge(edge.id)}>
        <span>{edgeKindLabel(edge.kind)}{edge.band ? ` · ${edge.band}` : ''}</span>
        <strong>{peer}</strong>
      </button>
      <button type="button" className="ghost-button" onClick={remove}>{edge.kind === 'manual' ? '删除' : '隐藏'}</button>
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
      <h3>已隐藏项目</h3>
      {[...hiddenNodeIds].map((nodeId) => <button type="button" key={nodeId} onClick={() => onRestoreNode(nodeId)}>显示节点 {nodeId}</button>)}
      {[...hiddenDeviceIds].map((deviceId) => <button type="button" key={deviceId} onClick={() => onRestoreDevice(deviceId)}>显示设备 {deviceId}</button>)}
      {[...hiddenManualSwitchIds].map((switchId) => <button type="button" key={switchId} onClick={() => onRestoreManualSwitch(switchId)}>显示交换机 {switchId}</button>)}
      {[...hiddenEdgeIds].map((edgeId) => <button type="button" key={edgeId} onClick={() => onRestoreEdge(edgeId)}>显示连接 {edgeId}</button>)}
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

function edgeKindLabel(kind: TopologyEdge['kind']): string {
  if (kind === 'ethernet') return '以太网';
  if (kind === 'wifi') return 'Wi‑Fi';
  if (kind === 'inferred') return '推断';
  return '手动';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
