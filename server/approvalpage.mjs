// MIT License - Copyright (c) fintonlabs.com
// Server-rendered hosted approval page (like hosted forms): public but
// token-gated, strict CSP, escape-first. Shows what's being approved (the
// decision context) and Approve / Reject-with-reason actions that POST back to
// /approve/<token>. No secrets are ever rendered here.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const brand = (branding = {}) => {
  const accent = branding.accent && /^#[0-9a-fA-F]{3,8}$/.test(branding.accent) ? branding.accent : '#5e6ad2'
  const name = branding.productName || 'steprail'
  return { accent, name }
}

const STYLES = accent => `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090a;color:#f7f8f8;
  font-family:Inter,system-ui,sans-serif;font-feature-settings:'cv01','ss03';padding:24px}
.card{width:100%;max-width:560px;background:#111214;border:1px solid rgba(255,255,255,.08);
  border-radius:14px;padding:28px}
.eyebrow{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#8a8f98;margin:0 0 6px}
h1{font-size:20px;font-weight:590;margin:0 0 4px}
.sub{color:#8a8f98;font-size:13px;margin:0 0 18px}
.message{font-size:15px;line-height:1.55;color:#e6e8eb;white-space:pre-wrap;margin:0 0 18px;
  padding:14px 16px;background:#0b0c0d;border:1px solid rgba(255,255,255,.07);border-radius:9px}
.ctx-label{font-size:12px;color:#8a8f98;margin:16px 0 6px}
pre{background:#0b0c0d;border:1px solid rgba(255,255,255,.07);border-radius:9px;padding:12px;
  font-size:12px;line-height:1.5;overflow:auto;max-height:280px;margin:0 0 16px;white-space:pre-wrap;word-break:break-word}
label{display:block;font-size:12px;color:#8a8f98;margin:14px 0 6px}
textarea{width:100%;min-height:70px;background:#0b0c0d;border:1px solid rgba(255,255,255,.1);
  border-radius:8px;color:#f7f8f8;padding:10px;font:inherit;font-size:13px;resize:vertical}
.row{display:flex;gap:10px;margin-top:18px}
button{flex:1;border:0;border-radius:9px;padding:11px;font:inherit;font-weight:590;font-size:14px;cursor:pointer}
.approve{background:${esc(accent)};color:#fff}
.reject{background:transparent;border:1px solid rgba(239,68,68,.5);color:#f87171}
.note{margin:18px 0 0;font-size:12px;color:#6b7280}
.done{text-align:center}
.big{font-size:34px;margin:0 0 10px}
`

export function renderApprovalHtml(data, branding = {}) {
  const { accent, name } = brand(branding)
  const ctx = data.context
  const ctxBlock = ctx
    ? `<div class="ctx-label">What you're approving — ${esc(ctx.label)}</div><pre>${esc(typeof ctx.data === 'string' ? ctx.data : JSON.stringify(ctx.data, null, 2)).slice(0, 4000)}</pre>`
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="preconnect" href="https://rsms.me/"/><link rel="stylesheet" href="https://rsms.me/inter/inter.css"/>
<title>${esc(name)} — approval</title><style>${STYLES(accent)}</style></head><body>
<form class="card" method="POST">
  <p class="eyebrow">${esc(name)} · approval</p>
  <h1>${esc(data.stepName)}</h1>
  <p class="sub">Flow “${esc(data.flowName)}” · requested of ${esc(data.approver)}</p>
  ${data.message ? `<div class="message">${esc(data.message)}</div>` : ''}
  ${ctxBlock}
  <label for="reason">Reason (required to reject)</label>
  <textarea id="reason" name="reason" placeholder="Why you're approving or rejecting…"></textarea>
  <div class="row">
    <button class="approve" type="submit" name="decision" value="approve">Approve</button>
    <button class="reject" type="submit" name="decision" value="reject">Reject</button>
  </div>
  <p class="note">This link is signed for ${esc(data.approver)} and is single-use.</p>
</form></body></html>`
}

// Shown on the PUBLIC page when sign-in is required: the public page can't act,
// so send the approver into the authenticated app (behind the login gate).
export function renderApprovalSignInHtml(appHref, branding = {}) {
  const { accent, name } = brand(branding)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="preconnect" href="https://rsms.me/"/><link rel="stylesheet" href="https://rsms.me/inter/inter.css"/>
<title>${esc(name)} — sign in to approve</title><style>${STYLES(accent)}</style></head><body>
<div class="card done">
  <p class="eyebrow">${esc(name)} · approval</p>
  <h1>Sign in to approve</h1>
  <p class="sub">This approval requires a signed-in ${esc(name)} account. Open it in the app to review and decide.</p>
  <div class="row"><a class="approve" style="text-decoration:none;text-align:center;line-height:1.3" href="${esc(appHref)}">Open in ${esc(name)} →</a></div>
</div></body></html>`
}

export function renderApprovalDoneHtml(kind, detail, branding = {}) {
  const { accent, name } = brand(branding)
  const map = {
    // Fixed semantic colours — legible regardless of a white-label accent.
    approved: { icon: '✓', title: 'Approved', color: '#34d399', msg: 'The run has been released to continue.' },
    rejected: { icon: '✕', title: 'Rejected', color: '#f87171', msg: 'The run has been stopped.' },
    expired: { icon: '⌛', title: 'Link no longer valid', color: '#8a8f98', msg: 'This approval was already decided, or the link expired.' },
    error: { icon: '!', title: 'Something went wrong', color: '#f87171', msg: detail || 'Please try again from steprail.' },
  }
  const s = map[kind] || map.error
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="preconnect" href="https://rsms.me/"/><link rel="stylesheet" href="https://rsms.me/inter/inter.css"/>
<title>${esc(name)} — ${esc(s.title)}</title><style>${STYLES(accent)}</style></head><body>
<div class="card done">
  <p class="big" style="color:${esc(s.color)}">${s.icon}</p>
  <h1>${esc(s.title)}</h1>
  <p class="sub">${esc(detail || s.msg)}</p>
</div></body></html>`
}
