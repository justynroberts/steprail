// MIT License - Copyright (c) fintonlabs.com
import type { Category, Field } from '../src/types'

export interface ToolCore {
  id: string
  name: string
  category: Category
  description: string
  fields: Field[]
  branching?: boolean
  modeTabs?: { key: string; values: Record<string, string> }
  sample: (cfg: Record<string, string>) => Record<string, unknown>
}

export const CATEGORY_LABEL: Record<Category, string>
export const CATEGORY_ORDER: Category[]
export const TOOL_CORE: ToolCore[]
export function toolCoreById(id: string): ToolCore | undefined
export function isTrigger(id: string): boolean
