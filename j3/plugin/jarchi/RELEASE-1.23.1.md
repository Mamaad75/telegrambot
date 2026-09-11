# Jarchi WordPress Plugin 1.23.1

## Customer ticket submit hotfix

The customer-facing ticket create/reply/rating forms no longer post to `wp-admin/admin-post.php`. Logged-in subscribers now post back to the public Jarchi ticket page, where `template_redirect` dispatches the request after nonce and login checks. This avoids account/profile plugins that redirect non-admin users away from wp-admin before `admin_post_*` fires.

A priority-0 `admin_init` compatibility bridge remains for cached <=1.23.0 forms that still post to admin-post.php, but only for ordinary customers; staff/admin back-office routes keep their normal behavior.
