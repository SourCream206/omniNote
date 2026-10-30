import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { File, FilePenLine, ExternalLink } from 'lucide-react';
import DocumentPreview from './DocumentPreview';
import type { Asset, CanvasObject, ExtensionInfo } from './types';

const builtIn = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'markdown', 'html', 'htm']);

export default function DocumentPage({ pageId, asset, extensions, toolbarTarget, onAnnotate, onError }: { pageId: string; asset: Asset; extensions: ExtensionInfo[]; toolbarTarget: HTMLElement | null; onAnnotate(): void; onError(error: unknown): void }) {
  const surface = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [previewFailed, setPreviewFailed] = useState(false);
  const format = asset.original_name.split('.').pop()?.toLowerCase() ?? '';
  const viewer = extensions.filter((item) => item.enabled && item.grantedPermissions.includes('asset.read')).flatMap((extension) => (extension.manifest.contributes.documentViewers ?? []).filter((entry) => entry.extensions.includes(format)).map((entry) => ({ extension, entry: entry.entry })))[0];
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (surface.current) observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setPreviewFailed(false), [asset.id]);
  const object = useMemo<CanvasObject>(() => ({ id: asset.id, page_id: pageId, type: 'document', x: 0, y: 0, width, height: 0, z_index: 0, group_id: null, payload_version: 1, payload: { assetId: asset.id, name: asset.original_name, format } }), [asset.id, asset.original_name, format, pageId, width]);
  const openOriginal = () => window.whiteboard.openOriginal(asset.id).catch(onError);
  const toolbar = <div className="document-page-toolbar"><span className="document-format">{format.toUpperCase() || 'FILE'}</span><span className="document-page-name" title={asset.original_name}>{asset.original_name}</span><button onClick={onAnnotate}><FilePenLine size={15} /> Annotate</button><button onClick={openOriginal}><ExternalLink size={15} /> Open original</button></div>;
  return <div className="document-page" ref={surface}>
    {toolbarTarget && createPortal(toolbar, toolbarTarget)}
    {(builtIn.has(format) || viewer) && !previewFailed ? <DocumentPreview object={object} asset={asset} viewer={viewer} interactive fullDocument onPreviewFailure={() => setPreviewFailed(true)} onError={onError} /> : <div className="document-page-fallback"><File size={42} /><strong>{asset.original_name}</strong><p>{previewFailed ? 'Preview unavailable. The original file is saved in this workspace.' : 'No built-in preview is available for this file type.'}</p><button onClick={openOriginal}>Open original</button></div>}
  </div>;
}
