// Why a WhatsApp message was not sent, in the words a person reads. The codes are the ones sendWhatsAppTemplate()
// returns (the consent ones are canContact()'s own). Pure.

export const REASONS: Record<string, string> = {
  module_off: "WhatsApp is not switched on for this workspace.",
  no_consent: "No WhatsApp consent on record for this topic, so nothing was sent.",
  withdrawn: "The person withdrew their WhatsApp consent, so nothing was sent.",
  do_not_contact: "The person is marked do not contact, so nothing was sent.",
  suppressed: "This number is suppressed, so nothing was sent.",
  account_opted_out: "The company opted out of marketing, so nothing was sent.",
  contact_not_found: "The person could not be found.",
  unavailable: "Consent could not be checked, so nothing was sent.",
  template_missing: "The template no longer exists.",
  template_not_approved: "The template is not approved yet, so it cannot be sent.",
  no_identity: "No WhatsApp number is set up for this workspace yet.",
  no_phone: "The person has no phone number that can be used on WhatsApp (it needs a country code).",
  weekly_cap: "The person already had a marketing WhatsApp message this week.",
  session_needs_person: "A free-form message must be sent by a person, not by a journey.",
  window_closed: "More than 24 hours have passed since the person last wrote, so only an approved template can be sent.",
  send_failed: "The message could not be sent.",
  dry_run: "Logged only: this workspace does not send to real numbers.",
};
