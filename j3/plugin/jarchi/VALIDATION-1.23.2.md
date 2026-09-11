# Validation — Jarchi WordPress Plugin 1.23.2

- PHP syntax lint passed for all plugin PHP files.
- Admin reply redirect now resolves to the canonical WordPress-admin support view with the current ticket id.
- Customer reply redirect remains unchanged and continues to return to the public ticket conversation.
- Open-ticket count reuses the existing grouped ticket-status query and defines open as all states except `closed`.
- Support sidebar renders the count as plain black text beside `تیکت‌ها`; no background, border, pill or chip is added.
- Counter is hidden with labels in the collapsed icon rail.
