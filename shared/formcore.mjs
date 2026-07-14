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
      }))
  } catch {
    return []
  }
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

const PAGE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #f7f8f8; color: #16181c; font-family: 'Inter var', 'Inter', -apple-system, system-ui, sans-serif;
    font-feature-settings: 'cv01', 'ss03'; padding: 24px; }
  .card { width: 100%; max-width: 460px; background: #fff; border: 1px solid #e2e4e8; border-radius: 12px;
    padding: 28px; box-shadow: 0 1px 3px rgba(20,22,26,0.06); }
  h1 { font-size: 22px; font-weight: 510; letter-spacing: -0.4px; margin: 0 0 6px; }
  .desc { color: #6f7680; font-size: 14px; margin: 0 0 22px; line-height: 1.5; }
  label { display: block; font-size: 11px; font-weight: 590; text-transform: uppercase; letter-spacing: 0.5px;
    color: #6f7680; margin: 14px 0 5px; }
  label .req { color: #5e6ad2; }
  input, textarea, select { width: 100%; background: #f3f4f5; border: 1px solid #e2e4e8; border-radius: 6px;
    padding: 9px 11px; font: inherit; font-size: 14px; outline: none; }
  input:focus, textarea:focus, select:focus { border-color: #5e6ad2; background: #fff; }
  textarea { min-height: 92px; resize: vertical; }
  button { margin-top: 22px; width: 100%; background: #5e6ad2; color: #fff; border: none; border-radius: 6px;
    padding: 11px; font: inherit; font-size: 14.5px; font-weight: 590; cursor: pointer; }
  button:hover { background: #4f5abf; }
  .ok { text-align: center; padding: 12px 0; }
  .ok .tick { font-size: 40px; color: #0f9d6e; }
  .brand { text-align: center; margin-top: 16px; font-size: 11px; color: #9ba0a8; }
`

export function renderFormHtml(config) {
  const fields = parseFormFields(config.fields)
  const inputs = fields.map(f => {
    const req = f.required ? ' required' : ''
    const label = `<label>${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>`
    if (f.type === 'long') return `${label}<textarea name="${esc(f.key)}"${req}></textarea>`
    if (f.type === 'choice') {
      const opts = (f.options || '').split(',').map(o => o.trim()).filter(Boolean)
      return `${label}<select name="${esc(f.key)}"${req}>${opts.map(o => `<option>${esc(o)}</option>`).join('')}</select>`
    }
    if (f.type === 'yesno') return `${label}<select name="${esc(f.key)}"><option>yes</option><option>no</option></select>`
    const type = f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : 'text'
    return `${label}<input type="${type}" name="${esc(f.key)}"${req} />`
  }).join('\n')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="preconnect" href="https://rsms.me/"/><link rel="stylesheet" href="https://rsms.me/inter/inter.css"/>
<title>${esc(config.title || 'Form')}</title><style>${PAGE_CSS}</style></head><body>
<form class="card" method="POST">
  <h1>${esc(config.title || 'Form')}</h1>
  ${config.description ? `<p class="desc">${esc(config.description)}</p>` : ''}
  ${inputs}
  <button type="submit">${esc(config.button || 'Send')}</button>
  <div class="brand">powered by steprail</div>
</form></body></html>`
}

export function renderFormSuccessHtml(config) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="preconnect" href="https://rsms.me/"/><link rel="stylesheet" href="https://rsms.me/inter/inter.css"/>
<title>Thanks</title><style>${PAGE_CSS}</style></head><body>
<div class="card ok"><div class="tick">✓</div>
  <h1>${esc(config.thanks || 'Got it — thank you!')}</h1>
  <p class="desc">Your answers are on their way.</p>
  <div class="brand">powered by steprail</div>
</div></body></html>`
}
