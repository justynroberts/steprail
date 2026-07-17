// MIT License - Copyright (c) fintonlabs.com
// The active project for THIS browser. A module (not React context) so that
// every flow-creation path — new flow, import, blueprint, AI compose — stamps
// the right projectId without threading a prop through each one.
export const ACTIVE_PROJECT_KEY = 'sr-active-project'

export function getActiveProjectId(): string {
  return localStorage.getItem(ACTIVE_PROJECT_KEY) || 'default'
}

export function setActiveProjectId(id: string): void {
  localStorage.setItem(ACTIVE_PROJECT_KEY, id)
}

export const projectOf = (record: { projectId?: string }): string => record.projectId || 'default'

// Imports and blueprint instantiations land with a name that doesn't collide
// inside the active project — "Deploy on merge" becomes "Deploy on merge 2".
export function uniqueFlowName(name: string, flows: { name: string; projectId?: string }[]): string {
  const taken = flows.filter(f => projectOf(f) === getActiveProjectId()).map(f => f.name.toLowerCase())
  if (!taken.includes(name.toLowerCase())) return name
  const base = name.replace(/ \d+$/, '')
  let n = 2
  while (taken.includes(`${base} ${n}`.toLowerCase())) n++
  return `${base} ${n}`
}
