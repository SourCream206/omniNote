import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, FolderPlus, Layers3, MoreHorizontal, Plus, Upload, X, Download, FileText, Puzzle, Grid2X2, Check, Search, Settings2 } from 'lucide-react';
import type { Asset, CanvasObject, Camera, ExtensionInfo, MarketplaceEntry, MarketplaceSearch, NodeKind, PaperStyle, Snapshot, TreeNode, UpdateStatus } from './types';
import Canvas, { type CanvasHandle } from './Canvas';
import MarketplacePanel from './MarketplacePanel';
import { readTheme, themes, type ThemeId } from './theme';

const childrenOf = (nodes: TreeNode[], parentId: string | null) => nodes.filter((node) => node.parent_id === parentId).sort((a, b) => a.order_index - b.order_index);
const firstPageIn = (nodes: TreeNode[], sectionId: string) => childrenOf(nodes, sectionId).find((node) => node.kind === 'page')?.id ?? null;
const paperChoices: { style: PaperStyle; label: string }[] = [{ style: 'blank', label: 'Blank' }, { style: 'dots', label: 'Dots' }, { style: 'grid', label: 'Grid' }, { style: 'lines', label: 'Lines' }];

export default function App() {
  const [dialogRequest, setDialogRequest] = useState<{ title: string; message?: string; mode: 'text' | 'confirm'; action: string } | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const dialogResolver = useRef<((value: string | null) => void) | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openTreeMenuId, setOpenTreeMenuId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<'explorer' | 'extensions' | 'settings' | null>('explorer');
  const [theme, setTheme] = useState<ThemeId>(readTheme);
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [focusMode, setFocusMode] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.min(380, Math.max(190, Number(localStorage.getItem('omninote.sidebarWidth')) || 230)));
  const [toast, setToast] = useState('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'unavailable', message: 'Updates are available in installed releases.' });
  const canvasRef = useRef<CanvasHandle>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const insertRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const data = await window.whiteboard.load();
    setSnapshot(data);
    return data;
  }, []);
  const refreshExtensions = useCallback(async () => setExtensions(await window.whiteboard.listExtensions()), []);
  const searchMarketplace = useCallback((query: string): Promise<MarketplaceSearch> => window.whiteboard.searchMarketplace(query), []);
  const installMarketplace = useCallback(async (entry: MarketplaceEntry) => {
    await window.whiteboard.installMarketplaceExtension(entry.id, entry.version);
    await refreshExtensions();
  }, [refreshExtensions]);

  useEffect(() => {
    Promise.all([refresh(), refreshExtensions()]).then(([data]) => {
      const first = data.nodes.find((node) => node.kind === 'page');
      if (first) { setPageId(first.id); setSectionId(first.parent_id); }
      setExpanded(new Set(data.nodes.filter((node) => node.kind !== 'page').map((node) => node.id)));
    }).catch((error) => setToast(String(error)));
  }, [refresh, refreshExtensions]);

  useEffect(() => {
    const unsubscribe = window.whiteboard.onUpdateStatus(setUpdateStatus);
    window.whiteboard.getUpdateStatus().then(setUpdateStatus).catch(notifyError);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => { localStorage.setItem('omninote.sidebarWidth', String(sidebarWidth)); }, [sidebarWidth]);
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('omninote.theme', theme); }, [theme]);

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      if (!exportRef.current?.contains(event.target as Node)) setExportOpen(false);
      if (!paperRef.current?.contains(event.target as Node)) setPaperOpen(false);
      if (!insertRef.current?.contains(event.target as Node)) setInsertOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExportOpen(false); setPaperOpen(false); setInsertOpen(false); }
    };
    document.addEventListener('pointerdown', closeMenus, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeMenus, true); document.removeEventListener('keydown', closeOnEscape); };
  }, []);

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.tree-menu, .tree-more')) setOpenTreeMenuId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenTreeMenuId(null); };
    document.addEventListener('pointerdown', closeMenu, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeMenu, true); document.removeEventListener('keydown', closeOnEscape); };
  }, []);

  useEffect(() => { if (activePanel !== 'explorer') setOpenTreeMenuId(null); }, [activePanel]);

  async function toggleFocus() {
    try {
      const next = !focusMode;
      await window.whiteboard.setFullScreen(next);
      setFocusMode(next);
      setPaperOpen(false);
      setExportOpen(false);
    } catch (error) { notifyError(error); }
  }

  useEffect(() => {
    if (!focusMode) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target as HTMLElement).closest('.ProseMirror, input, textarea, select')) {
        window.whiteboard.setFullScreen(false).then(() => setFocusMode(false)).catch(notifyError);
      }
    };
    document.addEventListener('keydown', exitOnEscape);
    return () => document.removeEventListener('keydown', exitOnEscape);
  }, [focusMode]);

  function resizeSidebar(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onMove = (move: PointerEvent) => setSidebarWidth(Math.min(380, Math.max(190, startWidth + move.clientX - startX)));
    const onEnd = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onEnd); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd, { once: true });
  }


  const nodes = snapshot?.nodes ?? [];
  const page = nodes.find((node) => node.id === pageId && node.kind === 'page') ?? null;
  const section = nodes.find((node) => node.id === sectionId && node.kind === 'section') ?? null;
  const notebook = useMemo(() => {
    let current = section;
    while (current?.parent_id) current = nodes.find((node) => node.id === current?.parent_id) ?? null;
    return current?.kind === 'notebook' ? current : nodes.find((node) => node.kind === 'notebook');
  }, [nodes, section]);

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

  async function changePaper(style: PaperStyle) {
    if (!pageId) return;
    setPaperOpen(false);
    try {
      await window.whiteboard.setPageStyle(pageId, style);
      setSnapshot((previous) => previous ? { ...previous, pages: previous.pages.map((row) => row.id === pageId ? { ...row, paper_style: style } : row) } : previous);
    } catch (error) { notifyError(error); }
  }

  async function insertFiles(presentation: 'block' | 'printout' = 'block') {
    setInsertOpen(false);
    try {
      const assets = await window.whiteboard.pickAssets();
      for (const asset of assets) { await canvasRef.current?.insertAsset(asset, presentation); await importedAsset(asset); }
    } catch (error) { notifyError(error); }
  }

  async function importedAsset(asset: Asset) {
    await refresh();
    const extension = asset.original_name.split('.').pop()?.toLowerCase() ?? '';
    for (const item of extensions.filter((entry) => entry.enabled && entry.grantedPermissions.includes('asset.read'))) {
      for (const importer of item.manifest.contributes.importers ?? []) {
        if (importer.extensions.includes(extension)) await runExtension(importer.command, { asset: { id: asset.id, name: asset.original_name, mimeType: asset.mime_type }, bytes: await window.whiteboard.readAsset(asset.id) });
      }
    }
  }

  async function runExtension(commandId: string, context?: unknown): Promise<boolean> {
    const extension = extensions.find((item) => item.enabled && item.manifest.contributes.commands?.some((command) => command.id === commandId));
    if (!extension) return false;
    try {
      const source = await window.whiteboard.extensionSource(extension.manifest.id);
      const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(blobUrl);
      const requestId = crypto.randomUUID();
      return await new Promise<boolean>((resolve) => {
        const finish = (success: boolean) => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(blobUrl); resolve(success); };
        const timer = setTimeout(() => { notifyError('Extension timed out'); finish(false); }, 5000);
        worker.onmessage = async (event: MessageEvent) => {
          const message = event.data;
          if (message?.requestId !== requestId) return;
          try {
            if (message.type === 'canvas.insertText' && extension.grantedPermissions.includes('canvas.write') && typeof message.text === 'string') canvasRef.current?.insertText(message.text.slice(0, 10000));
            else if (message.type === 'canvas.insertObject' && extension.grantedPermissions.includes('canvas.write') && extension.manifest.contributes.canvasObjectTypes?.some((entry) => entry.type === message.objectType)) canvasRef.current?.insertExtensionObject(extension.manifest.id, message.objectType, message.data);
            else if (message.type === 'export.writeFile' && extension.grantedPermissions.includes('export.write') && typeof message.name === 'string') await window.whiteboard.saveExtensionExport(message.name, new Uint8Array(message.bytes));
            else throw new Error('Extension requested an undeclared capability');
            setToast(`${extension.manifest.name} ran`);
            finish(true);
          } catch (error) { notifyError(error); finish(false); }
        };
        worker.onerror = (error) => { notifyError(error.message); finish(false); };
        worker.postMessage({ type: 'invoke', command: commandId, requestId, apiVersion: '1.0.0', settings: extension.settings, context });
      });
    } catch (error) { notifyError(error); return false; }
  }

  async function toggleExtension(item: ExtensionInfo, enabled: boolean) {
    try {
      if (enabled && item.manifest.permissions.length) {
        const approved = await ask(`Enable ${item.manifest.name}`, '', 'Enable', 'confirm', `Grant: ${item.manifest.permissions.join(', ')}?`);
        if (!approved) return;
      }
      await window.whiteboard.enableExtension(item.manifest.id, enabled, enabled ? item.manifest.permissions : []);
      await refreshExtensions();
    } catch (error) { notifyError(error); }
  }

  async function promptUpdate() {
    try { setUpdateStatus(await window.whiteboard.promptToInstallUpdate()); }
    catch (error) { notifyError(error); }
  }

  async function checkUpdates() {
    try { setUpdateStatus(await window.whiteboard.checkForUpdates()); }
    catch (error) { notifyError(error); }
  }

  if (!snapshot) return <div className="loading-screen"><BookOpen size={38} /><strong>Opening your workspace…</strong></div>;
  const paperStyle = snapshot.pages.find((row) => row.id === pageId)?.paper_style ?? 'blank';

  return <div className={`app-shell ${focusMode ? 'focus-mode' : ''}`}>
    <header className="app-header">
      <div className="brand"><strong>omniNote</strong></div>
      <div className="header-divider" />
      <div className="breadcrumbs"><span>{notebook?.title ?? 'Workspace'}</span><ChevronRight size={13} /><span>{section?.title ?? 'Select a section'}</span></div>
      <div className="header-actions"><div className="export-control" ref={exportRef}><button className="header-button" aria-expanded={exportOpen} onClick={() => setExportOpen((open) => !open)}><Download size={15} /> Export <ChevronDown size={13} /></button>{exportOpen && <div className="export-menu"><button disabled={!page} onClick={() => { setExportOpen(false); window.whiteboard.exportPagePdf().catch(notifyError); }}>Page as PDF</button><button onClick={() => { setExportOpen(false); Promise.resolve(canvasRef.current?.flushPendingSave()).then(() => window.whiteboard.exportWorkspace()).catch(notifyError); }}>Workspace backup ZIP</button>{extensions.filter((item) => item.enabled).flatMap((item) => item.manifest.contributes.exporters ?? []).map((entry) => <button key={entry.command} onClick={() => { setExportOpen(false); runExtension(entry.command); }}>{entry.id}</button>)}</div>}</div></div>
    </header>

    <div className="app-body">
      <nav className="activity-rail" aria-label="Primary navigation"><button className={activePanel === 'explorer' ? 'active' : ''} title="Toggle notebooks and pages" aria-label="Toggle notebooks and pages" aria-expanded={activePanel === 'explorer'} onClick={() => setActivePanel((panel) => panel === 'explorer' ? null : 'explorer')}><BookOpen size={20} /></button><button className={activePanel === 'extensions' ? 'active' : ''} title="Extensions" aria-label="Extensions" aria-expanded={activePanel === 'extensions'} onClick={() => setActivePanel((panel) => panel === 'extensions' ? null : 'extensions')}><Puzzle size={20} /></button>{['available', 'downloaded'].includes(updateStatus.state) && <button className="update-trigger" title={`Install omniNote ${updateStatus.version ?? 'update'}`} aria-label={`Install update ${updateStatus.version ?? ''}`} onClick={promptUpdate}><Download size={19} /><span className="update-dot" /></button>}<button className={`settings-trigger ${activePanel === 'settings' ? 'active' : ''}`} title="Settings" aria-label="Settings" aria-expanded={activePanel === 'settings'} onClick={() => setActivePanel((panel) => panel === 'settings' ? null : 'settings')}><Settings2 size={20} /></button></nav>
      {activePanel && <aside className="notebook-sidebar" aria-label={activePanel === 'explorer' ? 'Explorer' : activePanel === 'extensions' ? 'Extensions' : 'Settings'} style={{ width: sidebarWidth, flexBasis: sidebarWidth }}>
        {activePanel === 'explorer' ? <>
        <div className="sidebar-title"><span>EXPLORER</span><button className="icon-button small" title="New notebook" aria-label="New notebook" onClick={() => createNode('notebook', null)}><Plus size={16} /></button></div>
        <div className="tree-scroll" role="tree" aria-label="Notebooks">
          {childrenOf(nodes, null).filter((node) => node.kind === 'notebook').map((node) => <TreeItem key={node.id} node={node} nodes={nodes} depth={0} expanded={expanded} openMenuId={openTreeMenuId} onOpenMenu={setOpenTreeMenuId} onToggle={(id) => setExpanded((before) => { const next = new Set(before); next.has(id) ? next.delete(id) : next.add(id); return next; })} selectedSectionId={sectionId} selectedPageId={pageId} onSelect={(selected) => { if (selected.kind === 'section') { setSectionId(selected.id); setPageId(firstPageIn(nodes, selected.id)); setExpanded((before) => new Set([...before, selected.id])); } else if (selected.kind === 'page') { setPageId(selected.id); setSectionId(selected.parent_id); } }} onCreate={createNode} onRename={renameNode} onDelete={deleteNode} onMove={moveNode} />)}
          {!nodes.length && <div className="empty-sidebar">Create your first notebook to begin.</div>}
        </div>
        <button className="new-page" disabled={!section} onClick={() => section && createNode('page', section.id)}><Plus size={15} /> New page</button>
        {!!extensions.filter((item) => item.enabled).flatMap((item) => item.manifest.contributes.sidebar ?? []).length && <div className="sidebar-footer">{extensions.filter((item) => item.enabled).flatMap((item) => item.manifest.contributes.sidebar ?? []).map((entry) => <button key={entry.command} onClick={() => runExtension(entry.command)}><Puzzle size={16} /> {entry.label}</button>)}</div>}
        </> : activePanel === 'extensions' ? <ExtensionsPanel directory={snapshot.directory} extensions={extensions} onToggle={toggleExtension} onSearch={searchMarketplace} onInstall={installMarketplace} onSetting={async (id, key, value) => { try { await window.whiteboard.setExtensionSetting(id, key, value); await refreshExtensions(); } catch (error) { notifyError(error); } }} /> : <SettingsPanel theme={theme} onThemeChange={setTheme} updateStatus={updateStatus} onCheckUpdates={checkUpdates} />}
        <div className="sidebar-width-resizer" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={190} aria-valuemax={380} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={resizeSidebar} onKeyDown={(event) => { if (event.key === 'ArrowLeft') setSidebarWidth((size) => Math.max(190, size - 10)); if (event.key === 'ArrowRight') setSidebarWidth((size) => Math.min(380, size + 10)); }} />
      </aside>}
      <main className="editor-area">
        {page ? <><div className="page-topline"><div><h1 onDoubleClick={() => renameNode(page)} title="Double click to rename">{page.title}</h1><p>{new Date(page.updated_at).toLocaleDateString()}</p></div><div className="page-actions"><div className="paper-control" ref={paperRef}><button className="paper-button" aria-expanded={paperOpen} onClick={() => setPaperOpen((open) => !open)}><Grid2X2 size={15} /> Paper <ChevronDown size={13} /></button>{paperOpen && <div className="paper-menu">{paperChoices.map((choice) => <button key={choice.style} className={paperStyle === choice.style ? 'selected' : ''} onClick={() => changePaper(choice.style)}>{choice.label}{paperStyle === choice.style && <Check size={14} />}</button>)}</div>}</div><div className="insert-control" ref={insertRef}><button aria-expanded={insertOpen} onClick={() => setInsertOpen((open) => !open)}><Upload size={15} /> Insert file <ChevronDown size={12} /></button>{insertOpen && <div className="insert-menu"><button onClick={() => insertFiles('block')}>As embedded block</button><button onClick={() => insertFiles('printout')}>As page printout <small>PDF or DOCX</small></button></div>}</div></div></div><Canvas key={page.id} ref={canvasRef} page={page} row={snapshot.pages.find((row) => row.id === page.id)!} initialObjects={snapshot.objects.filter((object) => object.page_id === page.id)} assets={snapshot.assets} nodes={nodes} extensions={extensions} focusMode={focusMode} onToggleFocus={toggleFocus} onObjectsChange={updatePage} onNavigatePage={navigatePage} onError={notifyError} onAssetImported={importedAsset} onRunExtension={runExtension} onRequestLink={() => ask('Add web link', 'https://', 'Add link')} /></> : <div className="no-page"><Layers3 size={42} /><h2>Choose a page to begin</h2><p>Your canvas will appear here.</p></div>}
      </main>
    </div>

    {dialogRequest && <div className="modal-backdrop" onClick={() => finishDialog(null)}><form className="modal input-dialog" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); finishDialog(dialogRequest.mode === 'confirm' ? 'yes' : dialogValue.trim()); }} onKeyDown={(event) => { if (event.key === 'Escape') finishDialog(null); }}><div className="modal-head"><h2>{dialogRequest.title}</h2><button className="icon-button" type="button" onClick={() => finishDialog(null)}><X size={18} /></button></div>{dialogRequest.message && <p>{dialogRequest.message}</p>}{dialogRequest.mode === 'text' && <input autoFocus aria-label={dialogRequest.title} value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} maxLength={200} required />}<div className="dialog-actions"><button type="button" onClick={() => finishDialog(null)}>Cancel</button><button type="submit" className={dialogRequest.action === 'Delete' ? 'danger' : 'primary'}>{dialogRequest.action}</button></div></form></div>}
    {toast && <div className="toast" role="status">{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={13} /></button></div>}
  </div>;
}

function ExtensionsPanel({ directory, extensions, onToggle, onSetting, onSearch, onInstall }: { directory: string; extensions: ExtensionInfo[]; onToggle(item: ExtensionInfo, enabled: boolean): void; onSetting(id: string, key: string, value: boolean | string): void; onSearch(query: string): Promise<MarketplaceSearch>; onInstall(entry: MarketplaceEntry): Promise<void> }) {
  const [query, setQuery] = useState('');
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const visible = extensions.filter((item) => `${item.manifest.name} ${item.manifest.id} ${item.manifest.version}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="extensions-panel">
    <div className="sidebar-title"><span>EXTENSIONS</span><span className="extension-count">{extensions.length}</span></div>
    <label className="extension-search"><Search size={15} /><input aria-label="Search extensions" placeholder="Search extensions" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button title="Clear search" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label>
    <div className="extensions-list">
      <div className="marketplace-section-label">Installed</div>
      {visible.map((item) => <div className="extension-entry" key={item.manifest.id}>
        <div className="extension-entry-main"><Puzzle size={18} /><div><strong>{item.manifest.name}</strong><small>v{item.manifest.version} · {item.enabled ? 'Enabled' : 'Disabled'}</small></div><label className="mini-toggle" title={`${item.enabled ? 'Disable' : 'Enable'} ${item.manifest.name}`}><input type="checkbox" checked={item.enabled} onChange={(event) => onToggle(item, event.target.checked)} /></label></div>
        <div className="extension-entry-detail"><span title={item.manifest.id}>{item.manifest.id}</span>{!!item.manifest.contributes.settings?.length && item.enabled && <button onClick={() => setSettingsId(settingsId === item.manifest.id ? null : item.manifest.id)} aria-expanded={settingsId === item.manifest.id}>Settings <ChevronDown size={12} /></button>}</div>
        {settingsId === item.manifest.id && item.enabled && <div className="extension-settings">{item.manifest.contributes.settings?.map((setting) => <label key={setting.key}>{setting.label}{setting.type === 'boolean' ? <input type="checkbox" checked={Boolean(item.settings[setting.key])} onChange={(event) => onSetting(item.manifest.id, setting.key, event.target.checked)} /> : <input type="text" key={`${item.manifest.id}:${setting.key}`} defaultValue={String(item.settings[setting.key] ?? '')} onBlur={(event) => onSetting(item.manifest.id, setting.key, event.target.value)} />}</label>)}</div>}
      </div>)}
      {!visible.length && <p className="extensions-empty">{query ? 'No installed extensions match your search.' : 'No local extensions found.'}</p>}
      <MarketplacePanel query={query} installedIds={new Set(extensions.map((item) => item.manifest.id))} search={onSearch} install={onInstall} />
    </div>
    <p className="extensions-location" title={`${directory}\\extensions`}>Local extensions in <code>workspace/extensions</code></p>
  </div>;
}

function SettingsPanel({ theme, onThemeChange, updateStatus, onCheckUpdates }: { theme: ThemeId; onThemeChange(value: ThemeId): void; updateStatus: UpdateStatus; onCheckUpdates(): void }) {
  return <div className="settings-panel">
    <div className="sidebar-title"><span>SETTINGS</span></div>
    <div className="settings-scroll">
      <div className="settings-section-heading">Appearance</div>
      <div className="settings-label">Color Theme</div>
      <div className="theme-options" role="radiogroup" aria-label="Color Theme">
        {themes.map((choice, index) => <button key={choice.id} type="button" role="radio" aria-checked={theme === choice.id} tabIndex={theme === choice.id ? 0 : -1} className={`theme-option ${theme === choice.id ? 'selected' : ''}`} onClick={() => onThemeChange(choice.id)} onKeyDown={(event) => {
          const direction = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 0;
          if (!direction) return;
          event.preventDefault();
          const next = (index + direction + themes.length) % themes.length;
          onThemeChange(themes[next].id);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.theme-option')[next]?.focus();
        }}>
          <span className={`theme-preview theme-preview-${choice.id}`} aria-hidden="true"><i /><i /><i /></span>
          <span className="theme-copy"><strong>{choice.name}</strong><small>{choice.description}</small></span>
          {theme === choice.id && <Check size={15} aria-hidden="true" />}
        </button>)}
      </div>
      <p className="settings-hint">Themes change the workspace. Page paper stays light so existing ink and documents remain easy to read.</p>
      <div className="settings-section-heading settings-update-heading">Updates</div>
      <p className="settings-update-status" role="status">{updateStatus.message}</p>
      <button className="settings-check-update" disabled={['unavailable', 'checking', 'downloading'].includes(updateStatus.state)} onClick={onCheckUpdates}>Check for updates</button>
    </div>
  </div>;
}

interface TreeProps { node: TreeNode; nodes: TreeNode[]; depth: number; expanded: Set<string>; openMenuId: string | null; onOpenMenu(id: string | null): void; selectedSectionId: string | null; selectedPageId: string | null; onToggle(id: string): void; onSelect(node: TreeNode): void; onCreate(kind: NodeKind, parentId: string | null): void; onRename(node: TreeNode): void; onDelete(node: TreeNode): void; onMove(nodeId: string, parentId: string | null, beforeId?: string | null): void }
function TreeItem(props: TreeProps) {
  const { node, nodes, depth, expanded, openMenuId, onOpenMenu, selectedSectionId, selectedPageId, onToggle, onSelect, onCreate, onRename, onDelete, onMove } = props;
  const children = childrenOf(nodes, node.id);
  const expandable = node.kind !== 'page';
  const menu = openMenuId === node.id;
  const [drop, setDrop] = useState(false);
  const activate = () => node.kind === 'notebook' || node.kind === 'folder' ? onToggle(node.id) : onSelect(node);
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault(); event.stopPropagation(); setDrop(false);
    const movingId = event.dataTransfer.getData('text/plain');
    const moving = nodes.find((item) => item.id === movingId);
    if (!moving || movingId === node.id) return;
    if ((node.kind === 'section' && moving.kind !== 'page') || (node.kind === 'notebook' && moving.kind === 'notebook')) onMove(movingId, node.parent_id, node.id);
    else onMove(movingId, expandable ? node.id : node.parent_id, expandable ? null : node.id);
  };
  return <>
    <div className={`tree-item ${selectedPageId === node.id ? 'active' : ''} ${selectedSectionId === node.id ? 'parent-active' : ''} ${drop ? 'drop-target' : ''}`} style={{ paddingLeft: 8 + depth * 17 }} role="treeitem" tabIndex={0} aria-level={depth + 1} aria-selected={selectedPageId === node.id} aria-expanded={expandable ? expanded.has(node.id) : undefined} draggable onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData('text/plain', node.id); }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDrop(true); }} onDragLeave={() => setDrop(false)} onDrop={onDrop} onClick={activate} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!(event.target as HTMLElement).closest('.tree-menu')) onOpenMenu(node.id); }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); activate(); } }} onDoubleClick={(event) => { event.stopPropagation(); onRename(node); }}>
      {expandable ? <button className="tree-chevron" aria-label={`${expanded.has(node.id) ? 'Collapse' : 'Expand'} ${node.title}`} onClick={(event) => { event.stopPropagation(); onToggle(node.id); }}>{expanded.has(node.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="tree-chevron" />}
      <span className={`tree-symbol ${node.kind}`}>{node.kind === 'notebook' ? <BookOpen size={15} /> : node.kind === 'folder' ? <FolderPlus size={15} /> : node.kind === 'section' ? <Layers3 size={15} /> : <FileText size={15} />}</span>
      <span className="tree-name" title={node.title}>{node.title}</span>
      <button className="tree-more" title={`${node.kind} actions`} aria-label={`${node.kind} actions for ${node.title}`} aria-haspopup="menu" aria-expanded={menu} onClick={(event) => { event.stopPropagation(); onOpenMenu(menu ? null : node.id); }}><MoreHorizontal size={15} /></button>
      {menu && <div className="tree-menu" role="menu" onClick={(event) => event.stopPropagation()}>{(node.kind === 'notebook' || node.kind === 'folder') && <><button role="menuitem" onClick={() => { onCreate('folder', node.id); onOpenMenu(null); }}>New folder</button><button role="menuitem" onClick={() => { onCreate('section', node.id); onOpenMenu(null); }}>New section</button></>}<button role="menuitem" onClick={() => { onRename(node); onOpenMenu(null); }}>Rename</button><button role="menuitem" className="danger" onClick={() => { onDelete(node); onOpenMenu(null); }}>Delete</button></div>}
    </div>
    {expandable && expanded.has(node.id) && <div role="group">{children.map((child) => <TreeItem key={child.id} {...props} node={child} depth={depth + 1} />)}</div>}
  </>;
}
