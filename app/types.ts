export type NodeKind = 'notebook' | 'folder' | 'section' | 'page';
export type CanvasTool = 'select' | 'text' | 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'hand';
export interface TreeNode { id: string; parent_id: string | null; kind: NodeKind; title: string; order_index: number; created_at: string; updated_at: string }
export type PaperStyle = 'blank' | 'dots' | 'grid' | 'lines';
export interface PageRow { id: string; camera_x: number; camera_y: number; camera_zoom: number; paper_style: PaperStyle }
export interface Asset { id: string; relative_path: string; original_name: string; mime_type: string; sha256: string; size: number; updated_at: string }
export interface InkPoint { x: number; y: number; pressure: number; tiltX: number; tiltY: number; timestamp: number }
export type ObjectPayload =
  | { doc: unknown; appearance?: { color: string | null; opacity: number } }
  | { points: InkPoint[]; color: string; width: number; highlighter: boolean }
  | { assetId: string; name: string; format: string; presentation?: 'block' | 'printout'; audioCompact?: boolean; imageFitted?: boolean; previewFailed?: boolean; fileTileCompact?: boolean; previewSize?: { width: number; height: number } }
  | { extensionId: string; objectType: string; data: unknown };
export interface CanvasObject { id: string; page_id: string; type: 'text' | 'ink' | 'image' | 'audio' | 'video' | 'document' | 'extension'; x: number; y: number; width: number; height: number; z_index: number; group_id: string | null; payload_version: number; payload: ObjectPayload }
export interface Camera { x: number; y: number; zoom: number }
export interface Snapshot { schemaVersion: number; directory: string; nodes: TreeNode[]; pages: PageRow[]; objects: CanvasObject[]; assets: Asset[] }
export interface ExtensionManifest {
  id: string; name: string; version: string; apiVersion: string; main: string;
  activationEvents: string[]; permissions: string[];
  contributes: {
    commands?: { id: string; title: string }[];
    toolbar?: { command: string; label: string }[];
    sidebar?: { command: string; label: string }[];
    canvasObjectTypes?: { type: string; entry: string }[];
    documentViewers?: { extensions: string[]; entry: string }[];
    importers?: { extensions: string[]; command: string }[];
    exporters?: { id: string; command: string }[];
    settings?: { key: string; label: string; type: 'boolean' | 'string'; default: boolean | string }[];
  };
}
export interface ExtensionInfo { manifest: ExtensionManifest; enabled: boolean; grantedPermissions: string[]; settings: Record<string, boolean | string> }
export interface MarketplaceEntry { id: string; name: string; summary: string; version: string; apiVersion: string; permissions: string[] }
export interface MarketplaceSearch { configured: boolean; entries: MarketplaceEntry[] }
export interface UpdateStatus { state: 'unavailable' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'ignored' | 'up-to-date' | 'error'; message: string; version?: string }

export interface WhiteboardBridge {
  load(): Promise<Snapshot>;
  createNode(parentId: string | null, kind: NodeKind, title: string): Promise<string>;
  renameNode(nodeId: string, title: string): Promise<void>;
  deleteNode(nodeId: string): Promise<void>;
  moveNode(nodeId: string, parentId: string | null, beforeId?: string | null): Promise<void>;
  savePage(pageId: string, objects: CanvasObject[], camera: Camera): Promise<void>;
  savePageSync(pageId: string, objects: CanvasObject[], camera: Camera): void;
  setPageStyle(pageId: string, style: PaperStyle): Promise<void>;
  importAsset(name: string, mimeType: string, bytes: Uint8Array): Promise<Asset>;
  pickAssets(): Promise<Asset[]>;
  readAsset(assetId: string): Promise<Uint8Array>;
  copyImage(assetId: string): Promise<void>;
  copyText(text: string): Promise<void>;
  readClipboard(): Promise<{ text: string; image: Uint8Array | null }>;
  openOriginal(assetId: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  listExtensions(): Promise<ExtensionInfo[]>;
  searchMarketplace(query: string): Promise<MarketplaceSearch>;
  installMarketplaceExtension(extensionId: string, version: string): Promise<{ id: string; version: string }>;
  extensionSource(extensionId: string): Promise<string>;
  extensionResource(extensionId: string, fileName: string): Promise<string>;
  enableExtension(extensionId: string, enabled: boolean, permissions?: string[]): Promise<void>;
  setExtensionSetting(extensionId: string, key: string, value: boolean | string): Promise<void>;
  saveExtensionExport(name: string, bytes: Uint8Array): Promise<boolean>;
  exportWorkspace(): Promise<boolean>;
  exportPagePdf(): Promise<boolean>;
  setFullScreen(enabled: boolean): Promise<void>;
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<boolean>;
  onWindowMaximized(callback: (maximized: boolean) => void): () => void;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  promptToInstallUpdate(): Promise<UpdateStatus>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
}

declare global { interface Window { whiteboard: WhiteboardBridge } }
