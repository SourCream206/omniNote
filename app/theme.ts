export const themes = [
  { id: 'classic', name: 'Classic Light', description: 'Clean blue and white' },
  { id: 'midnight', name: 'Midnight', description: 'Dark workspace, bright paper' },
  { id: 'warm', name: 'Warm Paper', description: 'Soft cream and bronze' },
  { id: 'sage', name: 'Sage', description: 'Quiet green accents' },
] as const;

export type ThemeId = (typeof themes)[number]['id'];

export const themeBackground: Record<ThemeId, string> = { classic: '#f7f8fa', midnight: '#1b222b', warm: '#f6f1e9', sage: '#f0f5f1' };
export const themeAccent: Record<ThemeId, string> = { classic: '#315b93', midnight: '#a6d0f4', warm: '#79552d', sage: '#356a4d' };

export function readTheme(): ThemeId {
  const stored = localStorage.getItem('omninote.theme');
  return themes.find((theme) => theme.id === stored)?.id ?? 'classic';
}
