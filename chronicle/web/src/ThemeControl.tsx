import { useEffect, useId, useSyncExternalStore } from 'react';
import { ThemeController, themePreference } from './theme.ts';
export function ThemeControl({ controller }: { controller: ThemeController }) {
  const theme = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot), statusId = useId(), selectId = useId();
  useEffect(() => controller.start(), [controller]);
  const unavailable = theme.persistence === 'unavailable', invalid = theme.persistence === 'invalid';
  return <details className="theme-control"><summary aria-label="Theme settings" aria-describedby={unavailable || invalid ? statusId : undefined}>Theme <span className="theme-label">{theme.preference}</span>{unavailable && <small>Not saved</small>}{invalid && <small>Invalid saved setting</small>}</summary>
    <div className="theme-menu"><label htmlFor={selectId}>Color theme</label><select id={selectId} value={theme.preference} onChange={event => { const value = themePreference(event.target.value); if (value === null) throw new Error('Unknown theme preference'); controller.setPreference(value); }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
      <p className="tiny muted">System follows your device’s light or dark appearance.</p>
      {(unavailable || invalid) && <p className="tiny theme-save-warning" role="status" id={statusId}>{unavailable ? 'Theme preference cannot be saved in this browser. Your choice applies to this tab until it is reloaded.' : 'The saved theme preference is invalid. Using System until you choose a theme.'}</p>}
    </div>
  </details>;
}
