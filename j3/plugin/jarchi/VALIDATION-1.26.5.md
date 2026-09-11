# Validation 1.26.5

- PHP syntax check passed for all 125 PHP files in the package.
- TicketAutomations callback audit: 49 registered `$this` callbacks, 46 unique callback methods, 0 missing methods.
- Designer save endpoint checks the dedicated template capability and can update only `subject` and `body` on preset-derived rules.
- Custom/technical rules without `from_preset` are rejected by the designer endpoint.
- Automation trigger, condition, enable state, department, category, priority, delays, reply policy and hook slug are preserved on designer saves.
- Administrator role always retains template-editor access; selected non-admin roles receive `jarchi_edit_ticket_templates`.
- A role whose key/name contains `designer` or `طراح` is auto-detected on first 1.26.5 migration when no role selection exists.
- Package root remains `jarchi/`.
