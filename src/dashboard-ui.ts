/** The local console is self-contained: no remote fonts, assets, or analytics. */
export const dashboardHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Starmux · Console</title><style>
:root {
  color-scheme: light;
  --bg: #f5f6f3; --panel: #ffffff; --ink: #202b29; --muted: #6b7772;
  --line: #e0e6e0; --blue: #087a61; --soft: #eaf5ef; --danger: #b34242;
  --field: #f8faf7; --hover: #f0f4ef; --sidebar: #172824; --side-ink: #dce9e3;
  --shadow: 0 2px 3px #1b352004, 0 12px 30px #1b352003;
  --radius: 14px;
}
html[data-theme=dark] {
  color-scheme: dark;
  --bg: #111b18; --panel: #18251f; --ink: #e4ece7; --muted: #9aaaa1;
  --line: #2c3d33; --blue: #75d6ad; --soft: #203d30; --danger: #ff9a98;
  --field: #142019; --hover: #223228; --sidebar: #0b1612; --side-ink: #dce9e3;
  --shadow: none;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { min-width: 320px; scrollbar-gutter: stable; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
button, input, select, textarea { font: inherit; color: inherit; }
button, select, input { min-height: 40px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 8px 12px; }
button { cursor: pointer; font-weight: 550; line-height: 1.4; }
button:hover { border-color: var(--blue); background: var(--soft); }
button:disabled { opacity: .48; cursor: not-allowed; }
button.primary { background: var(--blue); color: #fff; border-color: transparent; box-shadow: 0 2px 3px #12392410; }
html[data-theme=dark] button.primary { color: #10291e; }
button.primary:hover { filter: brightness(.94); }
button.danger { color: var(--danger); }
a { color: var(--blue); text-underline-offset: 3px; }
:focus-visible { outline: 3px solid var(--blue); outline-offset: 3px; }
::selection { background: #a8dec4; color: #10291e; }
svg { flex-shrink: 0; vertical-align: middle; }
aside { position: fixed; inset: 0 auto 0 0; width: 238px; padding: 30px 18px 22px; background: var(--sidebar); color: var(--side-ink); display: flex; flex-direction: column; z-index: 20; }
.brand { display: flex; align-items: center; gap: 11px; padding: 0 12px; color: #fff; font-size: 22px; font-weight: 650; letter-spacing: -.8px; }
.brand-mark { display: grid; place-items: center; width: 32px; height: 32px; background: #b7efca; color: #173d2e; border-radius: 9px; }
.eyebrow { margin: 10px 0 36px; padding-left: 55px; color: #91aaa0; font-size: 10px; line-height: 1.5; letter-spacing: 1.5px; font-weight: 600; }
nav { display: grid; gap: 5px; }
nav button { width: 100%; min-width: 0; display: flex; align-items: center; gap: 12px; text-align: left; padding: 11px 13px; border-color: transparent; background: transparent; color: #a9beb3; font-size: 13px; font-weight: 500; }
nav button:hover { color: #f3fcf6; background: #ffffff08; border-color: transparent; }
nav button.active { color: #d7f5e0; background: #2a4436; box-shadow: inset 2px 0 #b2eac6; font-weight: 600; }
.nav-icon { display: inline-flex; align-items: center; justify-content: center; width: 19px; height: 19px; opacity: .82; }
.nav-icon svg { width: 18px; height: 18px; }
.nav-label { min-width: 0; }
.nav-section { padding: 22px 13px 7px; color: #829a8d; text-transform: uppercase; font-size: 10px; font-weight: 650; letter-spacing: 1.6px; }
.aside-bottom { margin-top: auto; padding: 25px 12px 0; color: #96afa1; font-size: 11px; }
.local-badge { display: flex; align-items: center; gap: 8px; padding: 15px 0 7px; border-top: 1px solid #ffffff13; color: #c2d6ca; font-size: 12px; }
.local-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #a4d7b6; box-shadow: 0 0 0 3px #a4d7b611; }
.shell { margin-left: 238px; }
header { min-height: 78px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 36px; background: var(--panel); }
header select { max-width: 260px; font-size: 12px; background: transparent; }
header #instance { font-size: 13px; font-weight: 600; min-width: 200px; }
header #language, header #theme { border-color: transparent; color: var(--muted); }
header #language:hover, header #theme:hover { background: var(--hover); }
header #logout { font-size: 12px; }
.toolbar, .actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
main { max-width: 1320px; padding: 42px 36px 80px; margin: auto; }
h1 { font-size: 30px; line-height: 1.2; font-weight: 650; letter-spacing: -1px; margin: 0 0 10px; }
h2 { font-size: 15px; line-height: 1.5; font-weight: 650; letter-spacing: -.2px; margin: 0 0 22px; }
h3 { font-size: 13px; font-weight: 650; }
p { margin: 12px 0; }
.sub, small { color: var(--muted); }
small { font-size: 12px; }
.page-head { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 30px; }
.page-kicker { display: block; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 1.6px; font-weight: 650; margin-bottom: 10px; }
.page-description { color: var(--muted); font-size: 13px; max-width: 600px; }
.page-indicator { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 7px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 25px; margin-bottom: 22px; box-shadow: var(--shadow); min-width: 0; }
.grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 22px; }
.grid > .panel { min-width: 0; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
.section-heading h2 { margin: 0; }
.overview-hero { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 28px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 28px; margin-bottom: 22px; box-shadow: var(--shadow); }
.overview-hero::before { content: ''; position: absolute; width: 3px; inset: 24px auto 24px 0; background: var(--blue); border-radius: 0 4px 4px 0; }
.hero-copy { min-width: 0; }
.hero-title { font-size: 23px; font-weight: 650; letter-spacing: -.5px; line-height: 1.4; margin: 10px 0 6px; overflow-wrap: anywhere; }
.hero-version { margin-top: 16px; color: var(--muted); font-size: 10px; letter-spacing: .3px; }
.hero-version span { padding: 0 7px; }
.hero-meta { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.hero-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.hero-actions button { font-size: 12px; }
.metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-bottom: 24px; }
.metric { min-width: 0; border-right: 1px solid var(--line); padding-right: 18px; }
.metric:last-child { border: 0; padding-right: 0; }
.metric > small:first-child { text-transform: uppercase; font-size: 10px; letter-spacing: 1px; font-weight: 600; }
.metric > small { display: block; }
.metric strong { display: block; font-size: 21px; font-weight: 600; letter-spacing: -.5px; margin: 10px 0 3px; line-height: 1.4; overflow-wrap: anywhere; }
.metric-icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: var(--soft); color: var(--blue); border-radius: 8px; margin-bottom: 12px; }
.badge, .status-pill { display: inline-flex; align-items: center; gap: 6px; background: var(--soft); color: var(--blue); padding: 4px 9px; border-radius: 5px; font-size: 11px; font-weight: 600; line-height: 1.5; }
.status-pill::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.status-pill[data-status=stopped], .status-pill[data-status=unknown] { color: var(--muted); background: var(--hover); }
.status-pill[data-status=error] { color: var(--danger); background: transparent; border: 1px solid var(--danger); }
.status-pill[data-status=starting], .status-pill[data-status=stopping] { color: #a7751a; background: #f3c87018; }
.row { padding: 16px 0; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.row:last-child { border: 0; }
.row > div { min-width: 0; }
.row strong { display: block; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.row small { display: block; margin-top: 3px; overflow-wrap: anywhere; }
.row button { font-size: 12px; flex-shrink: 0; }
code, pre, textarea { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
code { overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--field); border: 1px solid var(--line); padding: 18px; border-radius: 9px; max-height: 520px; overflow: auto; line-height: 1.8; }
.endpoint-url { display: block; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); color: var(--ink); margin: 18px 0; font-size: 13px; }
.endpoint-card p:last-child { margin-bottom: 0; }
.instance-summary { margin-bottom: 22px; color: var(--muted); font-size: 12px; }
.instance-summary strong { color: var(--ink); font-size: 20px; font-weight: 600; margin-right: 4px; }
.workspace-info { flex: 1; min-width: 0; }
.connection-note { font-size: 11px; margin-top: 18px; }
.empty.compact { padding: 26px 12px; }
.empty.compact svg { color: var(--muted); margin-bottom: 6px; }
.empty.compact h3 { color: var(--ink); margin: 5px 0; }
.empty.compact p { font-size: 12px; margin: 8px 0; }
.instance-options { border: 0; margin-top: 0; padding: 0 2px; }
.runtime-warning { padding: 12px; border: 1px solid var(--danger); border-radius: 8px; color: var(--danger); }
.instance-summary { display: flex; align-items: center; gap: 13px; min-width: 0; }
.workspace-mark { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 40px; height: 40px; color: var(--blue); background: var(--soft); border: 1px solid var(--line); border-radius: 10px; }
.workspace-list .row { padding: 18px 0; }
label { display: grid; gap: 7px; margin: 16px 0; font-size: 12px; font-weight: 500; color: var(--muted); }
input, textarea { width: 100%; }
input::placeholder, textarea::placeholder { color: var(--muted); opacity: .8; }
input[type=checkbox] { width: 15px; height: 15px; min-height: auto; accent-color: var(--blue); vertical-align: middle; margin: 0 5px 0 0; }
textarea { resize: vertical; min-height: 300px; border: 1px solid var(--line); border-radius: 9px; padding: 18px; background: var(--field); color: var(--ink); width: 100%; tab-size: 2; line-height: 1.8; }
#log { background: #101e18; color: #c4dbc9; min-height: 280px; border-color: #2b4033; }
details { margin: 20px 0; border-top: 1px solid var(--line); padding-top: 16px; }
summary { cursor: pointer; color: var(--muted); font-size: 12px; font-weight: 500; }
details[open] > summary { color: var(--ink); margin-bottom: 18px; }
#notice { position: sticky; top: 12px; z-index: 3; margin-bottom: 20px; padding: 13px 16px; border: 1px solid var(--line); background: var(--panel); border-left: 3px solid var(--blue); border-radius: 8px; box-shadow: var(--shadow); font-size: 13px; }
#notice:empty { display: none; }
#notice.error { border-left-color: var(--danger); }
.empty { text-align: center; padding: 48px 20px; color: var(--muted); font-size: 13px; }
.search { max-width: 340px; }
.search-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.search-bar label { margin: 0; }
.field-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 24px; }
.field-grid label { min-width: 0; }
.menu-toggle, .menu-close, .drawer-backdrop { display: none; }
.status-dot { color: var(--blue); }
.secret { border: 1px solid var(--blue); }
.skip-link { position: fixed; left: 260px; top: -80px; z-index: 50; padding: 10px 16px; background: var(--panel); border: 1px solid var(--blue); border-radius: 8px; }
.skip-link:focus { top: 12px; }
@media (min-width: 1500px) { main { padding-top: 50px; } }
@media (max-width: 1100px) { aside { width: 216px; padding-inline: 14px; } .shell { margin-left: 216px; } header { padding-inline: 24px; } main { padding: 32px 24px 60px; } .overview-hero { flex-wrap: wrap; } .hero-actions { justify-content: flex-start; } .grid { gap: 18px; } }
@media (max-width: 850px) {
  aside { display: none; width: 256px; padding-top: 28px; }
  aside.open { display: flex; }
  .drawer-backdrop { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; border-radius: 0; background: #07130eb0; padding: 0; z-index: 19; }
  body:has(aside.open) .drawer-backdrop { display: block; }
  .drawer-backdrop:hover { background: #07130eb0; }
  .menu-close { display: block; position: absolute; right: 12px; top: 12px; border: 0; background: transparent; color: #c7dace; padding: 4px; min-height: 30px; width: 30px; font-size: 20px; }
  .menu-close:hover { background: #ffffff10; }
  .shell { margin-left: 0; }
  .menu-toggle { display: flex; align-items: center; justify-content: center; padding: 8px; width: 36px; min-height: 36px; background: transparent; }
  header { min-height: 72px; padding: 14px 20px; flex-wrap: wrap; gap: 10px; }
  header .toolbar { gap: 6px; }
  header #instance { min-width: 0; max-width: 220px; }
  main { padding: 30px 20px 60px; }
  .page-head { margin-bottom: 25px; }
  .grid, .field-grid { grid-template-columns: minmax(0, 1fr); }
  .panel { padding: 22px; }
  .grid { gap: 0; }
  .skip-link { left: 20px; }
}
@media (max-width: 520px) {
  header { padding: 12px 16px; }
  header > .toolbar:first-child { width: 100%; }
  header #instance { flex: 1; max-width: none; }
  header > .toolbar:last-child { width: 100%; justify-content: flex-end; }
  header #language, header #theme { min-height: 32px; max-width: 145px; font-size: 11px; padding: 5px 7px; }
  header #logout { min-height: 32px; padding: 5px 10px; font-size: 11px; }
  main { padding: 28px 16px 50px; }
  h1 { font-size: 27px; }
  .page-head { align-items: flex-start; flex-wrap: wrap; gap: 15px; }
  .page-description { font-size: 12px; }
  .panel { padding: 20px; border-radius: 12px; }
  .overview-hero { padding: 22px; gap: 20px; border-radius: 12px; }
  .hero-title { font-size: 21px; }
  .hero-actions { gap: 7px; }
  .hero-actions button { min-height: 36px; padding: 8px 10px; }
  .metrics { gap: 10px; }
  .metric { padding-right: 8px; }
  .metric > small { display: block; }
.metric strong { font-size: 16px; margin-top: 8px; }
  .metric > small:first-child { font-size: 9px; letter-spacing: .6px; }
  .metric small { font-size: 10px; }
  .row { flex-wrap: wrap; gap: 10px; }
  .row > div { max-width: 100%; }
  .search-bar { align-items: flex-start; flex-direction: column; gap: 12px; }
  .search { max-width: none; }
  .toolbar input { flex-basis: 100%; }
  .section-heading { align-items: flex-start; }
}
@media (prefers-reduced-motion: no-preference) { button, select, input { transition: background .15s, border-color .15s, color .15s; } }
</style></head>
<body><a class="skip-link" href="#content">Skip to content</a>
<aside id="sidebar" aria-label="Console navigation"><div class="brand"><span class="brand-mark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M5 5l14 14M5 19L19 5" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg></span>Starmux</div><button id="menu-close" class="menu-close" aria-label="Close menu">×</button><div class="eyebrow">LOCAL CONTROL CENTER</div><nav id="nav" aria-label="Main"></nav><div class="aside-bottom"><div class="local-badge">Starmux · Owner local</div><span id="local-note"></span></div></aside>
<button id="drawer-backdrop" class="drawer-backdrop" tabindex="-1" aria-label="Close menu"></button>
<div class="shell"><header><div class="toolbar"><button class="menu-toggle" id="menu" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><select id="instance" aria-label="Instance"></select></div><div class="toolbar"><select id="language" aria-label="Language"><option value="en">English</option><option value="zh">简体中文</option></select><select id="theme" aria-label="Theme"></select><button id="logout">Lock</button></div></header><main><div id="notice" role="status" aria-live="polite"></div><div id="content" tabindex="-1"></div></main></div><script type="module" src="/app.js"></script></body></html>`;

/** Shared surface treatment for compatible per-instance owner pages. */
export function styleLegacyDashboard(html: string) {
  const style = dashboardHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const extra = '<style>' + style + 'body{max-width:1100px;margin:32px auto;padding:0 24px}body>aside{position:static;width:auto;display:block;padding:16px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink)}body>main{padding:24px 0}section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:24px;margin:20px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap}input{max-width:600px}button{margin:8px 0}@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#111b18;--panel:#18251f;--ink:#e4ece7;--muted:#9aaaa1;--line:#2c3d33;--blue:#75d6ad;--soft:#203d30;--field:#142019;--hover:#223228;--danger:#ff9a98}}@media(max-width:520px){body{margin:20px auto;padding:0 16px}section{padding:18px}table{font-size:12px}td,th{padding:8px}}</style>';
  return html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<\/head>/, extra + '</head>').replace(/<\/body>/, '<p class="sub">Starmux Console · <code>starmux dashboard</code></p></body>');
}
