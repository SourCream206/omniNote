import type { CanvasObject, Snapshot, TreeNode } from './types';

export type SearchMode = 'open' | 'tab' | 'notebook';
export interface SearchHit { pageId: string; objectId?: string; title: string; excerpt: string; kind: 'page' | 'note' | 'file' }
type SearchSnapshot = Pick<Snapshot, 'nodes' | 'objects' | 'assets' | 'documentPages'>;

function textOf(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const node = value as { text?: unknown; content?: unknown[] };
  if (typeof node.text === 'string') return node.text;
  return Array.isArray(node.content) ? node.content.map(textOf).join(' ') : '';
}

function notebookFor(nodes: Map<string, TreeNode>, pageId: string | null): string | null {
  let current = pageId ? nodes.get(pageId) : undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.kind === 'notebook') return current.id;
    seen.add(current.id);
    current = current.parent_id ? nodes.get(current.parent_id) : undefined;
  }
  return null;
}

function excerpt(value: string, query: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  const index = clean.toLocaleLowerCase().indexOf(query);
  if (index < 0) return clean.slice(0, 110);
  const start = Math.max(0, index - 36);
  return `${start ? '…' : ''}${clean.slice(start, start + 110)}${start + 110 < clean.length ? '…' : ''}`;
}

function objectText(object: CanvasObject): string {
  if (object.type === 'text') return textOf((object.payload as { doc?: unknown }).doc);
  if (['document', 'image', 'audio', 'video'].includes(object.type)) return String((object.payload as { name?: string }).name ?? '');
  return '';
}

export function searchWorkspace(snapshot: SearchSnapshot, mode: SearchMode, activePageId: string | null, input: string): SearchHit[] {
  const query = input.trim().toLocaleLowerCase();
  if (!query && mode !== 'open') return [];
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const notebookId = notebookFor(nodes, activePageId) ?? snapshot.nodes.find((node) => node.kind === 'notebook')?.id ?? null;
  const hits: SearchHit[] = [];
  const objectsByPage = new Map<string, CanvasObject[]>();
  if (mode !== 'open') for (const object of snapshot.objects) {
    if (!['text', 'document', 'image', 'audio', 'video'].includes(object.type)) continue;
    const objects = objectsByPage.get(object.page_id) ?? [];
    objects.push(object);
    objectsByPage.set(object.page_id, objects);
  }
  const assetNames = new Map(snapshot.assets.map((asset) => [asset.id, asset.original_name]));
  const documentNames = new Map(snapshot.documentPages.map((item) => [item.page_id, assetNames.get(item.asset_id) ?? '']));
  for (const page of snapshot.nodes) {
    if (page.kind !== 'page' || mode === 'tab' && page.id !== activePageId || mode === 'notebook' && notebookFor(nodes, page.id) !== notebookId) continue;
    if (!query || page.title.toLocaleLowerCase().includes(query)) hits.push({ pageId: page.id, title: page.title, excerpt: mode === 'open' ? '' : 'Page title', kind: 'page' });
    if (mode !== 'open') {
      const fileName = documentNames.get(page.id) ?? '';
      if (fileName.toLocaleLowerCase().includes(query) && fileName !== page.title) hits.push({ pageId: page.id, title: page.title, excerpt: fileName, kind: 'file' });
      for (const object of objectsByPage.get(page.id) ?? []) {
        const content = objectText(object);
        if (content.toLocaleLowerCase().includes(query)) hits.push({ pageId: page.id, objectId: object.id, title: page.title, excerpt: excerpt(content, query), kind: object.type === 'text' ? 'note' : 'file' });
        if (hits.length >= 100) return hits;
      }
    }
    if (hits.length >= 100) return hits;
  }
  return hits;
}
