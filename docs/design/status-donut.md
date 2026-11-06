# Status filter: a donut, collapsed by default

Owner, 2026-11-06: the status chips on almost every list take a lot of room (on a phone, four rows before the first record), so they become an interactive donut that is collapsed by default, on desktop and phone, in every theme.

**What already exists:** `ObjectListPage` (`src/components/page/ObjectListPage.tsx`) draws the chip row for every list that passes `chips`. One place, so one change.

**What it is now:** `ListStatusFilter` (client component). Collapsed: one pill with a mini donut, the current filter, a chevron. Opened: a donut of the statuses (centre: the total) with a legend, and the cross-cutting views (All, rollups) as small pills. A slice or a legend row is a link, so filtering still goes through the URL and the back button, exactly as before.

**Which chips are slices:** a donut needs statuses that do not overlap. A list may say so with `kind: "slice" | "also"` on a chip (RFQs does). Otherwise it is worked out: when the counts in the labels of every chip except All add up to the count of All, those chips are the slices. When they do not (Cases: Open, In repair, Awaiting, Closed, All), there is no donut and the pill opens to the same chips as before. The label's trailing "(n)" is the count.

**Themes:** colours come from the shared theme tokens (`c.*`, `pillar.*`), so it follows each theme and dark mode. Rich gets its capsule styling from `rich-native.css`.

**Not covered:** lists that draw their own filter UI instead of `ObjectListPage` chips (the Accounts Rich view, Invoices' "Credit notes" switch).
**Live-client screens that change:** every list with chips (Vikas, BIM, KAMCO workspaces included): the chips are one pill until opened.
