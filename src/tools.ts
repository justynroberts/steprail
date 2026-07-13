// MIT License - Copyright (c) fintonlabs.com
// Client view of the tool catalog: shared/toolcore.mjs (used verbatim by the
// server's queue worker) plus lucide icons, which are browser-only.
import {
  Webhook, CalendarClock, GitBranch, FolderSearch, ClipboardList,
  Sparkles, Bot, Tags, FileText,
  Boxes, Container, TerminalSquare, CloudCog, Layers,
  Globe, Database, Braces, Filter,
  Split, Repeat, Timer, UserCheck,
  MessageSquare, Mail, Siren, CircleDot,
  type LucideIcon,
} from 'lucide-react'
import type { ToolDef } from './types'
import { CATEGORY_LABEL, CATEGORY_ORDER, TOOL_CORE, isTrigger } from '../shared/toolcore.mjs'

const ICONS: Record<string, LucideIcon> = {
  'trigger.webhook': Webhook,
  'trigger.form': ClipboardList,
  'trigger.schedule': CalendarClock,
  'trigger.git': GitBranch,
  'trigger.file': FolderSearch,
  'ai.prompt': Sparkles,
  'ai.agent': Bot,
  'ai.classify': Tags,
  'ai.summarize': FileText,
  'infra.terraform': Layers,
  'infra.k8s': Boxes,
  'infra.docker': Container,
  'infra.ssh': TerminalSquare,
  'infra.lambda': CloudCog,
  'data.http': Globe,
  'data.postgres': Database,
  'data.transform': Braces,
  'data.filter': Filter,
  'logic.branch': Split,
  'logic.loop': Repeat,
  'logic.wait': Timer,
  'logic.approval': UserCheck,
  'notify.slack': MessageSquare,
  'notify.email': Mail,
  'notify.pagerduty': Siren,
}

export const TOOLS: ToolDef[] = TOOL_CORE.map(t => ({ ...t, icon: ICONS[t.id] || CircleDot }))

export const toolById = (id: string): ToolDef | undefined => TOOLS.find(t => t.id === id)

export { CATEGORY_LABEL, CATEGORY_ORDER, isTrigger }
