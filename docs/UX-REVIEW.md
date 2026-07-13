# UX review — 2026-07-13

A feature-by-feature audit after two weeks of fast growth. The rail editor is
strong; the shell around it accreted. Findings, then the restructure.

## What's working (keep, don't touch)

- **The rail itself**: slots, lanes, in-place config, plain-language errors,
  data pills, token chips. This is the product and it has stayed clean.
- **The empty state** (compose / blueprints / drag) and the hosted form pages.
- **Friendly schedule builder**, variables drawer, trace waterfall.

## Findings

1. **The tabbed sidebar is the wrong pattern.** Four unrelated jobs (tool
   palette, flow management, blueprint gallery, credentials) share one 292px
   column. Each tab hides the others, so you can't browse flows while seeing
   tools; Config is a settings page squeezed into a sliver; "Prints" is a
   label nobody should ship. Tabs at this level are navigation pretending to
   be a widget.
2. **Top bar icon soup.** Eight unlabeled icon buttons, several of which
   duplicate sidebar tabs (blueprints dialog, settings drawer, flow switcher
   dropdown vs the Flows tab). Tooltips are the only affordance — that fails
   the teenager test.
3. **Browsing and editing are different modes and deserve different screens.**
   Managing forty flows is a workspace job (list, search, tags, status, last
   run); editing one flow is a focused job (palette + rail). Splitting them is
   how every mature tool in the category works, and it dissolves findings 1–2.
4. **Redundant surfaces**: blueprints exist as a dialog AND a tab; settings as
   a drawer AND a tab; flows as a dropdown AND a tab. Each should exist once.

## The restructure

**Two-level shell.** A slim always-visible nav rail (far left): **Flows,
Blueprints, Config** — full words, icons above labels, active state; theme
toggle at the bottom. Each destination is a full-width page:

- **Flows** (home): roomy list — name, tags, live badge, updated time; search
  and tag filters; New / Import / per-row Export & Delete. Click → editor.
- **Blueprints**: tagged card gallery; custom ones deletable; save-current
  when a flow is open.
- **Config**: the connections manager and settings on a real page.

**The editor** becomes a mode you enter from Flows: back button + flow name +
Live toggle + Run, and only run-adjacent icons remain (undo, variables, JSON,
runs). The sidebar returns to being 100% tool palette. Removed: the flow
switcher dropdown, the blueprints dialog, the settings drawer trigger
(Config owns it), and the theme toggle from the top bar (nav rail owns it).

One rule going forward: **a thing lives in exactly one place.**
