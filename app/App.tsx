import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, FolderPlus, Layers3, MoreHorizontal, Plus, Upload, X, Download, FileText, File as FileIcon, Puzzle, Grid2X2, Check, Search, Settings2, Minus, Maximize2, Copy, PanelRight } from 'lucide-react';
import type { Asset, CanvasObject, Camera, ExtensionInfo, MarketplaceEntry, MarketplaceSearch, NodeKind, PaperStyle, Snapshot, TreeNode, UpdateStatus } from './types';
import Canvas, { type CanvasHandle } from './Canvas';
import MarketplacePanel from './MarketplacePanel';
import DocumentPage from './DocumentPage';
import { readTheme, themes, type ThemeId } from './theme';

const childrenOf = (nodes: TreeNode[], parentId: string | null) => nodes.filter((node) => node.parent_id === parentId).sort((a, b) => a.order_index - b.order_index);
type TreeDrop = { id: string; placement: 'before' | 'after' | 'inside'; parentId: string | null; beforeId: string | null };
type TabDrop = { pane: 0 | 1; targetId: string | null; edge: 'before' | 'after'; split: boolean };
const allowedTreeParent: Record<NodeKind, (NodeKind | null)[]> = { notebook: [null], folder: ['notebook', 'folder'], section: ['notebook', 'folder'], page: ['section'] };
function treeDropFor(nodes: TreeNode[], sourceId: string, targetId: string, pointerY: number, row: HTMLElement): TreeDrop | null {
  const source = nodes.find((item) => item.id === sourceId);
  const target = nodes.find((item) => item.id === targetId);
  if (!source || !target || source.id === target.id) return null;
  const ratio = (pointerY - row.getBoundingClientRect().top) / row.getBoundingClientRect().height;
  const placement = allowedTreeParent[source.kind].includes(target.kind) && ratio >= 0.25 && ratio <= 0.75 ? 'inside' : ratio < 0.5 ? 'before' : 'after';
  const parentId = placement === 'inside' ? target.id : target.parent_id;
  const parent = nodes.find((item) => item.id === parentId);
  if (!allowedTreeParent[source.kind].includes(parent?.kind ?? null)) return null;
  let cursor = parentId;
  while (cursor) { if (cursor === sourceId) return null; cursor = nodes.find((item) => item.id === cursor)?.parent_id ?? null; }
  const siblings = childrenOf(nodes, parentId);
  const afterId = siblings[siblings.findIndex((item) => item.id === target.id) + 1]?.id ?? null;
  return { id: target.id, placement, parentId, beforeId: placement === 'inside' ? null : placement === 'before' ? target.id : afterId };
}
const firstPageIn = (nodes: TreeNode[], sectionId: string) => childrenOf(nodes, sectionId).find((node) => node.kind === 'page')?.id ?? null;
const paperChoices: { style: PaperStyle; label: string }[] = [{ style: 'blank', label: 'Blank' }, { style: 'dots', label: 'Dots' }, { style: 'grid', label: 'Grid' }, { style: 'lines', label: 'Lines' }];

export default function App() {
  const [dialogRequest, setDialogRequest] = useState<{ title: string; message?: string; mode: 'text' | 'confirm'; action: string } | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const dialogResolver = useRef<((value: string | null) => void) | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [rightTabs, setRightTabs] = useState<string[]>([]);
  const [splitPageId, setSplitPageId] = useState<string | null>(null);
  const [activePane, setActivePane] = useState<0 | 1>(0);
  const [maximized, setMaximized] = useState(true);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [tabDrop, setTabDrop] = useState<TabDrop | null>(null);
  const [tabGhost, setTabGhost] = useState<{ id: string; x: number; y: number } | null>(null);
  const [treeDrag, setTreeDrag] = useState<{ id: string; target: TreeDrop | null; x: number; y: number } | null>(null);
  const [annotationPages, setAnnotationPages] = useState<Set<string>>(new Set());
  const [pendingAnnotation, setPendingAnnotation] = useState<string | null>(null);
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
  const splitCanvasRef = useRef<CanvasHandle>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const insertRef = useRef<HTMLDivElement>(null);
  const tabPointer = useRef<{ id: string; pane: 0 | 1; x: number; y: number } | null>(null);
  const suppressTabClick = useRef(false);
  const treePointer = useRef<{ id: string; x: number; y: number } | null>(null);
  const suppressTreeClick = useRef(false);
  const annotationInFlight = useRef(false);

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
      if (first) { setPageId(first.id); setOpenTabs([first.id]); setSectionId(first.parent_id); }
      setExpanded(new Set(data.nodes.filter((node) => node.kind !== 'page').map((node) => node.id)));
    }).catch((error) => setToast(String(error)));
  }, [refresh, refreshExtensions]);

  useEffect(() => {
    const unsubscribe = window.whiteboard.onUpdateStatus(setUpdateStatus);
    window.whiteboard.getUpdateStatus().then(setUpdateStatus).catch(notifyError);
    return unsubscribe;
  }, []);
  useEffect(() => window.whiteboard.onWindowMaximized(setMaximized), []);

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

  useEffect(() => {
    if (!pendingAnnotation || !snapshot || annotationInFlight.current) return;
    const assetId = snapshot.documentPages.find((item) => item.page_id === pendingAnnotation)?.asset_id;
    const asset = snapshot.assets.find((item) => item.id === assetId);
    const editor = pageId === pendingAnnotation ? canvasRef.current : splitPageId === pendingAnnotation ? splitCanvasRef.current : null;
    if (!asset || !editor) return;
    annotationInFlight.current = true;
    editor.insertAsset(asset, 'printout', { x: 16, y: 16 }).then(() => setPendingAnnotation(null)).catch(notifyError).finally(() => { annotationInFlight.current = false; });
  }, [pendingAnnotation, snapshot, pageId, splitPageId]);

  useEffect(() => {
    const destinationFor = (event: PointerEvent): TabDrop | null => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const editor = target?.closest<HTMLElement>('.editor-area');
      if (!editor) return null;
      const tabStrip = target?.closest<HTMLElement>('.page-tabs');
      const tabPane = tabStrip?.dataset.pane;
      if (tabPane === '0' || tabPane === '1') {
        const tab = target?.closest<HTMLElement>('.page-tab');
        const edge = tab && event.clientX < tab.getBoundingClientRect().left + tab.clientWidth / 2 ? 'before' : 'after';
        return { pane: Number(tabPane) as 0 | 1, targetId: tab?.dataset.pageId ?? null, edge, split: false };
      }
      if (!rightTabs.length && event.clientX > editor.getBoundingClientRect().left + editor.clientWidth * 0.55) return { pane: 1, targetId: null, edge: 'after', split: true };
      const pane = target?.closest<HTMLElement>('[data-pane]')?.dataset.pane;
      return pane === '0' || pane === '1' ? { pane: Number(pane) as 0 | 1, targetId: null, edge: 'after', split: false } : null;
    };
    const previewTabMove = (event: PointerEvent) => {
      const source = tabPointer.current;
      if (source && Math.hypot(event.clientX - source.x, event.clientY - source.y) >= 8) {
        setTabDrop(destinationFor(event));
        setTabGhost({ id: source.id, x: event.clientX, y: event.clientY });
      }
    };
    const finishTabMove = (event: PointerEvent) => {
      const source = tabPointer.current;
      tabPointer.current = null;
      setTabDrop(null);
      setTabGhost(null);
      if (!source || Math.hypot(event.clientX - source.x, event.clientY - source.y) < 8) return;
      suppressTabClick.current = true;
      window.setTimeout(() => { suppressTabClick.current = false; }, 0);
      const destination = destinationFor(event);
      if (destination === null) return;
      if (source.pane === destination.pane && destination.targetId === source.id) return;
      const sourceTabs = source.pane === 0 ? openTabs : rightTabs;
      const destTabs = destination.pane === 0 ? openTabs : rightTabs;
      const nextSource = sourceTabs.filter((id) => id !== source.id);
      const nextDest = destination.pane === source.pane ? nextSource : [...destTabs];
      const position = destination.targetId ? nextDest.indexOf(destination.targetId) : -1;
      nextDest.splice(position < 0 ? nextDest.length : position + (destination.edge === 'after' ? 1 : 0), 0, source.id);
      if (source.pane === destination.pane) destination.pane === 0 ? setOpenTabs(nextDest) : setRightTabs(nextDest);
      else { source.pane === 0 ? setOpenTabs(nextSource) : setRightTabs(nextSource); destination.pane === 0 ? setOpenTabs(nextDest) : setRightTabs(nextDest); }
      if (source.pane === 0 && destination.pane === 1) setPageId(nextSource.includes(pageId ?? '') ? pageId : nextSource[0] ?? null);
      if (source.pane === 1 && destination.pane === 0) setSplitPageId(nextSource.includes(splitPageId ?? '') ? splitPageId : nextSource[0] ?? null);
      if (destination.pane === 0) setPageId(source.id); else setSplitPageId(source.id);
      setActivePane(destination.pane);
    };
    document.addEventListener('pointermove', previewTabMove);
    document.addEventListener('pointerup', finishTabMove);
    return () => { document.removeEventListener('pointermove', previewTabMove); document.removeEventListener('pointerup', finishTabMove); };
  }, [openTabs, rightTabs, pageId, splitPageId]);

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
  const activePageId = activePane === 1 && splitPageId ? splitPageId : pageId;
  const page = nodes.find((node) => node.id === activePageId && node.kind === 'page') ?? null;
  const section = nodes.find((node) => node.id === sectionId && node.kind === 'section') ?? null;

  useEffect(() => {
    const targetFor = (event: PointerEvent): TreeDrop | null => {
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.tree-item[data-node-id]');
      return row && treePointer.current ? treeDropFor(nodes, treePointer.current.id, row.dataset.nodeId!, event.clientY, row) : null;
    };
    const onMove = (event: PointerEvent) => {
      const source = treePointer.current;
      if (source && Math.hypot(event.clientX - source.x, event.clientY - source.y) >= 6) setTreeDrag({ id: source.id, target: targetFor(event), x: event.clientX, y: event.clientY });
    };
    const onEnd = (event: PointerEvent) => {
      const source = treePointer.current;
      const target = targetFor(event);
      treePointer.current = null;
      setTreeDrag(null);
      if (!source || Math.hypot(event.clientX - source.x, event.clientY - source.y) < 6) return;
      suppressTreeClick.current = true;
      window.setTimeout(() => { suppressTreeClick.current = false; }, 0);
      if (target) {
        if (target.placement === 'inside' && target.parentId) setExpanded((before) => new Set([...before, target.parentId!]));
        void moveNode(source.id, target.parentId, target.beforeId);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    return () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onEnd); };
  }, [nodes]);

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
      if (kind === 'page') { openPage(nodeId, parentId); }
      if (kind === 'section') { setSectionId(nodeId); openPage(firstPageIn(data.nodes, nodeId), nodeId); }
      if (parentId) setExpanded((before) => new Set([...before, parentId]));
      if (kind === 'notebook') setExpanded((before) => new Set([...before, nodeId]));
      if (!data.nodes.length) { setPageId(null); setOpenTabs([]); setRightTabs([]); setSplitPageId(null); }
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
      setOpenTabs((before) => before.filter((id) => data.nodes.some((item) => item.id === id)));
      setRightTabs((before) => before.filter((id) => data.nodes.some((item) => item.id === id)));
      if (splitPageId && !data.nodes.some((item) => item.id === splitPageId)) { setSplitPageId(rightTabs.find((id) => id !== splitPageId && data.nodes.some((item) => item.id === id)) ?? null); setActivePane(0); }
      if (!data.nodes.some((item) => item.id === pageId)) {
        const first = data.nodes.find((item) => item.kind === 'page');
        setPageId(first?.id ?? null);
        if (first) setOpenTabs((before) => before.includes(first.id) ? before : [...before, first.id]);
        setSectionId(first?.parent_id ?? null);
      }
    } catch (error) { notifyError(error); }
  }

  async function moveNode(nodeId: string, parentId: string | null, beforeId?: string | null) {
    try {
      await window.whiteboard.moveNode(nodeId, parentId, beforeId);
      if (nodeId === activePageId) setSectionId(parentId);
      await refresh();
    }
    catch (error) { notifyError(error); }
  }

  async function importFilesToSection(files: File[], targetSectionId: string) {
    try {
      let lastId: string | null = null;
      for (const file of files) {
        const asset = await window.whiteboard.importAsset(file.name, file.type, new Uint8Array(await file.arrayBuffer()));
        lastId = await window.whiteboard.createDocumentPage(targetSectionId, asset.id);
      }
      await refresh();
      setExpanded((before) => new Set([...before, targetSectionId]));
      if (lastId) openPage(lastId, targetSectionId);
    } catch (error) { notifyError(error); }
  }

  function pickDocumentsForSection(targetSectionId: string) {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.onchange = () => { if (picker.files?.length) void importFilesToSection(Array.from(picker.files), targetSectionId); };
    picker.click();
  }

  function openPage(targetId: string | null, parentId: string | null) {
    if (!targetId) { setSectionId(parentId); return; }
    if (targetId && targetId === pageId) setActivePane(0);
    else if (targetId && openTabs.includes(targetId)) { setPageId(targetId); setActivePane(0); }
    else if (targetId && rightTabs.includes(targetId)) { setSplitPageId(targetId); setActivePane(1); }
    else if (activePane === 1 && rightTabs.length && targetId) { setRightTabs((before) => [...before, targetId]); setSplitPageId(targetId); }
    else { if (targetId) setOpenTabs((before) => [...before, targetId]); setPageId(targetId); }
    setSectionId(parentId);
  }

  function closeTab(targetId: string, pane: 0 | 1) {
    const remaining = (pane === 0 ? openTabs : rightTabs).filter((id) => id !== targetId);
    if (pane === 0) { setOpenTabs(remaining); if (pageId === targetId) setPageId(remaining.at(-1) ?? null); }
    else { setRightTabs(remaining); if (splitPageId === targetId) setSplitPageId(remaining.at(-1) ?? null); if (!remaining.length) setActivePane(0); }
  }

  function splitTab(targetId: string) {
    if (rightTabs.includes(targetId)) { setSplitPageId(targetId); setActivePane(1); return; }
    const remaining = openTabs.filter((id) => id !== targetId);
    setOpenTabs(remaining);
    setRightTabs((before) => [...before, targetId]);
    setSplitPageId(targetId);
    if (pageId === targetId) setPageId(remaining.at(-1) ?? null);
    setActivePane(1);
  }

  function navigatePage(targetId: string) {
    const target = nodes.find((node) => node.id === targetId && node.kind === 'page');
    if (target) openPage(target.id, target.parent_id);
    const targetSection = nodes.find((node) => node.id === targetId && node.kind === 'section');
    if (targetSection) openPage(firstPageIn(nodes, targetSection.id), targetSection.id);
  }

  function updatePage(pageIdValue: string, objects: CanvasObject[], camera: Camera) {
    setSnapshot((previous) => previous ? {
      ...previous,
      objects: [...previous.objects.filter((object) => object.page_id !== pageIdValue), ...objects],
      pages: previous.pages.map((row) => row.id === pageIdValue ? { ...row, camera_x: camera.x, camera_y: camera.y, camera_zoom: camera.zoom } : row),
    } : previous);
  }

  async function changePaper(style: PaperStyle) {
    if (!activePageId) return;
    setPaperOpen(false);
    try {
      await window.whiteboard.setPageStyle(activePageId, style);
      setSnapshot((previous) => previous ? { ...previous, pages: previous.pages.map((row) => row.id === activePageId ? { ...row, paper_style: style } : row) } : previous);
    } catch (error) { notifyError(error); }
  }

  async function insertFiles(presentation: 'block' | 'printout' = 'block') {
    setInsertOpen(false);
    try {
      const assets = await window.whiteboard.pickAssets();
      for (const asset of assets) { await (activePane === 1 ? splitCanvasRef.current : canvasRef.current)?.insertAsset(asset, presentation); await importedAsset(asset); }
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
            if (message.type === 'canvas.insertText' && extension.grantedPermissions.includes('canvas.write') && typeof message.text === 'string') (activePane === 1 ? splitCanvasRef.current : canvasRef.current)?.insertText(message.text.slice(0, 10000));
            else if (message.type === 'canvas.insertObject' && extension.grantedPermissions.includes('canvas.write') && extension.manifest.contributes.canvasObjectTypes?.some((entry) => entry.type === message.objectType)) (activePane === 1 ? splitCanvasRef.current : canvasRef.current)?.insertExtensionObject(extension.manifest.id, message.objectType, message.data);
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
  const paperStyle = snapshot.pages.find((row) => row.id === activePageId)?.paper_style ?? 'blank';
  const toolbarActions = <>
    {activePageId && snapshot.documentPages.some((item) => item.page_id === activePageId) && annotationPages.has(activePageId) && <button className="header-button" onClick={() => setAnnotationPages((before) => { const next = new Set(before); next.delete(activePageId); return next; })}>View document</button>}
    <div className="export-control" ref={exportRef}><button className="header-button" aria-expanded={exportOpen} onClick={() => setExportOpen((open) => !open)}><Download size={15} /> Export <ChevronDown size={13} /></button>{exportOpen && <div className="export-menu"><button disabled={!page} onClick={() => { setExportOpen(false); window.whiteboard.exportPagePdf().catch(notifyError); }}>Page as PDF</button><button onClick={() => { setExportOpen(false); Promise.resolve((activePane === 1 ? splitCanvasRef.current : canvasRef.current)?.flushPendingSave()).then(() => window.whiteboard.exportWorkspace()).catch(notifyError); }}>Workspace backup ZIP</button>{extensions.filter((item) => item.enabled).flatMap((item) => item.manifest.contributes.exporters ?? []).map((entry) => <button key={entry.command} onClick={() => { setExportOpen(false); runExtension(entry.command); }}>{entry.id}</button>)}</div>}</div>
    <div className="paper-control" ref={paperRef}><button className="paper-button" aria-expanded={paperOpen} onClick={() => setPaperOpen((open) => !open)}><Grid2X2 size={15} /> Paper <ChevronDown size={13} /></button>{paperOpen && <div className="paper-menu">{paperChoices.map((choice) => <button key={choice.style} className={paperStyle === choice.style ? 'selected' : ''} onClick={() => changePaper(choice.style)}>{choice.label}{paperStyle === choice.style && <Check size={14} />}</button>)}</div>}</div>
    <div className="insert-control" ref={insertRef}><button className="header-button" aria-expanded={insertOpen} onClick={() => setInsertOpen((open) => !open)}><Upload size={15} /> Insert file <ChevronDown size={12} /></button>{insertOpen && <div className="insert-menu"><button onClick={() => insertFiles('block')}>As embedded block</button><button onClick={() => insertFiles('printout')}>As page printout <small>PDF or DOCX</small></button></div>}</div>
  </>;
  const renderPane = (id: string | null, pane: 0 | 1) => {
    const panePage = nodes.find((node) => node.id === id && node.kind === 'page');
    const documentAssetId = snapshot.documentPages.find((item) => item.page_id === id)?.asset_id;
    const documentAsset = snapshot.assets.find((item) => item.id === documentAssetId);
    return <div className={`editor-pane ${activePane === pane ? 'active' : ''} ${tabGhost && tabDrop?.pane === pane && !tabDrop.targetId && !tabDrop.split ? 'drop-pane' : ''}`} data-pane={pane} onPointerDown={() => { setActivePane(pane); if (panePage) setSectionId(panePage.parent_id); }}>
      {panePage && documentAsset && !annotationPages.has(panePage.id) ? <DocumentPage key={`${pane}:${panePage.id}`} pageId={panePage.id} asset={documentAsset} extensions={extensions} toolbarTarget={activePane === pane ? toolbarHost : null} onAnnotate={() => { setActivePane(pane); setAnnotationPages((before) => new Set([...before, panePage.id])); if (!snapshot.objects.some((object) => object.page_id === panePage.id && object.type === 'document')) setPendingAnnotation(panePage.id); }} onError={notifyError} /> : panePage ? <Canvas key={`${pane}:${panePage.id}`} ref={pane === 0 ? canvasRef : splitCanvasRef} page={panePage} row={snapshot.pages.find((row) => row.id === panePage.id)!} initialObjects={snapshot.objects.filter((object) => object.page_id === panePage.id)} assets={snapshot.assets} nodes={nodes} extensions={extensions} toolbarActions={activePane === pane ? toolbarActions : undefined} toolbarPortalTarget={toolbarHost} showToolbar={activePane === pane} focusMode={focusMode} onToggleFocus={toggleFocus} onObjectsChange={updatePage} onNavigatePage={navigatePage} onError={notifyError} onAssetImported={importedAsset} onRunExtension={runExtension} onRequestLink={() => ask('Add web link', 'https://', 'Add link')} /> : <div className="no-page"><Layers3 size={30} /><h2>Open a page</h2><p>Choose one from Explorer or the tabs.</p></div>}
    </div>;
  };
  const renderTabStrip = (pane: 0 | 1) => {
    const ids = pane === 0 ? openTabs : rightTabs;
    const selectedId = pane === 0 ? pageId : splitPageId;
    return <div className="page-tabs" data-pane={pane} role="tablist" aria-label={`${pane === 0 ? 'Left' : 'Right'} editor tabs`}>
      {ids.map((id) => {
        const tab = nodes.find((node) => node.id === id && node.kind === 'page');
        if (!tab) return null;
        return <div key={tab.id} data-page-id={tab.id} className={`page-tab ${selectedId === tab.id ? 'active' : ''} ${selectedId === tab.id && activePane === pane ? 'focused' : ''} ${tabGhost && tabDrop?.pane === pane && tabDrop.targetId === tab.id ? `drop-${tabDrop.edge}` : ''}`} role="tab" aria-selected={selectedId === tab.id} tabIndex={0}
          onPointerDown={(event) => { if (event.button === 0 && !(event.target as HTMLElement).closest('button')) { tabPointer.current = { id: tab.id, pane, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); } }}
          onPointerCancel={() => { tabPointer.current = null; setTabDrop(null); setTabGhost(null); }}
          onClick={() => { if (suppressTabClick.current) return; pane === 0 ? setPageId(tab.id) : setSplitPageId(tab.id); setActivePane(pane); setSectionId(tab.parent_id); }}
          onDoubleClick={() => renameNode(tab)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } }}>
          {snapshot.documentPages.some((item) => item.page_id === tab.id) ? <FileIcon size={14} /> : <FileText size={14} />}<span>{tab.title}</span><button title={`Close ${tab.title}`} aria-label={`Close ${tab.title}`} onClick={(event) => { event.stopPropagation(); closeTab(tab.id, pane); }}><X size={13} /></button>
        </div>;
      })}
      {tabGhost && tabDrop?.pane === pane && !tabDrop.targetId && !tabDrop.split && <span className="tab-drop-end" aria-hidden="true" />}
      {pane === 0 ? <button className="split-tab-button" title="Move current page to the right" aria-label="Move current page to the right" disabled={!pageId} onClick={() => pageId && splitTab(pageId)}><PanelRight size={16} /></button> : <button className="split-tab-button" title="Close right editor group" aria-label="Close right editor group" onClick={() => { setOpenTabs((before) => [...before, ...rightTabs.filter((id) => !before.includes(id))]); setPageId(splitPageId ?? pageId); setRightTabs([]); setSplitPageId(null); setActivePane(0); }}><X size={15} /></button>}
    </div>;
  };

  return <div className={`app-shell ${focusMode ? 'focus-mode' : ''}`}>
    <header className="window-titlebar"><div className="window-logo" title="omniNote"><FileText size={17} /></div><div className="window-drag-region" /><div className="window-controls"><button title="Minimize" aria-label="Minimize window" onClick={() => window.whiteboard.windowAction('minimize')}><Minus size={15} /></button><button title={maximized ? 'Restore' : 'Maximize'} aria-label={maximized ? 'Restore window' : 'Maximize window'} onClick={() => window.whiteboard.windowAction('maximize').then(setMaximized)}>{maximized ? <Copy size={13} /> : <Maximize2 size={13} />}</button><button className="window-close" title="Close" aria-label="Close window" onClick={() => window.whiteboard.windowAction('close')}><X size={17} /></button></div></header>

    <div className="app-body">
      <nav className="activity-rail" aria-label="Primary navigation"><button className={activePanel === 'explorer' ? 'active' : ''} title="Toggle notebooks and pages" aria-label="Toggle notebooks and pages" aria-expanded={activePanel === 'explorer'} onClick={() => setActivePanel((panel) => panel === 'explorer' ? null : 'explorer')}><BookOpen size={20} /></button><button className={activePanel === 'extensions' ? 'active' : ''} title="Extensions" aria-label="Extensions" aria-expanded={activePanel === 'extensions'} onClick={() => setActivePanel((panel) => panel === 'extensions' ? null : 'extensions')}><Puzzle size={20} /></button>{['available', 'downloaded'].includes(updateStatus.state) && <button className="update-trigger" title={`Install omniNote ${updateStatus.version ?? 'update'}`} aria-label={`Install update ${updateStatus.version ?? ''}`} onClick={promptUpdate}><Download size={19} /><span className="update-dot" /></button>}<button className={`settings-trigger ${activePanel === 'settings' ? 'active' : ''}`} title="Settings" aria-label="Settings" aria-expanded={activePanel === 'settings'} onClick={() => setActivePanel((panel) => panel === 'settings' ? null : 'settings')}><Settings2 size={20} /></button></nav>
      {activePanel && <aside className="notebook-sidebar" aria-label={activePanel === 'explorer' ? 'Explorer' : activePanel === 'extensions' ? 'Extensions' : 'Settings'} style={{ width: sidebarWidth, flexBasis: sidebarWidth }}>
        {activePanel === 'explorer' ? <>
        <div className="sidebar-title"><span>EXPLORER</span><button className="icon-button small" title="New notebook" aria-label="New notebook" onClick={() => createNode('notebook', null)}><Plus size={16} /></button></div>
        <div className="tree-scroll" role="tree" aria-label="Notebooks" onDragOver={(event) => { if (event.dataTransfer.types.includes('Files') && sectionId) event.preventDefault(); }} onDrop={(event) => { if (event.dataTransfer.files.length && sectionId) { event.preventDefault(); void importFilesToSection(Array.from(event.dataTransfer.files), sectionId); } }}>
          {childrenOf(nodes, null).filter((node) => node.kind === 'notebook').map((node) => <TreeItem key={node.id} node={node} nodes={nodes} documentIds={new Set(snapshot.documentPages.map((item) => item.page_id))} depth={0} expanded={expanded} openMenuId={openTreeMenuId} onOpenMenu={setOpenTreeMenuId} onToggle={(id) => setExpanded((before) => { const next = new Set(before); next.has(id) ? next.delete(id) : next.add(id); return next; })} selectedSectionId={sectionId} selectedPageId={activePageId} treeDrop={treeDrag?.target ?? null} dragSourceId={treeDrag?.id ?? null} onTreePointerDown={(id, event) => { treePointer.current = { id, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} onTreePointerCancel={() => { treePointer.current = null; setTreeDrag(null); }} suppressTreeClick={suppressTreeClick} onSelect={(selected) => { if (selected.kind === 'section') { openPage(firstPageIn(nodes, selected.id), selected.id); setExpanded((before) => new Set([...before, selected.id])); } else if (selected.kind === 'page') openPage(selected.id, selected.parent_id); }} onCreate={createNode} onRename={renameNode} onDelete={deleteNode} onImportFiles={importFilesToSection} onPickDocuments={pickDocumentsForSection} />)}
          {!nodes.length && <div className="empty-sidebar">Create your first notebook to begin.</div>}
        </div>
        <button className="new-page" disabled={!section} onClick={() => section && createNode('page', section.id)}><Plus size={15} /> New page</button>
        {!!extensions.filter((item) => item.enabled).flatMap((item) => item.manifest.contributes.sidebar ?? []).length && <div className="sidebar-footer">{extensions.filter((item) => item.enabled).flatMap((item) => item.manifest.contributes.sidebar ?? []).map((entry) => <button key={entry.command} onClick={() => runExtension(entry.command)}><Puzzle size={16} /> {entry.label}</button>)}</div>}
        </> : activePanel === 'extensions' ? <ExtensionsPanel directory={snapshot.directory} extensions={extensions} onToggle={toggleExtension} onSearch={searchMarketplace} onInstall={installMarketplace} onSetting={async (id, key, value) => { try { await window.whiteboard.setExtensionSetting(id, key, value); await refreshExtensions(); } catch (error) { notifyError(error); } }} /> : <SettingsPanel theme={theme} onThemeChange={setTheme} updateStatus={updateStatus} onCheckUpdates={checkUpdates} />}
        <div className="sidebar-width-resizer" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={190} aria-valuemax={380} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={resizeSidebar} onKeyDown={(event) => { if (event.key === 'ArrowLeft') setSidebarWidth((size) => Math.max(190, size - 10)); if (event.key === 'ArrowRight') setSidebarWidth((size) => Math.min(380, size + 10)); }} />
      </aside>}
      <main className="editor-area">
        <div className={`editor-tabs-row ${rightTabs.length ? 'split' : ''}`}>{renderTabStrip(0)}{rightTabs.length > 0 && renderTabStrip(1)}</div>
        <div className="workspace-toolbar" ref={setToolbarHost} />
        <div className={`editor-panes ${rightTabs.length ? 'split' : ''} ${tabDrop?.split && tabGhost ? 'drag-split-preview' : ''}`}>{renderPane(pageId, 0)}{rightTabs.length > 0 && renderPane(splitPageId, 1)}</div>
      </main>
    </div>

    {tabGhost && <div className="drag-ghost tab-ghost" style={{ left: tabGhost.x + 12, top: tabGhost.y + 12 }} aria-hidden="true"><FileText size={14} />{nodes.find((item) => item.id === tabGhost.id)?.title}</div>}
    {treeDrag && <div className="drag-ghost tree-ghost" style={{ left: treeDrag.x + 12, top: treeDrag.y + 12 }} aria-hidden="true"><FileText size={14} />{nodes.find((item) => item.id === treeDrag.id)?.title}</div>}

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

interface TreeProps { node: TreeNode; nodes: TreeNode[]; documentIds: Set<string>; depth: number; expanded: Set<string>; openMenuId: string | null; onOpenMenu(id: string | null): void; selectedSectionId: string | null; selectedPageId: string | null; treeDrop: TreeDrop | null; dragSourceId: string | null; suppressTreeClick: { current: boolean }; onTreePointerDown(id: string, event: React.PointerEvent<HTMLDivElement>): void; onTreePointerCancel(): void; onToggle(id: string): void; onSelect(node: TreeNode): void; onCreate(kind: NodeKind, parentId: string | null): void; onRename(node: TreeNode): void; onDelete(node: TreeNode): void; onImportFiles(files: File[], sectionId: string): void; onPickDocuments(sectionId: string): void }
function TreeItem(props: TreeProps) {
  const { node, nodes, documentIds, depth, expanded, openMenuId, onOpenMenu, selectedSectionId, selectedPageId, treeDrop, dragSourceId, suppressTreeClick, onTreePointerDown, onTreePointerCancel, onToggle, onSelect, onCreate, onRename, onDelete, onImportFiles, onPickDocuments } = props;
  const children = childrenOf(nodes, node.id);
  const expandable = node.kind !== 'page';
  const menu = openMenuId === node.id;
  const [fileDrop, setFileDrop] = useState(false);
  const dropSection = node.kind === 'section' ? node.id : node.kind === 'page' ? node.parent_id : nodes.find((candidate) => {
    if (candidate.kind !== 'section') return false;
    let parentId = candidate.parent_id;
    while (parentId) { if (parentId === node.id) return true; parentId = nodes.find((item) => item.id === parentId)?.parent_id ?? null; }
    return false;
  })?.id;
  const activate = () => node.kind === 'notebook' || node.kind === 'folder' ? onToggle(node.id) : onSelect(node);
  const onDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer.files.length || !dropSection) return;
    event.preventDefault(); event.stopPropagation(); setFileDrop(false);
    onImportFiles(Array.from(event.dataTransfer.files), dropSection);
  };
  return <>
    <div className={`tree-item ${selectedPageId === node.id ? 'active' : ''} ${selectedSectionId === node.id ? 'parent-active' : ''} ${treeDrop?.id === node.id ? `drop-${treeDrop.placement}` : fileDrop ? 'drop-inside' : ''} ${dragSourceId === node.id ? 'drag-source' : ''}`} data-node-id={node.id} style={{ paddingLeft: 8 + depth * 17, '--drop-indent': `${8 + depth * 17}px` } as React.CSSProperties} role="treeitem" tabIndex={0} aria-level={depth + 1} aria-selected={selectedPageId === node.id} aria-expanded={expandable ? expanded.has(node.id) : undefined} onPointerDown={(event) => { if (event.button === 0 && !(event.target as HTMLElement).closest('button,.tree-menu')) onTreePointerDown(node.id, event); }} onPointerCancel={onTreePointerCancel} onDragOver={(event) => { if (!event.dataTransfer.types.includes('Files') || !dropSection) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setFileDrop(true); }} onDragLeave={() => setFileDrop(false)} onDrop={onDrop} onClick={() => { if (!suppressTreeClick.current) activate(); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!(event.target as HTMLElement).closest('.tree-menu')) onOpenMenu(node.id); }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); activate(); } }} onDoubleClick={(event) => { event.stopPropagation(); onRename(node); }}>
      {expandable ? <button className="tree-chevron" aria-label={`${expanded.has(node.id) ? 'Collapse' : 'Expand'} ${node.title}`} onClick={(event) => { event.stopPropagation(); onToggle(node.id); }}>{expanded.has(node.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="tree-chevron" />}
      <span className={`tree-symbol ${node.kind}`}>{node.kind === 'notebook' ? <BookOpen size={15} /> : node.kind === 'folder' ? <FolderPlus size={15} /> : node.kind === 'section' ? <Layers3 size={15} /> : documentIds.has(node.id) ? <FileIcon size={15} /> : <FileText size={15} />}</span>
      <span className="tree-name" title={node.title}>{node.title}</span>
      <button className="tree-more" title={`${node.kind} actions`} aria-label={`${node.kind} actions for ${node.title}`} aria-haspopup="menu" aria-expanded={menu} onClick={(event) => { event.stopPropagation(); onOpenMenu(menu ? null : node.id); }}><MoreHorizontal size={15} /></button>
      {menu && <div className="tree-menu" role="menu" onClick={(event) => event.stopPropagation()}>{(node.kind === 'notebook' || node.kind === 'folder') && <><button role="menuitem" onClick={() => { onCreate('folder', node.id); onOpenMenu(null); }}>New folder</button><button role="menuitem" onClick={() => { onCreate('section', node.id); onOpenMenu(null); }}>New section</button></>}{dropSection && <button role="menuitem" onClick={() => { onPickDocuments(dropSection); onOpenMenu(null); }}>Import documents…</button>}<button role="menuitem" onClick={() => { onRename(node); onOpenMenu(null); }}>Rename</button><button role="menuitem" className="danger" onClick={() => { onDelete(node); onOpenMenu(null); }}>Delete</button></div>}
    </div>
    {expandable && expanded.has(node.id) && <div role="group">{children.map((child) => <TreeItem key={child.id} {...props} node={child} depth={depth + 1} />)}</div>}
  </>;
}
