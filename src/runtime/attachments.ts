// Named node data is owned and interpreted by its business module.
export interface NodeAttachment {
  namespace: string;
  nodeId: string;
  data: Record<string, unknown>;
}
export type AttachmentRef = Pick<NodeAttachment, 'namespace' | 'nodeId'>;
export const attachmentKey = ({ namespace, nodeId }: AttachmentRef) => `${namespace}:${nodeId}`;
