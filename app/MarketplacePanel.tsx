import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { MarketplaceEntry, MarketplaceSearch } from './types';

export default function MarketplacePanel({ query, installedIds, search, install }: { query: string; installedIds: Set<string>; search(query: string): Promise<MarketplaceSearch>; install(entry: MarketplaceEntry): Promise<void> }) {
  const [result, setResult] = useState<MarketplaceSearch | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      search(query).then((next) => { if (active) { setResult(next); setError(''); } }).catch(() => { if (active) setError('Marketplace is unavailable. Installed extensions still work offline.'); }).finally(() => { if (active) setLoading(false); });
    }, query ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query, search]);

  async function installEntry(entry: MarketplaceEntry) {
    setInstalling(entry.id);
    try { await install(entry); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setInstalling(null); }
  }

  return <section className="marketplace-section" aria-label="Marketplace">
    <h3>Marketplace</h3>
    {loading && <p className="extensions-empty" role="status">Searching…</p>}
    {error && <p className="extensions-empty" role="alert">{error}</p>}
    {!loading && !error && result && !result.configured && <p className="extensions-empty">Marketplace address is not configured yet.</p>}
    {!loading && !error && result?.configured && !result.entries.length && <p className="extensions-empty">No extensions found.</p>}
    {!loading && !error && result?.entries.map((entry) => <div className="marketplace-entry" key={`${entry.id}@${entry.version}`}>
      <div className="marketplace-entry-copy"><strong>{entry.name}</strong><small>{entry.id} · v{entry.version}</small><p>{entry.summary}</p></div>
      <button type="button" disabled={installedIds.has(entry.id) || installing !== null} onClick={() => void installEntry(entry)} aria-label={`Install ${entry.name}`}><Download size={14} /> {installedIds.has(entry.id) ? 'Installed' : installing === entry.id ? 'Installing…' : 'Install'}</button>
    </div>)}
  </section>;
}
