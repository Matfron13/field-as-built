export const BRAND_MARK = '/brand/field-redline-mark.png';
// Intrinsic size of /brand/field-redline-mark.png. Display height is set in CSS.
const MARK_RATIO = 320 / 260;

export function BrandMark({ className = 'brand-mark', height = 32, ...rest }) {
  const width = Math.round(height * MARK_RATIO);
  return <img className={className} src={BRAND_MARK} alt="" width={width} height={height} {...rest} />;
}

export default function Brand({ big = false, href, mark = 32 }) {
  const cls = big ? 'brand big' : 'brand';
  const inner = <><BrandMark height={mark} />Field Redline</>;
  if (href) return <a className={cls} href={href}>{inner}</a>;
  return <div className={cls}>{inner}</div>;
}
