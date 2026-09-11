# Validation 1.21.2

- PHP syntax: 124/124 passed.
- JavaScript syntax: 10/10 passed.
- New-ticket URL resolver refuses a duplicate inbox/new-page id, recovers the canonical jarchi-new-ticket page, and always appends jarchi_view=new.
- New-ticket CTA has both a native href fallback and capture-phase navigation protection against theme/AJAX link interception.
- FAQ continuation only cancels native navigation after the inline form is found; otherwise jarchi_form=1 remains functional.
