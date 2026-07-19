// MIT License - Copyright (c) fintonlabs.com
// Client view of the tool catalog: shared/toolcore.mjs (used verbatim by the
// server's queue worker) plus lucide icons, which are browser-only.
import {
  Webhook, CalendarClock, GitBranch, FolderSearch, ClipboardList,
  Sparkles, Bot, Tags, FileText, PlugZap, Wrench, ScanSearch,
  Boxes, Container, TerminalSquare, CloudCog, Layers, ScrollText,
  Globe, Database, Braces, Filter, Brain,
  Split, Repeat, Timer, UserCheck, RotateCcw, PlayCircle,
  MessageSquare, Mail, Siren, CircleDot,
  Zap, Server, Bell, Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { Category, ToolDef } from './types'
import { CATEGORY_LABEL, CATEGORY_ORDER, TOOL_CORE, isTrigger } from '../shared/toolcore.mjs'

const ICONS: Record<string, LucideIcon> = {
  'trigger.webhook': Webhook,
  'trigger.form': ClipboardList,
  'trigger.mcp': PlugZap,
  'trigger.schedule': CalendarClock,
  'trigger.git': GitBranch,
  'trigger.file': FolderSearch,
  'ai.prompt': Sparkles,
  'ai.agent': Bot,
  'ai.classify': Tags,
  'ai.summarize': FileText,
  'ai.mcptool': Wrench,
  'ai.extract': ScanSearch,
  'infra.terraform': Layers,
  'infra.k8s': Boxes,
  'infra.docker': Container,
  'infra.ssh': TerminalSquare,
  'infra.ansible': ScrollText,
  'infra.lambda': CloudCog,
  'data.http': Globe,
  'data.postgres': Database,
  'data.transform': Braces,
  'data.memory': Brain,
  'data.filter': Filter,
  'logic.branch': Split,
  'logic.loop': Repeat,
  'logic.until': RotateCcw,
  'logic.subflow': PlayCircle,
  'logic.wait': Timer,
  'logic.approval': UserCheck,
  'notify.slack': MessageSquare,
  'notify.email': Mail,
  'notify.pagerduty': Siren,
}

// One web icon per category — drives the palette group headers (and any other
// place that needs to represent a whole category at a glance).
export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  trigger: Zap,
  ai: Sparkles,
  infra: Server,
  data: Database,
  logic: Workflow,
  notify: Bell,
}

export const TOOLS: ToolDef[] = TOOL_CORE.map(t => ({ ...t, icon: ICONS[t.id] || CircleDot }))

export const toolById = (id: string): ToolDef | undefined => TOOLS.find(t => t.id === id)

export { CATEGORY_LABEL, CATEGORY_ORDER, isTrigger }
