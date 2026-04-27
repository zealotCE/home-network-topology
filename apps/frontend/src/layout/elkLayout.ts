import ELK from 'elkjs/lib/elk.bundled.js';
import type { Edge } from '@xyflow/react';

import type { TopologyFlowNode } from '../types/topology';

const elk = new ELK();

const NODE_WIDTH = 220;
const NODE_HEIGHT = 112;

export async function layoutTopology(nodes: TopologyFlowNode[], edges: Edge[]): Promise<TopologyFlowNode[]> {
  if (nodes.length === 0) {
    return [];
  }

  const graph = await elk.layout({
    id: 'topology-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '72',
      'elk.layered.spacing.nodeNodeBetweenLayers': '108',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: nodes.map((node) => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  });

  const positions = new Map(graph.children?.map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]));
  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
}
