# Website step-by-step guides: shared brief (2026-10-30)

Goal: for each product object/module, a public page on bpmsquare.com that teaches it the way the tender walkthrough does: tasks ("flows"), one numbered step per click, one close-up screenshot per step with a red box and a red numbered badge on exactly what to click. Static HTML site, no build step.

## Where things go
- Site repo: `C:\Users\Abdul Nandalpad\Documents\bpmsquare-site` (branch main). Product repo: `C:\Users\Abdul Nandalpad\Documents\bpmsquare-app` (read-only for you except this brief's template).
- One page per module: `guide-<slug>.html` in the site repo root, built from `docs/website-guide-template.html` (product repo). Copy the `<svg>` sprite, `<header>`, the CTA block and `<footer>` from `tenders.html` exactly. Do NOT edit any other site page, `site.css` or `guides.css`; the lead builds `guides.html` (index) and adds the nav link.
- Images: `assets/guides/<slug>/NN-short-name.jpg` (JPEG, quality ~80, width at most 1100 px, usually 30 to 120 KB). Give every `<img>` real `width`/`height`, a meaningful `alt`, `loading="lazy"`.
- Commit locally in the site repo with a path-specific `git add` of only your files: message "Guide: <module names>" ending with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. NEVER push, never deploy.

## What a page contains
- Hero: title "<Module>, step by step", one or two sentences (what you do here, what you get), chips linking to each flow.
- 2 to 4 flows per module, each a real task (for example for Accounts: "Add an account", "Find an account and see everything about it", "Import many accounts"). Each flow has 5 to 12 steps. A step = one click or one entry: heading starts with a verb ("Click **New account**"), one or two short sentences, labels in bold EXACTLY as shown on screen (read the page text to confirm), then the picture. Say what the user sees afterwards when it matters. Where an "i" icon explains a label, say so once.
- Style: short sentences, no marketing words, no running paragraphs, plain words. This is a how-to, not a brochure.
- Only describe what you saw working in the product. If a flow needs data or permission you do not have, capture what you can and list the gap in your final reply; do not invent screens.

## Capturing (Claude in Chrome)
- Load the tools in ONE ToolSearch call: `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__browser_batch,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__find,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__get_page_text`.
- The user's Chrome is signed in to the DEMO workspace at https://app.bpmsquare.com (sample data, safe to show). Do NOT use kamco.bpmsquare.com (a client's workspace). Open your OWN tab with `tabs_create_mcp` and close it at the end. Other agents capture in their own tabs at the same time: always pass your own `tabId`, never touch other tabs, never use the desktop window resize.
- Marking the click target before each close-up: with `javascript_tool` find the element (by text/role/data-guide) and add a 3px red outline plus a numbered badge, then zoom and remove the marks:
  `el.style.outline='3px solid #e5322d'; el.style.outlineOffset='3px'; el.style.borderRadius='6px';` and a badge `<span data-gmark style="position:absolute;z-index:99999;width:26px;height:26px;border-radius:50%;background:#e5322d;color:#fff;font:700 14px/26px sans-serif;text-align:center">N</span>` placed at the element's top-left via getBoundingClientRect + scroll offsets. Remove all `[data-gmark]` and the outline afterwards. The badge number equals the step number in the page text.
- Close-ups: use the `computer` action `zoom` with `region` around the element plus enough context (about 700 x 400 CSS px) so labels are readable; `save_to_disk: true` returns a file path; convert/resize to JPEG into the site repo (use Python Pillow if installed: `python -c "import PIL"`; otherwise node `sharp`; otherwise ask the lead). One click target per image. Where a click opens a panel, add one more close-up of the panel.
- Phone: you may add 1 or 2 phone close-ups (375 px) per page using a same-origin iframe overlay (`javascript_tool` injects a fixed full-screen div with an iframe of width 375px pointing at the current URL; remove it afterwards). Optional.
- READ-ONLY. Do not save, send, create, delete or approve anything. Open "New ..." forms and side panels and close them with Cancel/Close. Never click Send, Save, Delete, Approve, Submit, Import (apply), or any button that changes data or sends email/WhatsApp. If a screen needs a value to proceed, type into fields only to show them (then cancel). Do not change settings or toggle feature flags. If you changed a UI preference (an expanded/collapsed section), put it back.
- Privacy: crop out the top bar (it shows the signed-in user's email) and anything showing a real person's address or phone number from outside the sample data. Check every image before you keep it. Sample data names are fine.
- If a tool call fails twice, stop retrying, note the gap, and move on.
- Heavy commands (pip, node image scripts over many files) take turns: `until mkdir .tmp-heavy.lock 2>/dev/null; do sleep 20; done; <command>; rc=$?; rmdir .tmp-heavy.lock; exit $rc` in the site repo root (remove any lock you hold).

## Final reply (short)
Per page: file name, title, one-line blurb for the index card, number of flows, number of steps/images; then the gaps (screens you could not capture and why) and anything wrong you noticed in the product.
