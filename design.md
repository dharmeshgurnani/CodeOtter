---
version: alpha
name: PR Scorer
description: Self-hosted pull request code review and scoring platform. Combines high-density technical daylight dashboards and GitHub-native review reports with an animated ordered-dither WebGL login showcase.
colors:
  background: "#ffffff"
  foreground: "#1f1f1f"
  primary: "#111111"
  on-primary: "#ffffff"
  brand: "#c2410c"
  on-brand: "#ffffff"
  brand-amber: "#f59e0b"
  brand-cream: "#fcecd9"
  showcase-bg: "#0a0a0b"
  showcase-fg: "#ffffff"
  showcase-muted: "#b3b3b3"
  surface-card-shell: "#fafafa"
  surface-panel: "#ffffff"
  surface-header: "#efefef"
  surface-muted: "#f3f3f3"
  surface-accent: "#ededed"
  surface-code: "#f5f5f5"
  sidebar-bg: "#f7f7f7"
  sidebar-fg: "#333333"
  sidebar-accent: "#e9e9e9"
  text-secondary: "#525252"
  text-muted: "#6b6b6b"
  border: "#e6e6e6"
  border-card: "#e5e5e5"
  ring-track: "#e9e9e9"
  ok-fg: "#166534"
  ok-bg: "#dcfce7"
  ok-ring: "#15803d"
  warn-fg: "#92400e"
  warn-bg: "#fef3c7"
  warn-ring: "#b45309"
  bad-fg: "#991b1b"
  bad-bg: "#fee2e2"
  bad-ring: "#b91c1c"
  neutral-pill-fg: "#404040"
  neutral-pill-bg: "#e5e5e5"
  hotspot-fg: "#7c2d12"
  hotspot-bg: "#ffedd5"
typography:
  showcase-display:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.025em
  login-h1:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.025em
  stat-value:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1
    fontFeature: "'tnum' 1"
  ring-score:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1
    fontFeature: "'tnum' 1"
  review-title:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
  topbar-title:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
  section-caps:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0.025em
  meta-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
  code-inline:
    fontFamily: ui-monospace
    fontSize: 12.5px
    fontWeight: 400
    lineHeight: 1.4
  badge-xs:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.2
    fontFeature: "'tnum' 1"
  showcase-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0.14em
rounded:
  xs: 5px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 28px
  2xl: 40px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 48px
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    padding: 8px
    height: 36px
  stat-card-shell:
    backgroundColor: "{colors.surface-card-shell}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xl}"
    padding: 14px
  stat-card-panel:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.foreground}"
    typography: "{typography.stat-value}"
    rounded: "{rounded.md}"
    padding: 16px
  table-header:
    backgroundColor: "{colors.surface-header}"
    textColor: "{colors.sidebar-fg}"
    typography: "{typography.label-md}"
    padding: 10px
  bot-comment-header:
    backgroundColor: "{colors.surface-header}"
    textColor: "{colors.foreground}"
    typography: "{typography.label-md}"
    padding: 8px
  finding-card-header:
    backgroundColor: "{colors.surface-card-shell}"
    textColor: "{colors.sidebar-fg}"
    typography: "{typography.meta-sm}"
    padding: 6px
  pill-ok:
    backgroundColor: "{colors.ok-bg}"
    textColor: "{colors.ok-fg}"
    typography: "{typography.badge-xs}"
    rounded: "{rounded.sm}"
    padding: 4px
  pill-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn-fg}"
    typography: "{typography.badge-xs}"
    rounded: "{rounded.sm}"
    padding: 4px
  pill-bad:
    backgroundColor: "{colors.bad-bg}"
    textColor: "{colors.bad-fg}"
    typography: "{typography.badge-xs}"
    rounded: "{rounded.sm}"
    padding: 4px
  pill-neutral:
    backgroundColor: "{colors.neutral-pill-bg}"
    textColor: "{colors.neutral-pill-fg}"
    typography: "{typography.badge-xs}"
    rounded: "{rounded.sm}"
    padding: 4px
  hotspot-tag:
    backgroundColor: "{colors.hotspot-bg}"
    textColor: "{colors.hotspot-fg}"
    typography: "{typography.badge-xs}"
    rounded: "{rounded.full}"
    padding: 4px
---

# PR Scorer

Specification of the visual identity, token system, and component patterns across **PR Scorer** ([`web/src/`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src) and [`server.mjs`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/server.mjs)), structured according to the open [Google Stitch `DESIGN.md`](https://github.com/google-labs-code/design.md) specification.

## Overview

**Technical Utilitarianism meets Retro-Compute Precision.** PR Scorer is an engineering tool that evaluates GitHub pull requests for code quality, blast radius, correctness risk, test coverage, readability, and PR hygiene using open-weight or hosted models.

The visual identity balances two distinct moods:
1. **High-Contrast Daylight Workspace** (Home Dashboard, Repository Queues, PR Review Reports, and Settings): Crisp white canvases (`#ffffff`), stone-grey table and comment headers (`#efefef`), soft off-white sidebar and card shells (`#f7f7f7` / `#fafafa`), 1px structural hairlines (`#e6e6e6`), and zero decorative chrome. It reads like a fast, information-dense developer console blended with GitHub's native PR timeline.
2. **Dithered Shader Showcase** (Split Login Page): The right column of `/login` contrasts the utilitarian left sign-in column with a deep obsidian canvas (`#0a0a0b`) running a live WebGL 8×8 Bayer ordered-dither fragment shader (`DitherCanvas`) quantized at chunky `3px` cells into burnt orange (`#c2410c`), warm amber (`#f59e0b`), and cream (`#fcecd9`).

Core philosophical pillars enforced across every screen:
- **Talk to technical people**: No marketing filler or explanatory prose for concepts engineers already understand. Every setting is a label, a plain control, and an optional one-line hint.
- **Server-driven JSON schemas, one generic renderer**: Read-only dashboards (`HomePage`) are rendered by [`JsonReport`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/components/json-report.tsx); all settings and admin pages (`SettingsPage`) are rendered by [`JsonForm`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/components/json-form.tsx).
- **Plainest control wins**: Native `<select>` picklists over card selectors, `<input type="range">` over custom slider libraries, and `<input list>` (`<datalist>`) over heavy comboboxes.
- **Layout stability**: Cards reserve space for empty subtitles and action buttons (`invisible` when omitted) so neighbor cards never mismatch in height, and every page loads with a layout-mirroring skeleton ([`web/src/components/skeletons.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/components/skeletons.tsx)).

## Colors

The color system is built on neutral monochrome surfaces punctuated by a single interactive brand hue (**Burnt Orange**, `#c2410c`) and a three-tier semantic scoring palette (`ok`, `warn`, `bad`).

### Core Surfaces & Ink
- **Background (`#ffffff`)**: Main application viewport (`SidebarInset`), table bodies, bot comment bodies, and the inset body panel inside dashboard KPI cards.
- **Foreground (`#1f1f1f`)**: Primary body copy, table cells, and headings.
- **Primary Ink (`#111111` / `#ffffff`)**: High-emphasis primary buttons (`Continue with GitHub` on Login, `Save`, `Open in GitHub`).
- **Brand Orange (`#c2410c`)**: Interactive links (`text-brand`), active sidebar submenu indicator bars (`bg-brand`), range/checkbox input `accent-brand`, bot comment avatar dots, download progress bars, and focus rings (`--ring`).
- **Brand Gradient (`#fbbf24` → `#c2410c`)**: `bg-gradient-to-br from-amber-400 to-brand` used on the `28px` circular mark on the Login page and fallback header.
- **Sidebar Surface (`#f7f7f7`) & Accent (`#e9e9e9`)**: Separates navigation from the `#ffffff` workspace via a `1px` `#e6e6e6` border; active/open dropdown triggers switch to `#e9e9e9`.
- **Table & Bot Header Surface (`#efefef`)**: Used exclusively on `<thead>` rows and the top bar of `pr-scorer` bot comment boxes (`Comment`) to anchor tabular and timeline sections.
- **Nested Card Shell (`#fafafa` / `bg-neutral-50`)**: Outer frame of dashboard KPI stat cards and file-path headers on `FindingCard` blocks.
- **Showcase Dark (`#0a0a0b`)**: Background of the right-hand `/login` showcase column and bottom gradient scrim (`from-[#0a0a0b] via-[#0a0a0b]/70 to-transparent`).

### Semantic Scoring & Status Roles
Scores (`0–100`) pass through `tone(value, invert)` in [`web/src/types.ts`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/types.ts), where `>= 70` is `ok`, `40–69` is `warn`, and `< 40` is `bad` (`invert = true` flips `100 - v` for **Blast radius** and **Risk** where lower scores are healthier):
- **OK / Approved / Additions**: Pill `#dcfce7` bg with `#166534` text (`bg-green-100 text-green-800`); Score Ring arc `#15803d`; Diff additions `text-green-700` (`+N`); Save banner `bg-green-50 text-green-800`.
- **Warn / Commented / Waiting**: Pill `#fef3c7` bg with `#92400e` text (`bg-amber-100 text-amber-800`); Score Ring arc `#b45309`.
- **Bad / Changes Requested / Risk / Deletions**: Pill `#fee2e2` bg with `#991b1b` text (`bg-red-100 text-red-800`); Score Ring arc `#b91c1c`; Diff deletions `text-red-700` (`-N`); Error banner `bg-red-50 text-red-800 border-red-200`.
- **Neutral Pill (`#e5e5e5` / `#404040`)**: Repository name pills, sidebar open-PR count badges, and `"none waiting"` status pills (`bg-neutral-200 text-neutral-700`).
- **Hotspot Tag (`#ffedd5` / `#7c2d12`)**: Rounded-full pill (`bg-orange-100 text-orange-900`) highlighting sensitive paths (`migrations`, `auth`, `payments`, `api`, `core`, `deps`, `ci`) under Blast radius details.

## Typography

- **Primary Sans (`Inter`)**: `Inter, system-ui, -apple-system, "Segoe UI", sans-serif` applied globally to `body`.
- **Monospace (`ui-monospace`)**: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` used for file paths, branch refs (`headRefName`, `baseRefName`), and CLI/env hints via `<Code>` (`rounded-[5px] bg-neutral-100 px-1.5 py-px font-mono text-[12.5px]`).
- **Tabular Numerals (`tabular-nums`)**: Mandatory on all KPI stat values (`22px`), score rings (`20px`), sidebar open-PR badges (`12px`), range slider value readouts, and numeric report cells (`CellView`).

| Token | Size | Weight | Tracking / Line Height | Primary Surface Usage |
| :--- | :--- | :--- | :--- | :--- |
| `showcase-display` | `34px` (`xl:40px`) | `600` | `-0.025em` / `1.1` | Login page right-column showcase headline (`max-w-[22ch]`) |
| `login-h1` | `28px` | `600` | `-0.025em` / `1.2` | Login page left-column `"Sign in"` heading |
| `stat-value` | `22px` | `600` | `0` / `1.0` (`tnum`) | Dashboard KPI stat card numeric metric |
| `ring-score` | `20px` (`1.25rem`) | `700` | `0` / `1.0` (`tnum`) | Center number inside `88px` circular score rings |
| `review-title` | `18px` (`1.125rem`) | `600` | `0` / `1.4` | PR title header (`h3`) on `/review` |
| `topbar-title` | `16px` (`1rem`) | `400` | `0` / `1.5` | Top breadcrumb bar inside `SidebarInset` |
| `body-md` | `15px` | `400`–`500` | `0` / `1.5` | Table cells (`Td`), bot comment prose, stat card titles, login subtitle, primary CTA |
| `section-caps` | `14px` (`0.875rem`) | `600` | `0.025em` uppercase | Dashboard section headers (`REPOSITORIES`, `RECENT REVIEWS`) & Settings section headers |
| `label-md` | `14px` (`0.875rem`) | `500` | `0` / `1.4` | Table `<th>` headers, form field labels, bot comment attribution bar |
| `meta-sm` | `13px` | `400` | `0` / `1.4` | Finding card file headers, review engine attribution footer, showcase item hints |
| `badge-xs` | `12px` (`0.75rem`) | `500` | `0` / `1.2` (`tnum`) | Status pills (`<Pill>`), field hints, sidebar open-PR count badges, login footer links |
| `showcase-caps` | `11px` | `600` | `0.14em` uppercase | Login showcase group headings (`SPONSORS`, `USED BY`, `CASE STUDIES`) |

## Layout

1. **Split Login Layout (`/login`, [`web/src/login-page.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/login-page.tsx))**:
   - Asymmetric two-column CSS Grid (`grid min-h-svh grid-cols-1 bg-white lg:grid-cols-[minmax(420px,5fr)_7fr]`).
   - Left column (`px-8 py-8 sm:px-14`) centers a `max-w-[380px]` sign-in stack between the top brand mark and bottom documentation links.
   - Right column (`hidden lg:block`) fills the remaining `7fr` viewport with the WebGL `DitherCanvas` and bottom-aligned showcase content (`p-12 xl:p-16`) with a 3-column metadata grid (`grid-cols-1 gap-8 xl:grid-cols-3`).
2. **Application Shell ([`web/src/App.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/App.tsx))**:
   - Uses `@animate-ui` `SidebarProvider` + collapsible `AppSidebar` (`collapsible="icon"`) + `SidebarInset`.
   - **Top Bar**: Full-width header (`flex items-center justify-between border-b border-border px-6 py-3 text-base`) with `<SidebarTrigger />` + breadcrumb path on the left and contextual actions (`Re-review`, `Open in GitHub`) on the right.
   - **Workspace Container**: `w-full px-10 py-7` (`40px` horizontal, `28px` vertical padding).
3. **Dashboard & Report Rhythm ([`web/src/components/json-report.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/components/json-report.tsx))**:
   - Vertical sections stack with `space-y-8` (`32px`).
   - KPI stat cards and Quick Links use a 3-column responsive grid (`grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3`).
4. **Settings Form Rhythm ([`web/src/settings-page.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/settings-page.tsx) & [`web/src/components/json-form.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/components/json-form.tsx))**:
   - Constrained to `max-w-[820px]`.
   - Each section wraps its fields in a `divide-y divide-border rounded-[10px] border border-border` container.
   - Individual field rows use a 2-column asymmetric grid: `grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[200px_1fr] sm:gap-4` (`[160px_1fr]` inside modal dialogs), with controls capped at `max-w-[520px]`.

## Elevation & Depth

PR Scorer eschews heavy drop shadows in favor of **structural 1px borders** (`#e6e6e6`) and **two-layer nested surface framing**:
- **Nested KPI Stat Card Depth**: Each dashboard stat card ([`web/src/components/json-report.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/components/json-report.tsx#L41-L60)) uses an off-white outer shell (`bg-neutral-50 border-neutral-200/90 shadow-[0_1px_2px_rgba(0,0,0,0.03)]`) with the metric label in the top rail (`px-5 pt-3.5 pb-3`), and an inset white card (`mx-1.5 mb-1.5 rounded-lg border border-neutral-200 bg-white px-4 py-4`) holding the value, hint, and CTA button.
- **Button Micro-Shadows**:
  - Primary dark CTA (`Continue with GitHub`): `shadow-[0_1px_2px_rgba(0,0,0,0.12)]`.
  - Secondary card action button: `shadow-[0_1px_1px_rgba(0,0,0,0.03)]`.
- **Shader & Scrim Layering (`/login`)**: The WebGL `<DitherCanvas pixel={3} />` sits at `z-0`, overlaid by an atmospheric gradient scrim (`bg-gradient-to-t from-[#0a0a0b] via-[#0a0a0b]/70 to-transparent`) so foreground typography (`text-white`, `text-white/70`, `text-white/50`) maintains effortless legibility.

## Shapes

- **Outer Nested Stat Card (`rounded-xl` / `12px`)**: Soft outer frame wrapping the `rounded-lg` (`8px`) inner white panel (`mx-1.5 mb-1.5` offset).
- **Primary Containers (`rounded-[10px]` / `--radius-lg`)**: All data tables (`Table`, `JsonReport` tables), bot review comment blocks (`Comment`), settings field groups (`JsonForm`), and quick-link cards.
- **Controls & Sub-Cards (`rounded-lg` / `8px` / `--radius-md`)**: Login primary CTA button, `FindingCard` blocks, error/status alert banners, sidebar avatars (`size-8 rounded-lg`), and dropdown menus.
- **Inputs & Pills (`rounded-md` / `6px` / `--radius-sm`)**: `<Pill>` badges, form `<Input>` and `<select>` elements, list containers, and sidebar repository badges.
- **Inline Code (`rounded-[5px]`)**: `<Code>` spans (`px-1.5 py-px`).
- **Circular Elements (`rounded-full` / `9999px`)**: `88px × 88px` conic-gradient `<Ring>` score gauges (with a `7px` inset white cutout `inset-[7px]`), `28px` brand gradient mark, `20px` bot avatar dot, hotspot tags, and `h-1.5` model download progress bars.

## Components

### 1. Split Login & Ordered-Dither Shader ([`web/src/login-page.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/login-page.tsx), [`web/src/components/dither-canvas.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/components/dither-canvas.tsx))
- **GitHub OAuth Button**: `h-12 w-full rounded-lg bg-neutral-900 px-4 text-[15px] font-medium text-white hover:bg-neutral-800 disabled:opacity-50` with a `size-5` GitHub SVG mark.
- **`DitherCanvas`**: WebGL fragment shader rendering animated 5-octave `fbm` noise + radial glow quantized through an 8×8 Bayer threshold matrix (`bayer8`) at `pixel={3}`. Respects `prefers-reduced-motion: reduce` by locking `u_time = 40`.
- **Showcase Content**: Hydrated from [`showcase.json`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/showcase.json) (`/api/login`), rendering the headline, subhead, and 3-column groups (`Sponsors`, `Used by`, `Case studies`).

### 2. App Sidebar & Organization Switcher ([`web/src/app-sidebar.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/app-sidebar.tsx))
- **`OrgSwitcher` (Header)**: Team-switcher dropdown displaying the active GitHub organization's avatar (`https://github.com/<org>.png?size=64`), name, and onboarded repository count (`Organization · N repositories`), plus an `"Add repository"` item.
- **`NavGroup` (Repositories, Settings, Admin)**: Collapsible `@animate-ui` menu items with an optional right-aligned open-PR counter (`bg-neutral-200 px-1.5 text-xs tabular-nums`) and animated 90° `ChevronRight`.
- **Active Submenu Indicator (`SUB_ACTIVE`)**: Active sub-links (`Reviews`, `Open pull requests`, individual Settings pages) never fill with a background box that competes with the group header. Instead, `data-[active=true]` sets `text-brand font-medium` and reveals a `2px` (`w-0.5`) vertical `bg-brand` indicator bar directly over the left submenu guide line (`before:absolute before:-left-2.5 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-brand`).
- **`NavUser` (Footer)**: Displays `"Not signed in / Log in with GitHub"` when anonymous, or the user's avatar, name, `role · email`, GitHub profile link, and `Log out` action when signed in.

### 3. Home Dashboard & `JsonReport` ([`web/src/home-page.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/home-page.tsx), [`web/src/components/json-report.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/components/json-report.tsx))
- **Stat Cards (`kind: "stats"`)**: Three cards (*Waiting for review*, *Reviewed*, *Average quality*) in a 3-column grid. Each card uses the two-layer nested shell (`bg-neutral-50` outer + `bg-white` inner) and always reserves `min-h-5` for the subtitle and `mt-4` for the action button (`invisible` when omitted) so all cards have identical geometry.
- **Report Tables (`kind: "table"`)**: Used for *Repositories* and *Recent reviews*. `rounded-[10px] border border-border` with `bg-[#efefef]` header row and `CellView` cells supporting numbers (`tabular-nums`), status pills (`tone`), internal SPA links (`path`), and external links (`href`).
- **Quick Links (`kind: "links"`)**: 3-column grid of `rounded-[10px] border border-border px-4 py-3 hover:bg-neutral-50` cards linking to *Model provider*, *Repositories*, *Sign-in (OAuth)*, and *Documentation*.

### 4. PR Review Report (`ReviewPage`, [`web/src/review-page.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/review-page.tsx))
- **Bot Comment Box (`<Comment>`)**: `rounded-[10px] border border-border` with a `bg-[#efefef] px-4 py-2 text-sm` header containing a `size-5 rounded-full bg-brand` avatar dot, bold `pr-scorer`, and `bot commented <when>` / `bot reviewed <when>`.
- **Score Gauges (`<Ring>`)**: Six `88px × 88px` circular gauges (**Quality**, **Blast radius** [inverted], **Risk** [inverted], **Tests**, **Readability**, **PR hygiene**) rendered with `conic-gradient(<color> <value>%, #e9e9e9 0)` and an `inset-[7px] rounded-full bg-white` mask.
- **Cohort Walkthrough & Pre-Merge Checks (`<Md>`)**: Compact bordered tables (`bg-neutral-50` headers) grouping file changes by 3-segment directory cohort and listing deterministic + System One (`S1_GATES`) merge checks (`✅ Passed` / `⚠️ Warning` with `(% yes)`).
- **Finding Cards (`<FindingCard>`)**: `rounded-lg border border-border` with a `bg-neutral-50 px-3 py-1.5` file header (`<Code>{f.file}</Code>`) and a body showing severity (`⚠️ Potential issue | 🔴 Major`, `⚠️ Potential issue | 🔴 Minor`, `🛠️ Refactor suggestion`, or `🧹 Nitpick`), bold title, and explanation.

### 5. Schema-Driven Settings (`JsonForm`, [`web/src/components/json-form.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/components/json-form.tsx))
- **Rich List Control (`type: "list"`)**: Divided list (`max-w-[520px] rounded-md border`) supporting inline `Active` badges (`bg-green-100 text-green-800`), metadata sublines, live `bg-brand` download progress bars (`section.poll`), row buttons (`Download N MB`, `Use`, `Delete`), per-item settings modal trigger (`Settings2` gear icon opening `ItemSettingsDialog` in an `@animate-ui` `Dialog`), and row removal (`X`).
- **Dirty-State Action Gating**: `Save` is disabled until `values !== saved`; secondary actions with `needsSaved: true` (`Test connection`) disable while dirty and show `"Save first."`.

### 6. Layout-Mirroring Skeletons ([`web/src/components/skeletons.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/components/skeletons.tsx))
- `ReportSkeleton` (3 `StatCardSkeleton` + 2 `TableSkeleton` + 5 link cards), `FormSkeleton` (parameterized per settings page: `model: [4, 3]`, `repos: [2]`, `oauth: [6]`, `models: [2, 1]`), `TableSkeleton`, and `ReviewSkeleton` (title + 2 bot comments + 6 `size-[88px]` circle skeletons + 3 `FindingSkeleton` blocks).

## Do's and Don'ts

### Do's
- **Do** route every new dashboard section through [`JsonReport`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/components/json-report.tsx) and every new settings/admin page through [`SETTINGS_PAGES`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/server.mjs) + [`JsonForm`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/components/json-form.tsx).
- **Do** preserve card geometry across every grid: always render the subtitle (`min-h-5`) and button row (`invisible` when unused) in stat cards.
- **Do** use `@animate-ui` primitives (`pnpx shadcn@latest add @animate-ui/<item> -y` inside `web/`) for any collapsible, dialog, dropdown, tooltip, or sidebar widget.
- **Do** scope every data request and page view to the active organization (`?org=`) selected in `OrgSwitcher`.
- **Do** apply `tabular-nums` to all scores, counts, badges, and range readouts, and invert `tone(v, true)` for metrics where higher numbers mean higher risk (**Blast radius** and **Risk**).
- **Do** provide a matching skeleton in [`web/src/components/skeletons.tsx`](file:///C:/Users/Ritika/.gemini/antigravity/worktrees/pr-scorer/generate_design_documentation/web/src/components/skeletons.tsx) for every loading state.

### Don'ts
- **Don't** create custom JSX pages or bespoke controls for individual settings when a schema entry in `SETTINGS_PAGES` and a plain `<select>`, `<input type="range">`, or `list` field will do the job.
- **Don't** write marketing or explanatory copy for concepts software engineers already know—stick to a concise label and control.
- **Don't** render `"Loading..."` text or generic spinners that cause layout jumps when data arrives.
- **Don't** use heavy background fills on active sidebar submenu items (`SidebarMenuSubButton`); always use `SUB_ACTIVE` (`text-brand` + `2px` `bg-brand` left indicator bar).
- **Don't** render raw, unvalidated model output; all scores, verdicts, findings, and walkthroughs must pass through `judge()` normalization first.
