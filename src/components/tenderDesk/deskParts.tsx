import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { ROUTES } from "@/lib/constants";

/** The tender tables are not there yet (migration pending): one calm card, no figures, no jargon. */
export function PendingState() {
  return (
    <Card>
      <div data-guide="tender.desk.pending">
        <EmptyState title="Tender data is not set up yet" text="Ask your administrator to finish setting up tenders for this workspace." />
      </div>
    </Card>
  );
}

/** Nothing open: say so and point at the one next step. */
export function NoOpenTenders() {
  return (
    <Card>
      <div data-guide="tender.desk.empty">
        <EmptyState
          title="No open tenders yet"
          text="Add the first tender and the desk fills in."
          action={<Button href={ROUTES.pipelineNewTender} variant="primary" data-guide="tender.desk.new">+ New tender</Button>}
        />
      </div>
    </Card>
  );
}
