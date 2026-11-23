// The company brief's layout (docs/design/company-brief-mockup.html). One stylesheet for one component that is drawn in two
// places: the dock (narrow) and the account's Company brief tab (wide). It adapts to ITS OWN width with container queries, not to
// the window, so the same markup is right at 375 px and on a PC. Colours are the app's own tokens, so both colour modes follow.

export const BRIEF_BREAK_TILES = 620;
export const BRIEF_BREAK_STACK = 520;

export const BRIEF_CSS = `
.bms-brief { container-type: inline-size; width: 100%; box-sizing: border-box; background: var(--card-bg, var(--panel)); border: 1px solid var(--line); border-radius: var(--card-radius, 10px); font-size: 12.5px; line-height: 1.45; color: var(--ink); overflow: hidden; }
.bms-brief .m { color: var(--hint); font-weight: 400; }
.bms-brief .ref { color: var(--accent); font-weight: 650; white-space: nowrap; text-decoration: none; }
.bms-brief .chipb { background: var(--accentbg); border: 1px solid var(--line); color: var(--accent); border-radius: 999px; padding: 6px 14px; font-size: 12px; font-weight: 650; min-height: 44px; min-width: 44px; cursor: pointer; font-family: inherit; }
.bms-brief .chipb:disabled { opacity: .6; cursor: default; }
.bms-brief .chipb:focus-visible, .bms-brief .bhead:focus-visible, .bms-brief .lnk:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.bms-brief .head { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-start; padding: 12px 14px; }
.bms-brief .head .who { flex: 1 1 220px; min-width: 0; }
.bms-brief .name { font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
.bms-brief .one { color: var(--muted); margin-top: 2px; overflow-wrap: anywhere; }
.bms-brief .made { color: var(--hint); font-size: 11.5px; margin-top: 4px; display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.bms-brief .acts { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.bms-brief .status { padding: 0 14px 8px; font-size: 12px; color: var(--amberink); }
.bms-brief .miss { margin: 0 14px 10px; background: var(--amberbg); color: var(--amberink); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.bms-brief .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 0 14px 12px; }
@container (min-width: ${BRIEF_BREAK_TILES}px) { .bms-brief .tiles { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
.bms-brief .tile { background: var(--panel2); border: 1px solid var(--line); border-radius: 10px; padding: 10px 11px; min-width: 0; }
.bms-brief .tl { font-size: 11.5px; color: var(--muted); }
.bms-brief .tv { font-size: 16px; font-weight: 700; margin-top: 2px; overflow-wrap: anywhere; line-height: 1.25; }
.bms-brief .tv.up { color: var(--greenink); }
.bms-brief .tv.down { color: var(--redink); }
.bms-brief .tv.nopub { font-size: 13px; color: var(--muted); font-weight: 600; }
.bms-brief .ts { font-size: 11px; color: var(--hint); margin-top: 2px; }
.bms-brief .chk { color: var(--hint); font-style: italic; }
.bms-brief .hist { margin: 0 14px 12px; padding: 10px 12px; border: 1px dashed var(--line); border-radius: 10px; }
.bms-brief .hh { display: flex; gap: 4px; align-items: center; margin-bottom: 4px; font-weight: 650; }
.bms-brief .hrow { display: flex; gap: 6px 16px; flex-wrap: wrap; }
.bms-brief .hgap { color: var(--amberink); margin-top: 4px; font-size: 12px; }
.bms-brief .blk { border-top: 1px solid var(--line); }
.bms-brief .bhrow { display: flex; align-items: center; }
.bms-brief .bhead { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; min-height: 44px; padding: 8px 14px; background: none; border: none; cursor: pointer; font-family: inherit; text-align: left; color: var(--ink); font-size: 13px; font-weight: 650; }
.bms-brief .chev { width: 7px; height: 7px; border-right: 2px solid var(--hint); border-bottom: 2px solid var(--hint); transform: rotate(-45deg); transition: transform .15s; flex: none; }
.bms-brief .bhead[aria-expanded="true"] .chev { transform: rotate(45deg); }
@media (prefers-reduced-motion: reduce) { .bms-brief .chev { transition: none; } }
.bms-brief .cnt { margin-left: auto; color: var(--hint); font-weight: 600; font-size: 12px; }
.bms-brief .tipw { padding-right: 10px; flex: none; }
.bms-brief .bbody { padding: 0 14px 12px; }
.bms-brief .why, .bms-brief .lst, .bms-brief .srcs { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 9px; }
.bms-brief .lst { margin-top: 8px; }
.bms-brief .lst li, .bms-brief .srcs li { overflow-wrap: anywhere; }
.bms-brief .why li { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 10px; align-items: start; }
@container (max-width: ${BRIEF_BREAK_STACK}px) { .bms-brief .why li { grid-template-columns: minmax(0, 1fr); gap: 4px; } }
.bms-brief .dchip { display: inline-block; font-size: 11.5px; font-weight: 650; background: var(--panel2); border: 1px solid var(--line); border-radius: 6px; padding: 2px 8px; white-space: nowrap; justify-self: start; }
.bms-brief .dchip.s { margin-right: 6px; }
.bms-brief .sw { color: var(--muted); font-size: 12px; margin-top: 2px; padding-left: 8px; border-left: 2px solid var(--line); }
.bms-brief .old .wt { color: var(--muted); }
.bms-brief .olds { color: var(--hint); font-size: 11.5px; }
.bms-brief .infer { font-size: 11px; font-weight: 600; color: var(--purpleink); background: var(--purplebg); border-radius: 6px; padding: 1px 7px; margin-left: 6px; white-space: nowrap; }
.bms-brief .tbl { display: flex; flex-direction: column; }
.bms-brief .tr { display: grid; grid-template-columns: 1.05fr 1.7fr 1.5fr .9fr; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); align-items: start; }
.bms-brief .tr.three { grid-template-columns: 1.05fr 1.7fr 1.5fr; }
.bms-brief .tr.th { border-top: 0; color: var(--hint); font-size: 11.5px; font-weight: 650; padding-top: 0; }
.bms-brief .fn { font-weight: 650; }
.bms-brief .inf { color: var(--muted); padding-left: 8px; border-left: 2px solid var(--line); }
.bms-brief .gap { color: var(--amberink); }
@container (max-width: ${BRIEF_BREAK_TILES}px) {
  .bms-brief .tr.th { display: none; }
  .bms-brief .tr, .bms-brief .tr.three { grid-template-columns: minmax(0, 1fr); gap: 3px; padding: 10px 0; }
  .bms-brief .tr > div[data-l]:not(.fn)::before { content: attr(data-l) ": "; color: var(--hint); font-size: 11px; }
  .bms-brief .inf { padding-left: 0; border-left: 0; }
}
.bms-brief .note { font-size: 11.5px; color: var(--hint); margin-top: 8px; }
.bms-brief .fit { margin: 0 14px 12px; border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 10px; background: var(--accentbg); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.bms-brief .fh { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 13.5px; }
.bms-brief .fh .infer { margin-left: 0; }
.bms-brief .pairs { display: grid; gap: 6px; }
.bms-brief .pair { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; }
.bms-brief .from { font-size: 11px; color: var(--hint); }
.bms-brief .qh { font-size: 12px; font-weight: 650; color: var(--muted); }
.bms-brief .qs { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; }
.bms-brief .bars { display: flex; align-items: flex-end; gap: 14px; height: 132px; padding: 6px 0 0; flex-wrap: wrap; }
.bms-brief .barset { display: flex; align-items: flex-end; gap: 14px; height: 100%; }
.bms-brief .bar { width: 64px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
.bms-brief .col { width: 100%; height: var(--h); max-height: 84px; min-height: 20px; background: var(--accent); border-radius: 6px 6px 0 0; position: relative; opacity: .9; }
.bms-brief .col span { position: absolute; top: -18px; left: 0; right: 0; text-align: center; font-weight: 700; font-size: 12px; color: var(--ink); }
.bms-brief .bl { font-size: 11.5px; color: var(--hint); margin-top: 4px; }
.bms-brief .barn { flex: 1 1 180px; font-size: 12px; color: var(--muted); align-self: center; }
.bms-brief .tw b { color: var(--greenink); }
.bms-brief .hw b { color: var(--amberink); }
.bms-brief .comp { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.bms-brief .proxy { margin: 0 14px 12px; border: 1px dashed var(--line); border-radius: 10px; padding: 9px 12px; }
.bms-brief .srcs { gap: 4px; font-size: 12px; }
.bms-brief .lnk { color: var(--accent); text-decoration: none; }
.bms-brief .more { margin-top: 6px; }
.bms-brief .pick { margin: 0 14px 12px; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.bms-brief .pi { padding: 6px 8px; border-radius: 8px; background: var(--panel2); display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.bms-brief .finp { border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; font-size: 16px; font-family: inherit; min-height: 44px; background: var(--panel); color: var(--ink); }
.bms-brief .err { font-size: 11.5px; color: var(--redink); }
.bms-prog { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.bms-prog li { display: flex; gap: 8px; align-items: center; }
.bms-prog .pd { width: 10px; height: 10px; border-radius: 50%; flex: none; border: 2px solid var(--hint); box-sizing: border-box; }
.bms-prog .pd.done { background: var(--greenink); border-color: var(--greenink); }
.bms-prog .pd.missing { background: var(--amberink); border-color: var(--amberink); }
.bms-prog .pd.running { border-color: var(--accent); border-top-color: transparent; animation: bms-sp 1s linear infinite; }
@keyframes bms-sp { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .bms-prog .pd.running { animation: none; border-top-color: var(--accent); } }
`;
