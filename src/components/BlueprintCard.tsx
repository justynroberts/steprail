// MIT License - Copyright (c) fintonlabs.com
// A blueprint card that shows the flow itself: the real chain of tool icons,
// wired with connectors, tinted by the flow's dominant category. The preview
// is derived straight from the portable JSON — nothing hand-drawn.
import { ArrowRight, GitFork, Trash2 } from 'lucide-react'
import type { Category } from '../types'
import type { Blueprint } from '../blueprints'
import type { PortableStep } from '../flowjson'
import { toolById } from '../tools'
import { CATEGORY_VAR } from '../ui'

const flattenTools = (steps: PortableStep[]): string[] =>
  steps.flatMap(s => [s.tool, ...(s.branches || []).flatMap(b => flattenTools(b.steps || []))])

function accentFor(bp: Blueprint): string {
  const counts: Partial<Record<Category, number>> = {}
  for (const id of flattenTools(bp.flow.steps || [])) {
    const cat = toolById(id)?.category
    if (!cat || cat === 'trigger') continue
    counts[cat] = (counts[cat] || 0) + 1
  }
  const top = (Object.entries(counts) as [Category, number][]).sort((a, b) => b[1] - a[1])[0]
  return top ? CATEGORY_VAR[top[0]] : 'var(--accent)'
}

export function BlueprintCard({ bp, onUse, onDelete }: { bp: Blueprint; onUse: () => void; onDelete?: () => void }) {
  const rootSteps = bp.flow.steps || []
  const shown = rootSteps.slice(0, 6)
  const extra = rootSteps.length - shown.length
  const accent = accentFor(bp)
  const stepCount = flattenTools(rootSteps).length
  const hasBranches = rootSteps.some(s => (s.branches || []).length > 0)

  return (
    <div className="bpc" style={{ '--bp-accent': accent } as React.CSSProperties} onClick={onUse}>
      <div className="bpc-preview">
        {shown.map((s, i) => {
          const tool = toolById(s.tool)
          const Icon = tool?.icon
          return (
            <span className="bpc-node" key={i} title={tool?.name || s.tool}>
              <span className="bpc-chip">
                {Icon ? <Icon size={13} style={{ color: CATEGORY_VAR[tool!.category] }} /> : null}
              </span>
              {(i < shown.length - 1 || extra > 0) && <span className="bpc-wire" />}
            </span>
          )
        })}
        {extra > 0 && <span className="bpc-more">+{extra}</span>}
        {hasBranches && (
          <span className="bpc-fork" title="Forks into lanes">
            <GitFork size={11} />
          </span>
        )}
      </div>
      <div className="bpc-name">
        {bp.name}
        {bp.custom && <span className="bp-badge">saved</span>}
      </div>
      <div className="bpc-desc">{bp.description}</div>
      <div className="bpc-foot">
        <span className="bpc-meta">
          {stepCount} steps
          {(bp.tags || []).map(t => <span key={t} className="tag-chip small">{t}</span>)}
        </span>
        <span className="bpc-use">
          Use <ArrowRight size={11} />
        </span>
      </div>
      {onDelete && (
        <button className="btn icon danger bpc-del" title="Delete blueprint" onClick={e => { e.stopPropagation(); onDelete() }}>
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
}
