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
