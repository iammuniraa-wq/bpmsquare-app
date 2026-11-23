# drawing_register
status: experimental
plain: Numbered engineering drawings with revisions A, B, C, a release signed by a named approver, and a comparison when a new revision arrives. Only a released revision can feed a bill of quantities or a handover.
rules:
- A revision moves draft, in review, released, then superseded when a later one is released. A released revision is a record: its file, label and number never change, and a mistake is fixed by a new revision.
- Who may release is set per drawing type (Settings, Drawing types): the named approvers, or a workspace admin when none are named. When the type asks for a second person, the person who submitted a revision cannot release it.
- Files go to a private store and are opened only through a short-lived link after a workspace check. SVG and HTML files are refused whatever they are called, and a file's fingerprint is checked again when the revision is released.
- Elements are read from an Excel or CSV schedule exported from the model. A unit the file does not state must be confirmed before it loads; a missing weight is worked out from the volume and marked as calculated. Reading IFC models is not built yet.
- A new revision is compared with the last release by model id, then by element code; elements with neither are listed and never guessed.
- A tender bill of quantities line can take a quantity from a released revision. It sits beside the client's own quantity, which is never changed. A later release flags the line for review and changes nothing by itself: a person applies it, or keeps the old quantity and says why.
- The project baseline cannot be asked for while a bill of quantities line still carries a quantity from an older revision. The handover Excel has a Drawings sheet of released elements.
- A connector can never release. Nothing is sent to the ERP yet: the F&O interface and a link to Autodesk's cloud are not built.
- The flag is set by a platform admin; a workspace without it sees no menu entry, screen, button or API answer, and the new tables are never read.
