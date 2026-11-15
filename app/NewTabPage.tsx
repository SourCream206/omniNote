import { useMemo, useRef, useEffect, useState } from 'react';
import { FileText, Plus, Search } from 'lucide-react';
import type { Snapshot } from './types';
import { searchWorkspace } from './workspaceSearch';

export default function NewTabPage({ snapshot, onOpen, onCreate }: { snapshot: Snapshot; onOpen(pageId: string, parentId: string | null): void; onCreate(): void }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchWorkspace(snapshot, 'open', null, query), [snapshot, query]);
  useEffect(() => input.current?.focus(), []);
  return <div className="new-tab-page"><div className="new-tab-content"><h1>Open a page</h1><label className="new-tab-search"><Search size={17} /><input ref={input} aria-label="Find a page to open" placeholder="Find a page…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="new-tab-list">{hits.map((hit) => <button key={hit.pageId} onClick={() => onOpen(hit.pageId, snapshot.nodes.find((node) => node.id === hit.pageId)?.parent_id ?? null)}><FileText size={15} /><span>{hit.title}</span></button>)}{!hits.length && <p>No pages found.</p>}</div><button className="new-tab-create" onClick={onCreate}><Plus size={15} /> New page</button></div></div>;
}
