// MIT License - Copyright (c) fintonlabs.com
export interface FormFieldDef {
  key: string
  label: string
  type: 'text' | 'long' | 'email' | 'number' | 'choice' | 'yesno'
  required: boolean
  options: string
  // Dynamic choice: fetch <option>s from an API at form-render time.
  optionsUrl?: string
  optionsPath?: string
  optionsLabel?: string
  optionsValue?: string
}

export interface FormOption { value: string; label: string }

export const FORM_FIELD_TYPES: { value: FormFieldDef['type']; label: string }[]
export function slugKey(label: string): string
export function parseFormFields(value: string | undefined): FormFieldDef[]
export function optionsFromResponse(field: FormFieldDef, data: unknown): FormOption[]
export function exampleValue(field: FormFieldDef): string | number
export interface Branding {
  name?: string
  logoUrl?: string
  accent?: string
  formCss?: string
  hideBadge?: boolean
}

export function renderFormHtml(config: Record<string, string>, branding?: Branding, resolvedOptions?: Record<string, FormOption[]>): string
export function renderFormSuccessHtml(config: Record<string, string>, branding?: Branding): string
