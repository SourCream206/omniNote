import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Image } from '@tauri-apps/api/image';
import { readImage, readText, writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { WhiteboardBridge, Camera, CanvasObject, NodeKind, PaperStyle, Snapshot, UpdateStatus } from './types';

const pendingSaves = new Map<string, Promise<void>>();

function saveInOrder(pageId: string, write: () => Promise<void>): Promise<void> {
  const next = (pendingSaves.get(pageId) ?? Promise.resolve()).catch(() => {}).then(write);
  pendingSaves.set(pageId, next);
  const clear = () => { if (pendingSaves.get(pageId) === next) pendingSaves.delete(pageId); };
  next.then(clear, clear);
  return next;
}

async function pngFromImage(image: Image): Promise<Uint8Array> {
  const { width, height } = await image.size();
  if (width * height * 4 > 32_000_000) throw new Error('Clipboard image is too large');
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Cannot read clipboard image');
  context.putImageData(new ImageData(new Uint8ClampedArray(await image.rgba()), width, height), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

async function readAsset(assetId: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>('read_asset', { assetId }));
}

export function createTauriBridge(): WhiteboardBridge {
  const appWindow = getCurrentWindow();
  let closing = false;
  const flushPages = async () => {
    const pending: Promise<void>[] = [];
    window.dispatchEvent(new CustomEvent('omninote:flush-save', { detail: { waitUntil: (save: Promise<void>) => pending.push(save) } }));
    await Promise.all(pending);
  };
  void appWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    if (closing) return;
    closing = true;
    try { await flushPages(); await appWindow.destroy(); }
    catch (error) { closing = false; window.alert(`Could not save your page. The window remains open.\n\n${String(error)}`); }
  });
  let updateStatus: UpdateStatus = { state: 'idle', message: 'Checking for updates…' };
  const updateListeners = new Set<(status: UpdateStatus) => void>();
  const publishUpdate = (status: UpdateStatus) => {
    updateStatus = status;
    updateListeners.forEach((listener) => listener(status));
    return status;
  };
  const checkForUpdates = async (): Promise<UpdateStatus> => {
    publishUpdate({ state: 'checking', message: 'Checking for updates…' });
    try {
      const status = await invoke<UpdateStatus>('check_for_updates', { ignoredVersion: localStorage.getItem('omninote.ignoredUpdate') });
      if (status.version && status.state === 'available') localStorage.removeItem('omninote.ignoredUpdate');
      return publishUpdate(status);
    } catch {
      return publishUpdate({ state: 'error', message: 'Could not check for updates. Try again later.' });
    }
  };
  return {
    load: () => invoke<Snapshot>('load_workspace'),
    createNode: (parentId: string | null, kind: NodeKind, title: string) => invoke('create_node', { parentId, kind, title }),
    savePage: (pageId: string, objects: CanvasObject[], camera: Camera) => saveInOrder(pageId, () => invoke('save_page', { pageId, objects, camera })),
    saveCamera: (pageId: string, camera: Camera) => saveInOrder(pageId, () => invoke('save_camera', { pageId, camera })),
    savePageSync: () => { throw new Error('Wait for the page to finish saving before closing.'); },
    setPageStyle: (pageId: string, style: PaperStyle) => invoke('set_page_style', { pageId, style }),
    setFullScreen: (enabled: boolean) => appWindow.setFullscreen(enabled),
    windowAction: async (action) => {
      if (action === 'minimize') { await appWindow.minimize(); return false; }
      if (action === 'maximize') { await appWindow.toggleMaximize(); return appWindow.isMaximized(); }
      await appWindow.close();
      return false;
    },
    onWindowMaximized: (callback) => {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      void appWindow.onResized(() => { void appWindow.isMaximized().then(callback); }).then((stop) => {
        if (disposed) stop(); else unlisten = stop;
      });
      return () => { disposed = true; unlisten?.(); };
    },
    getUpdateStatus: checkForUpdates,
    checkForUpdates,
    promptToInstallUpdate: async () => {
      if (updateStatus.state !== 'available' || !updateStatus.version) return updateStatus;
      await flushPages();
      try {
        const status = await invoke<UpdateStatus>('prompt_to_install_update', { version: updateStatus.version });
        if (status.state === 'ignored' && status.version) localStorage.setItem('omninote.ignoredUpdate', status.version);
        return publishUpdate(status);
      } catch (error) {
        publishUpdate({ state: 'error', message: 'Update installation failed. Check again to retry.' });
        throw error;
      }
    },
    onUpdateStatus: (listener) => { updateListeners.add(listener); return () => updateListeners.delete(listener); },
    listExtensions: () => invoke('list_extensions'),
    searchMarketplace: (query: string) => invoke('search_marketplace', { query }),
    openWorkspaceFolder: () => invoke('open_workspace_folder'),
    revealNode: (nodeId: string) => invoke('reveal_node', { nodeId }),
    createDocumentPage: (sectionId: string, assetId: string) => invoke('create_document_page', { sectionId, assetId }),
    renameNode: (nodeId: string, title: string) => invoke('rename_node', { nodeId, title }),
    setFolderAppearance: (nodeId: string, icon, color: string) => invoke('set_folder_appearance', { nodeId, icon, color }),
    deleteNode: (nodeId: string) => invoke('delete_node', { nodeId }),
    moveNode: (nodeId: string, parentId: string | null, beforeId?: string | null) => invoke('move_node', { nodeId, parentId, beforeId: beforeId ?? null }),
    importAsset: (name: string, mimeType: string, bytes: Uint8Array) => invoke('import_asset_raw', bytes, { headers: { 'x-file-name': encodeURIComponent(name), 'x-mime-type': mimeType || 'application/octet-stream' } }),
    pickAssets: () => invoke('pick_assets'),
    readAsset,
    copyImage: async (assetId: string) => {
      const bytes = await readAsset(assetId);
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Cannot copy image');
        context.drawImage(bitmap, 0, 0);
        const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
        const image = await Image.fromBytes(png);
        try { await writeImage(image); } finally { await image.close(); }
      } finally { bitmap.close(); }
    },
    copyText: (value: string) => value.length > 1_000_000 ? Promise.reject(new Error('Clipboard text is too large')) : writeText(value),
    readClipboard: async () => {
      const text = (await readText().catch(() => '')).slice(0, 1_000_000);
      let image: Uint8Array | null = null;
      const clipboardImage = await readImage().catch(() => null);
      if (clipboardImage) {
        try { image = await pngFromImage(clipboardImage); }
        finally { await clipboardImage.close(); }
      }
      return { text, image };
    },
    openOriginal: (assetId: string) => invoke('open_original', { assetId }),
    openExternal: (address: string) => invoke('open_external', { address }),
    installMarketplaceExtension: (extensionId: string, version: string) => invoke('install_marketplace_extension', { extensionId, version }),
    extensionSource: (extensionId: string) => invoke('extension_source', { extensionId }),
    extensionResource: (extensionId: string, fileName: string) => invoke('extension_resource', { extensionId, fileName }),
    enableExtension: (extensionId: string, enabled: boolean, permissions: string[] = []) => invoke('enable_extension', { extensionId, enabled, permissions }),
    setExtensionSetting: (extensionId: string, key: string, value: boolean | string) => invoke('set_extension_setting', { extensionId, key, value }),
    saveExtensionExport: (name: string, bytes: Uint8Array) => invoke('save_extension_export', { name, bytes: Array.from(bytes) }),
    exportWorkspace: () => invoke('export_workspace'),
    exportPagePdf: async () => { window.print(); return true; },
  };
}
