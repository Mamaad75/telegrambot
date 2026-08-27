<?php
/**
 * Webhook payload contract builder.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Assembles the JSON document exchanged with the Node.js service.
 *
 * The contract is intentionally the only place that knows the shape of
 * the wire format. {@see Normalizer} keeps collecting WordPress data into
 * a flat structure; this class maps that structure onto the payload, so a
 * future contract revision touches exactly one file.
 *
 * The document carries the advertisement twice, on purpose:
 *
 * 1. **Flat fields at the top level** — `post_id`, `title`, `description`,
 *    `price`, `location`, `url`, `images`. This is what the Node.js
 *    Telegram Publisher reads to build a message, and it matches the
 *    payload shape a manual `curl` test uses.
 * 2. **Structured blocks** — `site`, `post`, `author`, `listing`, `media`,
 *    `taxonomy`. These are the version 1.1.0 envelope, kept unchanged so
 *    existing consumers, filters and integrations keep working.
 *
 * Both views describe the same event and are built from the same data, so
 * they can never disagree.
 *
 * Envelope:
 *
 *     {
 *       "event_id":    "evt_…",
 *       "event_type":  "created|updated|deleted",
 *       "timestamp":   "2026-07-25T10:30:00Z",
 *       "post_id":     123,
 *       "title":       "…",
 *       "description": "…",
 *       "price":       "…",
 *       "location":    "…",
 *       "url":         "https://example.com/ad/123",
 *       "images":      [ "https://…/1.jpg" ],
 *       "fields":      { "<key>": <value> },
 *       "field_meta":  { "<key>": { "label", "order", "type", … } },
 *       "site":        { "id", "name", "url", … },
 *       "post":        { "id", "type", "status", "title", … },
 *       "author":      { "id", "name", "email", "phone" },
 *       "listing":     { "price", "city", "custom_fields" },
 *       "media":       { "featured_image", "gallery" },
 *       "taxonomy":    { "categories", "tags" }
 *     }
 *
 * `field_meta` is keyed identically to `fields` and describes it, so a
 * consumer never has to infer what a field means from its key.
 *
 * Every block is always present, so the consumer never has to guard
 * against missing keys.
 *
 * @since 1.1.0
 */
class Contract {

	/**
	 * Contract version advertised to the consumer.
	 *
	 * @since 1.2.0 Bumped to 1.1: flat advertisement fields were added
	 *              alongside the existing blocks. No field was removed.
	 * @since 1.5.1 Bumped to 1.2: `field_meta` was added, describing the
	 *              entries in `fields`. No field was removed or renamed, so
	 *              a consumer written against 1.1 keeps working unchanged.
	 * @since 1.6.0 Bumped to 1.3: `publication_targets` and `buttons` were
	 *              added. Every 1.2 block is still present and unchanged, so a
	 *              consumer written against any earlier version keeps working;
	 *              one that has not been taught about the new blocks simply
	 *              ignores them.
	 *
	 * @var string
	 */
	public const VERSION = '1.3';

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Constructor.
	 *
	 * @since 1.1.0
	 *
	 * @param Settings $settings Settings service.
	 */
	public function __construct( Settings $settings ) {
		$this->settings = $settings;
	}

	/**
	 * Builds the `site` block.
	 *
	 * @since 1.1.0
	 *
	 * @param array<string,mixed> $flat Flat normalized payload, when available.
	 *
	 * @return array<string,mixed> Site block.
	 */
	public function site( array $flat = array() ): array {
		$site = array(
			'id'                => $this->settings->site_id(),
			'name'              => isset( $flat['site_name'] ) ? (string) $flat['site_name'] : get_bloginfo( 'name' ),
			'url'               => isset( $flat['site_url'] ) ? (string) $flat['site_url'] : home_url(),
			'language'          => isset( $flat['language'] ) ? (string) $flat['language'] : get_locale(),
			'wordpress_version' => isset( $flat['wordpress_version'] ) ? (string) $flat['wordpress_version'] : get_bloginfo( 'version' ),
			'plugin_version'    => WPEP_VERSION,
			'contract_version'  => self::VERSION,
		);

		/**
		 * Filters the `site` block of the webhook envelope.
		 *
		 * @since 1.1.0
		 *
		 * @param array<string,mixed> $site Site block.
		 * @param array<string,mixed> $flat Flat normalized payload.
		 */
		return apply_filters( 'wpep_contract_site', $site, $flat );
	}

	/**
	 * Builds the complete payload for an event.
	 *
	 * @since 1.1.0
	 *
	 * @param Event               $event     Event being delivered.
	 * @param array<string,mixed> $flat      Flat payload from the normalizer.
	 * @param string              $timestamp ISO 8601 UTC timestamp.
	 *
	 * @return array<string,mixed> Webhook payload.
	 */
	public function build( Event $event, array $flat, string $timestamp ): array {
		$post_block = $this->post_block( $flat );
		$media      = $this->media_block( $flat );

		$payload = array_merge(
			array(
				'event_id'         => $event->id(),
				'event_type'       => $event->type(),
				'timestamp'        => $timestamp,
				'contract_version' => self::VERSION,
			),
			$this->advertisement( $event, $flat, $post_block, $media ),
			array(
				'fields'              => $this->fields_block( $flat ),
				'field_meta'          => $this->field_meta_block( $flat ),
				'rendering'           => $this->rendering_block( $flat ),
				'publication_targets' => $this->publication_targets_block( $flat ),
				'buttons'             => $this->buttons_block( $flat ),
				'site'                => $this->site( $flat ),
				'post'                => $post_block,
				'author'              => $this->author_block( $flat ),
				'listing'             => $this->listing_block( $flat ),
				'media'               => $media,
				'taxonomy'            => $this->taxonomy_block( $flat ),
			)
		);

		/**
		 * Filters the complete webhook payload before it is encoded.
		 *
		 * This is the last hook that can change the transmitted bytes:
		 * the payload is JSON-encoded immediately afterwards and the HMAC
		 * signature is computed over that exact body.
		 *
		 * @since 1.1.0
		 *
		 * @param array<string,mixed> $payload Webhook payload.
		 * @param Event               $event   Event being delivered.
		 * @param array<string,mixed> $flat    Flat normalized payload.
		 */
		return apply_filters( 'wpep_event_payload', $payload, $event, $flat );
	}

	/**
	 * Builds the flat advertisement fields the Node.js publisher reads.
	 *
	 * @since 1.2.0
	 *
	 * @param Event               $event      Event being delivered.
	 * @param array<string,mixed> $flat       Flat normalized payload.
	 * @param array<string,mixed> $post_block Post block.
	 * @param array<string,mixed> $media      Media block.
	 *
	 * @return array<string,mixed> Flat advertisement fields.
	 */
	private function advertisement( Event $event, array $flat, array $post_block, array $media ): array {
		$images = array();

		if ( isset( $flat['images'] ) && is_array( $flat['images'] ) ) {
			$images = array_values( array_filter( array_map( 'strval', $flat['images'] ) ) );
		} else {
			if ( ! empty( $media['featured_image']['url'] ) ) {
				$images[] = (string) $media['featured_image']['url'];
			}

			foreach ( (array) ( $media['gallery'] ?? array() ) as $image ) {
				if ( ! empty( $image['url'] ) ) {
					$images[] = (string) $image['url'];
				}
			}

			$images = array_values( array_unique( $images ) );
		}

		$description = isset( $flat['description'] ) ? (string) $flat['description'] : (string) ( $flat['excerpt'] ?? '' );

		$fields = array(
			'post_id'      => (int) ( $post_block['id'] ?? $event->post_id() ),
			'post_type'    => (string) ( $post_block['type'] ?? '' ),
			'status'       => (string) ( $post_block['status'] ?? '' ),
			'title'        => (string) ( $post_block['title'] ?? '' ),
			'description'  => $description,
			// The message this site's template produced. Empty means the
			// consumer should build its own from the fields, exactly as it
			// did before templates existed.
			'message'      => (string) ( $flat['message'] ?? '' ),
			'price'        => $this->scalar( $flat['price'] ?? '' ),
			'location'     => $this->scalar( $flat['location'] ?? ( $flat['city'] ?? '' ) ),
			'phone'        => $this->publishable_phone( $flat ),
			'url'          => (string) ( $post_block['url'] ?? '' ),
			'permalink'    => (string) ( $post_block['url'] ?? '' ),
			'images'       => $images,
			'image'        => $images[0] ?? '',
			'site_id'      => $this->settings->site_id(),
			'language'     => (string) ( $flat['language'] ?? get_locale() ),
			'published_at' => (string) ( $post_block['published_at'] ?? '' ),
			'updated_at'   => (string) ( $post_block['updated_at'] ?? '' ),
		);

		/**
		 * Filters the flat advertisement fields.
		 *
		 * These are the keys the Node.js Telegram Publisher reads
		 * directly. Use this filter to rename or add a field the backend
		 * expects without touching the structured blocks.
		 *
		 * @since 1.2.0
		 *
		 * @param array<string,mixed> $fields Flat advertisement fields.
		 * @param Event               $event  Event being delivered.
		 * @param array<string,mixed> $flat   Flat normalized payload.
		 */
		return (array) apply_filters( 'wpep_contract_advertisement', $fields, $event, $flat );
	}

	/**
	 * Converts a value into a transport-safe scalar string.
	 *
	 * @since 1.2.0
	 *
	 * @param mixed $value Raw value.
	 *
	 * @return string Scalar representation, empty when not representable.
	 */
	private function scalar( mixed $value ): string {
		if ( is_scalar( $value ) ) {
			return (string) $value;
		}

		return '';
	}

	/**
	 * Builds a minimal payload for an event whose post can no longer be
	 * read and for which no snapshot survived.
	 *
	 * Keeps the payload structurally complete so the consumer's schema
	 * validation still passes; only the descriptive fields are empty.
	 *
	 * @since 1.1.0
	 *
	 * @param Event               $event     Event being delivered.
	 * @param string              $timestamp ISO 8601 UTC timestamp.
	 * @param array<string,mixed> $post      Known post fields, if any.
	 *
	 * @return array<string,mixed> Webhook payload.
	 */
	public function build_minimal( Event $event, string $timestamp, array $post = array() ): array {
		$post_block = wp_parse_args(
			$post,
			array(
				'id'           => $event->post_id(),
				'type'         => '',
				'status'       => $event->is_delete() ? 'deleted' : '',
				'title'        => '',
				'slug'         => '',
				'url'          => '',
				'excerpt'      => '',
				'content'      => '',
				'published_at' => '',
				'updated_at'   => '',
			)
		);

		$media = array(
			'featured_image' => null,
			'gallery'        => array(),
		);

		$payload = array_merge(
			array(
				'event_id'         => $event->id(),
				'event_type'       => $event->type(),
				'timestamp'        => $timestamp,
				'contract_version' => self::VERSION,
			),
			$this->advertisement( $event, array(), $post_block, $media ),
			array(
				'fields'              => array(),
				'field_meta'          => array(),
				'publication_targets' => $this->publication_targets_block( array() ),
				'buttons'             => $this->buttons_block( array() ),
				'site'                => $this->site(),
				'post'                => $post_block,
				'author'     => array(
					'id'    => 0,
					'name'  => '',
					'email' => '',
					'phone' => '',
				),
				'listing'    => array(
					'price'         => null,
					'city'          => null,
					'custom_fields' => array(),
				),
				'media'      => $media,
				'taxonomy'   => array(
					'categories'  => array(),
					'tags'        => array(),
					'all'         => array(),
					'source'      => '',
					'category'    => null,
					'subcategory' => null,
					'term'        => null,
					'path'        => array(),
				),
			)
		);


		/** This filter is documented in includes/class-contract.php */
		return apply_filters( 'wpep_event_payload', $payload, $event, array() );
	}

	/**
	 * Builds the diagnostic payload used by the connection test.
	 *
	 * Carries no advertisement data but the same identity, site and
	 * signature surface as a real event, so the Node.js service exercises
	 * its authentication path end to end without publishing anything to
	 * the Telegram channel.
	 *
	 * @since 1.1.0
	 *
	 * @param Event  $event     Diagnostic event.
	 * @param string $timestamp ISO 8601 UTC timestamp.
	 *
	 * @return array<string,mixed> Diagnostic payload.
	 */
	public function build_diagnostic( Event $event, string $timestamp ): array {
		$payload = array(
			'event_id'         => $event->id(),
			'event_type'       => $event->type(),
			'timestamp'        => $timestamp,
			'contract_version' => self::VERSION,
			'test'             => true,
			'post_id'          => 0,
			'title'            => __( 'تست اتصال جارچی', 'wp-event-publisher' ),
			'description'      => '',
			'price'            => '',
			'location'         => '',
			'url'              => home_url(),
			'images'           => array(),
			'site_id'          => $this->settings->site_id(),
			// A connection test is not a publication: every target is off and no
			// button is offered, so a backend that acts on this payload by
			// mistake still posts nothing anywhere.
			'publication_targets' => $this->publication_targets_block( array() ),
			'buttons'             => $this->buttons_block( array() ),
			'site'             => $this->site(),
			'post'             => null,
			'author'           => null,
			'listing'          => null,
			'media'            => null,
			'taxonomy'         => null,
		);

		/**
		 * Filters the diagnostic (connection test) payload.
		 *
		 * @since 1.1.0
		 *
		 * @param array<string,mixed> $payload Diagnostic payload.
		 * @param Event               $event   Diagnostic event.
		 */
		return apply_filters( 'wpep_diagnostic_payload', $payload, $event );
	}

	/**
	 * Re-stamps a stored payload for a new delivery attempt.
	 *
	 * The event identity is preserved — that is what makes the Node.js
	 * idempotency key work — while the timestamp is refreshed so the
	 * request passes the consumer's replay window. The caller signs the
	 * refreshed body afterwards.
	 *
	 * @since 1.1.0
	 * @since 1.5.1 Fills in blocks a snapshot taken by an earlier version
	 *              predates, so every payload keeps the contract's promise
	 *              that a block is always present.
	 *
	 * @param array<string,mixed> $payload   Previously built payload.
	 * @param Event               $event     Event being delivered.
	 * @param string              $timestamp Fresh ISO 8601 UTC timestamp.
	 *
	 * @return array<string,mixed> Payload with a current timestamp.
	 */
	public function refresh( array $payload, Event $event, string $timestamp ): array {
		$payload['event_id']         = $event->id();
		$payload['event_type']       = $event->type();
		$payload['timestamp']        = $timestamp;
		$payload['contract_version'] = self::VERSION;

		if ( ! isset( $payload['field_meta'] ) || ! is_array( $payload['field_meta'] ) ) {
			$payload['field_meta'] = array();
		}

		// A snapshot that already resolved its own routing — a WooCommerce
		// order event does — keeps it; the block is still rebuilt from it so
		// the shape and the filter are the same whichever path produced it.
		// A payload queued by 1.5.x has no block at all, and rebuilding from
		// nothing yields every platform off, which is the only safe reading:
		// that event was captured when no platform selection existed, so it
		// cannot be presumed to have consented to any.
		$payload['publication_targets'] = $this->publication_targets_block( $payload );

		if ( ! isset( $payload['buttons'] ) || ! is_array( $payload['buttons'] ) ) {
			$payload['buttons'] = $this->buttons_block( array() );
		}

		if ( isset( $payload['author'] ) && is_array( $payload['author'] ) && ! isset( $payload['author']['phone'] ) ) {
			$payload['author']['phone'] = '';
		}

		return $payload;
	}

	/**
	 * Maps the flat payload onto the `post` block.
	 *
	 * @since 1.1.0
	 *
	 * @param array<string,mixed> $flat Flat normalized payload.
	 *
	 * @return array<string,mixed> Post block.
	 */
	private function post_block( array $flat ): array {
		return array(
			'id'           => isset( $flat['id'] ) ? (int) $flat['id'] : 0,
			'type'         => isset( $flat['post_type'] ) ? (string) $flat['post_type'] : '',
			'status'       => isset( $flat['status'] ) ? (string) $flat['status'] : '',
			'title'        => isset( $flat['title'] ) ? (string) $flat['title'] : '',
			'slug'         => isset( $flat['slug'] ) ? (string) $flat['slug'] : '',
			'url'          => isset( $flat['url'] ) ? (string) $flat['url'] : '',
			'excerpt'      => isset( $flat['excerpt'] ) ? (string) $flat['excerpt'] : '',
			'content'      => isset( $flat['content'] ) ? (string) $flat['content'] : '',
			'published_at' => isset( $flat['published_at'] ) ? (string) $flat['published_at'] : '',
			'updated_at'   => isset( $flat['updated_at'] ) ? (string) $flat['updated_at'] : '',
		);
	}

	/**
	 * Maps the flat payload onto the `author` block.
	 *
	 * `phone` is the author's own number, read from their user meta by
	 * {@see Normalizer::author_phone()} and empty whenever no user meta key
	 * held one. It is never derived from `id`: a user identifier is a
	 * number, not a telephone number, and publishing one as the other would
	 * put a stranger's contact details in a channel.
	 *
	 * @since 1.1.0
	 * @since 1.5.1 Added `phone`.
	 *
	 * @param array<string,mixed> $flat Flat normalized payload.
	 *
	 * @return array<string,mixed> Author block.
	 */
	private function author_block( array $flat ): array {
		return array(
			'id'    => isset( $flat['author_id'] ) ? (int) $flat['author_id'] : 0,
			'name'  => isset( $flat['author'] ) ? (string) $flat['author'] : '',
			'email' => isset( $flat['author_email'] ) ? (string) $flat['author_email'] : '',
			'phone' => isset( $flat['author_phone'] ) ? (string) $flat['author_phone'] : '',
		);
	}

	/**
	 * Maps the flat payload onto the `listing` block.
	 *
	 * `price` and `city` come from the meta mapping configured in
	 * Settings, with auto-detection as the fallback; no meta key is
	 * hardcoded anywhere in the plugin.
	 *
	 * @since 1.1.0
	 *
	 * @param array<string,mixed> $flat Flat normalized payload.
	 *
	 * @return array<string,mixed> Listing block.
	 */
	private function listing_block( array $flat ): array {
		$listing = array(
			'price'         => $flat['price'] ?? null,
			'city'          => $flat['city'] ?? null,
			'location'      => $flat['location'] ?? ( $flat['city'] ?? null ),
			'phone'         => '' !== $this->publishable_phone( $flat ) ? $this->publishable_phone( $flat ) : null,
			'custom_fields' => $this->redact_withheld_phone( $flat ),
		);

		/**
		 * Filters the `listing` block of the webhook payload.
		 *
		 * Use this to expose additional domain specific fields (area,
		 * rooms, currency…) without touching plugin core files.
		 *
		 * @since 1.1.0
		 *
		 * @param array<string,mixed> $listing Listing block.
		 * @param array<string,mixed> $flat    Flat normalized payload.
		 */
		return apply_filters( 'wpep_contract_listing', $listing, $flat );
	}

	/**
	 * Maps the flat payload onto the `media` block.
	 *
	 * @since 1.1.0
	 *
	 * @param array<string,mixed> $flat Flat normalized payload.
	 *
	 * @return array<string,mixed> Media block.
	 */
	private function media_block( array $flat ): array {
		$featured = isset( $flat['featured_image'] ) && is_array( $flat['featured_image'] )
			? $this->image( $flat['featured_image'] )
			: null;

		$gallery = array();

		if ( isset( $flat['gallery'] ) && is_array( $flat['gallery'] ) ) {
			foreach ( $flat['gallery'] as $image ) {
				if ( is_array( $image ) ) {
					$gallery[] = $this->image( $image );
				}
			}
		}

		return array(
			'featured_image' => $featured,
			'gallery'        => $gallery,
		);
	}

	/**
	 * Normalizes a single image entry for the media block.
	 *
	 * `url` and `alt` lead because they are what a publishing consumer
	 * needs; MIME type, dimensions and the registered size variants
	 * follow for consumers that resize or validate uploads.
	 *
	 * @since 1.1.0
	 *
	 * @param array<string,mixed> $image Image data from the normalizer.
	 *
	 * @return array<string,mixed> Image block.
	 */
	private function image( array $image ): array {
		return array(
			'url'       => isset( $image['url'] ) ? (string) $image['url'] : '',
			'alt'       => isset( $image['alt'] ) ? (string) $image['alt'] : '',
			'id'        => isset( $image['id'] ) ? (int) $image['id'] : 0,
			'title'     => isset( $image['title'] ) ? (string) $image['title'] : '',
			'mime_type' => isset( $image['mime_type'] ) ? (string) $image['mime_type'] : '',
			'sizes'     => isset( $image['sizes'] ) && is_array( $image['sizes'] ) ? $image['sizes'] : array(),
		);
	}

	/**
	 * Maps the flat payload onto the `taxonomy` block.
	 *
	 * @since 1.1.0
	 *
	 * @param array<string,mixed> $flat Flat normalized payload.
	 *
	 * @return array<string,mixed> Taxonomy block.
	 */
	private function taxonomy_block( array $flat ): array {
		$mapped = isset( $flat['mapped_taxonomy'] ) && is_array( $flat['mapped_taxonomy'] ) ? $flat['mapped_taxonomy'] : array();

		$taxonomy = array(
			'categories' => isset( $flat['categories'] ) && is_array( $flat['categories'] ) ? $flat['categories'] : array(),
			'tags'       => isset( $flat['tags'] ) && is_array( $flat['tags'] ) ? $flat['tags'] : array(),
			'all'        => isset( $flat['taxonomies'] ) && is_array( $flat['taxonomies'] ) ? $flat['taxonomies'] : array(),
			// The category tree position, resolved once so the consumer does
			// not have to walk `all` to find out what this advertisement is.
			'source'      => (string) ( $mapped['taxonomy'] ?? '' ),
			'category'    => $mapped['category'] ?? null,
			'subcategory' => $mapped['subcategory'] ?? null,
			'term'        => $mapped['term'] ?? null,
			'path'        => isset( $mapped['path'] ) && is_array( $mapped['path'] ) ? array_values( $mapped['path'] ) : array(),
		);

		/**
		 * Filters the `taxonomy` block of the webhook payload.
		 *
		 * Use this to append custom taxonomies to the contract.
		 *
		 * @since 1.1.0
		 *
		 * @param array<string,mixed> $taxonomy Taxonomy block.
		 * @param array<string,mixed> $flat     Flat normalized payload.
		 */
		return apply_filters( 'wpep_contract_taxonomy', $taxonomy, $flat );
	}

	/**
	 * Builds the `fields` block: everything the administrator mapped.
	 *
	 * This is the open half of the contract. The flat advertisement fields
	 * above are fixed, because the Node.js publisher reads them by name;
	 * `fields` carries whatever this site decided an advertisement is, keyed
	 * by the same names the message template uses.
	 *
	 * @since 1.4.0
	 *
	 * @param array<string,mixed> $flat Flat normalized payload.
	 *
	 * @return array<string,mixed> Mapped fields.
	 */
	private function fields_block( array $flat ): array {
		$fields = isset( $flat['mapped_fields'] ) && is_array( $flat['mapped_fields'] ) ? $flat['mapped_fields'] : array();

		/**
		 * Filters the `fields` block of the webhook payload.
		 *
		 * @since 1.4.0
		 *
		 * @param array<string,mixed> $fields Mapped field values.
		 * @param array<string,mixed> $flat   Flat normalized payload.
		 */
		return (array) apply_filters( 'wpep_contract_fields', $fields, $flat );
	}

	/**
	 * Returns the advertiser's phone number, or an empty string if it may
	 * not be published.
	 *
	 * The decision itself is made in the normaliser, which is the layer that
	 * can see the field mapping and the resolved platforms; this method only
	 * enforces it, in the one place the number would otherwise reach the
	 * wire. Both the flat `phone` and `listing.phone` route through here, so
	 * there is no second path that could leak it.
	 *
	 * A caller that never set `phone_published` — an older filter, a partial
	 * payload — fails closed rather than open.
	 *
	 * @since 1.6.0
	 *
	 * @param array<string,mixed> $flat Flat normalized payload.
	 *
	 * @return string Phone number, or an empty string when withheld.
	 */
	private function publishable_phone( array $flat ): string {
		if ( empty( $flat['phone_published'] ) ) {
			return '';
		}

		return $this->scalar( $flat['phone'] ?? '' );
	}

	/**
	 * Returns the custom fields with a withheld phone number removed.
	 *
	 * `custom_fields` is a raw dump of post meta, so a site storing the
	 * number under `ad_phone` would publish it here even with the privacy
	 * gate shut — the gate would be closing the front door while the number
	 * left through this one. Withholding the number has to mean withholding
	 * it everywhere in the payload, or it means nothing.
	 *
	 * Matching is by value rather than by key name, because the key is
	 * whatever the site's theme chose and cannot be predicted. Only an exact
	 * match of the detected number is removed, so a description that merely
	 * mentions a number is left alone.
	 *
	 * @since 1.6.0
	 *
	 * @param array<string,mixed> $flat Flat normalized payload.
	 *
	 * @return array<string,mixed> Custom fields, phone redacted when withheld.
	 */
	private function redact_withheld_phone( array $flat ): array {
		$custom = isset( $flat['custom_fields'] ) && is_array( $flat['custom_fields'] ) ? $flat['custom_fields'] : array();

		if ( ! empty( $flat['phone_published'] ) ) {
			return $custom;
		}

		$number = trim( (string) ( $flat['phone'] ?? '' ) );

		if ( '' === $number ) {
			return $custom;
		}

		foreach ( $custom as $key => $value ) {
			if ( is_scalar( $value ) && trim( (string) $value ) === $number ) {
				unset( $custom[ $key ] );
			}
		}

		return $custom;
	}

	/**
	 * Builds the `publication_targets` block: where this event may be published.
	 *
	 * The plugin is the authority on *whether* a platform is selected; the
	 * backend is the authority on *how* to reach it. So this block carries the
	 * selection and, where the administrator supplied one, the client-side
	 * address of the channel — never a credential.
	 *
	 * Resolution order for each platform, most specific first:
	 *
	 *   1. The per-post choice, if the author made one.
	 *   2. The site-wide default from the platform settings screen.
	 *   3. Off.
	 *
	 * Every platform is always present, enabled or not, so a consumer never has
	 * to distinguish "not selected" from "key absent".
	 *
	 * @since 1.6.0
	 *
	 * @param array<string,mixed> $flat Flat normalized payload.
	 *
	 * @return array<string,array<string,mixed>> Publication targets keyed by platform.
	 */
	private function publication_targets_block( array $flat ): array {
		$resolved = isset( $flat['publication_targets'] ) && is_array( $flat['publication_targets'] )
			? $flat['publication_targets']
			: array();

		$targets = array();

		foreach ( Field::PLATFORMS as $platform ) {
			$entry = isset( $resolved[ $platform ] ) && is_array( $resolved[ $platform ] )
				? $resolved[ $platform ]
				: array();

			$target = array( 'enabled' => ! empty( $entry['enabled'] ) );

			// Channel addresses are client-side configuration, not secrets, and
			// the backend needs them to know which channel to post to. They are
			// only included when non-empty so the block stays readable.
			foreach ( array( 'channel_id', 'channel_title', 'chat_id', 'recipient' ) as $key ) {
				if ( ! empty( $entry[ $key ] ) ) {
					$target[ $key ] = (string) $entry[ $key ];
				}
			}

			$targets[ $platform ] = $target;
		}

		/**
		 * Filters the `publication_targets` block of the webhook payload.
		 *
		 * @since 1.6.0
		 *
		 * @param array<string,array<string,mixed>> $targets Publication targets.
		 * @param array<string,mixed>               $flat    Flat normalized payload.
		 */
		return (array) apply_filters( 'wpep_contract_publication_targets', $targets, $flat );
	}

	/**
	 * Builds the `buttons` block: the labels WordPress wants on the message.
	 *
	 * Button text belongs to the site, not the backend. An administrator who
	 * writes "مشاهده آگهی 🔗" should see exactly that under their post, and the
	 * backend should not be guessing at a label or carrying a translation table
	 * for every customer. So the label travels with the event.
	 *
	 * The contact button is gated twice — its own switch, and the phone field's.
	 * Offering to contact a seller whose number is not being published would
	 * produce a button that cannot work.
	 *
	 * @since 1.6.0
	 *
	 * @param array<string,mixed> $flat Flat normalized payload.
	 *
	 * @return array<string,array<string,mixed>> Button configuration.
	 */
	private function buttons_block( array $flat ): array {
		$configured = isset( $flat['buttons'] ) && is_array( $flat['buttons'] ) ? $flat['buttons'] : array();

		$view    = isset( $configured['view'] ) && is_array( $configured['view'] ) ? $configured['view'] : array();
		$contact = isset( $configured['contact'] ) && is_array( $configured['contact'] ) ? $configured['contact'] : array();

		$phone_published = ! empty( $flat['phone_published'] );

		$buttons = array(
			'view'    => array(
				'enabled' => ! empty( $view['enabled'] ),
				'label'   => (string) ( $view['label'] ?? '' ),
			),
			'contact' => array(
				// The second gate. A contact button with no published number is
				// a dead end, so the phone field's own switch can veto it.
				'enabled' => ! empty( $contact['enabled'] ) && $phone_published,
				'label'   => (string) ( $contact['label'] ?? '' ),
			),
		);

		/**
		 * Filters the `buttons` block of the webhook payload.
		 *
		 * @since 1.6.0
		 *
		 * @param array<string,array<string,mixed>> $buttons Button configuration.
		 * @param array<string,mixed>               $flat    Flat normalized payload.
		 */
		return (array) apply_filters( 'wpep_contract_buttons', $buttons, $flat );
	}

	/**
	 * Builds the rendering contract consumed by the Node.js formatter.
	 *
	 * A missing block intentionally defaults to the structured renderer, so
	 * upgraded sites stop inheriting the legacy WordPress auto-template unless
	 * they explicitly chose a custom message template.
	 *
	 * @since 1.9.7
	 *
	 * @param array<string,mixed> $flat Flat payload.
	 * @return array<string,mixed> Rendering configuration.
	 */
	private function rendering_block( array $flat ): array {
		$rendering = isset( $flat['rendering'] ) && is_array( $flat['rendering'] ) ? $flat['rendering'] : array();
		$mode = in_array( (string) ( $rendering['mode'] ?? 'structured' ), array( 'structured', 'custom' ), true )
			? (string) $rendering['mode']
			: 'structured';

		return array(
			'mode' => $mode,
			'title' => is_array( $rendering['title'] ?? null ) ? $rendering['title'] : array( 'enabled' => true, 'icon' => '', 'bold' => true ),
			'fields' => is_array( $rendering['fields'] ?? null ) ? $rendering['fields'] : array( 'enabled' => true, 'showLabels' => true, 'bullet' => '', 'separator' => ': ', 'compact' => false ),
			'category' => is_array( $rendering['category'] ?? null ) ? $rendering['category'] : array( 'enabled' => true, 'label' => __( 'دسته‌بندی', 'wp-event-publisher' ), 'icon' => '' ),
			'description' => is_array( $rendering['description'] ?? null ) ? $rendering['description'] : array( 'enabled' => true, 'heading' => false, 'label' => '', 'icon' => '' ),
			'divider' => is_array( $rendering['divider'] ?? null ) ? $rendering['divider'] : array( 'enabled' => true, 'character' => '─', 'length' => 28 ),
		);
	}

	/**
	 * Builds the `field_meta` block: what each entry in `fields` actually is.
	 *
	 * `fields` carries an internal key and a value, which is enough to store
	 * but not enough to present — a consumer reading it alone has no way to
	 * know that `company_or_institution_name1` should be shown as a company
	 * name, and its only recourse is a generic label or a hardcoded table of
	 * key-to-label guesses per category. Both are wrong for the same reason:
	 * the answer is already known here, on the site where the administrator
	 * typed it.
	 *
	 * So this block describes `fields` key for key: the label the mapping
	 * gives it, the position it was dragged into, the type the framework
	 * declared, its choice list. WordPress stays the source of truth for
	 * what a field is, and no consumer has to infer anything from a key.
	 *
	 * The two blocks are built together in {@see DynamicPayload::describe()}
	 * and are reconciled there, so `field_meta` never describes a field that
	 * `fields` did not send — including anything disabled, admin-only or
	 * hidden, which reaches neither.
	 *
	 * @since 1.5.1
	 *
	 * @param array<string,mixed> $flat Flat normalized payload.
	 *
	 * @return array<string,array<string,mixed>> Field descriptions.
	 */
	private function field_meta_block( array $flat ): array {
		$meta = isset( $flat['mapped_field_meta'] ) && is_array( $flat['mapped_field_meta'] ) ? $flat['mapped_field_meta'] : array();

		/**
		 * Filters the `field_meta` block of the webhook payload.
		 *
		 * A key added here that `fields` does not carry describes nothing,
		 * so it is discarded before the payload is encoded.
		 *
		 * @since 1.5.1
		 *
		 * @param array<string,array<string,mixed>> $meta Field descriptions.
		 * @param array<string,mixed>               $flat Flat normalized payload.
		 */
		$meta = (array) apply_filters( 'wpep_contract_field_meta', $meta, $flat );

		$fields = isset( $flat['mapped_fields'] ) && is_array( $flat['mapped_fields'] ) ? $flat['mapped_fields'] : array();

		return array_intersect_key( $meta, $fields );
	}
}
