import type { ExtensionInfo } from './types';

export const previewFormats = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'markdown', 'html', 'htm']);

export function documentViewer(format: string, extensions: ExtensionInfo[]) {
  for (const extension of extensions) {
    if (!extension.enabled || !extension.grantedPermissions.includes('asset.read')) continue;
    const entry = extension.manifest.contributes.documentViewers?.find((viewer) => viewer.extensions.includes(format));
    if (entry) return { extension, entry: entry.entry };
  }
  return undefined;
}
