# ai_assistant_actions
status: experimental
plain: The assistant can propose a new account or contact as a card showing every field; nothing is created until the person presses the button on the card.
rules:
- The assistant never creates anything by itself: it shows a card with each field and its value, the person can edit any value, and the record is created only when they press the button on the card.
- A required field that is empty is flagged on the card and the create is refused until it is filled; the assistant fills a field only with what the person said or what is on their open screen, and never guesses a value.
- Similar records that already exist are listed on the card with a button to open them instead, before anything is created; if the list is different when the button is pressed, the person is asked to look again.
- The record is made by the object's own create route on the person's own session, so the module, the Business Role, the checks on linked records, encryption of phone and email, the reference number and custom fields all apply exactly as in the New form.
- Each card can be used once: pressing it twice, pressing it as another user, or pressing it in another workspace does nothing.
- Change History shows the record as created "via assistant", and an assistant action row records the card, the final values (phone and email are not written in the clear) and the result.
- Switched on per workspace by a platform admin, and it needs the AI assistant and Nova; until then the assistant has no create tool and the confirm endpoint answers 403.
