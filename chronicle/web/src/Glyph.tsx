// Sprite icons of the shared design system (/ui/icons.svg) beyond the shell's Icon.tsx names; decorative, never the only label.
export type GlyphName = 'plus' | 'alert' | 'check' | 'x' | 'play' | 'info' | 'chevron-down' | 'check-circle' | 'more';
const SPRITE = '/ui/icons.svg';
export function Glyph({ name }: { name: GlyphName }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href={`${SPRITE}#${name}`}/></svg>;
}
