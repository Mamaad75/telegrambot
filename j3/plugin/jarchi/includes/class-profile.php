<?php
/**
 * Publishing profile value object.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * One complete publishing configuration.
 *
 * A profile answers "what does an advertisement look like when it goes
 * out" in one reusable object: which fields, under what labels, in what
 * order, rendered by which template, with which images, to which
 * destinations. It is the thing an administrator names, duplicates,
 * exports and assigns — the mapping screen edits a profile rather than a
 * scope.
 *
 * A profile stores **only what it overrides**. Everything else comes from
 * its parent, and the root of every chain is a default the plugin
 * generates from discovery. That is what lets "Luxury SUV" say one thing
 * about badges and inherit forty field decisions from "Cars".
 *
 * @since 1.5.0
 */
class Profile {

	/**
	 * Identifier of the automatically created default profile.
	 *
	 * @var string
	 */
	public const DEFAULT_ID = 'default';

	/**
	 * Image mode: only the featured image.
	 *
	 * @var string
	 */
	public const IMAGES_FEATURED = 'featured';

	/**
	 * Image mode: only the gallery.
	 *
	 * @var string
	 */
	public const IMAGES_GALLERY = 'gallery';

	/**
	 * Image mode: featured image first, then the gallery.
	 *
	 * @var string
	 */
	public const IMAGES_BOTH = 'both';

	/**
	 * Image mode: send no images at all.
	 *
	 * @var string
	 */
	public const IMAGES_NONE = 'none';

	/**
	 * Every recognised image mode.
	 *
	 * @var string[]
	 */
	public const IMAGE_MODES = array(
		self::IMAGES_BOTH,
		self::IMAGES_FEATURED,
		self::IMAGES_GALLERY,
		self::IMAGES_NONE,
	);

	/**
	 * Stable identifier, used by assignments, rules and inheritance.
	 *
	 * @var string
	 */
	private string $id;

	/**
	 * Human readable name.
	 *
	 * @var string
	 */
	private string $name;

	/**
	 * Free text description.
	 *
	 * @var string
	 */
	private string $description;

	/**
	 * Identifier of the profile this one inherits from.
	 *
	 * @var string
	 */
	private string $parent;

	/**
	 * Field mapping overrides, keyed by field key.
	 *
	 * @var array<string,array<string,mixed>>
	 */
	private array $fields;

	/**
	 * Message template, empty to inherit or to generate.
	 *
	 * @var string
	 */
	private string $template;

	/**
	 * Image settings.
	 *
	 * @var array<string,mixed>
	 */
	private array $images;

	/**
	 * Field keys pinned to the top of the mapping screen.
	 *
	 * @var string[]
	 */
	private array $favorites;

	/**
	 * Destination identifiers this profile publishes to. Empty means
	 * "every enabled destination", which is what a single-destination
	 * site has always done.
	 *
	 * @var string[]
	 */
	private array $destinations;

	/**
	 * Payload shaping options.
	 *
	 * @var array<string,mixed>
	 */
	private array $payload;

	/**
	 * Message formatting options passed to destination adapters.
	 *
	 * @var array<string,mixed>
	 */
	private array $formatting;

	/**
	 * Whether the profile may be deleted.
	 *
	 * @var bool
	 */
	private bool $locked;

	/**
	 * Creation and last update timestamps, UTC.
	 *
	 * @var string
	 */
	private string $created;

	/**
	 * Last update timestamp, UTC.
	 *
	 * @var string
	 */
	private string $updated;

	/**
	 * Constructor.
	 *
	 * Accepts a partial array and fills in every missing key, so a profile
	 * read from an older option, or from an imported file written by a
	 * different version, is always structurally complete.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $data Profile data.
	 */
	public function __construct( array $data = array() ) {
		$this->id          = self::sanitize_id( (string) ( $data['id'] ?? '' ) );
		$this->name        = trim( (string) ( $data['name'] ?? '' ) );
		$this->description = (string) ( $data['description'] ?? '' );
		$this->parent      = self::sanitize_id( (string) ( $data['parent'] ?? '' ) );
		$this->template    = (string) ( $data['template'] ?? '' );
		$this->locked      = ! empty( $data['locked'] );
		$this->created     = (string) ( $data['created'] ?? gmdate( 'Y-m-d H:i:s' ) );
		$this->updated     = (string) ( $data['updated'] ?? $this->created );

		if ( '' === $this->name ) {
			$this->name = '' === $this->id ? __( 'Untitled profile', 'wp-event-publisher' ) : $this->id;
		}

		$fields = array();

		foreach ( (array) ( $data['fields'] ?? array() ) as $key => $settings ) {
			$key = Field::sanitize_key( (string) $key );

			if ( '' !== $key && is_array( $settings ) ) {
				$fields[ $key ] = $settings;
			}
		}

		$this->fields = $fields;

		$images = (array) ( $data['images'] ?? array() );
		$mode   = (string) ( $images['mode'] ?? self::IMAGES_BOTH );

		$this->images = array(
			'mode' => in_array( $mode, self::IMAGE_MODES, true ) ? $mode : self::IMAGES_BOTH,
			'max'  => max( 0, (int) ( $images['max'] ?? 10 ) ),
		);

		$this->favorites    = array_values( array_unique( array_filter( array_map( array( Field::class, 'sanitize_key' ), (array) ( $data['favorites'] ?? array() ) ) ) ) );
		$this->destinations = array_values( array_unique( array_filter( array_map( array( self::class, 'sanitize_id' ), (array) ( $data['destinations'] ?? array() ) ) ) ) );

		$payload       = (array) ( $data['payload'] ?? array() );
		$this->payload = array(
			// Off would drop the flat fields the Node.js publisher reads, so
			// it defaults to on and only an explicit choice turns it off.
			'include_legacy' => ! isset( $payload['include_legacy'] ) || ! empty( $payload['include_legacy'] ),
			'include_empty'  => ! empty( $payload['include_empty'] ),
		);

		$formatting = (array) ( $data['formatting'] ?? array() );
		$parse_mode = (string) ( $formatting['parse_mode'] ?? 'none' );

		$this->formatting = array(
			'parse_mode'      => in_array( $parse_mode, array( 'none', 'markdown', 'html' ), true ) ? $parse_mode : 'none',
			'disable_preview' => ! empty( $formatting['disable_preview'] ),
			'prepend'         => (string) ( $formatting['prepend'] ?? '' ),
			'append'          => (string) ( $formatting['append'] ?? '' ),
		);
	}

	/**
	 * Normalizes a profile or destination identifier.
	 *
	 * @since 1.5.0
	 *
	 * @param string $raw Raw identifier.
	 *
	 * @return string Sanitized identifier.
	 */
	public static function sanitize_id( string $raw ): string {
		$id = strtolower( trim( $raw ) );
		$id = preg_replace( '/[^a-z0-9_\-]+/', '_', $id ) ?? '';
		$id = preg_replace( '/_{2,}/', '_', $id ) ?? $id;

		return substr( trim( $id, '_-' ), 0, 64 );
	}

	/**
	 * Returns the identifier.
	 *
	 * @since 1.5.0
	 *
	 * @return string Profile id.
	 */
	public function id(): string {
		return $this->id;
	}

	/**
	 * Returns the display name.
	 *
	 * @since 1.5.0
	 *
	 * @return string Name.
	 */
	public function name(): string {
		return $this->name;
	}

	/**
	 * Returns the description.
	 *
	 * @since 1.5.0
	 *
	 * @return string Description.
	 */
	public function description(): string {
		return $this->description;
	}

	/**
	 * Returns the parent profile identifier.
	 *
	 * @since 1.5.0
	 *
	 * @return string Parent id, empty when this is a root.
	 */
	public function parent(): string {
		return $this->parent;
	}

	/**
	 * Returns the field mapping.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,array<string,mixed>> Field settings.
	 */
	public function fields(): array {
		return $this->fields;
	}

	/**
	 * Returns the message template.
	 *
	 * @since 1.5.0
	 *
	 * @return string Template.
	 */
	public function template(): string {
		return $this->template;
	}

	/**
	 * Returns the image settings.
	 *
	 * @since 1.5.0
	 *
	 * @return array{mode:string,max:int} Image settings.
	 */
	public function images(): array {
		return $this->images;
	}

	/**
	 * Returns the favourite field keys.
	 *
	 * @since 1.5.0
	 *
	 * @return string[] Field keys.
	 */
	public function favorites(): array {
		return $this->favorites;
	}

	/**
	 * Returns the destination identifiers.
	 *
	 * @since 1.5.0
	 *
	 * @return string[] Destination ids, empty for "every enabled one".
	 */
	public function destinations(): array {
		return $this->destinations;
	}

	/**
	 * Returns the payload shaping options.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,mixed> Payload options.
	 */
	public function payload(): array {
		return $this->payload;
	}

	/**
	 * Returns the formatting options.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,mixed> Formatting options.
	 */
	public function formatting(): array {
		return $this->formatting;
	}

	/**
	 * Whether the profile is protected from deletion.
	 *
	 * @since 1.5.0
	 *
	 * @return bool True when locked.
	 */
	public function is_locked(): bool {
		return $this->locked;
	}

	/**
	 * Returns the creation timestamp.
	 *
	 * @since 1.5.0
	 *
	 * @return string UTC timestamp.
	 */
	public function created(): string {
		return $this->created;
	}

	/**
	 * Returns the last update timestamp.
	 *
	 * @since 1.5.0
	 *
	 * @return string UTC timestamp.
	 */
	public function updated(): string {
		return $this->updated;
	}

	/**
	 * Returns the profile as a plain array.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,mixed> Profile data.
	 */
	public function to_array(): array {
		return array(
			'id'           => $this->id,
			'name'         => $this->name,
			'description'  => $this->description,
			'parent'       => $this->parent,
			'fields'       => $this->fields,
			'template'     => $this->template,
			'images'       => $this->images,
			'favorites'    => $this->favorites,
			'destinations' => $this->destinations,
			'payload'      => $this->payload,
			'formatting'   => $this->formatting,
			'locked'       => $this->locked,
			'created'      => $this->created,
			'updated'      => $this->updated,
		);
	}

	/**
	 * Returns a copy with some attributes replaced.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $changes Attributes to replace.
	 *
	 * @return Profile New instance.
	 */
	public function with( array $changes ): self {
		return new self( array_merge( $this->to_array(), $changes, array( 'updated' => gmdate( 'Y-m-d H:i:s' ) ) ) );
	}

	/**
	 * Merges this profile on top of another.
	 *
	 * The parent supplies everything; this profile overrides what it
	 * actually declares. Field settings merge per field, so a child that
	 * only renames one field keeps the parent's decision about the other
	 * forty.
	 *
	 * @since 1.5.0
	 *
	 * @param Profile $parent Profile to inherit from.
	 *
	 * @return Profile Merged profile carrying this one's identity.
	 */
	public function inherit( Profile $parent ): self {
		$fields = $parent->fields();

		foreach ( $this->fields as $key => $settings ) {
			$fields[ $key ] = array_merge( $fields[ $key ] ?? array(), $settings );
		}

		return new self(
			array(
				'id'           => $this->id,
				'name'         => $this->name,
				'description'  => $this->description,
				'parent'       => $this->parent,
				'fields'       => $fields,
				'template'     => '' !== $this->template ? $this->template : $parent->template(),
				'images'       => $this->images,
				'favorites'    => array_values( array_unique( array_merge( $parent->favorites(), $this->favorites ) ) ),
				'destinations' => ! empty( $this->destinations ) ? $this->destinations : $parent->destinations(),
				'payload'      => array_merge( $parent->payload(), $this->payload ),
				'formatting'   => array_merge( $parent->formatting(), $this->formatting ),
				'locked'       => $this->locked,
				'created'      => $this->created,
				'updated'      => $this->updated,
			)
		);
	}
}
