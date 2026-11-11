import { useId, useState } from 'react';
import { membershipKey } from '../shared/model.js';
import { descendantIds, directMemberIds } from '../shared/memberships.js';
import type { GraphState } from './graph-store.js';

export function MembershipPicker({ nodeId, state }: { nodeId: string; state: GraphState }) {
  const inputId = useId();
  const [chosenId, setChosenId] = useState('');
  const [message, setMessage] = useState('');
  const memberships = Object.values(state.memberships);
  const members = new Set(directMemberIds(memberships, nodeId));
  const ancestors = descendantIds(memberships.map(m => ({ containerId: m.memberId, memberId: m.containerId })), nodeId);
  const candidates = Object.keys(state.nodes).filter(id => id !== nodeId && !members.has(id));
  const chosen = candidates.includes(chosenId) ? chosenId : '';
  const disabled = !state.loaded || state.loading;
  return <form className="membership-picker" onSubmit={event => {
    event.preventDefault();
    if (!chosen) return;
    const error = state.addMembership(nodeId, chosen);
    setMessage(error ?? '已收录现有节点');
    if (!error) setChosenId('');
  }}>
    <label htmlFor={inputId}>收录已有节点</label>
    <select id={inputId} value={chosen} disabled={disabled} onChange={event => { setChosenId(event.target.value); setMessage(''); }}>
      <option value="">选择节点</option>
      {candidates.map(id => <option key={id} value={id} disabled={ancestors.has(id)}>{id}{ancestors.has(id) ? '（会形成循环）' : ''}</option>)}
    </select>
    <button type="submit" disabled={disabled || !chosen || ancestors.has(chosen)}>收录</button>
    <span className="visually-hidden" role="status">{message}</span>
  </form>;
}

export function MembershipEditor({ nodeId, state }: { nodeId: string; state: GraphState }) {
  const memberships = Object.values(state.memberships);
  const count = directMemberIds(memberships, nodeId).length;
  const parents = memberships.filter(m => m.memberId === nodeId).map(m => m.containerId);
  const disabled = !state.loaded || state.loading;
  const context = state.contextNodeId;
  const directInContext = context !== null && Boolean(state.memberships[membershipKey({ containerId: context, memberId: nodeId })]);
  return <section className="membership-editor" aria-label="节点收录关系">
    <button className="range-open" disabled={disabled} onClick={() => state.openScope(nodeId)}>
      查看收录节点 <span>{count}</span>
    </button>
    {directInContext && <div className="current-membership">
      <p className="detail-hint">当前母节点的直接成员</p>
      <button disabled={disabled} onClick={() => state.removeMembership(context!, nodeId)}>解除当前收录</button>
    </div>}
    {parents.length > 0 && <div className="parent-references"><span>被 {parents.length} 个节点直接收录</span><div>{parents.map(id =>
      <button key={id} title={id} disabled={disabled} onClick={() => state.openScope(id)}><code>{id.slice(0, 8)}</code></button>,
    )}</div></div>}
  </section>;
}
