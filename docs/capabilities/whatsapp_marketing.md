# whatsapp_marketing
status: experimental
plain: Send an approved WhatsApp template message to a person who agreed to hear from you on WhatsApp, see what was sent and answered, and add a WhatsApp step to a journey.
rules:
- Nothing is sent to a person who has not agreed to WhatsApp for the template's topic, who withdrew, or who is marked do not contact; this is checked at the moment of sending and cannot be switched off.
- Only templates marked approved can be sent, and a message outside 24 hours of the person's last reply can only be a template; a free-form reply is for a person on the record and never for a journey.
- A reply of STOP (or the Arabic equivalent) withdraws the person's WhatsApp consent at once; START records it again.
- A demo workspace never reaches a real number: a message goes to the test number set for the workspace, or is only logged.
- The shell has no live WhatsApp provider yet; the default is a sandbox that logs what would be sent and calls nothing outside.
- Switched on per workspace by a platform admin and needs Marketing campaigns; until then there is no menu item, no journey step and the webhook answers not found.
