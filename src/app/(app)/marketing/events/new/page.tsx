import { localInputs } from "@/lib/marketing/events/rules";
import EventForm from "../EventForm";
import { eventsPage } from "../pageData";
import { formPickers } from "../pickers";

// A new event. Nothing is saved until the person presses Create event.
export default async function NewEventPage() {
  const ctx = await eventsPage("create");
  const p = await formPickers(ctx);
  const nextWeek = localInputs(new Date(Date.now() + 7 * 86_400_000).toISOString(), ctx.tenant.timezone);
  return (
    <EventForm
      mode="create"
      initial={{
        name: "", kind: "webinar", status: "draft", date: nextWeek.date, time: "10:00", end_time: "", venue: "", link: "", capacity: "", description: "",
        form_id: "", follow_up_journey_id: "", follow_up_on: "attended", owner_user_id: ctx.userId,
      }}
      forms={p.forms} journeys={p.journeys} members={p.members} timezone={ctx.tenant.timezone} canEdit={ctx.can.create}
    />
  );
}
