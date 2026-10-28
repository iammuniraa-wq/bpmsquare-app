import Donut, { type DonutSlice } from "@/components/Donut";
import type { TenderDeskClient, TenderDeskData, TenderDeskStyle } from "@/lib/tenderDesk/types";
import { tenderLinks } from "@/lib/tenderDesk/links";
import { clientsAria, millions } from "./format";
import { clientPalette, lookVars } from "./look";
import s from "./tenderBlocks.module.css";

const isOthers = (c: TenderDeskClient) => c.accountId === null && c.name === "Others";

/** Where a client's slice goes: the tenders of that client; the "Others" slice and a client without an account go to all tenders. */
export const clientHref = (c: TenderDeskClient): string => (isOthers(c) || !c.accountId ? tenderLinks.tab : tenderLinks.client(c.accountId));

/** The slices of the donut, in the data's order (top five, then Others), coloured from the look's palette. */
export function clientSlices(clients: TenderDeskClient[], look: TenderDeskStyle, currency: string): DonutSlice[] {
  const palette = clientPalette(look);
  return clients.map((c, i) => ({
    label: c.name,
    value: c.value,
    color: isOthers(c) ? palette.others : palette.colours[i % palette.colours.length],
    href: clientHref(c),
    ariaLabel: `${c.name}: ${millions(c.value)} ${currency}, ${c.count === 1 ? "1 tender" : `${c.count} tenders`}`,
  }));
}

/**
 * Open value by client, as the app's own hover donut: a hovered (or focused) wedge lifts out, the others dim, the centre readout switches to
 * that client and the legend row lights with it. Each wedge and each legend row opens the tenders of that client.
 */
export default function ClientDonut({ data, look }: { data: TenderDeskData; look: TenderDeskStyle }) {
  const total = data.clients.reduce((sum, c) => sum + c.value, 0);
  return (
    <div className={s.blk} style={lookVars(look)} data-look={look} data-guide="tender.dash.clients" aria-label={clientsAria(data.clients, data.currency)}>
      {data.clients.length === 0 || total <= 0 ? <p className={s.quiet}>No open value to show.</p> : (
        <Donut
          slices={clientSlices(data.clients, look, data.currency)}
          title={undefined}
          centerLabel={`${data.currency} open`}
          centerValue={millions(total)}
          formatValue={millions}
          size={150}
          thickness={20}
        />
      )}
    </div>
  );
}
