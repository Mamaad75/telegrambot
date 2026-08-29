<?php
/**
 * The decisions rule evaluation produced.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * What the rules decided, and how they got there.
 *
 * Rules do not act; they accumulate decisions here and the publisher acts
 * on the result. Two consequences follow, both of them the point:
 *
 * - The **Rule Tester** can show an administrator exactly what would happen
 *   to an advertisement without publishing it, because producing the
 *   outcome has no side effects.
 * - Every publication can log *why* it went where it went, because the
 *   trace is part of the outcome rather than something reconstructed
 *   afterwards.
 *
 * @since 1.5.0
 */
class RuleOutcome {

	/**
	 * Profile identifier a rule chose, empty for the assigned one.
	 *
	 * @var string
	 */
	private string $profile = '';

	/**
	 * Template a rule chose, empty for the profile's own.
	 *
	 * @var string
	 */
	private string $template = '';

	/**
	 * Destination identifiers a rule chose, empty for the profile's own.
	 *
	 * @var string[]
	 */
	private array $destinations = array();

	/**
	 * Destination identifiers a rule added on top.
	 *
	 * @var string[]
	 */
	private array $added_destinations = array();

	/**
	 * Text prepended to the message.
	 *
	 * @var string[]
	 */
	private array $prepend = array();

	/**
	 * Text appended to the message.
	 *
	 * @var string[]
	 */
	private array $append = array();

	/**
	 * Literal replacements applied to the message, search => replace.
	 *
	 * @var array<string,string>
	 */
	private array $replacements = array();

	/**
	 * Field keys forced off.
	 *
	 * @var string[]
	 */
	private array $hidden = array();

	/**
	 * Field keys forced on.
	 *
	 * @var string[]
	 */
	private array $shown = array();

	/**
	 * Maximum number of images, null for the profile's own limit.
	 *
	 * @var int|null
	 */
	private ?int $image_limit = null;

	/**
	 * Whether publication is suppressed.
	 *
	 * @var bool
	 */
	private bool $skip = false;

	/**
	 * Why publication is suppressed.
	 *
	 * @var string
	 */
	private string $skip_reason = '';

	/**
	 * Delay before delivery, in seconds.
	 *
	 * @var int
	 */
	private int $delay = 0;

	/**
	 * Whether processing stopped early.
	 *
	 * @var bool
	 */
	private bool $stop = false;

	/**
	 * Evaluation trace.
	 *
	 * @var array<int,array{id:string,name:string,matched:bool,reason:string,actions:string[]}>
	 */
	private array $trace = array();

	/**
	 * Records that a rule was considered.
	 *
	 * @since 1.5.0
	 *
	 * @param Rule   $rule    Rule considered.
	 * @param bool   $matched Whether it matched.
	 * @param string $reason  Why, in plain language.
	 *
	 * @return void
	 */
	public function trace( Rule $rule, bool $matched, string $reason ): void {
		$this->trace[] = array(
			'id'      => $rule->id(),
			'name'    => $rule->name(),
			'matched' => $matched,
			'reason'  => $reason,
			'actions' => array(),
		);
	}

	/**
	 * Applies a matching rule's actions.
	 *
	 * Later rules win on single-valued decisions (profile, template, image
	 * limit) and accumulate on multi-valued ones (added destinations,
	 * prepends, hidden fields), which is what "rules run top to bottom and
	 * build on each other" means in practice.
	 *
	 * @since 1.5.0
	 *
	 * @param Rule        $rule    Matching rule.
	 * @param RuleContext $context Facts, for resolving placeholders in text.
	 *
	 * @return void
	 */
	public function apply( Rule $rule, RuleContext $context ): void {
		$applied = array();

		foreach ( $rule->actions() as $action ) {
			$type  = (string) $action['type'];
			$value = $action['value'] ?? '';
			$text  = is_scalar( $value ) ? (string) $value : '';

			switch ( $type ) {
				case Rule::ACTION_PROFILE:
					$this->profile = Profile::sanitize_id( $text );
					break;

				case Rule::ACTION_TEMPLATE:
					$this->template = $text;
					break;

				case Rule::ACTION_DESTINATION:
					$this->destinations = $this->id_list( $value );
					break;

				case Rule::ACTION_ADD_DEST:
					$this->added_destinations = array_values( array_unique( array_merge( $this->added_destinations, $this->id_list( $value ) ) ) );
					break;

				case Rule::ACTION_PREPEND:
					if ( '' !== $text ) {
						$this->prepend[] = $text;
					}
					break;

				case Rule::ACTION_APPEND:
					if ( '' !== $text ) {
						$this->append[] = $text;
					}
					break;

				case Rule::ACTION_REPLACE:
					// "search|replace", because one text box is easier to get
					// right than two.
					$parts = explode( '|', $text, 2 );

					if ( '' !== trim( $parts[0] ) ) {
						$this->replacements[ $parts[0] ] = $parts[1] ?? '';
					}
					break;

				case Rule::ACTION_HIDE_FIELD:
					foreach ( $this->key_list( $value ) as $key ) {
						$this->hidden[] = $key;
						$this->shown    = array_values( array_diff( $this->shown, array( $key ) ) );
					}
					break;

				case Rule::ACTION_SHOW_FIELD:
					foreach ( $this->key_list( $value ) as $key ) {
						$this->shown[]  = $key;
						$this->hidden   = array_values( array_diff( $this->hidden, array( $key ) ) );
					}
					break;

				case Rule::ACTION_LIMIT_IMAGES:
					$this->image_limit = max( 0, (int) $context->numeric( $text ) );
					break;

				case Rule::ACTION_NO_IMAGES:
					$this->image_limit = 0;
					break;

				case Rule::ACTION_SKIP:
					$this->skip        = true;
					$this->skip_reason = '' !== $text
						? $text
						: sprintf(
							/* translators: %s: rule name. */
							__( 'The rule "%s" stopped this advertisement from being published.', 'wp-event-publisher' ),
							$rule->name()
						);
					break;

				case Rule::ACTION_DELAY:
					$this->delay = max( $this->delay, (int) $context->numeric( $text ) );
					break;

				case Rule::ACTION_STOP:
					$this->stop = true;
					break;

				case Rule::ACTION_CONTINUE:
					$this->stop = false;
					break;
			}

			$applied[] = $type;
		}

		$this->hidden = array_values( array_unique( $this->hidden ) );
		$this->shown  = array_values( array_unique( $this->shown ) );

		// Attach the applied actions to this rule's trace entry.
		$last = count( $this->trace ) - 1;

		if ( $last >= 0 ) {
			$this->trace[ $last ]['actions'] = $applied;
		}
	}

	/**
	 * Splits a value into identifiers.
	 *
	 * @since 1.5.0
	 *
	 * @param mixed $value Raw action value.
	 *
	 * @return string[] Identifiers.
	 */
	private function id_list( mixed $value ): array {
		$items = is_array( $value ) ? $value : explode( ',', (string) $value );

		return array_values( array_filter( array_map( array( Profile::class, 'sanitize_id' ), array_map( 'strval', $items ) ) ) );
	}

	/**
	 * Splits a value into field keys.
	 *
	 * @since 1.5.0
	 *
	 * @param mixed $value Raw action value.
	 *
	 * @return string[] Field keys.
	 */
	private function key_list( mixed $value ): array {
		$items = is_array( $value ) ? $value : explode( ',', (string) $value );

		return array_values( array_filter( array_map( array( Field::class, 'sanitize_key' ), array_map( 'strval', $items ) ) ) );
	}

	/**
	 * Returns the profile a rule chose.
	 *
	 * @since 1.5.0
	 *
	 * @return string Profile id, empty when no rule chose one.
	 */
	public function profile(): string {
		return $this->profile;
	}

	/**
	 * Returns the template a rule chose.
	 *
	 * @since 1.5.0
	 *
	 * @return string Template, empty when no rule chose one.
	 */
	public function template(): string {
		return $this->template;
	}

	/**
	 * Returns the destinations a rule chose.
	 *
	 * @since 1.5.0
	 *
	 * @return string[] Destination ids, empty when no rule chose any.
	 */
	public function destinations(): array {
		return $this->destinations;
	}

	/**
	 * Returns the destinations a rule added.
	 *
	 * @since 1.5.0
	 *
	 * @return string[] Destination ids.
	 */
	public function added_destinations(): array {
		return $this->added_destinations;
	}

	/**
	 * Returns the field keys forced off.
	 *
	 * @since 1.5.0
	 *
	 * @return string[] Field keys.
	 */
	public function hidden_fields(): array {
		return $this->hidden;
	}

	/**
	 * Returns the field keys forced on.
	 *
	 * @since 1.5.0
	 *
	 * @return string[] Field keys.
	 */
	public function shown_fields(): array {
		return $this->shown;
	}

	/**
	 * Returns the image limit a rule imposed.
	 *
	 * @since 1.5.0
	 *
	 * @return int|null Limit, null when no rule imposed one.
	 */
	public function image_limit(): ?int {
		return $this->image_limit;
	}

	/**
	 * Whether publication is suppressed.
	 *
	 * @since 1.5.0
	 *
	 * @return bool True when the advertisement must not be sent.
	 */
	public function is_skipped(): bool {
		return $this->skip;
	}

	/**
	 * Why publication is suppressed.
	 *
	 * @since 1.5.0
	 *
	 * @return string Reason in plain language.
	 */
	public function skip_reason(): string {
		return $this->skip_reason;
	}

	/**
	 * Returns the delay before delivery.
	 *
	 * @since 1.5.0
	 *
	 * @return int Seconds.
	 */
	public function delay(): int {
		return $this->delay;
	}

	/**
	 * Whether rule processing stopped early.
	 *
	 * @since 1.5.0
	 *
	 * @return bool True when a rule said to stop.
	 */
	public function should_stop(): bool {
		return $this->stop;
	}

	/**
	 * Applies the text actions to a rendered message.
	 *
	 * @since 1.5.0
	 *
	 * @param string $message Rendered message.
	 *
	 * @return string Message with prefixes, suffixes and replacements.
	 */
	public function decorate( string $message ): string {
		foreach ( $this->replacements as $search => $replace ) {
			$message = str_replace( $search, $replace, $message );
		}

		$parts = array();

		foreach ( $this->prepend as $text ) {
			$parts[] = $text;
		}

		if ( '' !== trim( $message ) ) {
			$parts[] = $message;
		}

		foreach ( $this->append as $text ) {
			$parts[] = $text;
		}

		return trim( implode( "\n", $parts ) );
	}

	/**
	 * Returns the evaluation trace.
	 *
	 * @since 1.5.0
	 *
	 * @return array<int,array<string,mixed>> Trace entries.
	 */
	public function trace_entries(): array {
		return $this->trace;
	}

	/**
	 * Returns the identifiers of the rules that matched.
	 *
	 * @since 1.5.0
	 *
	 * @return string[] Rule identifiers.
	 */
	public function matched(): array {
		$matched = array();

		foreach ( $this->trace as $entry ) {
			if ( ! empty( $entry['matched'] ) ) {
				$matched[] = (string) $entry['id'];
			}
		}

		return $matched;
	}

	/**
	 * Returns the outcome as a plain array, for logging.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,mixed> Outcome summary.
	 */
	public function to_array(): array {
		return array(
			'profile'      => $this->profile,
			'template'     => '' !== $this->template,
			'destinations' => $this->destinations,
			'added'        => $this->added_destinations,
			'hidden'       => $this->hidden,
			'shown'        => $this->shown,
			'image_limit'  => $this->image_limit,
			'skip'         => $this->skip,
			'skip_reason'  => $this->skip_reason,
			'delay'        => $this->delay,
			'stopped'      => $this->stop,
			'matched'      => $this->matched(),
		);
	}
}
