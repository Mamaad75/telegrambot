# Release 1.26.3

- Fixes the missing zero-config `post-bumped` automation rule.
- Detects future ladder/bump/boost expiry post-meta changes on public custom post types and treats them as a new bump cycle.
- Resolves the bump expiry from event context or compatible post meta and schedules a Jarchi reminder exactly 48 hours before expiry.
- Adds the standard `post_bump_expiring` automation with subject «۲ روز تا پایان نردبان آگهی شما ⏳».
- Disables only the stock preset-derived `post_bump_ended` rule on upgrade; manually created custom rules are preserved.
- Dedupe for ladder events includes the expiry timestamp so a renewed bump on the same advert can legitimately produce a new ticket.
- Adds `{bump_expiration_date}` for ticket/e-mail templates.
