import { useEffect, useMemo, useRef } from 'react';
import { FileText, Search, X } from 'lucide-react';
import type { Snapshot } from './types';
import { searchWorkspace, type SearchHit } from './workspaceSearch';

export default function SearchPanel({ snapshot, activePageId, mode, query, focusToken, onModeChange, onQueryChange, onOpen, onClose }: {
  snapshot: Snapshot; activePageId: string | null; mode: 'tab' | 'notebook'; query: string; focusToken: number;
  onModeChange(mode: 'tab' | 'notebook'): void; onQueryChange(query: string): void; onOpen(hit: SearchHit): void; onClose(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchWorkspace(snapshot, mode, activePageId, query), [snapshot, mode, activePageId, query]);
  useEffect(() => input.current?.focus(), [focusToken, mode]);
  return <div className="workspace-search-panel">
    <div className="sidebar-title"><span>SEARCH</span><button className="icon-button small" aria-label="Close search" onClick={onClose}><X size={15} /></button></div>
    <div className="search-scope" role="group" aria-label="Search scope"><button className={mode === 'tab' ? 'active' : ''} aria-pressed={mode === 'tab'} onClick={() => onModeChange('tab')}>Current tab</button><button className={mode === 'notebook' ? 'active' : ''} aria-pressed={mode === 'notebook'} onClick={() => onModeChange('notebook')}>Notebook</button></div>
    <label className="extension-search"><Search size={15} /><input ref={input} aria-label={mode === 'tab' ? 'Search current tab' : 'Search notebook'} placeholder={mode === 'tab' ? 'Find in current tab' : 'Find in notebook'} value={query} onChange={(event) => onQueryChange(event.target.value)} />{query && <button title="Clear search" aria-label="Clear search" onClick={() => { onQueryChange(''); input.current?.focus(); }}><X size={14} /></button>}</label>
    <div className="workspace-search-results" role="region" aria-live="polite" aria-label="Search results">
      {!query.trim() ? <p>Search page titles, notes, and file names.</p> : hits.length ? <>{hits.map((hit, index) => <button key={`${hit.pageId}:${hit.objectId ?? hit.kind}:${index}`} className="workspace-search-result" onClick={() => onOpen(hit)}><FileText size={15} aria-hidden="true" /><span><strong>{hit.title}</strong>{hit.excerpt && <small>{hit.excerpt}</small>}</span></button>)}{hits.length === 100 && <p>Showing the first 100 matches.</p>}</> : <p>No matches in this {mode === 'tab' ? 'tab' : 'notebook'}.</p>}
    </div>
  </div>;
}
