// Stable anchors and structural relationships; no business or display fields.
export interface BaseNode { id: string }
export interface BaseEdge {
  id: string;
  source: string;
  target: string;
  directed: boolean;
}
export interface Project { id: string; name: string; business: string }

export interface GraphObjects {
  nodes: Record<string, BaseNode>;
  edges: Record<string, BaseEdge>;
}
