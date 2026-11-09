// A Bootstrap Icons glyph, exactly as Pallav writes it: <i class="bi bi-name">. The font is vendored in public/pallav.
export function Bi({ name, className = '', style }: { name: string; className?: string; style?: React.CSSProperties }) {
  return <i className={`bi bi-${name}${className ? ` ${className}` : ''}`} style={style} aria-hidden="true" />;
}
