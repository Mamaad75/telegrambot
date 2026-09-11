<?php
/**
 * Profile storage, inheritance and assignment.
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
 * Owns the profiles: storing them, resolving their inheritance, and
 * deciding which one applies to a given post.
 *
 * Two independent hierarchies meet here and it is worth being precise
 * about which does what:
 *
 * - **Profile inheritance** is a chain of profiles (`Default → Cars → SUV`)
 *   declared by each profile's `parent`. It merges configuration.
 * - **Assignment** maps a scope — a post type, or a post type and a term —
 *   onto one profile. Resolution walks the scope outwards (term, its
 *   ancestors, the post type, the site default) and takes the first
 *   assignment it finds.
 *
 * So a post filed under `Cars → SUV → Compact` with an assignment only on
 * `Cars` gets the Cars profile, and that profile's own parent chain is then
 * merged. Both directions are covered without either having to know about
 * the other.
 *
 * @since 1.5.0
 */
class ProfileRepository {

	/**
	 * Option holding every profile.
	 *
	 * @var string
	 */
	public const OPTION = 'wpep_profiles';

	/**
	 * Option mapping scopes onto profile identifiers.
	 *
	 * @var string
	 */
	public const OPTION_ASSIGNMENTS = 'wpep_profile_assignments';

	/**
	 * Maximum depth an inheritance chain may reach.
	 *
	 * @var int
	 */
	private const MAX_DEPTH = 10;

	/**
	 * Field registry.
	 *
	 * @var FieldRegistry
	 */
	private FieldRegistry $registry;

	/**
	 * Legacy mapping store, used to build the default profile and to keep
	 * a site that never opens the Profiles screen behaving as it did.
	 *
	 * @var FieldMapping
	 */
	private FieldMapping $mapping;

	/**
	 * Cached profiles.
	 *
	 * @var array<string,Profile>|null
	 */
	private ?array $profiles = null;

	/**
	 * Cached assignments.
	 *
	 * @var array<string,string>|null
	 */
	private ?array $assignments = null;

	/**
	 * Per-request memo of resolved profiles.
	 *
	 * @var array<string,Profile>
	 */
	private array $resolved = array();

	/**
	 * Constructor.
	 *
	 * @since 1.5.0
	 *
	 * @param FieldRegistry $registry Field registry.
	 * @param FieldMapping  $mapping  Legacy mapping store.
	 */
	public function __construct( FieldRegistry $registry, FieldMapping $mapping ) {
		$this->registry = $registry;
		$this->mapping  = $mapping;
	}

	/**
	 * Returns every stored profile.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,Profile> Profiles keyed by id.
	 */
	public function all(): array {
		if ( null !== $this->profiles ) {
			return $this->profiles;
		}

		$stored   = get_option( self::OPTION, array() );
		$profiles = array();

		if ( is_array( $stored ) ) {
			foreach ( $stored as $id => $data ) {
				if ( ! is_array( $data ) ) {
					continue;
				}

				$data['id'] = (string) ( $data['id'] ?? $id );
				$profile    = new Profile( $data );

				if ( '' !== $profile->id() ) {
					$profiles[ $profile->id() ] = $profile;
				}
			}
		}

		$this->profiles = $profiles;

		return $profiles;
	}

	/**
	 * Returns one profile by identifier.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id Profile identifier.
	 *
	 * @return Profile|null Profile, null when unknown.
	 */
	public function find( string $id ): ?Profile {
		return $this->all()[ Profile::sanitize_id( $id ) ] ?? null;
	}

	/**
	 * Whether a profile exists.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id Profile identifier.
	 *
	 * @return bool True when stored.
	 */
	public function exists( string $id ): bool {
		return null !== $this->find( $id );
	}

	/**
	 * Stores a profile, creating or replacing it.
	 *
	 * @since 1.5.0
	 *
	 * @param Profile $profile Profile to store.
	 *
	 * @return bool True when written.
	 */
	public function save( Profile $profile ): bool {
		if ( '' === $profile->id() ) {
			return false;
		}

		$profiles = $this->all();

		$profiles[ $profile->id() ] = $profile;

		return $this->persist( $profiles );
	}

	/**
	 * Deletes a profile and repairs anything that referenced it.
	 *
	 * Children are re-parented onto the deleted profile's own parent, and
	 * assignments pointing at it are removed, so deleting a profile can
	 * never leave a dangling reference behind.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id Profile identifier.
	 *
	 * @return bool True when something was deleted.
	 */
	public function delete( string $id ): bool {
		$id      = Profile::sanitize_id( $id );
		$profile = $this->find( $id );

		if ( ! $profile instanceof Profile || $profile->is_locked() ) {
			return false;
		}

		$profiles = $this->all();
		$parent   = $profile->parent();

		unset( $profiles[ $id ] );

		foreach ( $profiles as $key => $child ) {
			if ( $child->parent() === $id ) {
				$profiles[ $key ] = $child->with( array( 'parent' => $parent ) );
			}
		}

		$this->persist( $profiles );

		$assignments = $this->assignments();
		$changed     = false;

		foreach ( $assignments as $scope => $assigned ) {
			if ( $assigned === $id ) {
				unset( $assignments[ $scope ] );
				$changed = true;
			}
		}

		if ( $changed ) {
			$this->persist_assignments( $assignments );
		}

		/**
		 * Fires after a profile was deleted.
		 *
		 * @since 1.5.0
		 *
		 * @param string $id Deleted profile identifier.
		 */
		do_action( 'wpep_profile_deleted', $id );

		return true;
	}

	/**
	 * Copies a profile under a new identifier.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id   Profile to copy.
	 * @param string $name Name for the copy.
	 *
	 * @return Profile|null The copy, null when the source is unknown.
	 */
	public function duplicate( string $id, string $name = '' ): ?Profile {
		$source = $this->find( $id );

		if ( ! $source instanceof Profile ) {
			return null;
		}

		if ( '' === trim( $name ) ) {
			/* translators: %s: source profile name. */
			$name = sprintf( __( '%s (copy)', 'wp-event-publisher' ), $source->name() );
		}

		$copy = new Profile(
			array_merge(
				$source->to_array(),
				array(
					'id'      => $this->unique_id( $name ),
					'name'    => $name,
					'locked'  => false,
					'created' => gmdate( 'Y-m-d H:i:s' ),
					'updated' => gmdate( 'Y-m-d H:i:s' ),
				)
			)
		);

		return $this->save( $copy ) ? $copy : null;
	}

	/**
	 * Builds an identifier that is not taken yet.
	 *
	 * @since 1.5.0
	 *
	 * @param string $name Desired name.
	 *
	 * @return string Free identifier.
	 */
	public function unique_id( string $name ): string {
		$base = Profile::sanitize_id( $name );

		if ( '' === $base ) {
			$base = 'profile';
		}

		$id      = $base;
		$counter = 2;

		while ( $this->exists( $id ) ) {
			$id = $base . '_' . $counter;
			++$counter;
		}

		return $id;
	}

	/**
	 * Resolves a profile's inheritance chain into one effective profile.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id Profile identifier.
	 *
	 * @return Profile Effective profile; the generated default when unknown.
	 */
	public function resolve( string $id ): Profile {
		$id = Profile::sanitize_id( $id );

		if ( isset( $this->resolved[ $id ] ) ) {
			return $this->resolved[ $id ];
		}

		$profile = $this->find( $id );

		if ( ! $profile instanceof Profile ) {
			return $this->default_profile();
		}

		$chain = $this->chain( $id );
		$merged = null;

		// Root first, so each descendant overrides what it inherited.
		foreach ( array_reverse( $chain ) as $ancestor_id ) {
			$ancestor = $this->find( $ancestor_id );

			if ( ! $ancestor instanceof Profile ) {
				continue;
			}

			$merged = null === $merged ? $ancestor : $ancestor->inherit( $merged );
		}

		$effective = $merged instanceof Profile ? $merged : $profile;

		$this->resolved[ $id ] = $effective;

		return $effective;
	}

	/**
	 * Lists a profile's inheritance chain, itself first.
	 *
	 * Stops at the first repeated identifier, so a profile that was somehow
	 * made its own ancestor resolves to a finite chain instead of hanging.
	 * {@see self::validate()} reports the loop separately.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id Profile identifier.
	 *
	 * @return string[] Profile identifiers, most specific first.
	 */
	public function chain( string $id ): array {
		$chain   = array();
		$seen    = array();
		$current = Profile::sanitize_id( $id );
		$depth   = 0;

		while ( '' !== $current && ! isset( $seen[ $current ] ) && $depth < self::MAX_DEPTH ) {
			$profile = $this->find( $current );

			if ( ! $profile instanceof Profile ) {
				break;
			}

			$chain[]         = $current;
			$seen[ $current ] = true;
			$current          = $profile->parent();
			++$depth;
		}

		return $chain;
	}

	/**
	 * Returns the profile that would be created for a post type with no
	 * configuration at all.
	 *
	 * This is what makes the whole system opt-in: a site that never opens
	 * the Profiles screen resolves this, and this reproduces exactly what
	 * the plugin sent before profiles existed.
	 *
	 * @since 1.5.0
	 *
	 * @param string $post_type Post type to build defaults for.
	 *
	 * @return Profile Generated default profile.
	 */
	public function default_profile( string $post_type = '' ): Profile {
		$stored = $this->find( Profile::DEFAULT_ID );

		if ( $stored instanceof Profile ) {
			return $this->resolve( Profile::DEFAULT_ID );
		}

		return new Profile(
			array(
				'id'     => Profile::DEFAULT_ID,
				'name'   => __( 'Default profile', 'wp-event-publisher' ),
				'fields' => '' === $post_type ? array() : $this->mapping->defaults( $post_type ),
				'locked' => true,
			)
		);
	}

	/**
	 * Returns every scope assignment.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,string> Scope key to profile id.
	 */
	public function assignments(): array {
		if ( null !== $this->assignments ) {
			return $this->assignments;
		}

		$stored = get_option( self::OPTION_ASSIGNMENTS, array() );
		$clean  = array();

		if ( is_array( $stored ) ) {
			foreach ( $stored as $scope => $id ) {
				$scope = (string) $scope;
				$id    = Profile::sanitize_id( (string) $id );

				if ( '' !== $scope && '' !== $id ) {
					$clean[ $scope ] = $id;
				}
			}
		}

		$this->assignments = $clean;

		return $clean;
	}

	/**
	 * Assigns a profile to a scope, or clears the assignment.
	 *
	 * @since 1.5.0
	 *
	 * @param string $scope      Scope key from {@see FieldMapping::scope()}.
	 * @param string $profile_id Profile identifier, empty to clear.
	 *
	 * @return bool True when written.
	 */
	public function assign( string $scope, string $profile_id ): bool {
		$scope = trim( $scope );

		if ( '' === $scope ) {
			return false;
		}

		$assignments = $this->assignments();
		$profile_id  = Profile::sanitize_id( $profile_id );

		if ( '' === $profile_id ) {
			unset( $assignments[ $scope ] );
		} else {
			if ( ! $this->exists( $profile_id ) ) {
				return false;
			}

			$assignments[ $scope ] = $profile_id;
		}

		return $this->persist_assignments( $assignments );
	}

	/**
	 * Finds the profile assigned to a scope, walking outwards.
	 *
	 * @since 1.5.0
	 *
	 * @param string $post_type Post type slug.
	 * @param string $taxonomy  Taxonomy name.
	 * @param int    $term_id   Term identifier.
	 *
	 * @return string Profile identifier, empty when nothing is assigned.
	 */
	public function assigned_for( string $post_type, string $taxonomy = '', int $term_id = 0 ): string {
		$assignments = $this->assignments();

		foreach ( $this->mapping->chain( $post_type, $taxonomy, $term_id ) as $scope ) {
			if ( isset( $assignments[ $scope ] ) && $this->exists( $assignments[ $scope ] ) ) {
				return $assignments[ $scope ];
			}
		}

		// A site-wide default assignment, used when no post type says
		// anything of its own.
		if ( isset( $assignments['*'] ) && $this->exists( $assignments['*'] ) ) {
			return $assignments['*'];
		}

		return '';
	}

	/**
	 * Resolves the profile that applies to one post.
	 *
	 * @since 1.5.0
	 *
	 * @param WP_Post $post Post to publish.
	 *
	 * @return array{profile:Profile,assigned:string,taxonomy:string,term:WP_Term|null,scope:string} Resolution result.
	 */
	public function for_post( WP_Post $post ): array {
		$resolution = $this->mapping->for_post( $post );
		$term       = $resolution['term'] instanceof WP_Term ? $resolution['term'] : null;
		$taxonomy   = (string) $resolution['taxonomy'];
		$term_id    = $term instanceof WP_Term ? (int) $term->term_id : 0;

		$assigned = $this->assigned_for( $post->post_type, $taxonomy, $term_id );

		if ( '' !== $assigned ) {
			$profile = $this->resolve( $assigned );
		} else {
			// Nothing assigned: fall back to the legacy per-scope mapping,
			// which itself falls back to the generated default. This is the
			// path a site that never opens the Profiles screen takes, and it
			// is bit-for-bit what the plugin did before profiles existed.
			$profile = new Profile(
				array(
					'id'     => Profile::DEFAULT_ID,
					'name'   => __( 'Default profile', 'wp-event-publisher' ),
					'fields' => $resolution['mapping'],
					'template' => $this->mapping->template( $post->post_type, $taxonomy, $term_id ),
					'locked' => true,
				)
			);
		}

		/**
		 * Filters the profile resolved for a post, before rules run.
		 *
		 * @since 1.5.0
		 *
		 * @param Profile $profile Resolved profile.
		 * @param WP_Post $post    Post being published.
		 */
		$profile = apply_filters( 'wpep_resolved_profile', $profile, $post );

		return array(
			'profile'  => $profile instanceof Profile ? $profile : $this->default_profile( $post->post_type ),
			'assigned' => $assigned,
			'taxonomy' => $taxonomy,
			'term'     => $term,
			'scope'    => FieldMapping::scope( $post->post_type, $taxonomy, $term_id ),
		);
	}

	/**
	 * Checks a profile for the problems that are worth refusing to save.
	 *
	 * @since 1.5.0
	 *
	 * @param Profile     $profile   Profile to check.
	 * @param string      $post_type Post type to validate field keys against.
	 * @param string|null $original  Identifier being replaced, when editing.
	 *
	 * @return array<int,array{level:string,message:string}> Problems found.
	 */
	public function validate( Profile $profile, string $post_type = '', ?string $original = null ): array {
		$problems = array();

		if ( '' === $profile->id() ) {
			$problems[] = array(
				'level'   => 'error',
				'message' => __( 'The profile needs a name that produces a usable identifier.', 'wp-event-publisher' ),
			);
		}

		if ( '' !== $profile->parent() ) {
			if ( ! $this->exists( $profile->parent() ) ) {
				$problems[] = array(
					'level'   => 'error',
					/* translators: %s: parent profile identifier. */
					'message' => sprintf( __( 'The parent profile "%s" does not exist.', 'wp-event-publisher' ), $profile->parent() ),
				);
			} elseif ( $this->would_loop( $profile->id(), $profile->parent() ) ) {
				$problems[] = array(
					'level'   => 'error',
					'message' => __( 'That parent would create a circular inheritance chain: the profile would end up inheriting from itself.', 'wp-event-publisher' ),
				);
			}
		}

		if ( '' !== $post_type ) {
			$discovered = $this->registry->discover( $post_type );

			foreach ( array_keys( $profile->fields() ) as $key ) {
				if ( ! isset( $discovered[ $key ] ) ) {
					$problems[] = array(
						'level'   => 'warning',
						/* translators: 1: field key, 2: post type. */
						'message' => sprintf( __( 'The field "%1$s" no longer exists on the post type "%2$s". It is kept but will be ignored until the field comes back.', 'wp-event-publisher' ), $key, $post_type ),
					);
				}
			}
		}

		foreach ( $profile->destinations() as $destination ) {
			/**
			 * Filters whether a destination identifier is known.
			 *
			 * The destination registry answers this; the repository must not
			 * depend on it, so the question is asked through a filter.
			 *
			 * @since 1.5.0
			 *
			 * @param bool   $known       Whether the destination exists.
			 * @param string $destination Destination identifier.
			 */
			if ( ! apply_filters( 'wpep_destination_exists', true, $destination ) ) {
				$problems[] = array(
					'level'   => 'warning',
					/* translators: %s: destination identifier. */
					'message' => sprintf( __( 'The destination "%s" is not configured. The advertisement will simply not be sent there.', 'wp-event-publisher' ), $destination ),
				);
			}
		}

		unset( $original );

		return $problems;
	}

	/**
	 * Whether making `$parent` the parent of `$id` closes a loop.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id     Profile being edited.
	 * @param string $parent Proposed parent.
	 *
	 * @return bool True when the chain would become circular.
	 */
	public function would_loop( string $id, string $parent ): bool {
		$id     = Profile::sanitize_id( $id );
		$parent = Profile::sanitize_id( $parent );

		if ( '' === $id || '' === $parent ) {
			return false;
		}

		if ( $id === $parent ) {
			return true;
		}

		return in_array( $id, $this->chain( $parent ), true );
	}

	/**
	 * Serialises a profile, or every profile, for export.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id Profile identifier, empty for all of them.
	 *
	 * @return array<string,mixed> Export document.
	 */
	public function export( string $id = '' ): array {
		$profiles = array();

		if ( '' === $id ) {
			foreach ( $this->all() as $profile ) {
				$profiles[] = $profile->to_array();
			}
		} else {
			// Export the whole ancestry, or the import lands with a dangling
			// parent on the other site.
			foreach ( array_reverse( $this->chain( $id ) ) as $ancestor ) {
				$profile = $this->find( $ancestor );

				if ( $profile instanceof Profile ) {
					$profiles[] = $profile->to_array();
				}
			}
		}

		return array(
			'format'   => 'wpep-profiles',
			'version'  => WPEP_VERSION,
			'exported' => gmdate( 'c' ),
			'site'     => home_url(),
			'profiles' => $profiles,
		);
	}

	/**
	 * Restores profiles from an export document.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $document  Export document.
	 * @param bool                $overwrite Replace profiles with the same id.
	 *
	 * @return array{imported:int,skipped:int,errors:string[]} Import result.
	 */
	public function import( array $document, bool $overwrite = false ): array {
		$result = array(
			'imported' => 0,
			'skipped'  => 0,
			'errors'   => array(),
		);

		if ( 'wpep-profiles' !== ( $document['format'] ?? '' ) ) {
			$result['errors'][] = __( 'این فایل، خروجی قالب پیام جارچی نیست.', 'wp-event-publisher' );

			return $result;
		}

		$incoming = $document['profiles'] ?? array();

		if ( ! is_array( $incoming ) || empty( $incoming ) ) {
			$result['errors'][] = __( 'The export file contains no profiles.', 'wp-event-publisher' );

			return $result;
		}

		$profiles = $this->all();

		foreach ( $incoming as $data ) {
			if ( ! is_array( $data ) ) {
				++$result['skipped'];

				continue;
			}

			$profile = new Profile( $data );

			if ( '' === $profile->id() ) {
				++$result['skipped'];

				continue;
			}

			if ( isset( $profiles[ $profile->id() ] ) && ! $overwrite ) {
				$profile = $profile->with( array( 'id' => $this->unique_id( $profile->name() ) ) );
			}

			// An imported profile is never locked: the lock belongs to the
			// generated default of the site it lands on.
			$profiles[ $profile->id() ] = $profile->with( array( 'locked' => false ) );

			++$result['imported'];
		}

		$this->persist( $profiles );

		// Re-parent anything whose parent did not come along.
		$repaired = $this->all();
		$changed  = false;

		foreach ( $repaired as $id => $profile ) {
			if ( '' !== $profile->parent() && ! isset( $repaired[ $profile->parent() ] ) ) {
				$repaired[ $id ] = $profile->with( array( 'parent' => '' ) );
				$changed         = true;

				/* translators: 1: profile name, 2: missing parent identifier. */
				$result['errors'][] = sprintf( __( '"%1$s" referenced a parent profile ("%2$s") that was not in the file, so it was imported as a root profile.', 'wp-event-publisher' ), $profile->name(), $profile->parent() );
			}
		}

		if ( $changed ) {
			$this->persist( $repaired );
		}

		return $result;
	}

	/**
	 * Writes the profile option and drops the caches.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,Profile> $profiles Profiles to store.
	 *
	 * @return bool True when written.
	 */
	private function persist( array $profiles ): bool {
		$stored = array();

		foreach ( $profiles as $id => $profile ) {
			if ( $profile instanceof Profile ) {
				$stored[ (string) $id ] = $profile->to_array();
			}
		}

		$this->profiles = $profiles;
		$this->resolved = array();

		return update_option( self::OPTION, $stored, false );
	}

	/**
	 * Writes the assignment option and drops the cache.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,string> $assignments Assignments to store.
	 *
	 * @return bool True when written.
	 */
	private function persist_assignments( array $assignments ): bool {
		$this->assignments = $assignments;

		return update_option( self::OPTION_ASSIGNMENTS, $assignments, false );
	}

	/**
	 * Drops the in-memory caches.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function flush(): void {
		$this->profiles    = null;
		$this->assignments = null;
		$this->resolved    = array();
	}
}
