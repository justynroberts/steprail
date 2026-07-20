// MIT License - Copyright (c) fintonlabs.com
// StepHan's mark. Prefers a custom PNG dropped at public/stephan.png (served at
// /stephan.png); if that's absent it falls back to the built-in SVG face — so
// the app always shows something and lights up the moment the PNG is added.
import { useState } from 'react'

export function StepHanLogo({ size = 22 }: { size?: number }) {
  const [pngFailed, setPngFailed] = useState(false)
  if (!pngFailed) {
    return (
      <img
        src="/stephan.png"
        width={size}
        height={size}
        alt="StepHan"
        style={{ objectFit: 'contain', display: 'block', borderRadius: 6 }}
        onError={() => setPngFailed(true)}
      />
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      aria-label="StepHan"
    >
      {/* Head — rounded square, feels approachable not cold */}
      <rect x="4" y="7" width="28" height="24" rx="8" fill="currentColor" opacity="0.18" />
      <rect x="4" y="7" width="28" height="24" rx="8" stroke="currentColor" strokeWidth="1.8" />

      {/* Antenna */}
      <line x1="18" y1="7" x2="18" y2="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="18" cy="2" r="2" fill="currentColor" />

      {/* Eyes — slightly uneven for personality */}
      <circle cx="13" cy="17" r="2.2" fill="currentColor" />
      <circle cx="23" cy="17" r="2.2" fill="currentColor" />
      {/* Eye shine */}
      <circle cx="14" cy="16" r="0.8" fill="white" opacity="0.7" />
      <circle cx="24" cy="16" r="0.8" fill="white" opacity="0.7" />

      {/* Smile — warm, not a flat line */}
      <path
        d="M12 22 Q18 27 24 22"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />

      {/* Cheek blush dots — makes it human */}
      <circle cx="9" cy="22" r="1.5" fill="currentColor" opacity="0.25" />
      <circle cx="27" cy="22" r="1.5" fill="currentColor" opacity="0.25" />
    </svg>
  )
}
