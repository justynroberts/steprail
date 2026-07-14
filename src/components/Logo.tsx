// MIT License - Copyright (c) fintonlabs.com
// The steprail mark: a rail with three steps landing on nodes.
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-label="steprail">
      <path d="M6 3v18" />
      <path d="M6 6h8" />
      <path d="M6 12h11" />
      <path d="M6 18h8" />
      <circle cx="17" cy="6" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="20" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="17" cy="18" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}
