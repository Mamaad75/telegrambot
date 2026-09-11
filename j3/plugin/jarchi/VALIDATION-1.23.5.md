# Validation — Jarchi 1.23.5

- PHP syntax lint: all plugin PHP files
- Assignment form action points to WordPress `admin-post.php`
- Assignment handler validates ticket permissions and support-agent role
- Return URL is validated with `wp_validate_redirect`
- Empty support-agent state is explicit and non-interactive
