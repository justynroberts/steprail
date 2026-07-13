// MIT License - Copyright (c) fintonlabs.com
export interface FormFieldDef {
  key: string
  label: string
  type: 'text' | 'long' | 'email' | 'number' | 'choice' | 'yesno'
  required: boolean
  options: string
}

export const FORM_FIELD_TYPES: { value: FormFieldDef['type']; label: string }[]
export function slugKey(label: string): string
export function parseFormFields(value: string | undefined): FormFieldDef[]
export function exampleValue(field: FormFieldDef): string | number
export function renderFormHtml(config: Record<string, string>): string
export function renderFormSuccessHtml(config: Record<string, string>): string
