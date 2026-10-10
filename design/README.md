# Riparr design system (Phase B)

Notes for building the Phase C UI in Next.js 16 and Tailwind 4. The clickable reference is `mockups/index.html`. Open it in a browser and use **Phone preview** (bottom right) to see the phone layout.

```
design/
  tokens.css               all colour, type, spacing, radius and shadow tokens (light + dark)
  brand/
    logo.svg               mark + wordmark (wordmark is outlined Newsreader; switches ink for dark mode)
    logo-on-dark.svg       same, with a light wordmark for fixed dark backgrounds
    logo-mark.svg          square app mark (gradient tile), 64-unit grid
    logo-glyph.svg         the torn-frame glyph alone, fill = currentColor (for monochrome use)
    favicon.svg            simplified mark without sprocket holes, legible at 16px
    favicon-32.png, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png (180)
    manifest.webmanifest
    build-icons.cjs        re-renders the PNGs with the project's sharp: node design/brand/build-icons.cjs
  mockups/index.html       single-file clickable mockup (published as an Artifact)
```

## Brand

The mark is a **film frame torn in two**, with the right half dropping away: "rip" in Riparr, and a file being pulled down. It sits on a riptide-teal rounded tile, like the other *arr icons. Below 24px, use `favicon.svg`, which has no sprocket holes and a smaller window.

- Wordmark: Newsreader Regular, outlined to paths. It doesn't need the font installed.
- Clear space: half the mark's width on all sides. Minimum size: 16px for the favicon, 24px for the mark.
- Copy into `public/` for Phase C. In `app/layout.tsx` metadata, set `manifest: "/manifest.webmanifest"` and `icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" }`. Set `themeColor` per scheme: light `#0f7c86`, dark `#0e1315`. Delete the default Next.js `public/*.svg` and `app/favicon.ico`.

## Tokens to Tailwind 4

Import the tokens before Tailwind and map them with `@theme inline`, so utilities follow the theme at runtime:

```css
/* app/globals.css */
@import "../design/tokens.css";   /* or copy it into app/ */
@import "tailwindcss";

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-fg: var(--fg);
  --color-fg-2: var(--fg-2);
  --color-muted: var(--muted);
  --color-faint: var(--faint);
  --color-accent: var(--accent);
  --color-accent-soft: var(--accent-soft);
  --color-accent-ink: var(--accent-ink);
  --color-primary: var(--primary);
  --color-primary-fg: var(--primary-fg);
  --color-good: var(--good);        --color-good-soft: var(--good-soft);
  --color-warn: var(--warn);        --color-warn-soft: var(--warn-soft);
  --color-critical: var(--critical); --color-critical-soft: var(--critical-soft);
  --color-host-gofile: var(--host-gofile);
  --color-host-pixeldrain: var(--host-pixeldrain);
  --color-host-mega: var(--host-mega);
  --font-display: var(--font-display);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);
  --shadow-xs: var(--shadow-xs);
  --shadow-sm: var(--shadow-sm);
  --shadow-md: var(--shadow-md);
  --shadow-lg: var(--shadow-lg);
}
```

Then `bg-surface border-border text-muted`, `bg-warn-soft text-warn` and so on. Never write a hex value in a component. Every colour comes from a token, so both themes keep working.

**Theme switching:** the default is the system setting, with no attribute on `<html>`. A manual choice sets `data-theme="light"` or `data-theme="dark"` on `<html>`. Persist the choice in a cookie, and set the attribute in the root layout on the server so the page doesn't flash. `tokens.css` already handles all three states.

**Fonts:** load with `next/font/google` (`Newsreader` with axes `["opsz"]` and weights 400/500/600, `IBM_Plex_Sans` 400/500/600, `IBM_Plex_Mono` 400/500). Expose them as CSS variables and point `--font-display`, `--font-sans` and `--font-mono` at them. Keep the fallback stacks.

## Type

| Role | Font | Size / weight | Use |
| --- | --- | --- | --- |
| Page title | Newsreader | 30px (24 on phones) / 500 | `h1` on every page |
| Hero title | Newsreader | 36px (26 on phones) / 500 | title detail |
| Card title | Newsreader | 18–20px / 500 | card and section headings |
| Stat value | Newsreader, tabular | 30px / 400 | stat cards, countdowns |
| Body / UI | IBM Plex Sans | 14px / 400, labels 500 | everything else |
| Meta | IBM Plex Sans | 12–13px, `--muted` | timestamps, sizes, help text |
| Uppercase label | IBM Plex Sans | 11px / 500, +0.06em | `MENU`, day headers in History |
| Paths, file names | IBM Plex Mono | 12–13px | folders, release names, URLs, keys |

Use `font-variant-numeric: tabular-nums` (`tabular-nums` utility) on every number that updates or lines up: sizes, speeds, ETAs, counts, countdowns.

## Spacing and shape

- 4px base: `--space-1` to `--space-10`.
- Page gutter: 28px on desktop, 16px on phones.
- Card padding: 20px on desktop, 16px on phones. Gaps between cards: 14px (10px on phones). Gaps between page sections: 22px.
- Radius: 4px for chips and bars, 8px for inputs and buttons, 12px for cards, 16px for modals and sheets.
- Cards: `--surface`, a 1px `--border` and `--shadow-xs`. Stronger shadows are only for floating things (popovers, modals, drawers).
- Primary buttons are **ink** (`--primary`), as in the reference. The teal accent marks state: active nav, progress, focus rings, selected options, links.

## Colour rules

- **Neutrals** lean slightly toward teal-slate. The canvas is `--bg`; cards and the sidebar are `--surface`.
- **Status** always uses a pill: icon plus label plus tint, never colour alone.

  | State | Pill | Token |
  | --- | --- | --- |
  | Healthy | green | `good` |
  | Waiting on host | amber, hourglass | `warn` |
  | Needs attention | red, triangle | `critical` |
  | Paused | grey, outlined | `paused` |
  | Downloaded (movies) | teal | `info` |

- **Hosts** have one colour each, checked for colour-blind separation in both themes: gofile is blue, pixeldrain is orange, MEGA is crimson. Use them only for host identity (chips, dots, chart series), and always next to the host's name.
- **Charts:** host colours for series, a 2px gap between stacked segments, 4px rounded tops, faint `--grid` lines and labels in `--muted`. Every chart gets a hover tooltip and a "Show as table" fallback.

## Components

| Component | States and notes |
| --- | --- |
| **App shell** | Sidebar is 264px. It collapses to a 68px icon rail on desktop and becomes a slide-out drawer (with a scrim) below 860px. Accordion groups: Library, Activity, Settings, System. The group holding the current page stays open. Count badges show on items, and on a collapsed group header. The bottom card shows host status and free disk space. |
| **Top bar** | Sticky with a translucent `--bg`. Has title search (`/` focuses it), a 3-way theme toggle, a bell for needs-attention items with a count and popover, and the user menu with sign out. On phones it shows the hamburger, mark, theme toggle, bell and avatar. |
| **Stat card** | Label, an icon in a well, a serif value with a unit in `small`, and a footer with a delta (`good` up, `critical` down) and its period. Five across on wide screens, 3+2 on mid widths, 2 columns on phones with the last card full width. |
| **Title card** (dashboard) | Poster, name, a Show/Movie tag, year, root folder, status pill, `9 / 12 episodes` with a segmented progress bar (downloaded, downloading, waiting), an optional one-line reason, the latest episode, and a source health dot per source. |
| **Library card** | 2:3 poster with a status pill overlay, name, a thin progress bar and the count. Grid/list toggle. The list is a table on desktop and stacked cards on phones. |
| **Poster** | TMDB image, cached. Until it loads, or when there's no TMDB match, show the generated placeholder tile: a hue from the title's id, the title in Newsreader, and the year. |
| **Pill / Tag / Host chip** | Pill = state. Tag = type (SHOW, MOVIE). Host chip = colour swatch plus host name. |
| **Progress bar** | 6px (4px thin, 8px thick). Segments: `accent` = done, faded accent = downloading, faded `warn` = waiting. |
| **Queue item** | Poster, title and episode, file name in mono, host chip, then by section: progress with speed and ETA; "Waiting on pixeldrain, resumes in 42 min"; reason with the next attempt and **Retry now**; or queued with move up/remove. |
| **Host limit card** | Host, status pill, then a big number: live speed, or a live countdown when limited. Usage bar and a reset time. |
| **History row** | Time, level icon (info/good/warn/crit), message with a muted second line, and a link to the title. Grouped by day with a sticky-style day header. |
| **Settings section** | Two columns on desktop (heading and explanation on the left, fields on the right). One column on phones. **Save changes** and **Discard** sit in the page header. |
| **Form controls** | Input, mono input (paths, URLs, keys), select, switch row (label and hint on the left, switch on the right), radio cards, token chips that insert into a template, a live path preview, and a Test button with an inline result. |
| **Modal / sheet** | 720px centred modal on desktop, bottom sheet on phones. Add title is two steps: search TMDB, then folder, season folders, sources and monitor. |
| **Empty state** | Dashed icon well, a serif one-liner, one sentence on what will appear, and one action. |
| **Toast** | Ink pill at the bottom centre. Says what happened ("Settings saved"). Gone after about 3s. |
| **Inline confirm** | Destructive actions (restore a backup) turn the row red with Cancel/Confirm. No browser dialogs. |

## Icons

Use **`lucide-react`**, the same set as the mockup (Lucide 0.460 names). Default size 18px, `strokeWidth={1.75}`. Use 15–16px in buttons and 12px in pills (stroke 2.25). Nav icons are `--muted`, and the active item's icon is `--accent`.

Icons by area:
- Nav: `layout-dashboard`, `tv`, `clapperboard`, `activity`, `arrow-down-to-line`, `history`, `settings`, `monitor-cog`.
- States: `circle-check`, `hourglass`, `triangle-alert`, `pause`, `rotate-cw`.
- Actions: `refresh-cw`, `plus`, `pencil`, `trash-2`, `plug-zap` (Test).

Don't use emoji as icons.

## Breakpoints

The mockup switches layouts with a **container query on the app shell** (`container: app / inline-size`), so the phone preview frame works. In the app, use the matching Tailwind breakpoints:

| Width | Layout |
| --- | --- |
| ≥ 1240px | Five stat cards in a row, three title cards per row, title detail with episodes and sources side by side |
| 1000–1240px | Stats 3+2, two title cards per row, sources below episodes |
| 860–1000px | Settings go to one column, queue items wrap |
| < 860px (phone) | Drawer nav, 16px gutter, single-column cards, tables become stacked cards, modals become bottom sheets, 16px inputs (stops iOS zoom), page actions show icons only |

## Mobile patterns

- Tables become stacked cards, `table.stack` in the mockup. The main cell sits top left and the status or size top right. Other cells follow as rows, labelled with `data-label`.
- Touch targets are at least 38px tall. Filter chips scroll and wrap.
- The drawer closes on navigation, scrim tap and Escape.
- Sticky top bar respects `env(safe-area-inset-top)`, and toasts respect the bottom inset.
- Live values (countdowns, speeds) update in place, with no layout shift. Respect `prefers-reduced-motion`.
