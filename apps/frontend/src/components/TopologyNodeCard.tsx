import { Handle, Position, type NodeProps } from '@xyflow/react';

import type { TopologyFlowNode, TopologyNodeData } from '../types/topology';

const roleLabels: Record<TopologyNodeData['role'], string> = {
  router: '路由器',
  accessPoint: 'AP',
  device: '设备',
  manualSwitch: '手动交换机',
};

const modeLabels: Record<TopologyNodeData['connectionMode'], string> = {
  wifi: 'Wi‑Fi',
  wired: '有线',
  mixed: '混合',
  unknown: '未连接',
};

export function TopologyNodeCard({ data, selected }: NodeProps<TopologyFlowNode>) {
  const nodeClass = ['topology-node', `topology-node--${data.role}`, selected ? 'is-selected' : ''].filter(Boolean).join(' ');
  const detail = data.device?.ipAddresses[0] ?? data.router?.baseUrl ?? `${data.connectedEdges.length} 条连接`;

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
        <span>{data.node.kind === 'manualSwitch' ? '手动' : '已发现'}</span>
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
