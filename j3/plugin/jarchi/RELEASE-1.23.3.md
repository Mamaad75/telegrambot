# Jarchi 1.23.3

## Embedded ticket centre

The Elementor ticket centre is now location-owned by the designer. Every list/detail link and every customer form uses the current JetEngine/Elementor host URL as its base, preserving the surrounding sidebar/template. Ticket submit/reply/rating use a same-origin validated return URL, so the POST/redirect/GET cycle refreshes the host page rather than navigating to Jarchi's legacy ticket page.

Jarchi no longer auto-creates a WordPress ticket page. Existing pages are preserved but are optional legacy destinations.

The Elementor wrapper is a CSS size container; new container queries make the ticket UI respond to the actual widget slot width rather than only the browser viewport.
