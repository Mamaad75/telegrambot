<?php
/**
 * Field discovery across providers.
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
 * Asks every available provider what fields a post type has, and caches
 * the answer.
 *
 * Discovery reads field group definitions and runs a grouped query against
 * the meta table. That is fine once; doing it on every publish would put a
 * scan in the path of every advertisement. So the result is cached under a
 * key that includes every provider's signature: activating ACF, editing a
 * JetEngine meta box or deactivating Meta Box changes a signature, which
 * changes the key, which rebuilds the list. Nobody has to remember to clear
 * a cache.
 *
 * When two providers describe the same storage key, the one that knows more
 * wins: a framework's own definition (real label, declared type, choice
 * list) replaces the meta provider's guess. Provider order decides ties,
 * and {@see self::providers()} is filterable, so a site can change it.
 *
 * @since 1.4.0
 */
class FieldRegistry {

	/**
	 * Option holding the cache generation counter.
	 *
	 * Bumping it invalidates every cached discovery at once.
	 *
	 * @var string
	 */
	public const OPTION_GENERATION = 'wpep_fields_generation';

	/**
	 * Cache group for discovered field lists.
	 *
	 * @var string
	 */
	private const CACHE_GROUP = 'wpep_fields';

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Normalizer, needed by the image provider.
	 *
	 * @var Normalizer
	 */
	private Normalizer $normalizer;

	/**
	 * Registered providers, keyed by id.
	 *
	 * @var array<string,FieldProvider>|null
	 */
	private ?array $providers = null;

	/**
	 * Per-request memo of discovered fields.
	 *
	 * @var array<string,array<string,Field>>
	 */
	private array $memo = array();

	/**
	 * Constructor.
	 *
	 * @since 1.4.0
	 *
	 * @param Settings   $settings   Settings service.
	 * @param Normalizer $normalizer Normalizer service.
	 */
	public function __construct( Settings $settings, Normalizer $normalizer ) {
		$this->settings   = $settings;
		$this->normalizer = $normalizer;
	}

	/**
	 * Returns every provider, available or not.
	 *
	 * Order matters: later providers override earlier ones for the same
	 * storage key, so the frameworks come after the generic meta scan.
	 *
	 * @since 1.4.0
	 *
	 * @return array<string,FieldProvider> Providers keyed by id.
	 */
	public function providers(): array {
		if ( null !== $this->providers ) {
			return $this->providers;
		}

		$providers = array(
			new CoreProvider( $this->normalizer ),
			new MetaProvider(),
			new TaxonomyProvider(),
			new ImageProvider( $this->normalizer ),
			new JetEngineProvider(),
			new AcfProvider(),
			new MetaBoxProvider(),
			new PodsProvider(),
			// Registers itself only when WooCommerce is active, and only
			// answers for the shop_order pseudo post type.
			new WooCommerceOrderProvider(),
			new JetFormBuilderProvider(),
		);

		/**
		 * Filters the registered field providers.
		 *
		 * Append a class implementing {@see FieldProvider} to teach the
		 * plugin a field framework it does not know. Providers later in the
		 * list win when two describe the same storage key.
		 *
		 * @since 1.4.0
		 *
		 * @param FieldProvider[] $providers Provider instances.
		 */
		$providers = (array) apply_filters( 'wpep_field_providers', $providers );

		$indexed = array();

		foreach ( $providers as $provider ) {
			if ( $provider instanceof FieldProvider ) {
				$indexed[ $provider->id() ] = $provider;
			}
		}

		$this->providers = $indexed;

		return $indexed;
	}

	/**
	 * Returns one provider by id.
	 *
	 * @since 1.4.0
	 *
	 * @param string $id Provider id.
	 *
	 * @return FieldProvider|null Provider, null when not registered.
	 */
	public function provider( string $id ): ?FieldProvider {
		return $this->providers()[ $id ] ?? null;
	}

	/**
	 * Returns only the providers that can contribute right now.
	 *
	 * @since 1.4.0
	 *
	 * @return array<string,FieldProvider> Available providers keyed by id.
	 */
	public function available(): array {
		return array_filter( $this->providers(), static fn( FieldProvider $p ): bool => $p->is_available() );
	}

	/**
	 * Discovers every field of a post type.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 * @param bool   $fresh     Bypass the cache and rebuild.
	 *
	 * @return array<string,Field> Fields keyed by field key.
	 */
	public function discover( string $post_type, bool $fresh = false ): array {
		$post_type = sanitize_key( $post_type );

		if ( '' === $post_type ) {
			return array();
		}

		if ( ! $fresh && isset( $this->memo[ $post_type ] ) ) {
			return $this->memo[ $post_type ];
		}

		$key = $this->cache_key( $post_type );

		if ( ! $fresh ) {
			$cached = get_transient( $key );

			if ( is_array( $cached ) ) {
				$fields = array();

				foreach ( $cached as $data ) {
					if ( is_array( $data ) ) {
						$field                  = Field::from_array( $data );
						$fields[ $field->key() ] = $field;
					}
				}

				$this->memo[ $post_type ] = $fields;

				return $fields;
			}
		}

		$fields = $this->build( $post_type );

		$stored = array();

		foreach ( $fields as $field ) {
			$stored[] = $field->to_array();
		}

		/**
		 * Filters how long discovered fields stay cached.
		 *
		 * The cache key already changes when a provider's definitions
		 * change, so this is only a backstop against a stale entry.
		 *
		 * @since 1.4.0
		 *
		 * @param int    $ttl       Lifetime in seconds. Default 12 hours.
		 * @param string $post_type Post type slug.
		 */
		$ttl = (int) apply_filters( 'wpep_field_cache_ttl', 12 * HOUR_IN_SECONDS, $post_type );

		set_transient( $key, $stored, max( MINUTE_IN_SECONDS, $ttl ) );

		$this->memo[ $post_type ] = $fields;

		return $fields;
	}

	/**
	 * Runs discovery across the available providers and merges the result.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return array<string,Field> Fields keyed by field key.
	 */
	private function build( string $post_type ): array {
		$fields  = array();
		$claimed = array();

		foreach ( $this->available() as $provider ) {
			try {
				$discovered = $provider->discover( $post_type );
			} catch ( \Throwable $e ) {
				// A broken third-party provider costs its own fields, never
				// the whole screen and never a publication.
				continue;
			}

			foreach ( $discovered as $field ) {
				if ( ! $field instanceof Field || '' === $field->key() ) {
					continue;
				}

				$storage = $field->source() . '|' . $field->storage_key();
				$generic = MetaProvider::ID . '|' . $field->storage_key();

				// A framework describing a key the meta scan already found
				// replaces it: same data, better description.
				if ( MetaProvider::ID !== $field->source() && isset( $claimed[ $generic ] ) ) {
					unset( $fields[ $claimed[ $generic ] ] );
					unset( $claimed[ $generic ] );
				}

				// The meta scan never shadows a framework's own definition.
				if ( MetaProvider::ID === $field->source() && $this->already_described( $fields, $field->storage_key() ) ) {
					continue;
				}

				$key = $field->key();

				// Two providers with genuinely different fields of the same
				// name both keep their data; the later one is namespaced.
				if ( isset( $fields[ $key ] ) && $fields[ $key ]->storage_key() !== $field->storage_key() ) {
					$key = $field->source() . '_' . $key;
				}

				$fields[ $key ]    = $key === $field->key() ? $field : Field::from_array( array_merge( $field->to_array(), array( 'key' => $key ) ) );
				$claimed[ $storage ] = $key;
			}
		}

		/**
		 * Filters the discovered fields of a post type.
		 *
		 * @since 1.4.0
		 *
		 * @param array<string,Field> $fields    Fields keyed by field key.
		 * @param string              $post_type Post type slug.
		 */
		return (array) apply_filters( 'wpep_discovered_fields', $fields, $post_type );
	}

	/**
	 * Whether a framework provider already described a storage key.
	 *
	 * @since 1.4.0
	 *
	 * @param array<string,Field> $fields  Fields collected so far.
	 * @param string              $storage Storage key.
	 *
	 * @return bool True when a non-meta provider owns the key.
	 */
	private function already_described( array $fields, string $storage ): bool {
		foreach ( $fields as $field ) {
			if ( $field->storage_key() === $storage && MetaProvider::ID !== $field->source() ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Returns one discovered field.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 * @param string $key       Field key.
	 *
	 * @return Field|null Field, null when the post type has no such field.
	 */
	public function field( string $post_type, string $key ): ?Field {
		return $this->discover( $post_type )[ $key ] ?? null;
	}

	/**
	 * Groups discovered fields by provider, for the admin screen.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 * @param bool   $fresh     Bypass the cache.
	 *
	 * @return array<string,array{label:string,fields:array<string,Field>}> Groups keyed by provider id.
	 */
	public function grouped( string $post_type, bool $fresh = false ): array {
		$groups = array();

		foreach ( $this->discover( $post_type, $fresh ) as $key => $field ) {
			$source = $field->source();

			if ( ! isset( $groups[ $source ] ) ) {
				$provider = $this->provider( $source );

				$groups[ $source ] = array(
					'label'  => $provider instanceof FieldProvider ? $provider->label() : $this->fallback_label( $source ),
					'fields' => array(),
				);
			}

			$groups[ $source ]['fields'][ $key ] = $field;
		}

		return $groups;
	}

	/**
	 * Label for a field whose provider is no longer registered.
	 *
	 * @since 1.4.0
	 *
	 * @param string $source Provider id.
	 *
	 * @return string Group label.
	 */
	private function fallback_label( string $source ): string {
		return '' === $source ? __( 'Other providers', 'wp-event-publisher' ) : $source;
	}

	/**
	 * Reads a sample value of a field, formatted for the admin preview.
	 *
	 * @since 1.4.0
	 *
	 * @param Field        $field  Field to sample.
	 * @param WP_Post|null $post   Post to read, or null for the newest one.
	 * @param FieldResolver $resolver Resolver used to format the value.
	 *
	 * @return string Human readable sample, empty when there is none.
	 */
	public function sample( Field $field, ?WP_Post $post, FieldResolver $resolver ): string {
		if ( ! $post instanceof WP_Post ) {
			return '';
		}

		try {
			$value = $resolver->text( $field, $post );
		} catch ( \Throwable $e ) {
			return '';
		}

		if ( '' === $value ) {
			return '';
		}

		return mb_strlen( $value ) > 120 ? mb_substr( $value, 0, 120 ) . '…' : $value;
	}

	/**
	 * Returns a post to draw sample values from.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return WP_Post|null Sample post, null when the type has no content.
	 */
	public function sample_post( string $post_type ): ?WP_Post {
		$posts = get_posts(
			array(
				'post_type'        => $post_type,
				'post_status'      => array( 'publish', 'draft', 'pending', 'private' ),
				'posts_per_page'   => 1,
				'orderby'          => 'date',
				'order'            => 'DESC',
				'suppress_filters' => true,
				'no_found_rows'    => true,
			)
		);

		return ( is_array( $posts ) && isset( $posts[0] ) && $posts[0] instanceof WP_Post ) ? $posts[0] : null;
	}

	/**
	 * Builds the cache key for a post type.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return string Transient name.
	 */
	private function cache_key( string $post_type ): string {
		$signatures = array( (string) get_option( self::OPTION_GENERATION, '1' ) );

		foreach ( $this->providers() as $provider ) {
			try {
				$signatures[] = $provider->signature();
			} catch ( \Throwable $e ) {
				$signatures[] = $provider->id() . ':error';
			}
		}

		// Transient names are limited to 172 characters, so the varying part
		// is hashed rather than concatenated.
		return 'wpep_fields_' . md5( $post_type . '|' . implode( '|', $signatures ) );
	}

	/**
	 * Invalidates every cached discovery.
	 *
	 * Called on activation, on settings save, and whenever a plugin is
	 * activated or deactivated. Bumping a counter is O(1) and needs no
	 * `LIKE` delete against the options table; the old entries expire on
	 * their own.
	 *
	 * @since 1.4.0
	 *
	 * @return void
	 */
	public function flush(): void {
		$this->memo      = array();
		$this->providers = null;

		update_option( self::OPTION_GENERATION, (string) ( (int) get_option( self::OPTION_GENERATION, '1' ) + 1 ), false );

		/**
		 * Fires after the field discovery cache was invalidated.
		 *
		 * @since 1.4.0
		 */
		do_action( 'wpep_fields_flushed' );
	}

	/**
	 * Registers the hooks that keep the cache honest.
	 *
	 * @since 1.4.0
	 *
	 * @return void
	 */
	public function register(): void {
		// A plugin appearing or disappearing can change every provider.
		add_action( 'activated_plugin', array( $this, 'flush' ) );
		add_action( 'deactivated_plugin', array( $this, 'flush' ) );
		add_action( 'upgrader_process_complete', array( $this, 'flush' ) );

		// Field group edits in ACF and JetEngine.
		add_action( 'acf/update_field_group', array( $this, 'flush' ) );
		add_action( 'acf/delete_field_group', array( $this, 'flush' ) );
		add_action( 'jet-engine/meta-boxes/updated-item', array( $this, 'flush' ) );
	}
}
