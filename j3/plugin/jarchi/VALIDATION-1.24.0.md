# Validation — Jarchi 1.24.0

- PHP syntax: all plugin PHP files linted with `php -l`.
- JavaScript syntax: plugin JavaScript checked with `node --check`.
- ZIP integrity: tested after packaging.
- Version consistency: plugin header, runtime constant and WordPress stable tag are all 1.24.0.
- Navigation review: existing ticket routes preserved; only the sidebar tree is regrouped.
- Category review: default is hidden, global setting is persisted, Elementor can override per widget, shortcode can override explicitly, and an empty category taxonomy never produces an empty select.
