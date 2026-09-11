# Validation 1.26.0

- PHP syntax: all 124 PHP files pass `php -l` on PHP 8.4.
- Admin pagination: every page number is built from `Admin::app_url('support')`; `jarchi_view=support` is never reconstructed by `paginate_links()`.
- Customer Elementor inbox: embedded list switches to the compact table at a 700px container width and keeps cards below 700px.
- Elementor list controls: subject/meta/header/row/hover colours plus row spacing, table radius, subject/meta/header sizes and page heading size are wired into scoped CSS variables.
- Automated ticket migration: existing automated tickets recover department from the saved rule first and preset subject second; sender meta and first message author become `جارچی — <department>`.
- Legacy automated detection: post marker, origin, automation id, first-comment automation marker and existing Jarchi sender label are recognized.
