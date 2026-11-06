import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Image } from '@tauri-apps/api/image';
import { readImage, readText, writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { WhiteboardBridge, Camera, CanvasObject, NodeKind, PaperStyle, Snapshot, UpdateStatus } from './types';

const unavailable = (feature: string): Promise<never> => Promise.reject(new Error(`${feature} is not available in the Tauri preview yet.`));
const updateStatus: UpdateStatus = { state: 'unavailable', message: 'Updates are not configured in the Tauri preview.' };

async function pngFromImage(image: Image): Promise<Uint8Array> {
  const { width, height } = await image.size();
  if (width * height * 4 > 32_000_000) throw new Error('Clipboard image is too large');
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Cannot read clipboard image');
  context.putImageData(new ImageData(new Uint8ClampedArray(await image.rgba()), width, height), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

export function createTauriBridge(): WhiteboardBridge {
  const appWindow = getCurrentWindow();
  return {
    load: () => invoke<Snapshot>('load_workspace'),
    createNode: (parentId: string | null, kind: NodeKind, title: string) => invoke('create_node', { parentId, kind, title }),
    savePage: (pageId: string, objects: CanvasObject[], camera: Camera) => invoke('save_page', { pageId, objects, camera }),
    saveCamera: (pageId: string, camera: Camera) => invoke('save_camera', { pageId, camera }),
    savePageSync: () => { throw new Error('Wait for the page to finish saving before closing.'); },
    setPageStyle: (pageId: string, style: PaperStyle) => invoke('set_page_style', { pageId, style }),
    setFullScreen: (enabled: boolean) => appWindow.setFullscreen(enabled),
    windowAction: async (action) => {
      if (action === 'minimize') { await appWindow.minimize(); return false; }
      if (action === 'maximize') { await appWindow.toggleMaximize(); return appWindow.isMaximized(); }
      const pending: Promise<void>[] = [];
      window.dispatchEvent(new CustomEvent('omninote:flush-save', { detail: { waitUntil: (save: Promise<void>) => pending.push(save) } }));
      await Promise.all(pending);
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
    getUpdateStatus: async () => updateStatus,
    checkForUpdates: async () => updateStatus,
    promptToInstallUpdate: async () => updateStatus,
    onUpdateStatus: () => () => {},
    listExtensions: async () => [],
    searchMarketplace: async () => ({ configured: false, entries: [] }),
    openWorkspaceFolder: () => invoke('open_workspace_folder'),
    revealNode: (nodeId: string) => invoke('reveal_node', { nodeId }),
    createDocumentPage: (sectionId: string, assetId: string) => invoke('create_document_page', { sectionId, assetId }),
    renameNode: (nodeId: string, title: string) => invoke('rename_node', { nodeId, title }),
    setFolderAppearance: (nodeId: string, icon, color: string) => invoke('set_folder_appearance', { nodeId, icon, color }),
    deleteNode: (nodeId: string) => invoke('delete_node', { nodeId }),
    moveNode: (nodeId: string, parentId: string | null, beforeId?: string | null) => invoke('move_node', { nodeId, parentId, beforeId: beforeId ?? null }),
    importAsset: (name: string, mimeType: string, bytes: Uint8Array) => invoke('import_asset', { name, mimeType, bytes: Array.from(bytes) }),
    pickAssets: () => invoke('pick_assets'),
    readAsset: async (assetId: string) => new Uint8Array(await invoke<number[]>('read_asset', { assetId })),
    copyImage: async (assetId: string) => {
      const bytes = new Uint8Array(await invoke<number[]>('read_asset', { assetId }));
      const bitmap = await createImageBitmap(new Blob([bytes]));
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
    installMarketplaceExtension: () => unavailable('Extension installation'),
    extensionSource: () => unavailable('Extensions'),
    extensionResource: () => unavailable('Extensions'),
    enableExtension: () => unavailable('Extensions'),
    setExtensionSetting: () => unavailable('Extensions'),
    saveExtensionExport: () => unavailable('Extension export'),
    exportWorkspace: () => invoke('export_workspace'),
    exportPagePdf: () => unavailable('PDF export'),
  };
}
