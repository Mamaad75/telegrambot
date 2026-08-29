<?php
/**
 * Post data normalizer.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

use WP_Post;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Converts a WP_Post into the canonical payload consumed by the Node.js
 * microservice.
 *
 * The normalizer never talks to the network; it only collects and shapes
 * data. Advertisement fields — price, location, description, images — are
 * resolved through a chain that starts with whatever the administrator
 * mapped in Settings, then tries the conventions of the common
 * classifieds/WooCommerce setups, and finally falls back to fuzzy meta key
 * matching. A field that cannot be resolved becomes an empty value; it
 * never breaks the event.
 *
 * @since 1.0.0
 */
class Normalizer {

	/**
	 * Meta key name fragments that suggest a "price" semantic.
	 *
	 * @var string[]
	 */
	private const PRICE_HINTS = array( 'price', 'cost', 'amount', 'fee', 'gheymat', 'ghimat' );

	/**
	 * Meta key name fragments that suggest a "location" semantic.
	 *
	 * @var string[]
	 */
	private const CITY_HINTS = array( 'city', 'town', 'location', 'region', 'province', 'address', 'shahr', 'ostan' );

	/**
	 * Meta key name fragments that suggest a "phone" semantic.
	 *
	 * @var string[]
	 */
	private const PHONE_HINTS = array( 'phone', 'mobile', 'tel', 'whatsapp', 'contact_number', 'mobail', 'hamrah' );

	/**
	 * Meta keys commonly holding galleries in classifieds themes.
	 *
	 * @var string[]
	 */
	private const GALLERY_HINTS = array( '_product_image_gallery', 'gallery', 'images', 'photos', 'image_gallery', 'ad_gallery', 'listing_gallery' );

	/**
	 * User meta keys that hold a telephone number by convention.
	 *
	 * Deliberately a short, explicit list of keys whose *name* states what
	 * the value is. It is not a fuzzy search: a key has to be one of these
	 * for its value to be read as a phone number.
	 *
	 * @since 1.5.1
	 *
	 * @var string[]
	 */
	private const AUTHOR_PHONE_KEYS = array(
		'billing_phone',
		'phone',
		'user_phone',
		'mobile',
		'user_mobile',
		'mobile_number',
		'phone_number',
		'telephone',
		'tel',
		'contact_phone',
		'whatsapp',
	);

	/**
	 * Settings dependency.
	 *
	 * @var Settings|null
	 */
	private ?Settings $settings;

	/**
	 * Field resolver.
	 *
	 * @var FieldMap
	 */
	private FieldMap $fields;

	/**
	 * Field mapping service, when one was supplied.
	 *
	 * Optional on purpose: the normaliser is constructed standalone in
	 * several places (diagnostics, the rule tester) where no mapping service
	 * exists. Where it is absent the phone gate fails closed rather than
	 * reaching for a global.
	 *
	 * @since 1.6.0
	 * @var FieldMapping|null
	 */
	private ?FieldMapping $mapping;

	/**
	 * Constructor.
	 *
	 * @since 1.2.0
	 * @since 1.3.0 Added the field resolver.
	 * @since 1.6.0 Added the field mapping service, used by the phone gate.
	 *
	 * @param Settings|null     $settings Settings service, when available.
	 * @param FieldMap|null     $fields   Field resolver; created when omitted.
	 * @param FieldMapping|null $mapping  Field mapping service, when available.
	 */
	public function __construct( ?Settings $settings = null, ?FieldMap $fields = null, ?FieldMapping $mapping = null ) {
		$this->settings = $settings;
		$this->fields   = $fields ?? new FieldMap( $settings );
		$this->mapping  = $mapping;
	}

	/**
	 * Supplies the field mapping service after construction.
	 *
	 * The container cannot pass this to the constructor. FieldMapping needs
	 * FieldRegistry, and FieldRegistry needs this very normaliser, so asking
	 * for the mapping while the normaliser is still being built re-enters the
	 * same factory with its property still null and recurses until the
	 * process dies. Constructing first and wiring second is what breaks that
	 * cycle, and it is why {@see Plugin::normalizer()} assigns the property
	 * before it calls this.
	 *
	 * @since 1.6.0
	 *
	 * @param FieldMapping $mapping Field mapping service.
	 *
	 * @return void
	 */
	public function set_field_mapping( FieldMapping $mapping ): void {
		$this->mapping = $mapping;
	}

	/**
	 * Builds the flat, canonical representation of a post.
	 *
	 * This is the plugin's data collection layer: it gathers everything
	 * WordPress knows about a post into one predictable structure.
	 * {@see Contract} maps that structure onto the wire format, so the
	 * collection logic exists once and is never duplicated per event
	 * type.
	 *
	 * @since 1.0.0
	 * @since 1.1.0 Added `author_id`; `$event` now carries the lifecycle
	 *              event type (`created`, `updated`, `deleted`).
	 * @since 1.2.0 Added `description`, `images`, `location` and the
	 *              configurable field mapping.
	 *
	 * @param WP_Post $post  Post to normalize.
	 * @param string  $event Event type or legacy event name.
	 *
	 * @return array<string,mixed> Normalized payload.
	 */
	public function normalize( WP_Post $post, string $event = Event::TYPE_CREATED ): array {
		$author       = get_userdata( (int) $post->post_author );
		$custom_meta  = $this->collect_custom_fields( $post );
		$published_at = get_post_time( 'c', true, $post );
		$updated_at   = get_post_modified_time( 'c', true, $post );
		$featured     = $this->normalize_image( (int) get_post_thumbnail_id( $post ) );
		$gallery      = $this->collect_gallery( $post );

		$payload = array(
			'event'             => $event,
			'id'                => (int) $post->ID,
			'title'             => $this->plain_text( get_the_title( $post ) ),
			'slug'              => $post->post_name,
			'excerpt'           => $this->build_excerpt( $post ),
			'description'       => $this->build_description( $post ),
			'content'           => $this->render_content( $post ),
			'url'               => $this->absolute_url( (string) get_permalink( $post ) ),
			'author_id'         => (int) $post->post_author,
			'author'            => $author ? $author->display_name : '',
			'author_email'      => $author ? $author->user_email : '',
			'author_phone'      => $this->author_phone( (int) $post->post_author ),
			'featured_image'    => $featured,
			'gallery'           => $gallery,
			'images'            => $this->collect_image_urls( $featured, $gallery, $post ),
			'categories'        => $this->collect_terms( $post, 'category' ),
			'tags'              => $this->collect_terms( $post, 'post_tag' ),
			'taxonomies'        => $this->collect_all_terms( $post ),
			'custom_fields'     => $custom_meta,
			'price'             => $this->detect_price( $post, $custom_meta ),
			'city'              => $this->detect_location( $post, $custom_meta ),
			'phone'             => $this->detect_phone( $post, $custom_meta ),
			'status'            => $post->post_status,
			'published_at'      => $published_at ?: '',
			'updated_at'        => $updated_at ?: '',
			'post_type'         => $post->post_type,
			'language'          => $this->detect_language( $post ),
			'site_name'         => get_bloginfo( 'name' ),
			'site_url'          => home_url(),
			'wordpress_version' => get_bloginfo( 'version' ),
			'plugin_version'    => WPEP_VERSION,
		);

		// `location` is the name the Node.js publisher reads; `city` is
		// kept for payload compatibility with version 1.1.0 consumers.
		$payload['location'] = $payload['city'];

		// Where this post may be published, and what the buttons should say.
		// Both are resolved here, in the one place that already has the post
		// and the settings service, so the Contract receives real
		// configuration instead of falling back to its own defaults.
		$payload['publication_targets'] = $this->publication_targets( $post );
		$payload['phone_published']     = $this->phone_is_publishable( $post, $payload['publication_targets'] );
		$payload['buttons']             = $this->buttons( $payload['publication_targets'] );

		/**
		 * Filters the normalized webhook payload before dispatch.
		 *
		 * @since 1.0.0
		 *
		 * @param array<string,mixed> $payload Normalized payload.
		 * @param WP_Post             $post    Source post.
		 * @param string              $event   Event name.
		 */
		return apply_filters( 'wpep_payload', $payload, $post, $event );
	}

	/**
	 * Post meta key holding a per-post publication channel override.
	 *
	 * Absent meta means "inherit the site defaults"; present meta is
	 * authoritative, including when every platform in it is off. That
	 * distinction is the whole reason the metabox writes a marker: without
	 * it, an author who deliberately unticked every platform would silently
	 * fall back to the site defaults and publish anyway.
	 *
	 * @since 1.6.0
	 * @var string
	 */
	public const META_CHANNELS = '_jarchi_channels';

	/**
	 * Resolves where this post may be published.
	 *
	 * Resolution order, most specific first: the per-post choice, the
	 * site-wide default, then off. Every platform is always present in the
	 * result so a consumer never has to tell "not selected" from "key
	 * absent", and the channel address travels with it so the backend knows
	 * which channel it is being asked to post to.
	 *
	 * @since 1.6.0
	 *
	 * @param WP_Post $post Source post.
	 *
	 * @return array<string,array<string,mixed>> Publication targets keyed by platform.
	 */
	private function publication_targets( WP_Post $post ): array {
		$site      = $this->settings instanceof Settings ? $this->settings->platforms() : array();
		$override  = get_post_meta( (int) $post->ID, self::META_CHANNELS, true );
		$overrides = is_array( $override ) ? $override : array();
		$has_own   = ! empty( $overrides );

		$targets = array();

		foreach ( Field::PLATFORMS as $platform ) {
			$config = isset( $site[ $platform ] ) && is_array( $site[ $platform ] ) ? $site[ $platform ] : array();

			// The site switch is a precondition, not merely a default: a
			// platform the administrator has not configured cannot be turned
			// on by a post author, who has no way to supply its channel.
			$site_on = ! empty( $config['enabled'] );

			if ( $has_own && array_key_exists( $platform, $overrides ) ) {
				$enabled = $site_on && ! empty( $overrides[ $platform ] );
			} else {
				$enabled = $site_on;
			}

			$target = array( 'enabled' => $enabled );

			foreach ( array( 'channel_id', 'chat_id', 'recipient', 'channel_title' ) as $key ) {
				if ( ! empty( $config[ $key ] ) ) {
					$target[ $key ] = (string) $config[ $key ];
				}
			}

			$targets[ $platform ] = $target;
		}

		/**
		 * Filters the resolved publication targets for a post.
		 *
		 * @since 1.6.0
		 *
		 * @param array<string,array<string,mixed>> $targets Resolved targets.
		 * @param WP_Post                           $post    Source post.
		 */
		return (array) apply_filters( 'wpep_publication_targets', $targets, $post );
	}

	/**
	 * Resolves the button configuration the message should carry.
	 *
	 * Button text belongs to the site: an administrator who writes
	 * "مشاهده آگهی" should see exactly that, rather than the backend guessing
	 * or carrying a translation table per customer. Where several platforms
	 * are enabled, the first one in display order that switches a button on
	 * supplies its label, which keeps the result deterministic.
	 *
	 * @since 1.6.0
	 *
	 * @param array<string,array<string,mixed>> $targets Resolved publication targets.
	 *
	 * @return array<string,array<string,mixed>> Button configuration.
	 */
	private function buttons( array $targets ): array {
		$site = $this->settings instanceof Settings ? $this->settings->platforms() : array();

		$buttons = array(
			'view'    => array(
				'enabled' => false,
				'label'   => '',
			),
			'contact' => array(
				'enabled' => false,
				'label'   => '',
			),
		);

		foreach ( Field::PLATFORMS as $platform ) {
			// A button on a platform this post is not going to reach is not
			// configuration, it is noise.
			if ( empty( $targets[ $platform ]['enabled'] ) ) {
				continue;
			}

			$config = isset( $site[ $platform ] ) && is_array( $site[ $platform ] ) ? $site[ $platform ] : array();

			if ( ! $buttons['view']['enabled'] && ! empty( $config['view_button'] ) ) {
				$buttons['view'] = array(
					'enabled' => true,
					'label'   => (string) ( $config['view_label'] ?? '' ),
				);
			}

			if ( ! $buttons['contact']['enabled'] && ! empty( $config['contact_button'] ) ) {
				$buttons['contact'] = array(
					'enabled' => true,
					'label'   => (string) ( $config['contact_label'] ?? '' ),
				);
			}
		}

		return $buttons;
	}

	/**
	 * Decides whether the advertiser's phone number may travel publicly.
	 *
	 * Three gates, all of which must open (spec 4): the phone field is
	 * enabled in the mapping, at least one platform is actually being
	 * published to, and that platform is allowed to show the phone number.
	 * The default for all three is off, so a number is published only after
	 * someone has said so three times.
	 *
	 * @since 1.6.0
	 *
	 * @param WP_Post                           $post    Source post.
	 * @param array<string,array<string,mixed>> $targets Resolved publication targets.
	 *
	 * @return bool Whether the phone number may be published.
	 */
	private function phone_is_publishable( WP_Post $post, array $targets ): bool {
		// Permission is not the only question: an advertisement that carries
		// no number publishes no number, however many switches are on. Asking
		// this first also keeps the contact button honest, since it is gated
		// on this same answer and a button offering to reveal nothing is a
		// dead end.
		if ( '' === $this->phone_for( $post ) ) {
			return false;
		}

		$live = array();

		foreach ( Field::PLATFORMS as $platform ) {
			if ( ! empty( $targets[ $platform ]['enabled'] ) ) {
				$live[] = $platform;
			}
		}

		if ( empty( $live ) ) {
			return false;
		}

		$mapping = $this->phone_mapping_entry( $post );

		if ( empty( $mapping ) || empty( $mapping['enabled'] ) ) {
			return false;
		}

		$platforms = isset( $mapping['platforms'] ) && is_array( $mapping['platforms'] ) ? $mapping['platforms'] : array();

		foreach ( $live as $platform ) {
			if ( ! empty( $platforms[ $platform ] ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Reads the phone field's mapping entry for a post, if there is one.
	 *
	 * Resolved through the injected mapping service so category overrides and
	 * profile inheritance are respected. A caller that constructed the
	 * normaliser without one gets an empty entry, which fails closed.
	 *
	 * @since 1.6.0
	 *
	 * @param WP_Post $post Source post.
	 *
	 * @return array<string,mixed> Mapping entry, or empty when absent.
	 */
	private function phone_mapping_entry( WP_Post $post ): array {
		if ( ! $this->mapping instanceof FieldMapping ) {
			return array();
		}

		// for_post() answers with the resolved mapping *and* the taxonomy and
		// term it resolved through; the mapping itself is one key in.
		$resolved = $this->mapping->for_post( $post );
		$mapping  = isset( $resolved['mapping'] ) && is_array( $resolved['mapping'] ) ? $resolved['mapping'] : array();

		foreach ( array( 'phone', 'contact_phone', 'mobile' ) as $key ) {
			if ( isset( $mapping[ $key ] ) && is_array( $mapping[ $key ] ) ) {
				return $mapping[ $key ];
			}
		}

		return array();
	}

	/**
	 * Returns a settings value with a safe fallback when the normalizer
	 * was constructed without the settings service.
	 *
	 * @since 1.2.0
	 *
	 * @param string $key      Setting key.
	 * @param mixed  $fallback Fallback value.
	 *
	 * @return mixed Setting value.
	 */
	private function setting( string $key, mixed $fallback ): mixed {
		return $this->settings instanceof Settings ? $this->settings->get( $key, $fallback ) : $fallback;
	}

	/**
	 * Returns a configured meta key list.
	 *
	 * @since 1.2.0
	 *
	 * @param string $key Settings key.
	 *
	 * @return string[] Meta keys.
	 */
	private function mapped_keys( string $key ): array {
		return $this->settings instanceof Settings ? $this->settings->meta_keys( $key ) : array();
	}

	/**
	 * Returns the post content for the payload.
	 *
	 * Deliberately does **not** run `the_content`.
	 *
	 * Delivery happens in the background — on `shutdown` after the response
	 * was flushed, or in a cron request — with no loop context and no
	 * `setup_postdata()`. `the_content` is the busiest filter in WordPress:
	 * page builders render whole documents on it, JetEngine listings run
	 * nested queries, and several plugins assume they are inside the loop.
	 * Running it there is slow at best; at worst it fatals or exceeds the
	 * execution limit, and because the browser already received "Published"
	 * the failure is completely invisible. That is the difference between
	 * the connection test (which never touches this class and always works)
	 * and a real publication.
	 *
	 * The Node.js publisher builds its message from `description`, which is
	 * plain text derived from the raw content, so nothing downstream needs
	 * the rendered HTML. Sites that do want it can opt in per request.
	 *
	 * @since 1.3.1
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return string Post content.
	 */
	private function render_content( WP_Post $post ): string {
		/**
		 * Filters whether the rendered content is produced with `the_content`.
		 *
		 * Off by default. Turning it on runs every third-party content
		 * filter inside a background request; only do so if you know the
		 * filters on this site are safe outside the loop.
		 *
		 * @since 1.3.1
		 *
		 * @param bool    $render Whether to apply `the_content`. Default false.
		 * @param WP_Post $post   Source post.
		 */
		if ( ! apply_filters( 'wpep_render_the_content', false, $post ) ) {
			return (string) $post->post_content;
		}

		try {
			return (string) apply_filters( 'the_content', $post->post_content );
		} catch ( \Throwable $e ) {
			// A broken content filter must not cost us the advertisement.
			return (string) $post->post_content;
		}
	}

	/**
	 * Builds a plain-text excerpt with a sane fallback.
	 *
	 * @since 1.0.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return string Excerpt.
	 */
	private function build_excerpt( WP_Post $post ): string {
		$excerpt = $post->post_excerpt;

		if ( '' === trim( $excerpt ) ) {
			$excerpt = wp_trim_words( wp_strip_all_tags( strip_shortcodes( $post->post_content ) ), 55 );
		}

		return $this->plain_text( $excerpt );
	}

	/**
	 * Builds the advertisement description sent to Telegram.
	 *
	 * Telegram messages are text, so the description is delivered as
	 * plain UTF-8 with markup, shortcodes and block comments removed. The
	 * untouched HTML is still available as `post.content` for consumers
	 * that want it.
	 *
	 * @since 1.2.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return string Plain text description.
	 */
	private function build_description( WP_Post $post ): string {
		$source = (string) $this->setting( 'description_source', 'auto' );

		$excerpt = trim( (string) $post->post_excerpt );
		$content = (string) $post->post_content;

		$raw = match ( $source ) {
			'excerpt' => $excerpt,
			'content' => $content,
			default   => '' !== $excerpt ? $excerpt : $content,
		};

		// wp_strip_all_tags() also removes the block editor's HTML
		// comments, so Gutenberg markup does not leak into Telegram.
		$text = $this->plain_text( wp_strip_all_tags( strip_shortcodes( $raw ) ) );

		/**
		 * Filters the maximum length of the plain text description.
		 *
		 * @since 1.2.0
		 *
		 * @param int     $length Maximum number of characters. Default 3000.
		 * @param WP_Post $post   Source post.
		 */
		$limit = (int) apply_filters( 'wpep_description_length', 3000, $post );

		if ( $limit > 0 && mb_strlen( $text ) > $limit ) {
			$text = rtrim( mb_substr( $text, 0, $limit ) ) . '…';
		}

		/**
		 * Filters the advertisement description.
		 *
		 * @since 1.2.0
		 *
		 * @param string  $text Plain text description.
		 * @param WP_Post $post Source post.
		 */
		return (string) apply_filters( 'wpep_description', $text, $post );
	}

	/**
	 * Collapses whitespace and decodes entities in a text fragment.
	 *
	 * Persian text is left byte-identical: nothing is transliterated,
	 * escaped or re-encoded here, and the payload is later encoded with
	 * JSON_UNESCAPED_UNICODE.
	 *
	 * @since 1.2.0
	 *
	 * @param string $text Raw text.
	 *
	 * @return string Cleaned text.
	 */
	private function plain_text( string $text ): string {
		$text = html_entity_decode( $text, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		$text = str_replace( array( "\r\n", "\r" ), "\n", $text );
		$text = preg_replace( '/\n{3,}/u', "\n\n", $text ) ?? $text;
		$text = preg_replace( '/[ \t]{2,}/u', ' ', $text ) ?? $text;

		return trim( $text );
	}

	/**
	 * Makes a URL absolute and, where the site allows it, HTTPS.
	 *
	 * Local paths, protocol relative URLs and admin-side URLs are never
	 * transmitted: the consumer has to be able to fetch what it receives.
	 *
	 * @since 1.2.0
	 *
	 * @param string $url Raw URL or path.
	 *
	 * @return string Absolute URL, empty when nothing usable remained.
	 */
	public function absolute_url( string $url ): string {
		$url = trim( $url );

		if ( '' === $url ) {
			return '';
		}

		if ( str_starts_with( $url, '//' ) ) {
			$url = ( is_ssl() ? 'https:' : 'http:' ) . $url;
		} elseif ( str_starts_with( $url, '/' ) ) {
			$url = home_url( $url );
		} elseif ( ! preg_match( '#^https?://#i', $url ) ) {
			// A bare filesystem path can never be fetched by the consumer.
			return '';
		}

		// Serve everything over HTTPS when the site itself runs on HTTPS.
		if ( str_starts_with( (string) home_url(), 'https://' ) ) {
			$url = set_url_scheme( $url, 'https' );
		}

		return esc_url_raw( $url );
	}

	/**
	 * Normalizes a single attachment into a structured image array.
	 *
	 * Includes URL, MIME type, alt text and every registered image size.
	 *
	 * @since 1.0.0
	 *
	 * @param int $attachment_id Attachment ID.
	 *
	 * @return array<string,mixed>|null Image data or null when unavailable.
	 */
	public function normalize_image( int $attachment_id ): ?array {
		if ( $attachment_id <= 0 ) {
			return null;
		}

		$url = $this->absolute_url( (string) wp_get_attachment_url( $attachment_id ) );

		if ( '' === $url ) {
			return null;
		}

		$sizes = array();
		foreach ( get_intermediate_image_sizes() as $size ) {
			$src = wp_get_attachment_image_src( $attachment_id, $size );
			if ( $src ) {
				$sizes[ $size ] = array(
					'url'    => $this->absolute_url( (string) $src[0] ),
					'width'  => (int) $src[1],
					'height' => (int) $src[2],
				);
			}
		}

		return array(
			'id'        => $attachment_id,
			'url'       => $url,
			'mime_type' => (string) get_post_mime_type( $attachment_id ),
			'alt'       => (string) get_post_meta( $attachment_id, '_wp_attachment_image_alt', true ),
			'title'     => get_the_title( $attachment_id ),
			'sizes'     => $sizes,
		);
	}

	/**
	 * Builds the flat list of publicly fetchable image URLs.
	 *
	 * The featured image leads, because that is what a Telegram post
	 * shows first. Duplicates are removed and the list is capped by the
	 * "Maximum images" setting.
	 *
	 * @since 1.2.0
	 *
	 * @param array<string,mixed>|null       $featured Featured image, when present.
	 * @param array<int,array<string,mixed>> $gallery  Gallery images.
	 * @param WP_Post                        $post     Source post.
	 *
	 * @return string[] Absolute image URLs.
	 */
	private function collect_image_urls( ?array $featured, array $gallery, WP_Post $post ): array {
		$urls = array();

		if ( is_array( $featured ) && ! empty( $featured['url'] ) ) {
			$urls[] = (string) $featured['url'];
		}

		foreach ( $gallery as $image ) {
			if ( is_array( $image ) && ! empty( $image['url'] ) ) {
				$urls[] = (string) $image['url'];
			}
		}

		// Meta fields holding plain URLs, and images embedded in the
		// content, keep advertisements published by front-end forms from
		// arriving without pictures.
		$urls = array_merge( $urls, $this->meta_image_urls( $post ), $this->content_image_urls( $post ) );

		$urls = array_values(
			array_unique(
				array_filter(
					array_map( fn( $url ) => $this->absolute_url( (string) $url ), $urls )
				)
			)
		);

		$max = (int) $this->setting( 'max_images', 10 );

		if ( $max > 0 && count( $urls ) > $max ) {
			$urls = array_slice( $urls, 0, $max );
		}

		/**
		 * Filters the flat image URL list sent with the event.
		 *
		 * @since 1.2.0
		 *
		 * @param string[] $urls Absolute image URLs.
		 * @param WP_Post  $post Source post.
		 */
		return array_values( (array) apply_filters( 'wpep_image_urls', $urls, $post ) );
	}

	/**
	 * Extracts image URLs stored directly in post meta.
	 *
	 * @since 1.2.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return string[] Image URLs.
	 */
	private function meta_image_urls( WP_Post $post ): array {
		return $this->fields->gallery( $post )['urls'];
	}

	/**
	 * Extracts image sources embedded in the post content.
	 *
	 * @since 1.2.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return string[] Image URLs.
	 */
	private function content_image_urls( WP_Post $post ): array {
		if ( ! str_contains( $post->post_content, '<img' ) ) {
			return array();
		}

		if ( ! preg_match_all( '/<img[^>]+src=["\']([^"\']+)["\']/i', $post->post_content, $matches ) ) {
			return array();
		}

		return array_slice( (array) $matches[1], 0, 20 );
	}

	/**
	 * Collects gallery images from Gutenberg gallery blocks, the
	 * [gallery] shortcode, mapped meta fields and attached images.
	 *
	 * @since 1.0.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return array<int,array<string,mixed>> Gallery image list.
	 */
	private function collect_gallery( WP_Post $post ): array {
		$ids = array();

		// Gutenberg gallery + image blocks.
		if ( has_blocks( $post->post_content ) ) {
			$ids = array_merge( $ids, $this->extract_block_image_ids( parse_blocks( $post->post_content ) ) );
		}

		// Classic [gallery] shortcodes. This runs do_shortcode() internally,
		// which executes third-party shortcode handlers, so it is contained
		// the same way the content rendering is.
		if ( str_contains( $post->post_content, '[gallery' ) ) {
			try {
				foreach ( get_post_galleries( $post, false ) as $gallery ) {
					if ( ! empty( $gallery['ids'] ) ) {
						$ids = array_merge( $ids, wp_parse_id_list( $gallery['ids'] ) );
					}
				}
			} catch ( \Throwable $e ) {
				// A broken shortcode handler costs us the gallery, not the event.
				unset( $e );
			}
		}

		// Attachment IDs stored in meta: WooCommerce product galleries,
		// JetEngine and ACF gallery fields, and whatever the theme calls
		// its own. Resolution order lives in FieldMap.
		$ids = array_merge( $ids, $this->fields->gallery( $post )['ids'], $this->attached_image_ids( $post ) );

		$thumbnail_id = (int) get_post_thumbnail_id( $post );
		$ids          = array_values( array_unique( array_filter( array_map( 'absint', $ids ) ) ) );
		$ids          = array_values( array_diff( $ids, array( $thumbnail_id ) ) );

		/**
		 * Filters the attachment IDs treated as the post gallery.
		 *
		 * @since 1.0.0
		 *
		 * @param int[]   $ids  Attachment IDs.
		 * @param WP_Post $post Source post.
		 */
		$ids = apply_filters( 'wpep_gallery_ids', $ids, $post );

		$images = array();
		foreach ( $ids as $id ) {
			$image = $this->normalize_image( (int) $id );
			if ( null !== $image ) {
				$images[] = $image;
			}
		}

		return $images;
	}

	/**
	 * Returns the gallery of a post as a flat list of absolute URLs.
	 *
	 * Same collection as the `gallery` block of the payload — Gutenberg
	 * gallery and image blocks, the classic `[gallery]` shortcode, meta
	 * fields under any framework convention, and images attached to the
	 * post — reduced to what a message can actually show. Exposed so
	 * {@see ImageProvider} does not have to repeat any of it.
	 *
	 * @since 1.4.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return string[] Absolute image URLs, featured image excluded.
	 */
	public function gallery_urls( WP_Post $post ): array {
		$urls = array();

		foreach ( $this->collect_gallery( $post ) as $image ) {
			if ( is_array( $image ) && ! empty( $image['url'] ) ) {
				$urls[] = (string) $image['url'];
			}
		}

		// Meta fields holding plain URLs rather than attachment IDs, and
		// images that only exist inside the content.
		$urls = array_merge( $urls, $this->meta_image_urls( $post ), $this->content_image_urls( $post ) );

		return array_values(
			array_unique(
				array_filter(
					array_map( fn( $url ) => $this->absolute_url( (string) $url ), $urls )
				)
			)
		);
	}

	/**
	 * Collects attachment IDs stored in post meta.
	 *
	 * Looks at the keys mapped in Settings first, then at the key names
	 * used by WooCommerce and by the common classifieds plugins.
	 *
	 * @since 1.2.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return int[] Attachment IDs.
	 */
	private function attached_image_ids( WP_Post $post ): array {
		// Images attached to the post but never inserted into it.
		$attached = get_posts(
			array(
				'post_parent'    => $post->ID,
				'post_type'      => 'attachment',
				'post_mime_type' => 'image',
				'posts_per_page' => 20,
				'fields'         => 'ids',
				'post_status'    => 'inherit',
				'orderby'        => 'menu_order ID',
				'order'          => 'ASC',
			)
		);

		return array_map( 'absint', (array) $attached );
	}

	/**
	 * Flattens a meta value into a list of scalars.
	 *
	 * @since 1.2.0
	 *
	 * @param mixed $value Meta value.
	 *
	 * @return array<int,scalar> Scalar values.
	 */
	private function flatten_scalars( mixed $value ): array {
		$value = maybe_unserialize( $value );

		if ( is_scalar( $value ) ) {
			return array( $value );
		}

		if ( ! is_array( $value ) ) {
			return array();
		}

		$flat = array();

		array_walk_recursive(
			$value,
			static function ( $item ) use ( &$flat ): void {
				if ( is_scalar( $item ) ) {
					$flat[] = $item;
				}
			}
		);

		return $flat;
	}

	/**
	 * Recursively extracts image attachment IDs from parsed blocks.
	 *
	 * @since 1.0.0
	 *
	 * @param array<int,array<string,mixed>> $blocks Parsed block list.
	 *
	 * @return int[] Attachment IDs.
	 */
	private function extract_block_image_ids( array $blocks ): array {
		$ids = array();

		foreach ( $blocks as $block ) {
			$name = $block['blockName'] ?? '';

			if ( 'core/gallery' === $name && ! empty( $block['attrs']['ids'] ) && is_array( $block['attrs']['ids'] ) ) {
				$ids = array_merge( $ids, array_map( 'absint', $block['attrs']['ids'] ) );
			}

			if ( 'core/image' === $name && ! empty( $block['attrs']['id'] ) ) {
				$ids[] = absint( $block['attrs']['id'] );
			}

			if ( ! empty( $block['innerBlocks'] ) && is_array( $block['innerBlocks'] ) ) {
				$ids = array_merge( $ids, $this->extract_block_image_ids( $block['innerBlocks'] ) );
			}
		}

		return $ids;
	}

	/**
	 * Collects term names for a taxonomy, tolerating taxonomies that are
	 * not registered for the post type.
	 *
	 * @since 1.0.0
	 *
	 * @param WP_Post $post     Post object.
	 * @param string  $taxonomy Taxonomy name.
	 *
	 * @return array<int,array{id:int,name:string,slug:string}> Term list.
	 */
	private function collect_terms( WP_Post $post, string $taxonomy ): array {
		$terms = get_the_terms( $post, $taxonomy );

		if ( ! is_array( $terms ) ) {
			return array();
		}

		return array_values(
			array_map(
				static fn( $term ) => array(
					'id'   => (int) $term->term_id,
					'name' => $term->name,
					'slug' => $term->slug,
				),
				$terms
			)
		);
	}

	/**
	 * Collects every taxonomy term assigned to the post.
	 *
	 * Advertisement post types usually classify listings with custom
	 * taxonomies (ad category, city, brand), so the payload carries all of
	 * them instead of only the two built-in ones.
	 *
	 * @since 1.2.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return array<string,array<int,array{id:int,name:string,slug:string}>> Terms by taxonomy.
	 */
	private function collect_all_terms( WP_Post $post ): array {
		$result = array();

		foreach ( get_object_taxonomies( $post->post_type ) as $taxonomy ) {
			$terms = $this->collect_terms( $post, $taxonomy );

			if ( ! empty( $terms ) ) {
				$result[ $taxonomy ] = $terms;
			}
		}

		return $result;
	}

	/**
	 * Collects public custom fields (post meta).
	 *
	 * Protected keys (leading underscore) and known internal keys are
	 * excluded. Single-value arrays are flattened.
	 *
	 * @since 1.0.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return array<string,mixed> Custom field map.
	 */
	private function collect_custom_fields( WP_Post $post ): array {
		$meta   = get_post_meta( $post->ID );
		$fields = array();

		if ( ! is_array( $meta ) ) {
			return $fields;
		}

		foreach ( $meta as $key => $values ) {
			if ( is_protected_meta( $key, 'post' ) ) {
				continue;
			}

			$values = array_map( 'maybe_unserialize', (array) $values );

			$fields[ $key ] = 1 === count( $values ) ? $values[0] : $values;
		}

		/**
		 * Filters the custom fields included in the payload.
		 *
		 * @since 1.0.0
		 *
		 * @param array<string,mixed> $fields Custom field map.
		 * @param WP_Post             $post   Source post.
		 */
		return apply_filters( 'wpep_custom_fields', $fields, $post );
	}

	/**
	 * Resolves the advertisement price.
	 *
	 * @since 1.2.0
	 *
	 * @param WP_Post             $post   Post object.
	 * @param array<string,mixed> $fields Public custom fields.
	 *
	 * @return string Price as text, empty when unknown.
	 */
	private function detect_price( WP_Post $post, array $fields ): string {
		$value = $this->fields->scalar( $post, 'price', $fields );

		/**
		 * Filters the resolved advertisement price.
		 *
		 * @since 1.2.0
		 *
		 * @param string  $value Price as text.
		 * @param WP_Post $post  Source post.
		 */
		return (string) apply_filters( 'wpep_price', $this->plain_text( $value ), $post );
	}

	/**
	 * Resolves the advertisement location.
	 *
	 * @since 1.2.0
	 *
	 * @param WP_Post             $post   Post object.
	 * @param array<string,mixed> $fields Public custom fields.
	 *
	 * @return string Location as text, empty when unknown.
	 */
	private function detect_location( WP_Post $post, array $fields ): string {
		$value = $this->fields->scalar( $post, 'location', $fields );

		if ( '' === $value ) {
			$value = $this->location_from_taxonomies( $post );
		}

		/**
		 * Filters the resolved advertisement location.
		 *
		 * @since 1.2.0
		 *
		 * @param string  $value Location as text.
		 * @param WP_Post $post  Source post.
		 */
		return (string) apply_filters( 'wpep_location', $this->plain_text( $value ), $post );
	}

	/**
	 * Resolves the advertisement contact phone number.
	 *
	 * @since 1.2.1
	 *
	 * @param WP_Post             $post   Post object.
	 * @param array<string,mixed> $fields Public custom fields.
	 *
	 * @return string Phone number as text, empty when unknown.
	 */
	/**
	 * Returns the advertisement's contact number, however the site stores it.
	 *
	 * Public so the `phone` and `contact_advertiser` mapping fields resolve
	 * through the same detection chain the flat payload uses, rather than
	 * growing a second one that could disagree with it.
	 *
	 * This is detection only, and says nothing about whether the number may
	 * be published — that decision belongs to the privacy gate.
	 *
	 * @since 1.6.0
	 *
	 * @param WP_Post $post Source post.
	 *
	 * @return string Phone number, or an empty string when none is found.
	 */
	public function phone_for( WP_Post $post ): string {
		return $this->detect_phone( $post, $this->collect_custom_fields( $post ) );
	}

	private function detect_phone( WP_Post $post, array $fields ): string {
		$value = $this->fields->scalar( $post, 'phone', $fields );
		$value = $this->plain_text( $value );

		// When no mapped phone field exists, also inspect the human-written
		// advertisement description. This is especially useful for classifieds
		// sites where users type "تماس: 0912..." directly into the description.
		// Explicitly mapped phone values always win over text extraction.
		if ( '' === trim( $value ) ) {
			$description = $this->build_description( $post );
			$value       = $this->extract_phone_from_text( $description );
		}

		/**
		 * Filters the resolved advertisement phone number.
		 *
		 * @since 1.2.1
		 *
		 * @param string  $value Phone number as text.
		 * @param WP_Post $post  Source post.
		 */
		return (string) apply_filters( 'wpep_phone', $value, $post );
	}

	/**
	 * Extracts an Iranian mobile number from free-form text.
	 *
	 * Supports Persian/Arabic digits and common formats such as 0912...,
	 * +98912..., 0098912..., and spacing/dashes between digits. The helper
	 * intentionally requires an Iranian mobile prefix (09) after normalization
	 * so ordinary numbers, prices and IDs are not mistaken for phone numbers.
	 *
	 * @param string $text Text to inspect.
	 * @return string Normalized mobile number or empty string.
	 */
	private function extract_phone_from_text( string $text ): string {
		$text = $this->normalize_persian_digits( $text );
		if ( '' === trim( $text ) ) {
			return '';
		}

		// Strip common separators only between digits; keep surrounding text.
		$compact = preg_replace( '/(?<=\d)[\s\-\.()]+(?=\d)/u', '', $text );
		$compact = is_string( $compact ) ? $compact : $text;

		if ( preg_match( '/(?<!\d)(?:\+98|0098|98)?(9\d{9})(?!\d)/u', $compact, $matches ) ) {
			return '0' . $matches[1];
		}

		return '';
	}

	/**
	 * Converts Arabic/Persian numerals to ASCII digits.
	 *
	 * @param string $text Input text.
	 * @return string Normalized text.
	 */
	private function normalize_persian_digits( string $text ): string {
		return strtr( $text, array(
			'۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
			'۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
			'٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
			'٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
		) );
	}

	/**
	 * Resolves the telephone number of the user who wrote the advertisement.
	 *
	 * This is the author's own number and is unrelated to the contact
	 * number printed in the advertisement, which is post meta and is
	 * resolved by {@see self::detect_phone()}.
	 *
	 * **Where it looks, and nowhere else:** user meta on the post author,
	 * over the fixed key list in {@see self::AUTHOR_PHONE_KEYS}, first
	 * non-empty wins. Sites that store it under another name add that name
	 * with the `wpep_author_phone_meta_keys` filter.
	 *
	 * **What it never does.** It does not read the message, the post
	 * content, the title or any custom field, because a number that appears
	 * in text is not a number that anyone declared to be a phone number. It
	 * does not fuzzy-match key names, so a key called `verification_code`
	 * is never mistaken for one. It does not fall back to the user ID, the
	 * login, or any other numeric user attribute — those are identifiers
	 * that happen to be digits, and treating one as a telephone number
	 * would put a real, wrong number in front of a real person. It invents
	 * nothing: when no configured key holds a plausible number, the value
	 * is an empty string, which is a correct answer.
	 *
	 * @since 1.5.1
	 *
	 * @param int $user_id Post author identifier.
	 *
	 * @return string Phone number as text, empty when unknown.
	 */
	private function author_phone( int $user_id ): string {
		$phone = '';

		if ( $user_id > 0 ) {
			/**
			 * Filters the user meta keys searched for the author's phone
			 * number.
			 *
			 * Keys are tried in order and the first plausible value wins.
			 * Only add keys whose value genuinely is a telephone number:
			 * whatever is returned here is published.
			 *
			 * @since 1.5.1
			 *
			 * @param string[] $keys    User meta keys, in priority order.
			 * @param int      $user_id Post author identifier.
			 */
			$keys = (array) apply_filters( 'wpep_author_phone_meta_keys', self::AUTHOR_PHONE_KEYS, $user_id );

			foreach ( $keys as $key ) {
				$key = trim( (string) $key );

				if ( '' === $key ) {
					continue;
				}

				$scalars = $this->flatten_scalars( get_user_meta( $user_id, $key, true ) );

				foreach ( $scalars as $scalar ) {
					$candidate = $this->plain_text( (string) $scalar );

					if ( $this->looks_like_phone( $candidate ) ) {
						$phone = $candidate;
						break 2;
					}
				}
			}
		}

		/**
		 * Filters the resolved author phone number.
		 *
		 * @since 1.5.1
		 *
		 * @param string $phone   Phone number as text, empty when unknown.
		 * @param int    $user_id Post author identifier.
		 */
		return (string) apply_filters( 'wpep_author_phone', $phone, $user_id );
	}

	/**
	 * Whether a string is shaped like a telephone number.
	 *
	 * A deliberately conservative check, because the cost of a false
	 * positive is publishing a stranger's identifier as a contact number.
	 * The value has to be short enough to be a number, long enough to be
	 * dialled, and made only of the characters numbers are written with.
	 *
	 * @since 1.5.1
	 *
	 * @param string $value Candidate value.
	 *
	 * @return bool True when the value can be published as a phone number.
	 */
	private function looks_like_phone( string $value ): bool {
		$value = trim( $value );

		if ( '' === $value || mb_strlen( $value ) > 32 ) {
			return false;
		}

		// Persian and Arabic-Indic digits are how the number is often typed.
		$latin = strtr(
			$value,
			array(
				'۰' => '0',
				'۱' => '1',
				'۲' => '2',
				'۳' => '3',
				'۴' => '4',
				'۵' => '5',
				'۶' => '6',
				'۷' => '7',
				'۸' => '8',
				'۹' => '9',
				'٠' => '0',
				'١' => '1',
				'٢' => '2',
				'٣' => '3',
				'٤' => '4',
				'٥' => '5',
				'٦' => '6',
				'٧' => '7',
				'٨' => '8',
				'٩' => '9',
			)
		);

		// Only the punctuation phone numbers are actually written with. A
		// value carrying a letter or a currency mark is something else.
		if ( 1 !== preg_match( '/^\+?[0-9()\/.\-\s]+$/', $latin ) ) {
			return false;
		}

		$digits = preg_replace( '/\D/', '', $latin ) ?? '';

		// Seven is the shortest dialable subscriber number; more than
		// fifteen exceeds E.164 and is an identifier of some other kind.
		return strlen( $digits ) >= 7 && strlen( $digits ) <= 15;
	}

	/**
	 * Reads the first non-empty value from the mapped meta keys.
	 *
	 * Reads through `get_post_meta()` directly so protected keys such as
	 * WooCommerce's `_price` can be mapped as well.
	 *
	 * @since 1.2.0
	 *
	 * @param WP_Post $post        Post object.
	 * @param string  $setting_key Settings key holding the mapping.
	 *
	 * @return string Value as text, empty when nothing matched.
	 */
	private function mapped_meta_value( WP_Post $post, string $setting_key ): string {
		foreach ( $this->mapped_keys( $setting_key ) as $key ) {
			$values = $this->flatten_scalars( get_post_meta( $post->ID, $key, true ) );

			foreach ( $values as $value ) {
				if ( '' !== trim( (string) $value ) ) {
					return (string) $value;
				}
			}
		}

		return '';
	}

	/**
	 * Derives a location from taxonomies that look geographic.
	 *
	 * @since 1.2.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return string Comma separated term names, empty when none matched.
	 */
	private function location_from_taxonomies( WP_Post $post ): string {
		foreach ( get_object_taxonomies( $post->post_type ) as $taxonomy ) {
			$normalized = strtolower( $taxonomy );

			foreach ( self::CITY_HINTS as $hint ) {
				if ( ! str_contains( $normalized, $hint ) ) {
					continue;
				}

				$terms = get_the_terms( $post, $taxonomy );

				if ( is_array( $terms ) && ! empty( $terms ) ) {
					return implode( '، ', array_map( static fn( $term ) => $term->name, $terms ) );
				}
			}
		}

		return '';
	}

	/**
	 * Auto-detects a semantic value (e.g. price, location) from the custom
	 * field map by fuzzy-matching key names — nothing is hardcoded to a
	 * specific plugin's meta keys.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string,mixed> $fields Custom field map.
	 * @param string[]            $hints  Key fragments to look for.
	 *
	 * @return mixed Detected scalar value or null.
	 */
	private function detect_meta_value( array $fields, array $hints ): mixed {
		foreach ( $fields as $key => $value ) {
			$normalized_key = strtolower( (string) $key );

			foreach ( $hints as $hint ) {
				if ( str_contains( $normalized_key, $hint ) && is_scalar( $value ) && '' !== (string) $value ) {
					return $value;
				}
			}
		}

		return null;
	}

	/**
	 * Detects the content language.
	 *
	 * Prefers per-post multilingual data exposed via the
	 * `wpep_post_language` filter (WPML/Polylang integrations can hook
	 * in), falling back to the site locale.
	 *
	 * @since 1.0.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return string Language / locale code.
	 */
	private function detect_language( WP_Post $post ): string {
		$language = get_locale();

		// Polylang.
		if ( function_exists( 'pll_get_post_language' ) ) {
			$pll = pll_get_post_language( $post->ID, 'locale' );
			if ( is_string( $pll ) && '' !== $pll ) {
				$language = $pll;
			}
		}

		/**
		 * Filters the language reported for a post.
		 *
		 * @since 1.0.0
		 *
		 * @param string  $language Locale code.
		 * @param WP_Post $post     Source post.
		 */
		return (string) apply_filters( 'wpep_post_language', $language, $post );
	}
}
