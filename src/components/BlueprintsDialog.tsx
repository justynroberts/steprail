// MIT License - Copyright (c) fintonlabs.com
// The blueprint gallery: built-ins plus your saved flows, applied as new
// flows. Saving the current flow captures it in the portable JSON format.
import { useEffect, useState } from 'react'
import { BookmarkPlus, LayoutTemplate, Trash2, X } from 'lucide-react'
import type { Flow } from '../types'
import { useDispatch } from '../state'
import { BUILTIN_BLUEPRINTS, flowFromBlueprint, type Blueprint } from '../blueprints'
import { serializeFlow } from '../flowjson'
import { fetchBlueprints, saveBlueprints } from '../api'
import { uid } from '../state'

export function BlueprintsDialog({ flow, onClose }: { flow: Flow | null; onClose: () => void }) {
  const dispatch = useDispatch()
  const [custom, setCustom] = useState<Blueprint[]>([])
  const [saveName, setSaveName] = useState(flow?.name || '')
  const [saveDesc, setSaveDesc] = useState('')

  useEffect(() => {
    void fetchBlueprints().then(setCustom)
  }, [])

  const use = (bp: Blueprint) => {
    dispatch({ type: 'create', flow: flowFromBlueprint(bp) })
    onClose()
  }

  const remove = (id: string) => {
    const next = custom.filter(b => b.id !== id)
    setCustom(next)
    void saveBlueprints(next)
  }

  const saveCurrent = () => {
    if (!flow || !flow.steps.length || !saveName.trim()) return
    const bp: Blueprint = {
      id: uid(),
      name: saveName.trim(),
      description: saveDesc.trim() || `${flow.steps.length} steps`,
      flow: serializeFlow({ ...flow, name: saveName.trim() }),
      custom: true,
    }
    const next = [bp, ...custom]
    setCustom(next)
    void saveBlueprints(next)
    setSaveDesc('')
  }

  const Card = ({ bp }: { bp: Blueprint }) => (
    <div className="template-card bp-card">
      <button className="bp-main" onClick={() => use(bp)}>
        <span className="t-name">
          <LayoutTemplate size={14} style={{ color: 'var(--accent)' }} />
          {bp.name}
          {bp.custom && <span className="bp-badge">saved</span>}
        </span>
        <span className="t-desc">{bp.description}</span>
      </button>
      {bp.custom && (
        <button className="btn icon danger bp-del" title="Delete blueprint" onClick={() => remove(bp.id)}>
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmdk json-dialog">
        <div className="cmdk-input">
          <LayoutTemplate size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ flex: 1, fontWeight: 590, fontSize: 14 }}>Blueprints</span>
          <button className="btn icon" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="json-body">
          <div className="template-grid">
            {custom.map(bp => <Card bp={bp} key={bp.id} />)}
            {BUILTIN_BLUEPRINTS.map(bp => <Card bp={bp} key={bp.id} />)}
          </div>
          {flow && flow.steps.length > 0 && (
            <>
              <div className="compose-or" style={{ margin: '8px 0' }}>save the current flow as a blueprint</div>
              <div className="json-actions">
                <input
                  className="var-input"
                  placeholder="Blueprint name"
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  style={{ maxWidth: 200 }}
                />
                <input
                  className="var-input"
                  placeholder="Short description"
                  value={saveDesc}
                  onChange={e => setSaveDesc(e.target.value)}
                />
                <button className="btn" onClick={saveCurrent} disabled={!saveName.trim()}>
                  <BookmarkPlus size={13} /> Save
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
