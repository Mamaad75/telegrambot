<?php
/**
 * Discovered field descriptor.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * One field a post type can carry, as reported by a provider.
 *
 * A field is a description, not a value. It says where the data lives
 * (`source` + `storage_key`), what it looks like (`type`, `repeatable`,
 * `choices`) and what to call it (`label`). {@see FieldResolver} turns a
 * field plus a post into a value; {@see FieldMapping} decides whether that
 * value is sent anywhere.
 *
 * The `key` is the field's identity everywhere else in the plugin: it is
 * the mapping key, the payload key under `fields`, and the template
 * placeholder. It is derived from the storage key, so a mapping survives a
 * cache rebuild, a provider becoming unavailable, and the plugin being
 * deactivated and reactivated.
 *
 * @since 1.4.0
 */
class Field {

	/**
	 * Field type constants.
	 *
	 * These describe how a value should be read and formatted, not how the
	 * source plugin renders its editor. An unknown editor control maps onto
	 * TEXT, which is always safe.
	 *
	 * @var string
	 */
	public const TYPE_TEXT     = 'text';
	public const TYPE_TEXTAREA = 'textarea';
	public const TYPE_NUMBER   = 'number';
	public const TYPE_DATE     = 'date';
	public const TYPE_BOOLEAN  = 'boolean';
	public const TYPE_SELECT   = 'select';
	public const TYPE_CHECKBOX = 'checkbox';
	public const TYPE_URL      = 'url';
	public const TYPE_EMAIL    = 'email';
	public const TYPE_IMAGE    = 'image';
	public const TYPE_GALLERY  = 'gallery';
	public const TYPE_FILE     = 'file';
	public const TYPE_REPEATER = 'repeater';
	public const TYPE_TAXONOMY = 'taxonomy';
	public const TYPE_POST     = 'post';
	public const TYPE_USER     = 'user';
	public const TYPE_HTML     = 'html';

	/**
	 * Every recognised type.
	 *
	 * @var string[]
	 */
	public const TYPES = array(
		self::TYPE_TEXT,
		self::TYPE_TEXTAREA,
		self::TYPE_NUMBER,
		self::TYPE_DATE,
		self::TYPE_BOOLEAN,
		self::TYPE_SELECT,
		self::TYPE_CHECKBOX,
		self::TYPE_URL,
		self::TYPE_EMAIL,
		self::TYPE_IMAGE,
		self::TYPE_GALLERY,
		self::TYPE_FILE,
		self::TYPE_REPEATER,
		self::TYPE_TAXONOMY,
		self::TYPE_POST,
		self::TYPE_USER,
		self::TYPE_HTML,
	);

	/**
	 * Visibility: shown in the Telegram message and sent to the backend.
	 *
	 * @var string
	 */
	public const VISIBILITY_TELEGRAM = 'telegram';

	/**
	 * Visibility: sent to the backend, never rendered into the message.
	 *
	 * @var string
	 */
	public const VISIBILITY_BACKEND = 'backend';

	/**
	 * Visibility: visible on the mapping screen only, never transmitted.
	 *
	 * @var string
	 */
	public const VISIBILITY_ADMIN = 'admin';

	/**
	 * Visibility: not shown and not transmitted.
	 *
	 * @var string
	 */
	public const VISIBILITY_HIDDEN = 'hidden';

	/**
	 * Every recognised visibility.
	 *
	 * @var string[]
	 */
	public const VISIBILITIES = array(
		self::VISIBILITY_TELEGRAM,
		self::VISIBILITY_BACKEND,
		self::VISIBILITY_ADMIN,
		self::VISIBILITY_HIDDEN,
	);

	/**
	 * Platform: Telegram.
	 *
	 * @since 1.6.0
	 * @var string
	 */
	public const PLATFORM_TELEGRAM = 'telegram';

	/**
	 * Platform: Bale.
	 *
	 * @since 1.6.0
	 * @var string
	 */
	public const PLATFORM_BALE = 'bale';

	/**
	 * Platform: WhatsApp.
	 *
	 * @since 1.6.0
	 * @var string
	 */
	public const PLATFORM_WHATSAPP = 'whatsapp';

	/**
	 * The official Jarchi platform set, in display order.
	 *
	 * Telegram, Bale and WhatsApp. Discord, Slack and email remain registered
	 * as delivery providers for installations that already configured them,
	 * but they are not part of the product and are not offered here.
	 *
	 * @since 1.6.0
	 * @var string[]
	 */
	public const PLATFORMS = array(
		self::PLATFORM_TELEGRAM,
		self::PLATFORM_BALE,
		self::PLATFORM_WHATSAPP,
	);

	/**
	 * Stable identity used as mapping key, payload key and placeholder.
	 *
	 * @var string
	 */
	private string $key;

	/**
	 * Human readable label.
	 *
	 * @var string
	 */
	private string $label;

	/**
	 * Optional one-line explanation shown beside the field in the admin.
	 *
	 * Purely for the mapping screen. It never reaches the payload — a
	 * consumer describing a field has `field_meta` for that — and it is
	 * empty for every field a provider does not bother to describe.
	 *
	 * @since 1.6.0
	 * @var string
	 */
	private string $description;

	/**
	 * Where the value is stored: a meta key, a taxonomy name, or a native
	 * post property, depending on the source.
	 *
	 * @var string
	 */
	private string $storage_key;

	/**
	 * Provider identifier that discovered this field.
	 *
	 * @var string
	 */
	private string $source;

	/**
	 * Field type, one of the TYPE_* constants.
	 *
	 * @var string
	 */
	private string $type;

	/**
	 * Whether the field holds more than one value.
	 *
	 * @var bool
	 */
	private bool $repeatable;

	/**
	 * Whether the source declares the field required.
	 *
	 * @var bool
	 */
	private bool $required;

	/**
	 * Stored value to display label map, for select and checkbox fields.
	 *
	 * @var array<string,string>
	 */
	private array $choices;

	/**
	 * Sub-fields, for repeaters and groups.
	 *
	 * @var array<string,Field>
	 */
	private array $children;

	/**
	 * Provider specific extras (taxonomy name, JetEngine object type, …).
	 *
	 * @var array<string,mixed>
	 */
	private array $meta;

	/**
	 * Constructor.
	 *
	 * @since 1.4.0
	 *
	 * @param array<string,mixed> $args Field attributes.
	 */
	public function __construct( array $args ) {
		$this->key         = self::sanitize_key( (string) ( $args['key'] ?? '' ) );
		$this->label       = (string) ( $args['label'] ?? $this->key );
		$this->description = (string) ( $args['description'] ?? '' );
		$this->storage_key = (string) ( $args['storage_key'] ?? $this->key );
		$this->source      = (string) ( $args['source'] ?? 'other' );
		$this->type        = in_array( (string) ( $args['type'] ?? '' ), self::TYPES, true ) ? (string) $args['type'] : self::TYPE_TEXT;
		$this->repeatable  = (bool) ( $args['repeatable'] ?? false );
		$this->required    = (bool) ( $args['required'] ?? false );
		$this->meta        = (array) ( $args['meta'] ?? array() );

		$choices = array();

		foreach ( (array) ( $args['choices'] ?? array() ) as $value => $label ) {
			if ( is_scalar( $label ) ) {
				$choices[ (string) $value ] = (string) $label;
			}
		}

		$this->choices = $choices;

		$children = array();

		foreach ( (array) ( $args['children'] ?? array() ) as $child ) {
			if ( $child instanceof self ) {
				$children[ $child->key() ] = $child;
			} elseif ( is_array( $child ) ) {
				$field                   = new self( $child );
				$children[ $field->key() ] = $field;
			}
		}

		$this->children = $children;
	}

	/**
	 * Normalizes an arbitrary string into a placeholder-safe key.
	 *
	 * Placeholders are written by hand in the template builder, so the key
	 * has to survive being typed: lower case, ASCII word characters only.
	 * A leading underscore is kept, because that is how WordPress marks a
	 * protected meta key and dropping it would collide two distinct fields.
	 *
	 * @since 1.4.0
	 *
	 * @param string $raw Raw key.
	 *
	 * @return string Sanitized key.
	 */
	public static function sanitize_key( string $raw ): string {
		$key = strtolower( trim( $raw ) );

		// A leading underscore distinguishes WordPress protected meta from a
		// public key of the same name, so it is preserved deliberately.
		$protected = str_starts_with( $key, '_' );

		$key = preg_replace( '/[^a-z0-9_]+/', '_', $key ) ?? '';
		$key = preg_replace( '/_{2,}/', '_', $key ) ?? $key;
		$key = trim( $key, '_' );

		return $protected && '' !== $key ? '_' . $key : $key;
	}

	/**
	 * Returns the field identity.
	 *
	 * @since 1.4.0
	 *
	 * @return string Field key.
	 */
	public function key(): string {
		return $this->key;
	}

	/**
	 * Returns the human readable label.
	 *
	 * @since 1.4.0
	 *
	 * @return string Label.
	 */
	public function label(): string {
		return '' !== $this->label ? $this->label : $this->key;
	}

	/**
	 * Returns the field's one-line explanation, if a provider supplied one.
	 *
	 * @since 1.6.0
	 *
	 * @return string Description, or an empty string.
	 */
	public function description(): string {
		return $this->description;
	}

	/**
	 * Returns the storage key.
	 *
	 * @since 1.4.0
	 *
	 * @return string Meta key, taxonomy name or post property.
	 */
	public function storage_key(): string {
		return $this->storage_key;
	}

	/**
	 * Returns the provider identifier.
	 *
	 * @since 1.4.0
	 *
	 * @return string Provider id.
	 */
	public function source(): string {
		return $this->source;
	}

	/**
	 * Returns the field type.
	 *
	 * @since 1.4.0
	 *
	 * @return string One of the TYPE_* constants.
	 */
	public function type(): string {
		return $this->type;
	}

	/**
	 * Whether the field holds several values.
	 *
	 * @since 1.4.0
	 *
	 * @return bool True for repeaters, galleries and multi-value fields.
	 */
	public function is_repeatable(): bool {
		return $this->repeatable;
	}

	/**
	 * Whether the source declares the field required.
	 *
	 * @since 1.4.0
	 *
	 * @return bool True when required.
	 */
	public function is_required(): bool {
		return $this->required;
	}

	/**
	 * Returns the stored-value to label map.
	 *
	 * @since 1.4.0
	 *
	 * @return array<string,string> Choices.
	 */
	public function choices(): array {
		return $this->choices;
	}

	/**
	 * Returns the sub-fields of a repeater or group.
	 *
	 * @since 1.4.0
	 *
	 * @return array<string,Field> Child fields.
	 */
	public function children(): array {
		return $this->children;
	}

	/**
	 * Returns a provider specific attribute.
	 *
	 * @since 1.4.0
	 *
	 * @param string $key      Attribute name.
	 * @param mixed  $fallback Value returned when absent.
	 *
	 * @return mixed Attribute value.
	 */
	public function meta( string $key, mixed $fallback = null ): mixed {
		return $this->meta[ $key ] ?? $fallback;
	}

	/**
	 * Returns every provider specific attribute.
	 *
	 * Used when the whole set has to travel rather than one known name — the
	 * payload's field description carries it so a consumer can read a
	 * framework's own hints without the plugin having to know what they are.
	 *
	 * @since 1.5.1
	 *
	 * @return array<string,mixed> Provider extras.
	 */
	public function meta_all(): array {
		return $this->meta;
	}

	/**
	 * Resolves a stored value to its display label when the field declares
	 * choices.
	 *
	 * A select storing `diesel` shows "Diesel"; a value with no matching
	 * choice is returned unchanged rather than blanked, because an
	 * incomplete choice list must never lose data.
	 *
	 * @since 1.4.0
	 *
	 * @param string $value Stored value.
	 *
	 * @return string Display label.
	 */
	public function choice_label( string $value ): string {
		if ( empty( $this->choices ) ) {
			return $value;
		}

		return $this->choices[ $value ] ?? $value;
	}

	/**
	 * Returns the field as a plain array, for caching and for the UI.
	 *
	 * @since 1.4.0
	 *
	 * @return array<string,mixed> Field data.
	 */
	public function to_array(): array {
		$children = array();

		foreach ( $this->children as $child ) {
			$children[] = $child->to_array();
		}

		return array(
			'key'         => $this->key,
			'label'       => $this->label,
			'description' => $this->description,
			'storage_key' => $this->storage_key,
			'source'      => $this->source,
			'type'        => $this->type,
			'repeatable'  => $this->repeatable,
			'required'    => $this->required,
			'choices'     => $this->choices,
			'children'    => $children,
			'meta'        => $this->meta,
		);
	}

	/**
	 * Rebuilds a field from its array form.
	 *
	 * @since 1.4.0
	 *
	 * @param array<string,mixed> $data Field data.
	 *
	 * @return Field Field instance.
	 */
	public static function from_array( array $data ): self {
		return new self( $data );
	}

	/**
	 * Returns a copy with a different label.
	 *
	 * @since 1.4.0
	 *
	 * @param string $label New label.
	 *
	 * @return Field New instance.
	 */
	public function with_label( string $label ): self {
		$data          = $this->to_array();
		$data['label'] = $label;

		return new self( $data );
	}
}
