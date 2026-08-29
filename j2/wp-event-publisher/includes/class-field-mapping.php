<?php
/**
 * Field mapping storage and inheritance.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

use WP_Post;
use WP_Term;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Decides which discovered fields are sent, under what name, in what
 * order, and to whom.
 *
 * A mapping is stored per scope. A scope is a post type on its own
 * (`car`), or a post type and a taxonomy term (`car:product_cat:42`).
 * Resolution walks from the most specific scope outwards — the term, then
 * each ancestor term, then the post type — and the first scope that has an
 * opinion about a field wins. That is what makes "Cars → SUV" able to add
 * `drivetrain` without repeating everything "Cars" already said, and what
 * makes editing "Cars" reach every one of its subcategories.
 *
 * A scope with no stored mapping is not empty: it inherits, all the way up
 * to the automatically generated default. A site that never opens this
 * screen behaves exactly as it did before the feature existed.
 *
 * @since 1.4.0
 */
class FieldMapping {

	/**
	 * Option holding every mapping, keyed by scope.
	 *
	 * @var string
	 */
	public const OPTION = 'wpep_field_mappings';

	/**
	 * Field keys the default mapping enables for Telegram, in order.
	 *
	 * These reproduce the payload the plugin sent before mappings existed,
	 * so an upgrade changes nothing that is visible downstream.
	 *
	 * @var string[]
	 */
	private const DEFAULT_TELEGRAM = array( 'title', 'price', 'location', 'city', 'phone', 'description', 'permalink' );

	/*
	 * `phone` stays in DEFAULT_TELEGRAM deliberately. New installations never
	 * reach this list — they get defaults_all_off(), where the phone and
	 * contact fields start off along with everything else, which is what spec
	 * 4 and 26 ask for. This list is only consulted for a pre-1.6.0 site that
	 * never saved a mapping, and there the number was already being published;
	 * switching it off during an upgrade would silently change what a live
	 * site sends. `contact_advertiser` is absent because it is new in 1.6.0,
	 * so no site can have been relying on it.
	 */

	/**
	 * Field keys the default mapping sends to the backend without showing
	 * them in the message.
	 *
	 * @var string[]
	 */
	private const DEFAULT_BACKEND = array( 'id', 'post_type', 'status', 'slug', 'author', 'published_at', 'updated_at', 'featured_image', 'gallery', 'images', 'excerpt' );

	/**
	 * Which default mapping a site gets when it has saved none.
	 *
	 * Two requirements pull in opposite directions here, and this option is the
	 * seam between them.
	 *
	 * A **new** installation must start with every field off, so nothing is
	 * published until somebody chooses it — and in particular so a phone number
	 * is never broadcast by default.
	 *
	 * An **existing** installation must keep publishing exactly what it
	 * published yesterday. Those sites rely on `defaults()`: many never opened
	 * the mapping screen, and their live Telegram channel is fed by
	 * `DEFAULT_TELEGRAM`. Returning all-off for them would silently stop
	 * publishing on upgrade, which is the worst possible outcome of a cosmetic
	 * release.
	 *
	 * So the answer depends on where the site came from. Activation on an empty
	 * database writes `off`; the 1.6.0 migration writes `legacy`. Neither
	 * overwrites the other, and an administrator's saved mapping outranks both.
	 *
	 * @since 1.6.0
	 *
	 * @var string
	 */
	public const OPTION_DEFAULTS_MODE = 'wpep_field_defaults_mode';

	/**
	 * Defaults mode: nothing enabled until the administrator says so.
	 *
	 * @since 1.6.0
	 * @var string
	 */
	public const DEFAULTS_OFF = 'off';

	/**
	 * Defaults mode: reproduce what 1.5.x sent.
	 *
	 * @since 1.6.0
	 * @var string
	 */
	public const DEFAULTS_LEGACY = 'legacy';

	/**
	 * Field registry.
	 *
	 * @var FieldRegistry
	 */
	private FieldRegistry $registry;

	/**
	 * Cached option contents.
	 *
	 * @var array<string,array<string,mixed>>|null
	 */
	private ?array $stored = null;

	/**
	 * Constructor.
	 *
	 * @since 1.4.0
	 *
	 * @param FieldRegistry $registry Field registry.
	 */
	public function __construct( FieldRegistry $registry ) {
		$this->registry = $registry;
	}

	/**
	 * Builds a scope identifier.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 * @param string $taxonomy  Taxonomy name, empty for the post type scope.
	 * @param int    $term_id   Term ID, 0 for the post type scope.
	 *
	 * @return string Scope key.
	 */
	public static function scope( string $post_type, string $taxonomy = '', int $term_id = 0 ): string {
		$post_type = sanitize_key( $post_type );

		if ( '' === $taxonomy || $term_id <= 0 ) {
			return $post_type;
		}

		return $post_type . ':' . sanitize_key( $taxonomy ) . ':' . $term_id;
	}

	/**
	 * Reads every stored mapping.
	 *
	 * @since 1.4.0
	 *
	 * @return array<string,array<string,mixed>> Mappings keyed by scope.
	 */
	private function all(): array {
		if ( null !== $this->stored ) {
			return $this->stored;
		}

		$stored = get_option( self::OPTION, array() );

		$this->stored = is_array( $stored ) ? $stored : array();

		return $this->stored;
	}

	/**
	 * Whether a scope has its own stored mapping.
	 *
	 * @since 1.4.0
	 *
	 * @param string $scope Scope key.
	 *
	 * @return bool True when the scope overrides its parent.
	 */
	public function has_own( string $scope ): bool {
		$all = $this->all();

		return isset( $all[ $scope ] ) && is_array( $all[ $scope ] ) && ! empty( $all[ $scope ]['fields'] );
	}

	/**
	 * Returns a scope's own stored mapping, without inheritance.
	 *
	 * @since 1.4.0
	 *
	 * @param string $scope Scope key.
	 *
	 * @return array<string,mixed> Stored mapping, empty when there is none.
	 */
	public function own( string $scope ): array {
		$all = $this->all();

		return isset( $all[ $scope ] ) && is_array( $all[ $scope ] ) ? $all[ $scope ] : array();
	}

	/**
	 * Lists the scopes a lookup walks, most specific first.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 * @param string $taxonomy  Taxonomy name.
	 * @param int    $term_id   Term ID.
	 *
	 * @return string[] Scope keys.
	 */
	public function chain( string $post_type, string $taxonomy = '', int $term_id = 0 ): array {
		$chain = array();

		if ( '' !== $taxonomy && $term_id > 0 ) {
			$chain[] = self::scope( $post_type, $taxonomy, $term_id );

			foreach ( (array) get_ancestors( $term_id, $taxonomy, 'taxonomy' ) as $ancestor_id ) {
				$chain[] = self::scope( $post_type, $taxonomy, (int) $ancestor_id );
			}
		}

		$chain[] = self::scope( $post_type );

		return $chain;
	}

	/**
	 * Resolves the effective mapping for a scope.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 * @param string $taxonomy  Taxonomy name.
	 * @param int    $term_id   Term ID.
	 *
	 * @return array<string,array<string,mixed>> Field settings keyed by field key, in display order.
	 */
	public function resolve( string $post_type, string $taxonomy = '', int $term_id = 0 ): array {
		$chain    = $this->chain( $post_type, $taxonomy, $term_id );
		$resolved = array();

		// Walk from the least specific scope outwards so a more specific one
		// overwrites what it inherits.
		foreach ( array_reverse( $chain ) as $scope ) {
			$mapping = $this->own( $scope );

			foreach ( (array) ( $mapping['fields'] ?? array() ) as $key => $settings ) {
				if ( ! is_array( $settings ) ) {
					continue;
				}

				$key = (string) $key;

				$resolved[ $key ] = array_merge( $resolved[ $key ] ?? array(), $settings, array( 'inherited_from' => $scope ) );
			}
		}

		if ( empty( $resolved ) ) {
			$resolved = $this->defaults( $post_type );
		}

		// A mapped field whose post type no longer has it is dropped rather
		// than sent as an empty value.
		$discovered = $this->registry->discover( $post_type );
		$effective  = array();

		foreach ( $resolved as $key => $settings ) {
			if ( ! isset( $discovered[ $key ] ) ) {
				continue;
			}

			$effective[ $key ] = $this->normalize_entry( $settings );
		}

		uasort(
			$effective,
			static fn( array $a, array $b ): int => ( (int) $a['order'] ) <=> ( (int) $b['order'] )
		);

		/**
		 * Filters the effective field mapping for a scope.
		 *
		 * @since 1.4.0
		 *
		 * @param array<string,array<string,mixed>> $effective Field settings keyed by field key.
		 * @param string                            $post_type Post type slug.
		 * @param string                            $taxonomy  Taxonomy name.
		 * @param int                               $term_id   Term ID.
		 */
		return (array) apply_filters( 'wpep_field_mapping', $effective, $post_type, $taxonomy, $term_id );
	}

	/**
	 * Resolves the mapping that applies to one post.
	 *
	 * Picks the deepest term of the post's primary taxonomy, so a listing
	 * filed under "Cars → SUV" gets the SUV mapping.
	 *
	 * @since 1.4.0
	 *
	 * @param WP_Post $post Post object.
	 *
	 * @return array{mapping:array<string,array<string,mixed>>,taxonomy:string,term:WP_Term|null} Resolution result.
	 */
	public function for_post( WP_Post $post ): array {
		$taxonomy = $this->primary_taxonomy( $post->post_type );
		$term     = null;

		if ( '' !== $taxonomy ) {
			$terms = get_the_terms( $post, $taxonomy );

			if ( is_array( $terms ) && ! empty( $terms ) ) {
				$provider = $this->registry->provider( TaxonomyProvider::ID );
				$term     = $provider instanceof TaxonomyProvider ? $provider->deepest( $terms ) : null;

				if ( ! $term instanceof WP_Term && isset( $terms[0] ) && $terms[0] instanceof WP_Term ) {
					$term = $terms[0];
				}
			}
		}

		return array(
			'mapping'  => $this->resolve( $post->post_type, $taxonomy, $term instanceof WP_Term ? (int) $term->term_id : 0 ),
			'taxonomy' => $taxonomy,
			'term'     => $term,
		);
	}

	/**
	 * Returns the taxonomy a post type's mappings are organised by.
	 *
	 * The first hierarchical taxonomy is the category tree on essentially
	 * every classifieds site. Sites that classify differently override it.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return string Taxonomy name, empty when the type has no hierarchy.
	 */
	public function primary_taxonomy( string $post_type ): string {
		$chosen = '';

		foreach ( get_object_taxonomies( $post_type, 'objects' ) as $taxonomy ) {
			if ( $taxonomy instanceof \WP_Taxonomy && $taxonomy->hierarchical ) {
				$chosen = (string) $taxonomy->name;
				break;
			}
		}

		/**
		 * Filters which taxonomy drives per-category field mappings.
		 *
		 * @since 1.4.0
		 *
		 * @param string $taxonomy  Taxonomy name, empty when none.
		 * @param string $post_type Post type slug.
		 */
		return (string) apply_filters( 'wpep_mapping_taxonomy', $chosen, $post_type );
	}

	/**
	 * Builds the automatic default mapping for a post type.
	 *
	 * Reproduces the pre-1.4.0 payload: the advertisement fields the
	 * Node.js publisher reads go to Telegram, the structural ones go to the
	 * backend, and everything else is discovered but disabled. Nothing an
	 * administrator did not ask for is broadcast.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return array<string,array<string,mixed>> Default field settings.
	 */
	public function defaults( string $post_type ): array {
		if ( self::DEFAULTS_OFF === self::defaults_mode() ) {
			return $this->defaults_all_off( $post_type );
		}

		$fields  = $this->registry->discover( $post_type );
		$mapping = array();
		$order   = 0;

		// The named fields first, in the order they are listed, so the
		// generated message reads like the one the plugin used to send.
		foreach ( self::DEFAULT_TELEGRAM as $key ) {
			if ( isset( $fields[ $key ] ) ) {
				$mapping[ $key ] = $this->entry( $fields[ $key ], Field::VISIBILITY_TELEGRAM, $order++ );
			}
		}

		foreach ( self::DEFAULT_BACKEND as $key ) {
			if ( isset( $fields[ $key ] ) && ! isset( $mapping[ $key ] ) ) {
				$mapping[ $key ] = $this->entry( $fields[ $key ], Field::VISIBILITY_BACKEND, $order++ );
			}
		}

		// Taxonomies carry the category, which the payload has always
		// included; they are sent but not printed.
		foreach ( $fields as $key => $field ) {
			if ( isset( $mapping[ $key ] ) ) {
				continue;
			}

			$visibility = TaxonomyProvider::ID === $field->source() && ! str_contains( $key, '_top' ) && ! str_contains( $key, '_leaf' ) && ! str_contains( $key, '_path' )
				? Field::VISIBILITY_BACKEND
				: Field::VISIBILITY_HIDDEN;

			$mapping[ $key ] = $this->entry( $field, $visibility, $order++ );
		}

		/**
		 * Filters the automatic default field mapping.
		 *
		 * @since 1.4.0
		 *
		 * @param array<string,array<string,mixed>> $mapping   Default settings.
		 * @param string                            $post_type Post type slug.
		 */
		return (array) apply_filters( 'wpep_default_field_mapping', $mapping, $post_type );
	}

	/**
	 * Which defaults a site with no saved mapping receives.
	 *
	 * Defaults to `legacy` when the option is absent. An installation that
	 * predates 1.6.0 and somehow missed the migration is far better served by
	 * continuing to publish than by going quiet.
	 *
	 * @since 1.6.0
	 *
	 * @return string One of the DEFAULTS_* constants.
	 */
	public static function defaults_mode(): string {
		$mode = (string) get_option( self::OPTION_DEFAULTS_MODE, self::DEFAULTS_LEGACY );

		return self::DEFAULTS_OFF === $mode ? self::DEFAULTS_OFF : self::DEFAULTS_LEGACY;
	}

	/**
	 * The new-installation default: every discovered field present but off.
	 *
	 * The fields are listed rather than omitted, so the mapping screen can show
	 * the administrator everything their post type offers. They simply all start
	 * switched off, on every platform.
	 *
	 * `title` is enabled as a technical necessity — validation rejects a payload
	 * with no title, so a mapping with nothing at all enabled could never
	 * publish. It is enabled with no platform selected, which means it is sent
	 * to the backend but printed nowhere: honest, and it keeps the "choose what
	 * you publish" decision entirely with the administrator.
	 *
	 * @since 1.6.0
	 *
	 * @param string $post_type Post type slug.
	 *
	 * @return array<string,array<string,mixed>> Default settings, all off.
	 */
	private function defaults_all_off( string $post_type ): array {
		$fields  = $this->registry->discover( $post_type );
		$mapping = array();
		$order   = 0;

		foreach ( $fields as $key => $field ) {
			$entry = $this->entry( $field, Field::VISIBILITY_HIDDEN, $order++ );

			if ( 'title' === $key ) {
				$entry['enabled']    = true;
				$entry['visibility'] = Field::VISIBILITY_BACKEND;
			}

			$mapping[ $key ] = $entry;
		}

		/**
		 * Filters the all-off default mapping used by new installations.
		 *
		 * @since 1.6.0
		 *
		 * @param array<string,array<string,mixed>> $mapping   Default settings.
		 * @param string                            $post_type Post type slug.
		 */
		return (array) apply_filters( 'wpep_default_field_mapping_off', $mapping, $post_type );
	}

	/**
	 * Builds one mapping entry for a field.
	 *
	 * @since 1.4.0
	 *
	 * @param Field  $field      Discovered field.
	 * @param string $visibility Visibility constant.
	 * @param int    $order      Sort order.
	 *
	 * @return array<string,mixed> Mapping entry.
	 */
	private function entry( Field $field, string $visibility, int $order ): array {
		$enabled = Field::VISIBILITY_HIDDEN !== $visibility;

		$platforms = array();
		foreach ( Field::PLATFORMS as $platform ) {
			// Only Telegram existed before 1.6.0, so a legacy default that was
			// destined for the message becomes a Telegram-only field. Bale and
			// WhatsApp start off for everyone: no existing site was publishing
			// to them, and switching them on unasked would broadcast content to
			// platforms the administrator has not configured.
			$platforms[ $platform ] = Field::PLATFORM_TELEGRAM === $platform
				&& Field::VISIBILITY_TELEGRAM === $visibility;
		}

		return array(
			'enabled'    => $enabled,
			'label'      => $field->label(),
			'visibility' => $visibility,
			'platforms'  => $platforms,
			'order'      => $order,
			'format'     => FieldResolver::FORMAT_INLINE,
			'separator'  => '، ',
		);
	}

	/**
	 * Fills in and sanitizes a stored mapping entry.
	 *
	 * @since 1.4.0
	 *
	 * @param array<string,mixed> $settings Raw entry.
	 *
	 * @return array<string,mixed> Complete entry.
	 */
	private function normalize_entry( array $settings ): array {
		$visibility = (string) ( $settings['visibility'] ?? Field::VISIBILITY_BACKEND );
		$visibility = in_array( $visibility, Field::VISIBILITIES, true ) ? $visibility : Field::VISIBILITY_BACKEND;
		$enabled    = ! empty( $settings['enabled'] );

		return array(
			'enabled'        => $enabled,
			'label'          => (string) ( $settings['label'] ?? '' ),
			'visibility'     => $visibility,
			'platforms'      => self::normalize_platforms( $settings, $visibility, $enabled ),
			'order'          => (int) ( $settings['order'] ?? 0 ),
			'format'         => in_array( (string) ( $settings['format'] ?? '' ), FieldResolver::FORMATS, true ) ? (string) $settings['format'] : FieldResolver::FORMAT_INLINE,
			'separator'      => (string) ( $settings['separator'] ?? '، ' ),
			'inherited_from' => (string) ( $settings['inherited_from'] ?? '' ),
		);
	}

	/**
	 * Resolves the per-platform visibility block for one field.
	 *
	 * Version 1.5.1 and earlier stored a single `visibility` string, so a field
	 * was either printed into the Telegram message or it was not. Jarchi
	 * publishes to three platforms, and a field that belongs in a Telegram post
	 * does not necessarily belong in a WhatsApp message, so 1.6.0 stores one
	 * boolean per platform.
	 *
	 * Both shapes are readable, and this is where they meet:
	 *
	 * - An entry saved by 1.6.0 carries `platforms` and it is used verbatim.
	 * - An entry saved by an older version carries only `visibility`, and is
	 *   translated: `telegram` means Telegram on, anything else means all off.
	 *   That reproduces exactly what the old installation was already sending,
	 *   which is the point — an upgrade must not change what a live site
	 *   publishes.
	 *
	 * The legacy `visibility` key is still written on save, so downgrading the
	 * plugin does not orphan a mapping either.
	 *
	 * @since 1.6.0
	 *
	 * @param array<string,mixed> $settings   Raw entry.
	 * @param string              $visibility Normalised legacy visibility.
	 * @param bool                $enabled    Whether the field is enabled at all.
	 *
	 * @return array<string,bool> Platform id => enabled.
	 */
	private static function normalize_platforms( array $settings, string $visibility, bool $enabled ): array {
		$platforms = array();

		if ( isset( $settings['platforms'] ) && is_array( $settings['platforms'] ) ) {
			foreach ( Field::PLATFORMS as $platform ) {
				$platforms[ $platform ] = ! empty( $settings['platforms'][ $platform ] );
			}

			return $platforms;
		}

		// Legacy entry: derive from the single visibility string.
		$telegram = $enabled && Field::VISIBILITY_TELEGRAM === $visibility;

		foreach ( Field::PLATFORMS as $platform ) {
			$platforms[ $platform ] = Field::PLATFORM_TELEGRAM === $platform ? $telegram : false;
		}

		return $platforms;
	}

	/**
	 * Whether a field should be published to a given platform.
	 *
	 * Two gates, both of which must be open: the field's master switch and its
	 * switch for that platform. The master switch exists so an administrator can
	 * silence a field everywhere without losing its per-platform configuration.
	 *
	 * @since 1.6.0
	 *
	 * @param array<string,mixed> $entry    Normalised mapping entry.
	 * @param string              $platform Platform id.
	 *
	 * @return bool True when the field goes to that platform.
	 */
	public static function goes_to( array $entry, string $platform ): bool {
		if ( empty( $entry['enabled'] ) ) {
			return false;
		}

		if ( ! isset( $entry['platforms'] ) || ! is_array( $entry['platforms'] ) ) {
			return false;
		}

		return ! empty( $entry['platforms'][ $platform ] );
	}

	/**
	 * Whether a field is published to any platform at all.
	 *
	 * @since 1.6.0
	 *
	 * @param array<string,mixed> $entry Normalised mapping entry.
	 *
	 * @return bool
	 */
	public static function goes_anywhere( array $entry ): bool {
		foreach ( Field::PLATFORMS as $platform ) {
			if ( self::goes_to( $entry, $platform ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Stores a scope's mapping.
	 *
	 * @since 1.4.0
	 *
	 * @param string                            $scope    Scope key.
	 * @param array<string,array<string,mixed>> $fields   Field settings keyed by field key.
	 * @param string                            $template Message template for this scope.
	 *
	 * @return bool True when the option was written.
	 */
	public function save( string $scope, array $fields, string $template = '' ): bool {
		$all   = $this->all();
		$clean = array();
		$order = 0;

		foreach ( $fields as $key => $settings ) {
			$key = Field::sanitize_key( (string) $key );

			if ( '' === $key || ! is_array( $settings ) ) {
				continue;
			}

			$entry = $this->normalize_entry( $settings );

			unset( $entry['inherited_from'] );

			$entry['order'] = $order++;

			$clean[ $key ] = $entry;
		}

		$all[ $scope ] = array(
			'fields'   => $clean,
			'template' => $template,
			'updated'  => gmdate( 'Y-m-d H:i:s' ),
		);

		$this->stored = $all;

		$saved = update_option( self::OPTION, $all, false );

		/**
		 * Fires after a scope's field mapping was saved.
		 *
		 * @since 1.4.0
		 *
		 * @param string                            $scope  Scope key.
		 * @param array<string,array<string,mixed>> $clean  Stored field settings.
		 */
		do_action( 'wpep_field_mapping_saved', $scope, $clean );

		return $saved;
	}

	/**
	 * Removes a scope's own mapping so it inherits again.
	 *
	 * @since 1.4.0
	 *
	 * @param string $scope Scope key.
	 *
	 * @return bool True when something was removed.
	 */
	public function reset( string $scope ): bool {
		$all = $this->all();

		if ( ! isset( $all[ $scope ] ) ) {
			return false;
		}

		unset( $all[ $scope ] );

		$this->stored = $all;

		return update_option( self::OPTION, $all, false );
	}

	/**
	 * Returns the message template that applies to a scope.
	 *
	 * Templates inherit exactly like fields do: the nearest scope with a
	 * non-empty template wins, and an empty result means the message is
	 * generated from the enabled fields instead.
	 *
	 * @since 1.4.0
	 *
	 * @param string $post_type Post type slug.
	 * @param string $taxonomy  Taxonomy name.
	 * @param int    $term_id   Term ID.
	 *
	 * @return string Template, empty when none is defined.
	 */
	public function template( string $post_type, string $taxonomy = '', int $term_id = 0 ): string {
		foreach ( $this->chain( $post_type, $taxonomy, $term_id ) as $scope ) {
			$template = trim( (string) ( $this->own( $scope )['template'] ?? '' ) );

			if ( '' !== $template ) {
				return $template;
			}
		}

		return '';
	}

	/**
	 * Lists every scope that has its own mapping.
	 *
	 * @since 1.4.0
	 *
	 * @return string[] Scope keys.
	 */
	public function scopes(): array {
		return array_keys( $this->all() );
	}

	/**
	 * Clears the in-memory copy of the option.
	 *
	 * @since 1.4.0
	 *
	 * @return void
	 */
	public function flush(): void {
		$this->stored = null;
	}
}
