// MIT License - Copyright (c) fintonlabs.com
// Form definitions and the hosted form page. A form is a small JSON list a
// person builds field-by-field in the editor (or an LLM writes) — the server
// renders it as a real page and submissions start runs.

export const FORM_FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'long', label: 'Long text' },
  { value: 'email', label: 'Email' },
  { value: 'number', label: 'Number' },
  { value: 'choice', label: 'Choice' },
  { value: 'yesno', label: 'Yes / no' },
]

export const slugKey = label =>
  String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field'

// Tolerant parse of the fields JSON: always returns a clean array.
export function parseFormFields(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(f => f && typeof f === 'object' && (f.label || f.key))
      .map(f => ({
        key: slugKey(f.key || f.label),
        label: String(f.label || f.key),
        type: FORM_FIELD_TYPES.some(t => t.value === f.type) ? f.type : 'text',
        required: Boolean(f.required),
        options: typeof f.options === 'string' ? f.options : '',
        // Dynamic choice: fetch options from an API at form-render time.
        optionsUrl: typeof f.optionsUrl === 'string' ? f.optionsUrl : '',
        optionsPath: typeof f.optionsPath === 'string' ? f.optionsPath : '',
        optionsLabel: typeof f.optionsLabel === 'string' ? f.optionsLabel : '',
        optionsValue: typeof f.optionsValue === 'string' ? f.optionsValue : '',
      }))
  } catch {
    return []
  }
}

// Walk a dot-path into a value ("data.items" → obj.data.items).
const dig = (obj, path) => (path || '').split('.').filter(Boolean).reduce((v, k) => (v == null ? v : v[k]), obj)

// Map a fetched JSON payload into [{value, label}] for a dynamic choice field.
// Handles: array of strings, array of objects (mapped via optionsLabel/
// optionsValue or sensible defaults), and plain { value: label } objects.
export function optionsFromResponse(field, data) {
  const arr = field.optionsPath ? dig(data, field.optionsPath) : data
  if (arr && !Array.isArray(arr) && typeof arr === 'object') {
    return Object.entries(arr).map(([value, label]) => ({ value: String(value), label: String(label) })).slice(0, 500)
  }
  if (!Array.isArray(arr)) return []
  const lk = field.optionsLabel?.trim(), vk = field.optionsValue?.trim()
  return arr.map(item => {
    if (item == null) return null
    if (typeof item !== 'object') return { value: String(item), label: String(item) }
    const value = vk ? item[vk] : (item.value ?? item.id ?? item.key ?? Object.values(item)[0])
    const label = lk ? item[lk] : (item.label ?? item.name ?? item.title ?? value)
    return value == null ? null : { value: String(value), label: String(label ?? value) }
  }).filter(Boolean).slice(0, 500)
}

export function exampleValue(field) {
  switch (field.type) {
    case 'email': return 'sam@example.com'
    case 'number': return 42
    case 'choice': return (field.options || 'first option').split(',')[0].trim()
    case 'yesno': return 'yes'
    case 'long': return 'A longer answer with a couple of sentences.'
    default: return 'Sample answer'
  }
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Every visual choice hangs off these variables so branding (global) and
// per-form CSS overrides have a stable surface to restyle.
const PAGE_CSS = `
  :root { --form-accent: #5e6ad2; --form-bg: #f7f8f8; --form-card: #fff; --form-text: #16181c;
    --form-muted: #6f7680; --form-border: #e2e4e8; --form-field: #f3f4f5; --form-radius: 12px; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--form-bg); color: var(--form-text); font-family: 'Inter var', 'Inter', -apple-system, system-ui, sans-serif;
    font-feature-settings: 'cv01', 'ss03'; padding: 24px; }
  .card { width: 100%; max-width: 460px; background: var(--form-card); border: 1px solid var(--form-border);
    border-radius: var(--form-radius); padding: 28px; box-shadow: 0 1px 3px rgba(20,22,26,0.06); }
  .logo { display: block; max-height: 36px; max-width: 180px; margin: 0 0 18px; }
  h1 { font-size: 22px; font-weight: 510; letter-spacing: -0.4px; margin: 0 0 6px; }
  .desc { color: var(--form-muted); font-size: 14px; margin: 0 0 22px; line-height: 1.5; }
  label { display: block; font-size: 11px; font-weight: 590; text-transform: uppercase; letter-spacing: 0.5px;
    color: var(--form-muted); margin: 14px 0 5px; }
  label .req { color: var(--form-accent); }
  input, textarea, select { width: 100%; background: var(--form-field); border: 1px solid var(--form-border);
    border-radius: 6px; padding: 9px 11px; font: inherit; font-size: 14px; outline: none; }
  input:focus, textarea:focus, select:focus { border-color: var(--form-accent); background: var(--form-card); }
  textarea { min-height: 92px; resize: vertical; }
  button { margin-top: 22px; width: 100%; background: var(--form-accent); color: #fff; border: none; border-radius: 6px;
    padding: 11px; font: inherit; font-size: 14.5px; font-weight: 590; cursor: pointer; }
  button:hover { filter: brightness(0.92); }
  .ok { text-align: center; padding: 12px 0; }
  .ok .tick { font-size: 40px; color: #0f9d6e; }
  .brand { text-align: center; margin-top: 16px; font-size: 11px; color: #9ba0a8; }
`

const HEX = /^#[0-9a-fA-F]{3,8}$/
// Custom CSS is operator-authored (same trust as flow config); the only thing
// we must prevent is breaking out of the <style> element.
const safeCss = css => String(css || '').replace(/<\s*\//g, '<\\/')

// Compose the page <style>: base rules, then global branding (accent + CSS
// from Setup), then this form's own CSS override — last one wins.
function pageStyles(config, branding = {}) {
  const layers = [PAGE_CSS]
  if (HEX.test(branding.accent || '')) layers.push(`:root { --form-accent: ${branding.accent}; }`)
  if (branding.formCss) layers.push(safeCss(branding.formCss))
  if (config.css) layers.push(safeCss(config.css))
  return layers.join('\n')
}

const logoTag = branding =>
  branding?.logoUrl ? `<img class="logo" src="${esc(branding.logoUrl)}" alt="${esc(branding.name || 'logo')}"/>` : ''

const brandLine = branding =>
  branding?.hideBadge ? '' : `<div class="brand">powered by ${esc(branding?.name || 'steprail')}</div>`

// resolvedOptions: optional { fieldKey: [{value,label}] } for dynamic choice
// fields whose options were fetched from an API (see optionsFromResponse).
export function renderFormHtml(config, branding = {}, resolvedOptions = {}) {
  const fields = parseFormFields(config.fields)
  const inputs = fields.map(f => {
    const req = f.required ? ' required' : ''
    const label = `<label>${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>`
    if (f.type === 'long') return `${label}<textarea name="${esc(f.key)}"${req}></textarea>`
    if (f.type === 'choice') {
      const dyn = resolvedOptions[f.key]
      const opts = (dyn && dyn.length)
        ? dyn
        : (f.options || '').split(',').map(o => o.trim()).filter(Boolean).map(o => ({ value: o, label: o }))
      return `${label}<select name="${esc(f.key)}"${req}>${opts.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`
    }
    if (f.type === 'yesno') return `${label}<select name="${esc(f.key)}"><option>yes</option><option>no</option></select>`
    const type = f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : 'text'
    return `${label}<input type="${type}" name="${esc(f.key)}"${req} />`
  }).join('\n')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="preconnect" href="https://rsms.me/"/><link rel="stylesheet" href="https://rsms.me/inter/inter.css"/>
<title>${esc(config.title || 'Form')}</title><style>${pageStyles(config, branding)}</style></head><body>
<form class="card" method="POST">
  ${logoTag(branding)}
  <h1>${esc(config.title || 'Form')}</h1>
  ${config.description ? `<p class="desc">${esc(config.description)}</p>` : ''}
  ${inputs}
  <button type="submit">${esc(config.button || 'Send')}</button>
  ${brandLine(branding)}
</form></body></html>`
}

export function renderFormSuccessHtml(config, branding = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="preconnect" href="https://rsms.me/"/><link rel="stylesheet" href="https://rsms.me/inter/inter.css"/>
<title>Thanks</title><style>${pageStyles(config, branding)}</style></head><body>
<div class="card ok"><div class="tick">✓</div>
  <h1>${esc(config.thanks || 'Got it — thank you!')}</h1>
  <p class="desc">Your answers are on their way.</p>
  ${brandLine(branding)}
</div></body></html>`
}
