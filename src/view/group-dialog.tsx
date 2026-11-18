import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SessionStore } from '../runtime/client/session.js';
import { groupAssignments } from '../runtime/node-groups.js';

export type GroupDialogMode = 'create' | 'move' | 'manage';
const titles = { create: '新建组', move: '移入组', manage: '管理节点组' };

export default function GroupDialog({ mode, session, nodeIds, onClose }: {
  mode: GroupDialogMode; session: SessionStore; nodeIds: string[]; onClose: () => void;
}) {
  const state = session.getState();
  const choices = Object.values(state.groups).sort((a, b) => a.name.localeCompare(b.name));
  const [id, setId] = useState(state.groupByNode[nodeIds[0]] ?? choices[0]?.id ?? '');
  const [name, setName] = useState(mode === 'manage' ? state.groups[id]?.name ?? '' : '');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    const current = session.getState();
    if (mode === 'create') {
      const group = { id: current.allocateId(), name: name.trim() };
      current.edit([{ type: 'group.put', group }, ...groupAssignments(current, nodeIds, group.id)]);
    } else if (mode === 'move') {
      current.edit(groupAssignments(current, nodeIds, id));
    } else if (name.trim() !== current.groups[id]?.name) {
      current.edit([{ type: 'group.put', group: { id, name: name.trim() } }]);
    }
    onClose();
  }
  return <dialog ref={dialog} className="group-dialog" aria-label={titles[mode]} data-canvas-controls onCancel={onClose}>
    <form onSubmit={submit}>
      <h2>{titles[mode]}</h2>
      {mode !== 'create' && <label>节点组<select value={id} onChange={event => {
        setId(event.target.value);
        setName(state.groups[event.target.value].name);
      }}>{choices.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
      {mode !== 'move' && <label>组名<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>}
      <div className="group-dialog-actions">
        {mode === 'manage' && <button type="button" onClick={() => {
          state.edit([{ type: 'group.delete', id }]); onClose();
        }}>解散组</button>}
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" disabled={mode === 'move' ? !id : !name.trim()}>{mode === 'create' ? '创建' : mode === 'move' ? '移入' : '保存组名'}</button>
      </div>
    </form>
  </dialog>;
}
