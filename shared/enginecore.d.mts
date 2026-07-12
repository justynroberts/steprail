// MIT License - Copyright (c) fintonlabs.com
export function interpolateWith(outputs: Record<string, Record<string, unknown>>, value: string): string
export function resolveConfigWith(
  outputs: Record<string, Record<string, unknown>>,
  cfg: Record<string, string>,
): Record<string, string>
export function systemVars(flow: { name: string }): Record<string, unknown>
export function seedVars(flow: { name: string; vars?: Record<string, string> }): Record<string, Record<string, unknown>>
export function validateStep(step: { toolId: string; config: Record<string, string> }): string | null
