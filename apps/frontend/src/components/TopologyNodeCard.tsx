import { Handle, Position, type NodeProps } from '@xyflow/react';

import type { TopologyFlowNode, TopologyNodeData } from '../types/topology';

const roleLabels: Record<TopologyNodeData['role'], string> = {
  router: 'Router',
  accessPoint: 'Access point',
  device: 'Device',
  manualSwitch: 'Manual switch',
};

const modeLabels: Record<TopologyNodeData['connectionMode'], string> = {
  wifi: 'Wi‑Fi',
  wired: 'Wired',
  mixed: 'Mixed',
  unknown: 'Unlinked',
};

export function TopologyNodeCard({ data, selected }: NodeProps<TopologyFlowNode>) {
  const nodeClass = ['topology-node', `topology-node--${data.role}`, selected ? 'is-selected' : ''].filter(Boolean).join(' ');
  const detail = data.device?.ipAddresses[0] ?? data.router?.baseUrl ?? `${data.connectedEdges.length} link${data.connectedEdges.length === 1 ? '' : 's'}`;

  return (
    <article className={nodeClass} data-testid={`topology-node-${data.node.id}`}>
      <Handle className="topology-node__handle" type="target" position={Position.Left} />
      <div className="topology-node__header">
        <span className="topology-node__glyph" aria-hidden="true">{glyphForRole(data.role)}</span>
        <span className="topology-node__kind">{roleLabels[data.role]}</span>
      </div>
      <h3>{data.node.label}</h3>
      <p>{detail}</p>
      <div className="topology-node__badges">
        <span>{modeLabels[data.connectionMode]}</span>
        <span>{data.node.kind === 'manualSwitch' ? 'Manual' : 'Discovered'}</span>
      </div>
      <Handle className="topology-node__handle" type="source" position={Position.Right} />
    </article>
  );
}

function glyphForRole(role: TopologyNodeData['role']): string {
  if (role === 'router') return 'R';
  if (role === 'accessPoint') return 'AP';
  if (role === 'manualSwitch') return 'S';
  return 'D';
}
