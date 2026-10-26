import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, FilePlus2, FolderPlus, Layers3, MoreHorizontal, NotebookPen, PanelLeftClose, Plus, Search, Settings2, Upload, X, Download, FileText, Puzzle, CalendarDays } from 'lucide-react';
import type { CanvasObject, Camera, ExtensionInfo, NodeKind, Snapshot, TreeNode } from './types';
import Canvas, { type CanvasHandle } from './Canvas';

const childrenOf = (nodes: TreeNode[], parentId: string | null) => nodes.filter((node) => node.parent_id === parentId).sort((a, b) => a.order_index - b.order_index);
const firstPageIn = (nodes: TreeNode[], sectionId: string) => childrenOf(nodes, sectionId).find((node) => node.kind === 'page')?.id ?? null;

export default function App() {
  const [dialogRequest, setDialogRequest] = useState<{ title: string; message?: string; mode: 'text' | 'confirm'; action: string } | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const dialogResolver = useRef<((value: string | null) => void) | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showExtensions, setShowExtensions] = useState(false);
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [toast, setToast] = useState('');
  const canvasRef = useRef<CanvasHandle>(null);

  const refresh = useCallback(async () => {
    const data = await window.whiteboard.load();
    setSnapshot(data);
    return data;
  }, []);
  const refreshExtensions = useCallback(async () => setExtensions(await window.whiteboard.listExtensions()), []);

  useEffect(() => {
    Promise.all([refresh(), refreshExtensions()]).then(([data]) => {
      const first = data.nodes.find((node) => node.kind === 'page');
      if (first) { setPageId(first.id); setSectionId(first.parent_id); }
      setExpanded(new Set(data.nodes.filter((node) => node.kind === 'notebook' || node.kind === 'folder').map((node) => node.id)));
    }).catch((error) => setToast(String(error)));
  }, [refresh, refreshExtensions]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const nodes = snapshot?.nodes ?? [];
  const page = nodes.find((node) => node.id === pageId && node.kind === 'page') ?? null;
  const section = nodes.find((node) => node.id === sectionId && node.kind === 'section') ?? null;
  const notebook = useMemo(() => {
    let current = section;
    while (current?.parent_id) current = nodes.find((node) => node.id === current?.parent_id) ?? null;
    return current?.kind === 'notebook' ? current : nodes.find((node) => node.kind === 'notebook');
  }, [nodes, section]);
  const pages = section ? childrenOf(nodes, section.id).filter((node) => node.kind === 'page') : [];

  const notifyError = (error: unknown) => setToast(error instanceof Error ? error.message : String(error));

  function ask(title: string, value: string, action: string, mode: 'text' | 'confirm' = 'text', message?: string): Promise<string | null> {
    return new Promise((resolve) => {
      dialogResolver.current = resolve;
      setDialogValue(value);
      setDialogRequest({ title, mode, action, message });
    });
  }
  function finishDialog(value: string | null) {
    dialogResolver.current?.(value);
    dialogResolver.current = null;
    setDialogRequest(null);
  }

  async function createNode(kind: NodeKind, parentId: string | null) {
    const defaults: Record<NodeKind, string> = { notebook: 'New notebook', folder: 'New folder', section: 'New section', page: 'Untitled page' };
    const title = await ask(`Create ${kind}`, defaults[kind], 'Create');
    if (title === null) return;
    try {
      const nodeId = await window.whiteboard.createNode(parentId, kind, title);
      const data = await refresh();
      if (kind === 'page') { setPageId(nodeId); setSectionId(parentId); }
      if (kind === 'section') { setSectionId(nodeId); setPageId(null); }
      if (parentId) setExpanded((before) => new Set([...before, parentId]));
      if (kind === 'notebook') setExpanded((before) => new Set([...before, nodeId]));
      if (!data.nodes.length) setPageId(null);
    } catch (error) { notifyError(error); }
  }

  async function renameNode(node: TreeNode) {
    const title = await ask(`Rename ${node.kind}`, node.title, 'Rename');
    if (title === null || title === node.title) return;
    try { await window.whiteboard.renameNode(node.id, title); await refresh(); }
    catch (error) { notifyError(error); }
  }

  async function deleteNode(node: TreeNode) {
    if (!(await ask(`Delete ${node.kind}`, '', 'Delete', 'confirm', `Delete “${node.title}” and everything inside it?`))) return;
    try {
      await window.whiteboard.deleteNode(node.id);
      const data = await refresh();
      if (!data.nodes.some((item) => item.id === pageId)) {
        const first = data.nodes.find((item) => item.kind === 'page');
        setPageId(first?.id ?? null);
        setSectionId(first?.parent_id ?? null);
      }
    } catch (error) { notifyError(error); }
  }

  async function moveNode(nodeId: string, parentId: string | null, beforeId?: string | null) {
    try { await window.whiteboard.moveNode(nodeId, parentId, beforeId); await refresh(); }
    catch (error) { notifyError(error); }
  }

  function navigatePage(targetId: string) {
    const target = nodes.find((node) => node.id === targetId && node.kind === 'page');
    if (target) { setPageId(target.id); setSectionId(target.parent_id); }
    const targetSection = nodes.find((node) => node.id === targetId && node.kind === 'section');
    if (targetSection) { setSectionId(targetSection.id); setPageId(firstPageIn(nodes, targetSection.id)); }
  }

  function updatePage(pageIdValue: string, objects: CanvasObject[], camera: Camera) {
    setSnapshot((previous) => previous ? {
      ...previous,
      objects: [...previous.objects.filter((object) => object.page_id !== pageIdValue), ...objects],
      pages: previous.pages.map((row) => row.id === pageIdValue ? { ...row, camera_x: camera.x, camera_y: camera.y, camera_zoom: camera.zoom } : row),
    } : previous);
  }

  async function insertFiles() {
    try {
      const assets = await window.whiteboard.pickAssets();
      for (const asset of assets) canvasRef.current?.insertAsset(asset);
    } catch (error) { notifyError(error); }
  }

  async function runExtension(commandId: string) {
    const extension = extensions.find((item) => item.enabled && item.manifest.contributes.commands?.some((command) => command.id === commandId));
    if (!extension) return;
    try {
      const source = await window.whiteboard.extensionSource(extension.manifest.id);
      const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(blobUrl);
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { worker.terminate(); URL.revokeObjectURL(blobUrl); notifyError('Extension timed out'); }, 5000);
      worker.onmessage = (event: MessageEvent) => {
        if (event.data?.requestId !== requestId) return;
        clearTimeout(timer);
        if (event.data.type === 'canvas.insertText' && extension.manifest.permissions.includes('canvas.write') && typeof event.data.text === 'string') {
          canvasRef.current?.insertText(event.data.text.slice(0, 10000));
          setToast(`${extension.manifest.name} ran`);
        }
        worker.terminate(); URL.revokeObjectURL(blobUrl);
      };
      worker.onerror = (error) => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(blobUrl); notifyError(error.message); };
      worker.postMessage({ type: 'invoke', command: commandId, requestId, apiVersion: '1.0.0' });
    } catch (error) { notifyError(error); }
  }

  if (!snapshot) return <div className="loading-screen"><NotebookPen size={38} /><strong>Opening your workspace…</strong></div>;

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><span className="brand-icon"><NotebookPen size={19} strokeWidth={2.2} /></span><span><strong>omniNote</strong><small>your ideas, anywhere</small></span></div>
      <div className="header-divider" />
      <button className="icon-button header-toggle" title="Toggle sidebar" onClick={() => setSidebarVisible(!sidebarVisible)}><PanelLeftClose size={17} /></button>
      <div className="breadcrumbs"><span>{notebook?.title ?? 'Workspace'}</span><ChevronRight size={13} /><span>{section?.title ?? 'Select a section'}</span><ChevronRight size={13} /><strong>{page?.title ?? 'Select a page'}</strong></div>
      <div className="header-actions"><span className="save-status"><span className="saved-dot" /> Stored locally</span><button className="header-button" onClick={() => window.whiteboard.exportWorkspace().catch(notifyError)}><Download size={15} /> Backup ZIP</button><button className="icon-button" title="Extensions" onClick={() => setShowExtensions(true)}><Puzzle size={18} /></button></div>
    </header>

    <div className="app-body">
      {sidebarVisible && <aside className="notebook-sidebar">
        <div className="sidebar-title"><span>NOTEBOOKS</span><button className="icon-button small" title="New notebook" onClick={() => createNode('notebook', null)}><Plus size={16} /></button></div>
        <div className="tree-scroll">
          {childrenOf(nodes, null).filter((node) => node.kind === 'notebook').map((node) => <TreeItem key={node.id} node={node} nodes={nodes} depth={0} expanded={expanded} onToggle={(id) => setExpanded((before) => { const next = new Set(before); next.has(id) ? next.delete(id) : next.add(id); return next; })} selectedSectionId={sectionId} onSelect={(selected) => { if (selected.kind === 'section') { setSectionId(selected.id); setPageId(firstPageIn(nodes, selected.id)); } }} onCreate={createNode} onRename={renameNode} onDelete={deleteNode} onMove={moveNode} />)}
          {!nodes.length && <div className="empty-sidebar">Create your first notebook to begin.</div>}
        </div>
        <div className="sidebar-footer"><button onClick={() => setShowExtensions(true)}><Puzzle size={16} /> Extensions <span>{extensions.filter((item) => item.enabled).length}</span></button><button onClick={() => window.whiteboard.exportWorkspace().catch(notifyError)}><Download size={16} /> Export workspace</button></div>
      </aside>}

      <aside className="page-sidebar"><div className="page-sidebar-head"><div><span className="eyebrow">SECTION</span><h2>{section?.title ?? 'Pages'}</h2></div><button className="icon-button" title="New page" disabled={!section} onClick={() => section && createNode('page', section.id)}><FilePlus2 size={18} /></button></div><div className="page-search"><Search size={14} /><span>Pages in this section</span></div><div className="page-list">{pages.map((item) => <div key={item.id} className={`page-item ${pageId === item.id ? 'active' : ''}`} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const moving = event.dataTransfer.getData('text/plain'); if (moving) moveNode(moving, sectionId, item.id); }} onClick={() => setPageId(item.id)} onDoubleClick={() => renameNode(item)}><FileText size={16} /><div><strong>{item.title}</strong><small>{new Date(item.updated_at).toLocaleDateString()}</small></div><button className="page-delete" title="Delete page" onClick={(event) => { event.stopPropagation(); deleteNode(item); }}><X size={13} /></button></div>)}{section && !pages.length && <div className="empty-pages">No pages yet.<button onClick={() => createNode('page', section.id)}>Create a page</button></div>}</div><button className="new-page" disabled={!section} onClick={() => section && createNode('page', section.id)}><Plus size={15} /> New page</button></aside>

      <main className="editor-area">
        {page ? <><div className="page-topline"><div><span className="eyebrow">PAGE</span><h1 onDoubleClick={() => renameNode(page)} title="Double click to rename">{page.title}</h1><p>Created {new Date(page.created_at).toLocaleString()} · Updated {new Date(page.updated_at).toLocaleString()}</p></div><div className="page-actions"><button onClick={insertFiles}><Upload size={15} /> Insert file</button><button onClick={() => window.whiteboard.exportPagePdf().catch(notifyError)}><Download size={15} /> PDF</button></div></div><Canvas key={page.id} ref={canvasRef} page={page} row={snapshot.pages.find((row) => row.id === page.id)!} initialObjects={snapshot.objects.filter((object) => object.page_id === page.id)} assets={snapshot.assets} nodes={nodes} extensions={extensions} onObjectsChange={updatePage} onNavigatePage={navigatePage} onError={notifyError} onAssetImported={refresh} onRunExtension={runExtension} onRequestLink={() => ask('Add web link', 'https://', 'Add link')} /></> : <div className="no-page"><Layers3 size={42} /><h2>Choose a page to begin</h2><p>Your canvas will appear here.</p>{section && <button onClick={() => createNode('page', section.id)}>Create page</button>}</div>}
      </main>
    </div>

    {showExtensions && <div className="modal-backdrop" onClick={() => setShowExtensions(false)}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">LOCAL EXTENSIONS</span><h2>Extensions</h2></div><button className="icon-button" onClick={() => setShowExtensions(false)}><X size={18} /></button></div><p>Extensions load from <code>{snapshot.directory}\extensions</code>. Commands run in isolated browser workers.</p>{extensions.map((item) => <div className="extension-row" key={item.manifest.id}><span className="extension-symbol"><Puzzle size={19} /></span><div><strong>{item.manifest.name}</strong><small>{item.manifest.id} · v{item.manifest.version}</small></div><label className="mini-toggle"><input type="checkbox" checked={item.enabled} onChange={async (event) => { await window.whiteboard.enableExtension(item.manifest.id, event.target.checked); await refreshExtensions(); }} /><span /></label></div>)}<div className="extension-tip"><CalendarDays size={16} /><span>The bundled example adds an <strong>Insert date</strong> toolbar command.</span></div></div></div>}
    {dialogRequest && <div className="modal-backdrop" onClick={() => finishDialog(null)}><form className="modal input-dialog" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); finishDialog(dialogRequest.mode === 'confirm' ? 'yes' : dialogValue.trim()); }} onKeyDown={(event) => { if (event.key === 'Escape') finishDialog(null); }}><div className="modal-head"><h2>{dialogRequest.title}</h2><button className="icon-button" type="button" onClick={() => finishDialog(null)}><X size={18} /></button></div>{dialogRequest.message && <p>{dialogRequest.message}</p>}{dialogRequest.mode === 'text' && <input autoFocus aria-label={dialogRequest.title} value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} maxLength={200} required />}<div className="dialog-actions"><button type="button" onClick={() => finishDialog(null)}>Cancel</button><button type="submit" className={dialogRequest.action === 'Delete' ? 'danger' : 'primary'}>{dialogRequest.action}</button></div></form></div>}
    {toast && <div className="toast" role="status">{toast}<button onClick={() => setToast('')}><X size={13} /></button></div>}
  </div>;
}

interface TreeProps { node: TreeNode; nodes: TreeNode[]; depth: number; expanded: Set<string>; selectedSectionId: string | null; onToggle(id: string): void; onSelect(node: TreeNode): void; onCreate(kind: NodeKind, parentId: string | null): void; onRename(node: TreeNode): void; onDelete(node: TreeNode): void; onMove(nodeId: string, parentId: string | null, beforeId?: string | null): void }
function TreeItem(props: TreeProps) {
  const { node, nodes, depth, expanded, selectedSectionId, onToggle, onSelect, onCreate, onRename, onDelete, onMove } = props;
  const children = childrenOf(nodes, node.id).filter((item) => item.kind !== 'page');
  const expandable = node.kind === 'notebook' || node.kind === 'folder';
  const [menu, setMenu] = useState(false);
  const [drop, setDrop] = useState(false);
  return <><div className={`tree-item ${selectedSectionId === node.id ? 'active' : ''} ${drop ? 'drop-target' : ''}`} style={{ paddingLeft: 11 + depth * 15 }} draggable onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData('text/plain', node.id); }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDrop(true); }} onDragLeave={() => setDrop(false)} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDrop(false); const moving = event.dataTransfer.getData('text/plain'); if (moving && moving !== node.id) onMove(moving, expandable ? node.id : node.parent_id, expandable ? null : node.id); }} onClick={() => { if (expandable) onToggle(node.id); else onSelect(node); }} onDoubleClick={(event) => { event.stopPropagation(); onRename(node); }}><span className="tree-chevron">{expandable ? (expanded.has(node.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}</span><span className={`tree-symbol ${node.kind}`}>{node.kind === 'notebook' ? <BookOpen size={15} /> : node.kind === 'folder' ? <FolderPlus size={15} /> : <Layers3 size={15} />}</span><span className="tree-name">{node.title}</span><button className="tree-more" title="Item actions" onClick={(event) => { event.stopPropagation(); setMenu(!menu); }}><MoreHorizontal size={15} /></button>{menu && <div className="tree-menu" onClick={(event) => event.stopPropagation()}>{expandable && <><button onClick={() => { onCreate('folder', node.id); setMenu(false); }}>New folder</button><button onClick={() => { onCreate('section', node.id); setMenu(false); }}>New section</button></>}{node.kind === 'section' && <button onClick={() => { onCreate('page', node.id); setMenu(false); }}>New page</button>}<button onClick={() => { onRename(node); setMenu(false); }}>Rename</button><button className="danger" onClick={() => { onDelete(node); setMenu(false); }}>Delete</button></div>}</div>{expandable && expanded.has(node.id) && children.map((child) => <TreeItem key={child.id} {...props} node={child} depth={depth + 1} />)}</>;
}
