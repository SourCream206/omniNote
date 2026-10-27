export const themes = [
  { id: 'classic', name: 'Classic Light', description: 'Clean blue and white' },
  { id: 'midnight', name: 'Midnight', description: 'Dark workspace, bright paper' },
  { id: 'warm', name: 'Warm Paper', description: 'Soft cream and bronze' },
  { id: 'sage', name: 'Sage', description: 'Quiet green accents' },
] as const;

export type ThemeId = (typeof themes)[number]['id'];

export function readTheme(): ThemeId {
  const stored = localStorage.getItem('omninote.theme');
  return themes.find((theme) => theme.id === stored)?.id ?? 'classic';
}
