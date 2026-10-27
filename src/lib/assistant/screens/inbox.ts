import type { ScreenManifest, ScreenOverlay } from "./types";

// The shared Inbox (0214). Ids: inbox.* are carried by InboxClient, ThreadClient, CreateFromEmail and ChannelsClient as
// data-guide. The assistant knows how to USE these screens; it never reads a message (mail is private correspondence,
// so there is deliberately no assistant object or Talk-to-data source for it).

export const NAV_INBOX: ScreenOverlay = {
  id: "nav.inbox",
  purpose: "Customer mail from the addresses your team reads: filter by address and status, search by sender or subject, open one to answer it or turn it into a record.",
  controls: [
    { id: "inbox.channel", label: "Address filter", does: "Shows the mail of one address, or all the addresses you are on the team of." },
    { id: "inbox.status", label: "New, Handled, Spam", does: "Shows only the mail with that status; the number is how many there are." },
    { id: "inbox.search", label: "Search", does: "Finds mail by the sender or the subject." },
    { id: "inbox.row", label: "A message in the list", does: "Opens the message and its conversation." },
  ],
  tasks: [
    {
      id: "answer", label: "Answer a customer email",
      steps: [
        { control: "inbox.status", text: "Pick New to see what has not been dealt with." },
        { control: "inbox.row", text: "Open the message." },
        { text: "Write the reply at the bottom and press Send reply, or press Create to turn it into a record." },
      ],
    },
  ],
};

export const INBOX_DETAIL: ScreenManifest = {
  id: "inbox.detail",
  kind: "detail",
  title: "Email",
  purpose: "One customer email and its conversation: its files with a quality label, who it is assigned to, a reply box, and Create to turn it into a Quote, Project, Case, Lead or Estimate.",
  match: (p) => /^\/inbox\/[0-9a-f-]{36}$/i.test(p),
  featureKey: "inbox",
  workcenter: "inbox",
  controls: [
    { id: "inbox.back", label: "Back to the Inbox", does: "Returns to the list." },
    { id: "inbox.assign", label: "Assign", does: "Gives the message to a person on the address's team.", needs: "edit" },
    { id: "inbox.handled", label: "Mark handled", does: "Marks the message as dealt with; Reopen puts it back to New.", needs: "edit" },
    { id: "inbox.spam", label: "Spam", does: "Marks the message as spam so it leaves the New list.", needs: "edit" },
    { id: "inbox.file", label: "A file", does: "Opens or downloads the file; its label says whether it is good enough to measure from." },
    { id: "inbox.create", label: "Create from this email", does: "Opens the list of records this email can become, the address's favourite first.", needs: "edit" },
    { id: "inbox.reply", label: "Reply box", does: "Write the answer; it goes only to the person who wrote, threaded in their mail.", needs: "edit" },
    { id: "inbox.ask_drawing", label: "Ask for PDF or DXF", does: "Fills the reply with a ready message asking for a drawing as a PDF or DXF.", needs: "edit" },
    { id: "inbox.send", label: "Send reply", does: "Sends the reply and keeps it in the conversation.", needs: "edit" },
  ],
  tasks: [
    {
      id: "to_quote", label: "Turn an email into a quote",
      steps: [
        { control: "inbox.create", text: "Press Create from this email and choose Quote." },
        { text: "Check the account (the sender is matched for you, or create a new one) and press Create." },
      ],
    },
    {
      id: "better_drawing", label: "Ask the customer for a better drawing",
      steps: [
        { control: "inbox.file", text: "Look at the label on each file: Poor or Needs review means it cannot be measured with confidence." },
        { control: "inbox.ask_drawing", text: "Press Ask for PDF or DXF to fill in the reply." },
        { control: "inbox.send", text: "Press Send reply." },
      ],
    },
  ],
};

export const SETTINGS_INBOX_CHANNELS: ScreenOverlay = {
  id: "settings.inbox_channels",
  controls: [
    { id: "inbox.channels.new", label: "New channel", does: "Opens the panel to add an address customers can write to.", needs: "admin" },
    { id: "inbox.channels.row", label: "A channel in the list", does: "Opens its panel: team, what Create offers first, mailbox and reply-from." },
    { id: "inbox.channels.copy", label: "Copy address", does: "Copies the channel's address, to forward your own mail to or to put on the website." },
    { id: "inbox.channels.team", label: "Team", does: "Who can see and answer this channel's mail; empty means everyone with the Inbox.", needs: "admin" },
    { id: "inbox.channels.mailbox", label: "Mailbox", does: "Reads the company's own Gmail or mail server into this channel, without changing anything in it.", needs: "admin" },
    { id: "inbox.channels.save", label: "Create / Save", does: "Saves the channel.", needs: "admin" },
  ],
  tasks: [
    {
      id: "add", label: "Add an address customers can write to",
      steps: [
        { control: "inbox.channels.new", text: "Press New channel and give it a name, for example Fence enquiries." },
        { control: "inbox.channels.team", text: "Pick the team who should read it, or leave it for everyone." },
        { control: "inbox.channels.save", text: "Press Create, then copy the address with the copy button." },
        { text: "Forward your company mail to that address, or put it on your website." },
      ],
    },
  ],
};
