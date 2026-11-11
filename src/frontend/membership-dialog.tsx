import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { GraphStore } from './graph-store.js';
import { directMemberIds } from '../shared/memberships.js';
import { MembershipPicker } from './scope-controls.js';
import { Icon } from './editor-overlays.js';

export function MembershipDialog({ store, children }: { store: GraphStore; children: ReactNode }) {
  const state = useStore(store);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const nodeId = state.contextNodeId!;
  const path = [...state.navigation.filter((id): id is string => id !== null), nodeId];
  const count = directMemberIds(Object.values(state.memberships), nodeId).length;
  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }); }, [nodeId]);
  return <dialog ref={dialog} className="membership-dialog" aria-labelledby="membership-dialog-title"
    onCancel={event => { event.preventDefault(); state.closeScope(); }}>
    <header className="membership-dialog-header">
      <div className="membership-dialog-title-row">
        <h2 ref={heading} tabIndex={-1} id="membership-dialog-title">收录节点 <code title={nodeId}>{nodeId.slice(0, 8)}</code><span>{count} 个直接成员</span></h2>
        <button className="dialog-close" aria-label="关闭收录弹窗" title="关闭（Esc）" onClick={state.closeScope}><Icon name="close" /></button>
      </div>
      <div className="membership-dialog-actions">
        <nav className="membership-path" aria-label="浏览路径">
          <button disabled={state.loading || state.navigation.length < 2} onClick={state.goBack}>返回</button>
          <ol>{path.map((id, index) => <li key={`${index}:${id}`} aria-current={index === path.length - 1 ? 'location' : undefined}><code title={id}>{id.slice(0, 8)}</code></li>)}</ol>
        </nav>
        <MembershipPicker key={nodeId} nodeId={nodeId} state={state} />
      </div>
    </header>
    <div className="membership-dialog-body">{children}</div>
  </dialog>;
}
