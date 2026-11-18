// Icons of the shared sprite (shared/ui-web/icons.js, served as /ui/icons.svg); decorative, never the only label.
export type IconName = 'book' | 'sun' | 'moon' | 'monitor' | 'user' | 'users' | 'key' | 'arrow-right' | 'chevron-down' | 'refresh' | 'search' | 'x' | 'columns' | 'alert' | 'arrow-up' | 'arrow-left' | 'arrow-down' | 'chevron-up' | 'panel' | 'more' | 'copy' | 'link' | 'info' | 'hash' | 'check';
const SPRITE = '/ui/icons.svg';
export function Icon({ name, small }: { name: IconName; small: boolean }) {
  return <svg className={small ? 'icon icon-sm' : 'icon'} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href={`${SPRITE}#${name}`}/></svg>;
}
