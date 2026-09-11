<?php
/**
 * Publishing rule value object.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * One "if this, then that" decision applied before an advertisement is
 * published.
 *
 * A rule holds a condition group and a list of actions. Rules run in
 * priority order and each one either matches or does not; a matching rule
 * applies its actions and, unless it says to stop, processing continues so
 * later rules can add to what earlier ones decided.
 *
 * A rule never *sends* anything. It only changes the decisions —
 * which profile, which template, which destinations, whether to publish at
 * all — that the publisher then acts on. That separation is what makes the
 * rule tester able to show exactly what would happen without doing it.
 *
 * @since 1.5.0
 */
class Rule {

	/**
	 * Every condition in the group must hold.
	 *
	 * @var string
	 */
	public const MATCH_ALL = 'all';

	/**
	 * Any one condition in the group is enough.
	 *
	 * @var string
	 */
	public const MATCH_ANY = 'any';

	/**
	 * Action names.
	 *
	 * @var string
	 */
	public const ACTION_PROFILE      = 'assign_profile';
	public const ACTION_TEMPLATE     = 'assign_template';
	public const ACTION_DESTINATION  = 'assign_destination';
	public const ACTION_ADD_DEST     = 'add_destination';
	public const ACTION_APPEND       = 'append_text';
	public const ACTION_PREPEND      = 'prepend_text';
	public const ACTION_REPLACE      = 'replace';
	public const ACTION_HIDE_FIELD   = 'hide_field';
	public const ACTION_SHOW_FIELD   = 'show_field';
	public const ACTION_LIMIT_IMAGES = 'limit_images';
	public const ACTION_NO_IMAGES    = 'skip_images';
	public const ACTION_SKIP         = 'skip_publishing';
	public const ACTION_DELAY        = 'delay_publishing';
	public const ACTION_STOP         = 'stop_processing';
	public const ACTION_CONTINUE     = 'continue_processing';

	/**
	 * Every recognised action.
	 *
	 * @var string[]
	 */
	public const ACTIONS = array(
		self::ACTION_PROFILE,
		self::ACTION_TEMPLATE,
		self::ACTION_DESTINATION,
		self::ACTION_ADD_DEST,
		self::ACTION_APPEND,
		self::ACTION_PREPEND,
		self::ACTION_REPLACE,
		self::ACTION_HIDE_FIELD,
		self::ACTION_SHOW_FIELD,
		self::ACTION_LIMIT_IMAGES,
		self::ACTION_NO_IMAGES,
		self::ACTION_SKIP,
		self::ACTION_DELAY,
		self::ACTION_STOP,
		self::ACTION_CONTINUE,
	);

	/**
	 * Stable identifier.
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
	 * Whether the rule participates at all.
	 *
	 * @var bool
	 */
	private bool $enabled;

	/**
	 * Sort order; lower runs first.
	 *
	 * @var int
	 */
	private int $priority;

	/**
	 * Condition group.
	 *
	 * A group is `{ match: all|any, conditions: [ condition|group, … ] }`
	 * and may nest to any depth the evaluator's guard allows.
	 *
	 * @var array<string,mixed>
	 */
	private array $conditions;

	/**
	 * Actions applied when the rule matches.
	 *
	 * @var array<int,array<string,mixed>>
	 */
	private array $actions;

	/**
	 * Constructor.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $data Rule data.
	 */
	public function __construct( array $data = array() ) {
		$this->id       = Profile::sanitize_id( (string) ( $data['id'] ?? '' ) );
		$this->name     = trim( (string) ( $data['name'] ?? '' ) );
		$this->enabled  = ! isset( $data['enabled'] ) || ! empty( $data['enabled'] );
		$this->priority = (int) ( $data['priority'] ?? 10 );

		if ( '' === $this->name ) {
			$this->name = '' === $this->id ? __( 'Untitled rule', 'wp-event-publisher' ) : $this->id;
		}

		$this->conditions = self::normalize_group( (array) ( $data['conditions'] ?? array() ) );

		$actions = array();

		foreach ( (array) ( $data['actions'] ?? array() ) as $action ) {
			if ( ! is_array( $action ) ) {
				continue;
			}

			$type = (string) ( $action['type'] ?? '' );

			if ( ! in_array( $type, self::ACTIONS, true ) ) {
				continue;
			}

			$actions[] = array(
				'type'  => $type,
				'value' => $action['value'] ?? '',
			);
		}

		$this->actions = $actions;
	}

	/**
	 * Fills in a condition group's structure.
	 *
	 * A bare list of conditions is accepted and wrapped, so a rule written
	 * by hand or imported from a simpler format still loads.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $group Raw group.
	 *
	 * @return array{match:string,conditions:array<int,mixed>} Normalized group.
	 */
	public static function normalize_group( array $group ): array {
		if ( ! isset( $group['conditions'] ) && ! isset( $group['match'] ) ) {
			$group = array(
				'match'      => self::MATCH_ALL,
				'conditions' => array_values( $group ),
			);
		}

		$match = (string) ( $group['match'] ?? self::MATCH_ALL );
		$match = in_array( $match, array( self::MATCH_ALL, self::MATCH_ANY ), true ) ? $match : self::MATCH_ALL;

		$conditions = array();

		foreach ( (array) ( $group['conditions'] ?? array() ) as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}

			// A nested group is anything that carries its own conditions.
			if ( isset( $entry['conditions'] ) || isset( $entry['match'] ) ) {
				$conditions[] = self::normalize_group( $entry );

				continue;
			}

			$subject = (string) ( $entry['subject'] ?? '' );

			if ( '' === $subject ) {
				continue;
			}

			$conditions[] = array(
				'subject'  => $subject,
				'key'      => (string) ( $entry['key'] ?? '' ),
				'operator' => (string) ( $entry['operator'] ?? 'is' ),
				'value'    => $entry['value'] ?? '',
			);
		}

		return array(
			'match'      => $match,
			'conditions' => $conditions,
		);
	}

	/**
	 * Returns the identifier.
	 *
	 * @since 1.5.0
	 *
	 * @return string Rule id.
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
	 * Whether the rule is enabled.
	 *
	 * @since 1.5.0
	 *
	 * @return bool True when enabled.
	 */
	public function is_enabled(): bool {
		return $this->enabled;
	}

	/**
	 * Returns the sort order.
	 *
	 * @since 1.5.0
	 *
	 * @return int Priority; lower runs first.
	 */
	public function priority(): int {
		return $this->priority;
	}

	/**
	 * Returns the condition group.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,mixed> Condition group.
	 */
	public function conditions(): array {
		return $this->conditions;
	}

	/**
	 * Returns the actions.
	 *
	 * @since 1.5.0
	 *
	 * @return array<int,array<string,mixed>> Actions.
	 */
	public function actions(): array {
		return $this->actions;
	}

	/**
	 * Whether the rule has no conditions, and therefore always matches.
	 *
	 * @since 1.5.0
	 *
	 * @return bool True when unconditional.
	 */
	public function is_unconditional(): bool {
		return empty( $this->conditions['conditions'] );
	}

	/**
	 * Returns the rule as a plain array.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,mixed> Rule data.
	 */
	public function to_array(): array {
		return array(
			'id'         => $this->id,
			'name'       => $this->name,
			'enabled'    => $this->enabled,
			'priority'   => $this->priority,
			'conditions' => $this->conditions,
			'actions'    => $this->actions,
		);
	}

	/**
	 * Returns a copy with some attributes replaced.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $changes Attributes to replace.
	 *
	 * @return Rule New instance.
	 */
	public function with( array $changes ): self {
		return new self( array_merge( $this->to_array(), $changes ) );
	}
}
