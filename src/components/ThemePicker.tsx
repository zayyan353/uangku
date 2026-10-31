import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import type { ThemePreference } from '../lib/theme';

export default function ThemePicker({ onNotice }: { onNotice?: (message: string) => void }) {
  const { preference, resolved, choose } = useTheme(onNotice);
  const Icon = preference === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun;
  return <label className="theme-picker" title="Pilih tema tampilan">
    <span className="theme-picker-icon" aria-hidden="true"><Icon size={18} /></span>
    <span className="screen-reader-only">Tema tampilan</span>
    <select aria-label="Tema tampilan" value={preference} onChange={event => choose(event.target.value as ThemePreference)}>
      <option value="system">Sistem</option>
      <option value="light">Terang</option>
      <option value="dark">Gelap</option>
    </select>
  </label>;
}
