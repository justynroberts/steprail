// MIT License - Copyright (c) fintonlabs.com
// Small, dependency-free hardening: security response headers and an in-memory
// per-IP rate limiter for the public surfaces (hooks, forms, compose, MCP).

// Baseline headers on every response. Deliberately conservative but safe for
// both the SPA and the server-rendered forms (which load Inter from rsms.me).
export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-XSS-Protection', '0') // modern browsers: disable the legacy auditor
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
  // (No Cross-Origin-Opener-Policy: it's ignored on plain-HTTP origins and only
  // logs a console error — steprail serves HTTP by default behind your network.)
  next()
}

// A Content-Security-Policy tuned for the hosted form pages, whose sources we
// control exactly: our own assets, inline styles, and the rsms.me webfont.
export const FORM_CSP =
  "default-src 'self'; " +
  "img-src 'self' data: https:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "font-src 'self' https://rsms.me; " +
  "style-src-elem 'self' 'unsafe-inline' https://rsms.me; " +
  "script-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"

// Sliding-window limiter keyed by client IP: 429 + Retry-After once a client
// exceeds `max` requests per `windowMs`. In-memory and swept, so it stays
// bounded without a datastore — a fit for the single-process model. A shared
// sweeper (below) keeps every limiter's map from growing unbounded.
const registry = []
export function makeLimiter(opts) {
  const hits = new Map()
  registry.push(hits)
  const windowMs = opts.windowMs
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    const now = Date.now()
    let b = hits.get(ip)
    if (!b || now >= b.resetAt) { b = { count: 0, resetAt: now + windowMs }; hits.set(ip, b) }
    b.count++
    if (b.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)))
      return res.status(429).json({ error: `Too many ${opts.name || 'requests'} — slow down and retry shortly.` })
    }
    next()
  }
}

export function startRateLimitSweeper(intervalMs = 60_000) {
  const timer = setInterval(() => {
    const now = Date.now()
    for (const hits of registry) for (const [ip, b] of hits) if (now >= b.resetAt) hits.delete(ip)
  }, intervalMs)
  timer.unref?.()
  return timer
}
