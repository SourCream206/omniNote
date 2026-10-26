import { useEffect, useRef, useState } from 'react';
import type { ExtensionInfo } from './types';

const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'";

export default function ExtensionFrame({ extension, entry, kind, data, bytes, interactive, onError }: { extension: ExtensionInfo; entry: string; kind: 'canvas-object' | 'document'; data: unknown; bytes?: Uint8Array | null; interactive: boolean; onError(error: unknown): void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [source, setSource] = useState('');
  useEffect(() => {
    let active = true;
    window.whiteboard.extensionResource(extension.manifest.id, entry).then((html) => { if (active) setSource(html); }).catch(onError);
    return () => { active = false; };
  }, [extension.manifest.id, entry]);
  useEffect(() => {
    if (!source) return;
    const send = () => frame.current?.contentWindow?.postMessage({ type: 'omninote:init', apiVersion: '1.0.0', kind, data, bytes, settings: extension.settings }, '*');
    const current = frame.current;
    current?.addEventListener('load', send);
    send();
    return () => current?.removeEventListener('load', send);
  }, [source, kind, data, bytes, extension.settings]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !interactive) return;
      if (event.data?.type === 'omninote:openExternal' && extension.grantedPermissions.includes('link.open') && typeof event.data.url === 'string') window.whiteboard.openExternal(event.data.url).catch(onError);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [extension.grantedPermissions, interactive, onError]);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;width:100%;height:100%;font:13px system-ui,sans-serif}</style></head><body>${source}</body></html>`;
  return <div className="extension-frame" onPointerDown={(event) => { if (interactive) event.stopPropagation(); }}><iframe ref={frame} title={`${extension.manifest.name} ${kind}`} srcDoc={html} sandbox="allow-scripts" style={{ pointerEvents: interactive ? 'auto' : 'none' }} />{!interactive && <div className="document-shield" aria-hidden="true" />}</div>;
}
