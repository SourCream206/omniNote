import { useState } from 'react';
import { bindingConflict, eventToShortcut, keybindingCommands, shortcutLabel, type KeybindingCommand, type Keybindings } from './keybindings';

export default function KeybindingsSection({ bindings, onChange, onReset }: { bindings: Keybindings; onChange(command: KeybindingCommand, shortcut: string): void; onReset(): void }) {
  const [recording, setRecording] = useState<KeybindingCommand | null>(null);
  const [error, setError] = useState('');
  return <details className="settings-keybindings"><summary>Keyboard shortcuts</summary><div className="settings-keybinding-content">
    {keybindingCommands.map((command, index) => <div key={command.id}>
      {(index === 0 || keybindingCommands[index - 1].group !== command.group) && <div className="keybinding-group">{command.group}</div>}
      <div className="keybinding-row"><span>{command.label}</span><button type="button" data-shortcut-capture={recording === command.id ? '' : undefined} aria-label={`Change shortcut for ${command.label}`} aria-pressed={recording === command.id} onClick={() => { setRecording(command.id); setError(''); }} onBlur={() => setRecording(null)} onKeyDownCapture={(event) => {
        if (recording !== command.id) return;
        if (event.key === 'Tab') { setRecording(null); return; }
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') { setRecording(null); setError(''); return; }
        if (event.key === 'Backspace' || event.key === 'Delete') { onChange(command.id, ''); setRecording(null); setError(''); return; }
        const shortcut = eventToShortcut(event.nativeEvent);
        if (!shortcut) return;
        const conflict = bindingConflict(bindings, command.id, shortcut);
        if (conflict) { setError(conflict === 'reserved' ? `${shortcutLabel(shortcut)} is reserved.` : `${shortcutLabel(shortcut)} is used by ${keybindingCommands.find((item) => item.id === conflict)?.label}.`); return; }
        onChange(command.id, shortcut); setRecording(null); setError('');
      }}>{recording === command.id ? 'Press keys…' : shortcutLabel(bindings[command.id])}</button></div>
    </div>)}
    {error && <p className="keybinding-error" role="alert">{error}</p>}
    <div className="keybinding-footer"><span>Escape cancels · Backspace clears</span><button onClick={() => { onReset(); setRecording(null); setError(''); }}>Restore defaults</button></div>
  </div></details>;
}
