import { useEffect, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';

export type FullscreenScope = 'current' | 'both';

export default function FullscreenControl({ splitView, onEnter }: { splitView: boolean; onEnter(scope: FullscreenScope): void }) {
  const [open, setOpen] = useState(false);
  const control = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!control.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', escape); };
  }, [open]);

  return <div className="fullscreen-control" ref={control}>
    <button title="Full screen" aria-label="Full screen" aria-haspopup={splitView ? 'menu' : undefined} aria-expanded={splitView ? open : undefined} onClick={() => splitView ? setOpen((before) => !before) : onEnter('current')}><Maximize2 size={16} /></button>
    {splitView && open && <div className="fullscreen-menu" role="menu">
      <button role="menuitem" onClick={() => { setOpen(false); onEnter('current'); }}>Full screen current tab</button>
      <button role="menuitem" onClick={() => { setOpen(false); onEnter('both'); }}>Full screen both tabs</button>
    </div>}
  </div>;
}
