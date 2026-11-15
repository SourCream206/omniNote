import type { CanvasTool } from './types';

export const keybindingCommands = [
  { id: 'tab.open', label: 'New tab', group: 'Workspace' },
  { id: 'tab.close', label: 'Close current tab', group: 'Workspace' },
  { id: 'page.new', label: 'New page', group: 'Workspace' },
  { id: 'search.tab', label: 'Search current tab', group: 'Search' },
  { id: 'search.notebook', label: 'Search notebook', group: 'Search' },
  { id: 'tool.select', label: 'Select', group: 'Tools' },
  { id: 'tool.text', label: 'Text', group: 'Tools' },
  { id: 'tool.pen', label: 'Pen', group: 'Tools' },
  { id: 'tool.highlighter', label: 'Highlight', group: 'Tools' },
  { id: 'tool.eraser', label: 'Erase', group: 'Tools' },
  { id: 'tool.lasso', label: 'Lasso', group: 'Tools' },
  { id: 'tool.hand', label: 'Pan', group: 'Tools' },
] as const;

export type KeybindingCommand = (typeof keybindingCommands)[number]['id'];
export type Keybindings = Record<KeybindingCommand, string>;
export const DEFAULT_BINDINGS: Keybindings = {
  'tab.open': 'Mod+T', 'tab.close': 'Mod+W', 'page.new': 'Mod+N',
  'search.tab': 'Mod+F', 'search.notebook': 'Mod+Shift+F',
  'tool.select': 'V', 'tool.text': 'T', 'tool.pen': 'P',
  'tool.highlighter': 'H', 'tool.eraser': 'E', 'tool.lasso': 'L', 'tool.hand': 'G',
};

type KeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> & { getModifierState?(key: string): boolean };
const allowedKey = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|[./,;\[\]\-=])$/;
const reserved = new Set(['Mod+Z', 'Mod+Shift+Z', 'Mod+Y', 'Mod+C', 'Mod+X', 'Mod+V', 'Mod+G', 'Mod+R', 'Space', 'Escape', 'Delete', 'Backspace', 'F5']);
const bindingPattern = /^(?:Mod\+)?(?:Alt\+)?(?:Shift\+)?(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|[./,;\[\]\-=])$/;

export function eventToShortcut(event: KeyEvent): string | null {
  if (event.getModifierState?.('AltGraph')) return null;
  const key = event.key.toUpperCase();
  if (!allowedKey.test(key)) return null;
  return `${event.ctrlKey || event.metaKey ? 'Mod+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${key}`;
}

export function commandForEvent(event: KeyEvent, bindings: Keybindings): KeybindingCommand | null {
  const shortcut = eventToShortcut(event);
  if (!shortcut) return null;
  return keybindingCommands.find((command) => bindings[command.id] === shortcut)?.id ?? null;
}

export function bindingConflict(bindings: Keybindings, command: KeybindingCommand, shortcut: string): KeybindingCommand | 'reserved' | null {
  if (!shortcut) return null;
  if (!bindingPattern.test(shortcut) || reserved.has(shortcut)) return 'reserved';
  return keybindingCommands.find((item) => item.id !== command && bindings[item.id] === shortcut)?.id ?? null;
}

export function readKeybindings(storage: Pick<Storage, 'getItem'> = localStorage): Keybindings {
  const bindings = { ...DEFAULT_BINDINGS };
  try {
    const saved = JSON.parse(storage.getItem('omninote.keybindings') ?? '{}') as Record<string, unknown>;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return bindings;
    for (const [id, shortcut] of Object.entries(saved)) {
      if (!keybindingCommands.some((command) => command.id === id) || typeof shortcut !== 'string') continue;
      const command = id as KeybindingCommand;
      if (!bindingConflict(bindings, command, shortcut)) bindings[command] = shortcut;
    }
  } catch { /* Ignore invalid saved preferences. */ }
  return bindings;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as { isContentEditable?: boolean; closest?(selector: string): unknown } | null;
  return Boolean(element?.isContentEditable || element?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

export function shortcutLabel(shortcut: string): string {
  const mac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
  return shortcut ? shortcut.replace('Mod', mac ? '⌘' : 'Ctrl').replaceAll('+', mac ? ' ' : ' + ') : 'Unassigned';
}

export function toolForCommand(command: KeybindingCommand): CanvasTool | null {
  return command.startsWith('tool.') ? command.slice(5) as CanvasTool : null;
}
