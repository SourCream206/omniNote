import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Bold, Italic, Underline as UnderlineIcon, Heading1, List, ListChecks, Link2, MousePointer2, PenLine, Highlighter, Eraser, Hand, Scan, Undo2, Redo2, Group, Ungroup, BringToFront, SendToBack, Copy, Trash2, Minus, Plus, FileUp, Maximize2, ChevronDown } from 'lucide-react';
import type { Asset, Camera, CanvasObject, CanvasTool, ExtensionInfo, InkPoint, PageRow, TreeNode } from './types';
import { eraseInk, inkPath, pointInPolygon } from './ink';
import DocumentPreview from './DocumentPreview';

export interface CanvasHandle { insertText(text: string): void; insertAsset(asset: Asset): void }
interface Props { page: TreeNode; row: PageRow; initialObjects: CanvasObject[]; assets: Asset[]; nodes: TreeNode[]; extensions: ExtensionInfo[]; onObjectsChange(pageId: string, objects: CanvasObject[], camera: Camera): void; onNavigatePage(id: string): void; onError(error: unknown): void; onAssetImported(): void; onRunExtension(command: string): void }
type Point = { x: number; y: number };
type Gesture = { kind: 'pan' | 'draw' | 'erase' | 'lasso' | 'move' | 'resize'; pointerId: number; start: Point; camera: Camera; objects: CanvasObject[]; selected: string[]; targetId?: string; points?: InkPoint[]; lasso?: Point[] };
const emptyDoc = (text = '') => ({ type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] });
const clone = (objects: CanvasObject[]) => objects.map((object) => ({ ...object, payload: structuredClone(object.payload) }));
const clamp = (number: number, min: number, max: number) => Math.max(min, Math.min(max, number));

const Canvas = forwardRef<CanvasHandle, Props>(function Canvas({ page, row, initialObjects, assets, nodes, extensions, onObjectsChange, onNavigatePage, onError, onAssetImported, onRunExtension }, ref) {
  const viewport = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [objects, setObjects] = useState<CanvasObject[]>(initialObjects);
  const [camera, setCamera] = useState<Camera>({ x: row.camera_x, y: row.camera_y, zoom: row.camera_zoom });
  const [selected, setSelected] = useState<string[]>([]);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  const [ink, setInk] = useState<{ points: InkPoint[]; highlighter: boolean } | null>(null);
  const [lasso, setLasso] = useState<Point[]>([]);
  const [width, setWidth] = useState(4);
  const [color, setColor] = useState('#253454');
  const [partialEraser, setPartialEraser] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 1000, height: 650 });
  const [localAssets, setLocalAssets] = useState(assets);
  const gesture = useRef<Gesture | null>(null);
  const pinch = useRef<{ distance: number; center: Point; camera: Camera } | null>(null);
  const touches = useRef(new Map<number, Point>());
  const history = useRef<{ past: CanvasObject[][]; future: CanvasObject[][] }>({ past: [], future: [] });
  const clipboard = useRef<CanvasObject[]>([]);
  const objectsRef = useRef(objects);
  const cameraRef = useRef(camera);
  const selectedRef = useRef(selected);
  const toolRef = useRef(tool);
  const penLastSeen = useRef(-Infinity);
  const spaceHeld = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateObjects = (next: CanvasObject[]) => { objectsRef.current = next; setObjects(next); scheduleSave(next, cameraRef.current); };
  const updateCamera = (next: Camera) => { cameraRef.current = next; setCamera(next); scheduleSave(objectsRef.current, next); };
  const updateSelected = (next: string[]) => { selectedRef.current = next; setSelected(next); };
  const updateTool = (next: CanvasTool) => { toolRef.current = next; setTool(next); setActiveDoc(null); };

  function scheduleSave(nextObjects: CanvasObject[], nextCamera: Camera) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      window.whiteboard.savePage(page.id, nextObjects, nextCamera).then(() => onObjectsChange(page.id, nextObjects, nextCamera)).catch(onError);
    }, 400);
  }

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (viewport.current) observer.observe(viewport.current);
    return () => {
      observer.disconnect();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      window.whiteboard.savePage(page.id, objectsRef.current, cameraRef.current).catch(onError);
    };
    // Canvas is keyed by page ID; cleanup flushes its latest state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  useEffect(() => setLocalAssets(assets), [assets]);

  function record(before: CanvasObject[]) {
    if (JSON.stringify(before) === JSON.stringify(objectsRef.current)) return;
    history.current.past.push(before);
    if (history.current.past.length > 100) history.current.past.shift();
    history.current.future = [];
  }
  function commit(next: CanvasObject[]) { record(objectsRef.current); updateObjects(next); }
  function undo() {
    const previous = history.current.past.pop(); if (!previous) return;
    history.current.future.push(clone(objectsRef.current)); updateObjects(previous); updateSelected([]);
  }
  function redo() {
    const next = history.current.future.pop(); if (!next) return;
    history.current.past.push(clone(objectsRef.current)); updateObjects(next); updateSelected([]);
  }

  function centerWorld(): Point {
    const current = cameraRef.current;
    const element = viewport.current;
    return { x: ((element?.clientWidth ?? 900) / 2 - current.x) / current.zoom, y: ((element?.clientHeight ?? 600) / 2 - current.y) / current.zoom };
  }
  function createText(x: number, y: number, text = '') {
    const object: CanvasObject = { id: crypto.randomUUID(), page_id: page.id, type: 'text', x, y, width: 300, height: 165, z_index: Math.max(0, ...objectsRef.current.map((item) => item.z_index)) + 1, group_id: null, payload_version: 1, payload: { doc: emptyDoc(text) } };
    commit([...objectsRef.current, object]); updateSelected([object.id]); updateTool('select');
  }
  function insertAsset(asset: Asset) {
    const ext = asset.original_name.split('.').pop()?.toLowerCase() ?? '';
    const isImage = ['png','jpg','jpeg','gif','webp','svg','bmp'].includes(ext);
    const center = centerWorld();
    const object: CanvasObject = { id: crypto.randomUUID(), page_id: page.id, type: isImage ? 'image' : 'document', x: center.x - 210, y: center.y - 160, width: 420, height: 320, z_index: Math.max(0, ...objectsRef.current.map((item) => item.z_index)) + 1, group_id: null, payload_version: 1, payload: { assetId: asset.id, name: asset.original_name, format: ext } };
    setLocalAssets((current) => [...current.filter((item) => item.id !== asset.id), asset]);
    commit([...objectsRef.current, object]); updateSelected([object.id]); updateTool('select');
  }
  useImperativeHandle(ref, () => ({ insertText: (text) => { const point = centerWorld(); createText(point.x - 150, point.y - 80, text); }, insertAsset }), [page.id]);

  function screen(event: { clientX: number; clientY: number }): Point { const rect = viewport.current!.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  function world(point: Point, cam = cameraRef.current): Point { return { x: (point.x - cam.x) / cam.zoom, y: (point.y - cam.y) / cam.zoom }; }
  function sample(event: PointerEvent): InkPoint { const point = world(screen(event)); return { ...point, pressure: event.pointerType === 'mouse' ? 0.5 : clamp(event.pressure || 0.01, 0.01, 1), tiltX: event.tiltX || 0, tiltY: event.tiltY || 0, timestamp: event.timeStamp }; }
  function zoomAt(factor: number, origin: Point) {
    const old = cameraRef.current;
    const nextZoom = clamp(old.zoom * factor, 0.2, 4);
    updateCamera({ x: origin.x - (origin.x - old.x) * nextZoom / old.zoom, y: origin.y - (origin.y - old.y) * nextZoom / old.zoom, zoom: nextZoom });
  }

  function startObjectGesture(event: React.PointerEvent, object: CanvasObject, kind: 'move' | 'resize') {
    if (toolRef.current !== 'select') return;
    event.stopPropagation(); event.preventDefault();
    const group = object.group_id ? objectsRef.current.filter((item) => item.group_id === object.group_id).map((item) => item.id) : [object.id];
    const nextSelected = event.shiftKey ? [...new Set([...selectedRef.current, ...group])] : selectedRef.current.includes(object.id) ? selectedRef.current : group;
    updateSelected(nextSelected);
    const point = world(screen(event.nativeEvent));
    gesture.current = { kind, pointerId: event.pointerId, start: point, camera: cameraRef.current, objects: clone(objectsRef.current), selected: nextSelected, targetId: object.id };
    viewport.current?.setPointerCapture(event.pointerId);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'pen') penLastSeen.current = performance.now();
    if (event.pointerType === 'touch') {
      if (performance.now() - penLastSeen.current < 700) return;
      touches.current.set(event.pointerId, screen(event.nativeEvent));
      if (touches.current.size === 2) {
        const points = [...touches.current.values()];
        pinch.current = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), center: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, camera: cameraRef.current };
        gesture.current = null;
        viewport.current?.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (gesture.current || pinch.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1) return;
    const point = screen(event.nativeEvent);
    const position = world(point);
    const eraserButton = event.pointerType === 'pen' && (event.button === 5 || (event.buttons & 32) !== 0);
    const currentTool = spaceHeld.current || event.button === 1 ? 'hand' : eraserButton ? 'eraser' : toolRef.current;
    if (currentTool === 'text') {
      if ((event.target as HTMLElement).closest('.canvas-object')) return;
      createText(position.x, position.y); return;
    }
    if (currentTool === 'select') { updateSelected([]); setActiveDoc(null); return; }
    event.preventDefault();
    viewport.current?.setPointerCapture(event.pointerId);
    const kind: Gesture['kind'] = currentTool === 'hand' ? 'pan' : currentTool === 'eraser' ? 'erase' : currentTool === 'lasso' ? 'lasso' : 'draw';
    const initialPoint = sample(event.nativeEvent);
    gesture.current = { kind, pointerId: event.pointerId, start: kind === 'pan' ? point : position, camera: cameraRef.current, objects: clone(objectsRef.current), selected: selectedRef.current, points: [initialPoint], lasso: [position] };
    if (kind === 'draw') setInk({ points: [initialPoint], highlighter: currentTool === 'highlighter' });
    if (kind === 'lasso') setLasso([position]);
    if (kind === 'erase') updateObjects(eraseInk(objectsRef.current, position.x, position.y, 12 / cameraRef.current.zoom, partialEraser));
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'pen') penLastSeen.current = performance.now();
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) touches.current.set(event.pointerId, screen(event.nativeEvent));
    if (pinch.current && touches.current.size >= 2) {
      const points = [...touches.current.values()];
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const base = pinch.current;
      const zoom = clamp(base.camera.zoom * distance / Math.max(1, base.distance), 0.2, 4);
      const anchor = world(base.center, base.camera);
      updateCamera({ x: center.x - anchor.x * zoom, y: center.y - anchor.y * zoom, zoom });
      return;
    }
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const point = screen(event.nativeEvent);
    const position = world(point);
    if (current.kind === 'pan') { updateCamera({ ...current.camera, x: current.camera.x + point.x - current.start.x, y: current.camera.y + point.y - current.start.y }); return; }
    if (current.kind === 'move') { const dx = position.x - current.start.x; const dy = position.y - current.start.y; updateObjects(current.objects.map((object) => current.selected.includes(object.id) ? { ...object, x: object.x + dx, y: object.y + dy } : object)); return; }
    if (current.kind === 'resize') { const dx = position.x - current.start.x; const dy = position.y - current.start.y; updateObjects(current.objects.map((object) => object.id === current.targetId ? { ...object, width: Math.max(90, object.width + dx), height: Math.max(70, object.height + dy) } : object)); return; }
    if (current.kind === 'erase') { updateObjects(eraseInk(objectsRef.current, position.x, position.y, 12 / cameraRef.current.zoom, partialEraser)); return; }
    if (current.kind === 'lasso') { current.lasso!.push(position); setLasso([...current.lasso!]); return; }
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    for (const item of coalesced.length ? coalesced : [event.nativeEvent]) current.points!.push(sample(item));
    setInk({ points: [...current.points!], highlighter: toolRef.current === 'highlighter' });
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch') { touches.current.delete(event.pointerId); if (touches.current.size < 2) pinch.current = null; }
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (current.kind === 'draw' && current.points?.length) {
      const points = current.points;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const point of points) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
      minX -= width * 2; minY -= width * 2; maxX += width * 2; maxY += width * 2;
      const object: CanvasObject = { id: crypto.randomUUID(), page_id: page.id, type: 'ink', x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY), z_index: Math.max(0, ...objectsRef.current.map((item) => item.z_index)) + 1, group_id: null, payload_version: 1, payload: { points: points.map((point) => ({ ...point, x: point.x - minX, y: point.y - minY })), color, width, highlighter: toolRef.current === 'highlighter' } };
      updateObjects([...objectsRef.current, object]);
      record(current.objects);
      setInk(null);
    } else if (current.kind === 'lasso') {
      const polygon = current.lasso ?? [];
      updateSelected(objectsRef.current.filter((object) => pointInPolygon({ x: object.x + object.width / 2, y: object.y + object.height / 2 }, polygon)).map((object) => object.id));
      setLasso([]);
    } else if (['move','resize','erase'].includes(current.kind)) record(current.objects);
    gesture.current = null;
    try { viewport.current?.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  }

  function onWheel(event: React.WheelEvent) { event.preventDefault(); zoomAt(Math.exp(-event.deltaY * 0.0015), screen(event.nativeEvent)); }
  async function onDrop(event: React.DragEvent) {
    event.preventDefault();
    for (const file of Array.from(event.dataTransfer.files)) {
      try {
        const asset = await window.whiteboard.importAsset(file.name, file.type, new Uint8Array(await file.arrayBuffer()));
        insertAsset(asset);
      } catch (error) { onError(error); }
    }
    onAssetImported();
  }

  function groupSelected() { if (selectedRef.current.length < 2) return; const groupId = crypto.randomUUID(); commit(objectsRef.current.map((object) => selectedRef.current.includes(object.id) ? { ...object, group_id: groupId } : object)); }
  function ungroupSelected() { commit(objectsRef.current.map((object) => selectedRef.current.includes(object.id) ? { ...object, group_id: null } : object)); }
  function zOrder(front: boolean) { const top = Math.max(0, ...objectsRef.current.map((item) => item.z_index)); const bottom = Math.min(0, ...objectsRef.current.map((item) => item.z_index)); commit(objectsRef.current.map((object) => selectedRef.current.includes(object.id) ? { ...object, z_index: front ? top + 1 : bottom - 1 } : object)); }
  function deleteSelected() { commit(objectsRef.current.filter((object) => !selectedRef.current.includes(object.id))); updateSelected([]); }
  function copySelected() { clipboard.current = clone(objectsRef.current.filter((object) => selectedRef.current.includes(object.id))); }
  function paste() { if (!clipboard.current.length) return; const copies = clipboard.current.map((object) => ({ ...object, id: crypto.randomUUID(), x: object.x + 28, y: object.y + 28, group_id: object.group_id ? crypto.randomUUID() : null })); commit([...objectsRef.current, ...copies]); updateSelected(copies.map((item) => item.id)); clipboard.current = clone(copies); }
  function updateText(id: string, doc: unknown) { updateObjects(objectsRef.current.map((object) => object.id === id ? { ...object, payload: { doc } } : object)); }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editing = target.closest('.ProseMirror, input, textarea, select');
      if (event.code === 'Space' && !editing) { spaceHeld.current = true; event.preventDefault(); }
      if (editing) return;
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (command && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (command && key === 'y') { event.preventDefault(); redo(); }
      else if (command && key === 'c') { event.preventDefault(); copySelected(); }
      else if (command && key === 'v') { event.preventDefault(); paste(); }
      else if (command && key === 'g') { event.preventDefault(); event.shiftKey ? ungroupSelected() : groupSelected(); }
      else if (key === 'delete' || key === 'backspace') { if (selectedRef.current.length) { event.preventDefault(); deleteSelected(); } }
      else if (key === 'escape') { updateSelected([]); setActiveDoc(null); }
    };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') spaceHeld.current = false; };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); };
  }, []);

  const margin = 250;
  const worldView = { minX: (-camera.x - margin) / camera.zoom, minY: (-camera.y - margin) / camera.zoom, maxX: (viewportSize.width - camera.x + margin) / camera.zoom, maxY: (viewportSize.height - camera.y + margin) / camera.zoom };
  const visibleObjects = useMemo(() => objects.filter((object) => object.x + object.width >= worldView.minX && object.y + object.height >= worldView.minY && object.x <= worldView.maxX && object.y <= worldView.maxY).sort((a, b) => a.z_index - b.z_index), [objects, worldView.minX, worldView.minY, worldView.maxX, worldView.maxY]);
  const worldStyle = { transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` };
  const selectedObject = objects.find((object) => selected.includes(object.id));

  return <div className="canvas-shell">
    <div className="canvas-toolbar">
      <div className="tool-group"><ToolButton icon={<MousePointer2 size={16} />} name="Select" tool="select" active={tool} onClick={updateTool} /><ToolButton icon={<FileUp size={16} />} name="Text" tool="text" active={tool} onClick={updateTool} /></div>
      <div className="toolbar-divider" />
      <div className="tool-group"><ToolButton icon={<PenLine size={16} />} name="Pen" tool="pen" active={tool} onClick={updateTool} /><ToolButton icon={<Highlighter size={16} />} name="Highlight" tool="highlighter" active={tool} onClick={updateTool} /><ToolButton icon={<Eraser size={16} />} name="Erase" tool="eraser" active={tool} onClick={updateTool} /><ToolButton icon={<Scan size={16} />} name="Lasso" tool="lasso" active={tool} onClick={updateTool} /><ToolButton icon={<Hand size={16} />} name="Pan" tool="hand" active={tool} onClick={updateTool} /></div>
      <div className="toolbar-divider" />
      <div className="tool-group"><label className="color-control" title="Ink color"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><input className="width-slider" aria-label="Pen width" type="range" min="1" max="24" value={width} onChange={(event) => setWidth(Number(event.target.value))} /><span className="width-value">{width}px</span>{tool === 'eraser' && <label className="partial-toggle"><input type="checkbox" checked={partialEraser} onChange={(event) => setPartialEraser(event.target.checked)} /> Partial</label>}</div>
      <div className="toolbar-spacer" />
      <div className="tool-group right"><button title="Undo" onClick={undo}><Undo2 size={16} /></button><button title="Redo" onClick={redo}><Redo2 size={16} /></button><button title="Copy selected" onClick={copySelected}><Copy size={16} /></button><button title="Group selected" onClick={groupSelected}><Group size={16} /></button><button title="Ungroup" onClick={ungroupSelected}><Ungroup size={16} /></button><button title="Bring to front" onClick={() => zOrder(true)}><BringToFront size={16} /></button><button title="Send to back" onClick={() => zOrder(false)}><SendToBack size={16} /></button><button title="Delete selected" onClick={deleteSelected}><Trash2 size={16} /></button></div>
      {extensions.filter((item) => item.enabled).flatMap((item) => item.manifest.contributes.toolbar ?? []).map((entry) => <button className="extension-command" key={entry.command} onClick={() => onRunExtension(entry.command)}>{entry.label}</button>)}
    </div>
    <RichToolbar selectedObject={selectedObject} onAction={(action) => { if (selectedObject?.type === 'text') document.dispatchEvent(new CustomEvent('whiteboard:text-command', { detail: { id: selectedObject.id, action } })); }} nodes={nodes} />
    <div ref={viewport} className="canvas-viewport" data-tool={tool} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onContextMenu={(event) => event.preventDefault()} style={{ backgroundPosition: `${camera.x}px ${camera.y}px`, backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px` }}>
      <div className="canvas-world" style={worldStyle}>
        {visibleObjects.map((object) => <div key={object.id} className={`canvas-object object-${object.type} ${selected.includes(object.id) ? 'selected' : ''} ${activeDoc === object.id ? 'doc-active' : ''}`} data-object-id={object.id} style={{ left: object.x, top: object.y, width: object.width, height: object.height, zIndex: object.z_index }} onPointerDown={(event) => { if (tool === 'select' && object.type !== 'text') startObjectGesture(event, object, 'move'); }}>
          {object.type !== 'ink' && <div className="object-header" onPointerDown={(event) => startObjectGesture(event, object, 'move')}><span className="drag-grip">⋮⋮</span><span>{object.type === 'text' ? 'Note' : (object.payload as { name?: string }).name ?? object.type}</span>{object.type === 'document' && <button type="button" title="Enter document" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setActiveDoc(activeDoc === object.id ? null : object.id); updateSelected([object.id]); }}><Maximize2 size={12} /> {activeDoc === object.id ? 'Exit' : 'Interact'}</button>}</div>}
          {object.type === 'text' && <TextBlock object={object} onChange={(doc) => updateText(object.id, doc)} onNavigatePage={onNavigatePage} onOpenExternal={(url) => window.whiteboard.openExternal(url).catch(onError)} onSelect={() => updateSelected([object.id])} />}
          {object.type === 'ink' && <svg className="ink-svg" viewBox={`0 0 ${object.width} ${object.height}`} overflow="visible" onPointerDown={(event) => startObjectGesture(event, object, 'move')}><path d={inkPath((object.payload as { points: InkPoint[] }).points, (object.payload as { width: number }).width * ((object.payload as { highlighter: boolean }).highlighter ? 3.5 : 1))} fill={(object.payload as { color: string }).color} opacity={(object.payload as { highlighter: boolean }).highlighter ? 0.35 : 1} /></svg>}
          {object.type === 'image' && <ImageBlock assetId={(object.payload as { assetId: string }).assetId} />}
          {object.type === 'document' && <DocumentPreview object={object} asset={localAssets.find((asset) => asset.id === (object.payload as { assetId: string }).assetId)} interactive={activeDoc === object.id} onEnter={() => { setActiveDoc(object.id); updateSelected([object.id]); }} onError={onError} />}
          {object.type === 'extension' && <div className="extension-placeholder">Extension object: {(object.payload as { objectType: string }).objectType}</div>}
          {selected.includes(object.id) && tool === 'select' && object.type !== 'ink' && <div className="resize-handle" onPointerDown={(event) => startObjectGesture(event, object, 'resize')} />}
        </div>)}
        {ink && <svg className="live-ink" overflow="visible"><path d={inkPath(ink.points.map((point) => ({ ...point, x: point.x, y: point.y })), width * (ink.highlighter ? 3.5 : 1))} fill={color} opacity={ink.highlighter ? 0.35 : 1} /></svg>}
        {lasso.length > 1 && <svg className="lasso-overlay" overflow="visible"><polyline points={lasso.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#4471d0" strokeWidth={2 / camera.zoom} strokeDasharray="5 4" /></svg>}
      </div>
      {!objects.length && <div className="canvas-empty"><PenLine size={30} /><strong>Your canvas starts anywhere</strong><span>Click to type, or choose a pen to draw.</span></div>}
      <div className="canvas-zoom"><button onClick={() => zoomAt(0.8, { x: viewportSize.width / 2, y: viewportSize.height / 2 })}><Minus size={15} /></button><span>{Math.round(camera.zoom * 100)}%</span><button onClick={() => zoomAt(1.25, { x: viewportSize.width / 2, y: viewportSize.height / 2 })}><Plus size={15} /></button><button title="Reset view" onClick={() => updateCamera({ x: 0, y: 0, zoom: 1 })}><Maximize2 size={15} /></button></div>
    </div>
    <div className="canvas-status"><span>{objects.length} objects · {visibleObjects.length} visible</span><span>Wheel to zoom · Space to pan · Shift-click to multi-select</span><span>{camera.zoom.toFixed(2)}×</span></div>
  </div>;
});
export default Canvas;

function ToolButton({ icon, name, tool, active, onClick }: { icon: React.ReactNode; name: string; tool: CanvasTool; active: CanvasTool; onClick(tool: CanvasTool): void }) { return <button title={name} className={active === tool ? 'active' : ''} onClick={() => onClick(tool)}>{icon}<span>{name}</span></button>; }

function RichToolbar({ selectedObject, onAction, nodes }: { selectedObject?: CanvasObject; onAction(action: string): void; nodes: TreeNode[] }) {
  const active = selectedObject?.type === 'text';
  const link = () => { const url = window.prompt('Enter a web URL or choose a page below', 'https://'); if (url) onAction(`link:${url}`); };
  return <div className={`rich-toolbar ${active ? '' : 'disabled'}`}><span className="rich-label">TEXT</span><button title="Bold" disabled={!active} onClick={() => onAction('bold')}><Bold size={15} /></button><button title="Italic" disabled={!active} onClick={() => onAction('italic')}><Italic size={15} /></button><button title="Underline" disabled={!active} onClick={() => onAction('underline')}><UnderlineIcon size={15} /></button><span className="toolbar-divider" /><button title="Heading" disabled={!active} onClick={() => onAction('heading')}><Heading1 size={15} /></button><button title="Bulleted list" disabled={!active} onClick={() => onAction('list')}><List size={15} /></button><button title="Checkbox list" disabled={!active} onClick={() => onAction('checklist')}><ListChecks size={15} /></button><button title="Add link" disabled={!active} onClick={link}><Link2 size={15} /></button><select aria-label="Link to page" disabled={!active} value="" onChange={(event) => { if (event.target.value) onAction(`link:whiteboard://page/${event.target.value}`); }}><option value="">Link to page…</option>{nodes.filter((node) => node.kind === 'page').map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select><ChevronDown className="rich-chevron" size={12} /></div>;
}

function TextBlock({ object, onChange, onNavigatePage, onOpenExternal, onSelect }: { object: CanvasObject; onChange(doc: unknown): void; onNavigatePage(id: string): void; onOpenExternal(url: string): void; onSelect(): void }) {
  const editor = useEditor({ extensions: [StarterKit, Underline, Link.configure({ openOnClick: false }), TaskList, TaskItem.configure({ nested: true })], content: (object.payload as { doc: unknown }).doc as object, onUpdate: ({ editor }) => onChange(editor.getJSON()), editorProps: { attributes: { class: 'rich-content' }, handleClick: (_view, _pos, event) => {
    const link = (event.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!link) return false;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('whiteboard://page/')) onNavigatePage(href.slice('whiteboard://page/'.length));
    else onOpenExternal(href);
    return true;
  } } });
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; action: string }>).detail;
      if (!editor || detail.id !== object.id) return;
      const { action } = detail;
      if (action === 'bold') editor.chain().focus().toggleBold().run();
      if (action === 'italic') editor.chain().focus().toggleItalic().run();
      if (action === 'underline') editor.chain().focus().toggleUnderline().run();
      if (action === 'heading') editor.chain().focus().toggleHeading({ level: 2 }).run();
      if (action === 'list') editor.chain().focus().toggleBulletList().run();
      if (action === 'checklist') editor.chain().focus().toggleTaskList().run();
      if (action.startsWith('link:')) editor.chain().focus().setLink({ href: action.slice(5) }).run();
    };
    document.addEventListener('whiteboard:text-command', handler);
    return () => document.removeEventListener('whiteboard:text-command', handler);
  }, [editor, object.id]);
  return <div className="text-body" onPointerDown={(event) => event.stopPropagation()} onFocus={onSelect}><EditorContent editor={editor} /></div>;
}

function ImageBlock({ assetId }: { assetId: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true; let objectUrl = '';
    window.whiteboard.readAsset(assetId).then((bytes) => { objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)])); if (active) setUrl(objectUrl); }).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assetId]);
  return url ? <img className="image-body" src={url} alt="Embedded image" draggable={false} /> : <div className="image-loading">Loading image…</div>;
}
