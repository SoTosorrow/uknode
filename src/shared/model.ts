// Core identity, relationship and visual position remain independent.
export interface BaseNode { id: string }

export interface BaseEdge {
  id: string;
  source: string;
  target: string;
  directed: boolean;
  label: string;
}

export interface NodeLayout {
  nodeId: string;
  x: number;
  y: number;
}

export interface GraphData {
  revision: number;
  nodes: BaseNode[];
  edges: BaseEdge[];
  layouts: NodeLayout[];
}
