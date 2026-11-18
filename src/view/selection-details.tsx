import type { ReactNode } from 'react';
import type { EditorUIState } from './use-editor.js';
import type { NodeLayout } from '../runtime/document.js';
import type { CanvasSelection } from './graph-canvas.js';
import { DetailsPanel } from './editor-overlays.js';

export function SelectionDetails({ state, layouts, structural, renderDetails }: {
  state: EditorUIState;
  structural: boolean;
  layouts: Record<string, NodeLayout>;
  renderDetails?: (selection: CanvasSelection) => ReactNode;
}) {
  const nodeIds = state.selectedNodes.filter(id => state.nodes[id]);
  const edgeIds = state.selectedEdges.filter(id => state.edges[id]);
  const node = nodeIds.length === 1 && !edgeIds.length ? state.nodes[nodeIds[0]] : undefined;
  const edge = edgeIds.length === 1 && !nodeIds.length ? state.edges[edgeIds[0]] : undefined;
  const layout = node && layouts[node.id];
  const group = node && state.groups[state.groupByNode[node.id]];
  const title = node ? '节点详情' : edge ? '连线详情' : '选中对象';
  const visible = Boolean(nodeIds.length || edgeIds.length);
  return <DetailsPanel title={title} visible={visible}>
    {node ? <>
      {group && <p className="node-group-name">节点组 · {group.name}</p>}
      <p className="node-meta" aria-label="节点 ID 和坐标">
        <span>ID <code>{node.id}</code></span>
        {layout && <><span>X {Number(layout.x.toFixed(1))}</span><span>Y {Number(layout.y.toFixed(1))}</span></>}
      </p>
    </> : edge ? <>
      <dl className="endpoint-list">
        <div><dt>起点</dt><dd><code>{edge.source}</code></dd></div>
        <div><dt>终点</dt><dd><code>{edge.target}</code></dd></div>
      </dl>
      {structural && <label className="direction-field"><input type="checkbox" disabled={state.loading} checked={edge.directed} onChange={event => state.updateEdge(edge.id, { directed: event.target.checked })} />有方向</label>}
    </> : <>
      <p className="selection-count">{nodeIds.length} 个节点 · {edgeIds.length} 条连线</p>
      <p className="detail-hint">拖动选区可一起移动，或使用“删除选中”。</p>
    </>}
    {visible && renderDetails?.({ nodes: nodeIds, edges: edgeIds })}
  </DetailsPanel>;
}
