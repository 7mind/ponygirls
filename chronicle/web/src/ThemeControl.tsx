import { Anchored } from './Popover.tsx';
import { Icon, type IconName } from './Icon.tsx';
import { useEffect, useId, useSyncExternalStore } from 'react';
import type { ThemeController, ThemePreference } from './theme.ts';
const CHOICES: readonly { preference: ThemePreference; label: string; icon: IconName }[] = [
  { preference: 'system', label: 'System', icon: 'monitor' }, { preference: 'light', label: 'Light', icon: 'sun' }, { preference: 'dark', label: 'Dark', icon: 'moon' },
];
export function ThemeControl({ controller }: { controller: ThemeController }) {
  const theme = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot), statusId = useId();
  useEffect(() => controller.start(), [controller]);
  const unavailable = theme.persistence === 'unavailable', invalid = theme.persistence === 'invalid', warning = unavailable || invalid;
  return <Anchored className="theme-control" buttonClassName={warning ? 'btn btn-ghost theme-trigger' : 'btn btn-ghost btn-icon theme-trigger'} buttonState={undefined} ariaLabel="Theme settings" describedBy={warning ? statusId : undefined} panel="menu" panelClassName="menu theme-menu" panelLabel={undefined}
    label={<><Icon name={theme.resolved === 'dark' ? 'moon' : 'sun'} small={false}/>{unavailable && <span className="theme-warning">Not saved</span>}{invalid && <span className="theme-warning">Invalid saved setting</span>}</>}>
    {CHOICES.map(choice => <button type="button" role="menuitemradio" className="menu-item" aria-checked={theme.preference === choice.preference} key={choice.preference} onClick={() => controller.setPreference(choice.preference)}><Icon name={choice.icon} small={false}/>{choice.label}</button>)}
    <div className="menu-sep" role="separator"/>
    <p className="menu-note">System follows your device’s light or dark appearance.</p>
    {warning && <p className="menu-note theme-warning" role="status" id={statusId}>{unavailable ? 'Theme preference cannot be saved in this browser. Your choice applies to this tab until it is reloaded.' : 'The saved theme preference is invalid. Using System until you choose a theme.'}</p>}
  </Anchored>;
}
