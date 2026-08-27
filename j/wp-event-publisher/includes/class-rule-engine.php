<?php
/**
 * Rule storage and evaluation.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Stores the rules and runs them against one advertisement.
 *
 * Evaluation is deliberately transparent: {@see self::evaluate()} returns
 * not only the decisions but a trace of every rule it considered and why it
 * did or did not match. The Rule Tester screen is that trace rendered, and
 * the delivery log records it, so "why did this advertisement go to the VIP
 * channel" is always answerable.
 *
 * @since 1.5.0
 */
class RuleEngine {

	/**
	 * Option holding every rule.
	 *
	 * @var string
	 */
	public const OPTION = 'wpep_rules';

	/**
	 * How deep a nested condition group may go.
	 *
	 * @var int
	 */
	private const MAX_DEPTH = 8;

	/**
	 * Every recognised condition subject.
	 *
	 * @var string[]
	 */
	public const SUBJECTS = array(
		'post_type',
		'post_status',
		'post_id',
		'title',
		'author',
		'author_id',
		'user_role',
		'category',
		'subcategory',
		'parent_category',
		'term',
		'taxonomy',
		'tags',
		'field',
		'number',
		'boolean',
		'price',
		'image_count',
		'gallery_count',
		'word_count',
		'date',
		'time',
		'weekday',
	);

	/**
	 * Every recognised operator.
	 *
	 * @var string[]
	 */
	public const OPERATORS = array(
		'is',
		'is_not',
		'contains',
		'not_contains',
		'starts_with',
		'ends_with',
		'gt',
		'gte',
		'lt',
		'lte',
		'between',
		'in',
		'not_in',
		'empty',
		'not_empty',
		'matches',
	);

	/**
	 * Cached rules.
	 *
	 * @var array<string,Rule>|null
	 */
	private ?array $rules = null;

	/**
	 * Returns every rule, in execution order.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,Rule> Rules keyed by id, lowest priority first.
	 */
	public function all(): array {
		if ( null !== $this->rules ) {
			return $this->rules;
		}

		$stored = get_option( self::OPTION, array() );
		$rules  = array();

		if ( is_array( $stored ) ) {
			foreach ( $stored as $id => $data ) {
				if ( ! is_array( $data ) ) {
					continue;
				}

				$data['id'] = (string) ( $data['id'] ?? $id );
				$rule       = new Rule( $data );

				if ( '' !== $rule->id() ) {
					$rules[ $rule->id() ] = $rule;
				}
			}
		}

		uasort( $rules, static fn( Rule $a, Rule $b ): int => $a->priority() <=> $b->priority() );

		$this->rules = $rules;

		return $rules;
	}

	/**
	 * Returns one rule.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id Rule identifier.
	 *
	 * @return Rule|null Rule, null when unknown.
	 */
	public function find( string $id ): ?Rule {
		return $this->all()[ Profile::sanitize_id( $id ) ] ?? null;
	}

	/**
	 * Stores a rule.
	 *
	 * @since 1.5.0
	 *
	 * @param Rule $rule Rule to store.
	 *
	 * @return bool True when written.
	 */
	public function save( Rule $rule ): bool {
		if ( '' === $rule->id() ) {
			return false;
		}

		$rules              = $this->all();
		$rules[ $rule->id() ] = $rule;

		return $this->persist( $rules );
	}

	/**
	 * Deletes a rule.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id Rule identifier.
	 *
	 * @return bool True when deleted.
	 */
	public function delete( string $id ): bool {
		$id    = Profile::sanitize_id( $id );
		$rules = $this->all();

		if ( ! isset( $rules[ $id ] ) ) {
			return false;
		}

		unset( $rules[ $id ] );

		return $this->persist( $rules );
	}

	/**
	 * Re-orders rules from a list of identifiers.
	 *
	 * @since 1.5.0
	 *
	 * @param string[] $order Rule identifiers in the desired order.
	 *
	 * @return bool True when written.
	 */
	public function reorder( array $order ): bool {
		$rules    = $this->all();
		$priority = 10;

		foreach ( $order as $id ) {
			$id = Profile::sanitize_id( (string) $id );

			if ( isset( $rules[ $id ] ) ) {
				$rules[ $id ] = $rules[ $id ]->with( array( 'priority' => $priority ) );
				$priority    += 10;
			}
		}

		return $this->persist( $rules );
	}

	/**
	 * Builds an identifier that is not taken.
	 *
	 * @since 1.5.0
	 *
	 * @param string $name Desired name.
	 *
	 * @return string Free identifier.
	 */
	public function unique_id( string $name ): string {
		$base = Profile::sanitize_id( $name );
		$base = '' === $base ? 'rule' : $base;
		$id   = $base;
		$n    = 2;

		while ( null !== $this->find( $id ) ) {
			$id = $base . '_' . $n;
			++$n;
		}

		return $id;
	}

	/**
	 * Runs every enabled rule against a context.
	 *
	 * @since 1.5.0
	 *
	 * @param RuleContext $context Facts about the advertisement.
	 *
	 * @return RuleOutcome Decisions plus the trace that produced them.
	 */
	public function evaluate( RuleContext $context ): RuleOutcome {
		$outcome = new RuleOutcome();

		foreach ( $this->all() as $rule ) {
			if ( ! $rule->is_enabled() ) {
				$outcome->trace( $rule, false, __( 'The rule is disabled.', 'wp-event-publisher' ) );

				continue;
			}

			try {
				$matched = $this->matches( $rule->conditions(), $context, 0 );
			} catch ( \Throwable $e ) {
				// A broken condition must never stop a publication; it is
				// recorded and treated as "did not match".
				$outcome->trace(
					$rule,
					false,
					sprintf(
						/* translators: %s: error message. */
						__( 'The rule could not be evaluated and was skipped: %s', 'wp-event-publisher' ),
						$e->getMessage()
					)
				);

				continue;
			}

			if ( ! $matched ) {
				$outcome->trace( $rule, false, __( 'The conditions did not match this advertisement.', 'wp-event-publisher' ) );

				continue;
			}

			$outcome->trace(
				$rule,
				true,
				$rule->is_unconditional()
					? __( 'The rule has no conditions, so it applies to everything.', 'wp-event-publisher' )
					: __( 'The conditions matched.', 'wp-event-publisher' )
			);

			$outcome->apply( $rule, $context );

			if ( $outcome->should_stop() ) {
				break;
			}
		}

		/**
		 * Filters the outcome of rule evaluation.
		 *
		 * @since 1.5.0
		 *
		 * @param RuleOutcome $outcome Decisions and trace.
		 * @param RuleContext $context Facts evaluated.
		 */
		return apply_filters( 'wpep_rule_outcome', $outcome, $context );
	}

	/**
	 * Evaluates one condition group.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $group   Condition group.
	 * @param RuleContext         $context Facts.
	 * @param int                 $depth   Current nesting depth.
	 *
	 * @return bool True when the group holds.
	 */
	public function matches( array $group, RuleContext $context, int $depth = 0 ): bool {
		$conditions = (array) ( $group['conditions'] ?? array() );

		// A group with nothing in it is a rule that always applies.
		if ( empty( $conditions ) ) {
			return true;
		}

		if ( $depth > self::MAX_DEPTH ) {
			return false;
		}

		$any = Rule::MATCH_ANY === ( $group['match'] ?? Rule::MATCH_ALL );

		foreach ( $conditions as $condition ) {
			if ( ! is_array( $condition ) ) {
				continue;
			}

			$result = isset( $condition['conditions'] ) || isset( $condition['match'] )
				? $this->matches( $condition, $context, $depth + 1 )
				: $this->test( $condition, $context );

			if ( $any && $result ) {
				return true;
			}

			if ( ! $any && ! $result ) {
				return false;
			}
		}

		// All-groups fall through having failed nothing; any-groups having
		// matched nothing.
		return ! $any;
	}

	/**
	 * Evaluates one leaf condition.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $condition Condition.
	 * @param RuleContext         $context   Facts.
	 *
	 * @return bool True when the condition holds.
	 */
	public function test( array $condition, RuleContext $context ): bool {
		$subject  = (string) ( $condition['subject'] ?? '' );
		$operator = (string) ( $condition['operator'] ?? 'is' );
		$expected = $condition['value'] ?? '';
		$key      = (string) ( $condition['key'] ?? '' );

		if ( '' === $subject || ! in_array( $operator, self::OPERATORS, true ) ) {
			return false;
		}

		$actual = $context->value( $subject, $key );

		$haystack = is_array( $actual )
			? array_values( array_map( 'strval', array_filter( $actual, 'is_scalar' ) ) )
			: array( is_bool( $actual ) ? ( $actual ? '1' : '0' ) : (string) $actual );

		switch ( $operator ) {
			case 'empty':
				return '' === trim( implode( '', $haystack ) );

			case 'not_empty':
				return '' !== trim( implode( '', $haystack ) );

			case 'is':
				return $this->any_equals( $haystack, $expected );

			case 'is_not':
				return ! $this->any_equals( $haystack, $expected );

			case 'in':
				return $this->any_in( $haystack, $expected );

			case 'not_in':
				return ! $this->any_in( $haystack, $expected );

			case 'contains':
				return $this->any_contains( $haystack, $expected );

			case 'not_contains':
				return ! $this->any_contains( $haystack, $expected );

			case 'starts_with':
				foreach ( $haystack as $item ) {
					if ( '' !== (string) $expected && str_starts_with( $this->fold( $item ), $this->fold( (string) $expected ) ) ) {
						return true;
					}
				}

				return false;

			case 'ends_with':
				foreach ( $haystack as $item ) {
					if ( '' !== (string) $expected && str_ends_with( $this->fold( $item ), $this->fold( (string) $expected ) ) ) {
						return true;
					}
				}

				return false;

			case 'matches':
				return $this->matches_pattern( $haystack, (string) $expected );

			case 'between':
				$bounds = is_array( $expected ) ? array_values( $expected ) : array_map( 'trim', explode( ',', (string) $expected ) );

				if ( count( $bounds ) < 2 ) {
					return false;
				}

				$number = $this->to_number( $actual, $context );

				return $number >= $context->numeric( (string) $bounds[0] ) && $number <= $context->numeric( (string) $bounds[1] );

			case 'gt':
			case 'gte':
			case 'lt':
			case 'lte':
				$number   = $this->to_number( $actual, $context );
				$compared = $context->numeric( is_scalar( $expected ) ? (string) $expected : '' );

				return match ( $operator ) {
					'gt'    => $number > $compared,
					'gte'   => $number >= $compared,
					'lt'    => $number < $compared,
					default => $number <= $compared,
				};
		}

		return false;
	}

	/**
	 * Converts a subject value into a number for comparison.
	 *
	 * @since 1.5.0
	 *
	 * @param mixed       $value   Subject value.
	 * @param RuleContext $context Context, for its numeric parser.
	 *
	 * @return float Number.
	 */
	private function to_number( mixed $value, RuleContext $context ): float {
		if ( is_array( $value ) ) {
			return (float) count( $value );
		}

		if ( is_bool( $value ) ) {
			return $value ? 1.0 : 0.0;
		}

		if ( is_int( $value ) || is_float( $value ) ) {
			return (float) $value;
		}

		return $context->numeric( (string) $value );
	}

	/**
	 * Case-insensitive, whitespace-tolerant comparison key.
	 *
	 * @since 1.5.0
	 *
	 * @param string $value Raw value.
	 *
	 * @return string Comparison key.
	 */
	private function fold( string $value ): string {
		return trim( function_exists( 'mb_strtolower' ) ? mb_strtolower( $value, 'UTF-8' ) : strtolower( $value ) );
	}

	/**
	 * Whether any value equals the expectation.
	 *
	 * @since 1.5.0
	 *
	 * @param string[] $haystack Actual values.
	 * @param mixed    $expected Expected value.
	 *
	 * @return bool True on a match.
	 */
	private function any_equals( array $haystack, mixed $expected ): bool {
		$wanted = $this->fold( is_scalar( $expected ) ? (string) $expected : '' );

		foreach ( $haystack as $item ) {
			if ( $this->fold( $item ) === $wanted ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Whether any value appears in a comma separated list.
	 *
	 * @since 1.5.0
	 *
	 * @param string[] $haystack Actual values.
	 * @param mixed    $expected Expected list.
	 *
	 * @return bool True on a match.
	 */
	private function any_in( array $haystack, mixed $expected ): bool {
		$list = is_array( $expected ) ? $expected : explode( ',', (string) $expected );
		$list = array_filter( array_map( fn( $item ) => $this->fold( (string) $item ), $list ), static fn( $item ): bool => '' !== $item );

		foreach ( $haystack as $item ) {
			if ( in_array( $this->fold( $item ), $list, true ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Whether any value contains the expectation.
	 *
	 * @since 1.5.0
	 *
	 * @param string[] $haystack Actual values.
	 * @param mixed    $expected Expected fragment.
	 *
	 * @return bool True on a match.
	 */
	private function any_contains( array $haystack, mixed $expected ): bool {
		$needle = $this->fold( is_scalar( $expected ) ? (string) $expected : '' );

		if ( '' === $needle ) {
			return false;
		}

		foreach ( $haystack as $item ) {
			if ( str_contains( $this->fold( $item ), $needle ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Whether any value matches a wildcard pattern.
	 *
	 * The pattern language is `*` and `?`, not a regular expression: an
	 * administrator types these into a text box, and a malformed regular
	 * expression there would be a denial of service on every publication.
	 *
	 * @since 1.5.0
	 *
	 * @param string[] $haystack Actual values.
	 * @param string   $pattern  Wildcard pattern.
	 *
	 * @return bool True on a match.
	 */
	private function matches_pattern( array $haystack, string $pattern ): bool {
		$pattern = trim( $pattern );

		if ( '' === $pattern ) {
			return false;
		}

		$regex = '/^' . str_replace( array( '\*', '\?' ), array( '.*', '.' ), preg_quote( $pattern, '/' ) ) . '$/iu';

		foreach ( $haystack as $item ) {
			if ( 1 === preg_match( $regex, $item ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Checks a rule for problems worth reporting before it is saved.
	 *
	 * @since 1.5.0
	 *
	 * @param Rule                $rule       Rule to check.
	 * @param array<string,mixed> $known      Known ids: `profiles`, `destinations`.
	 * @param string              $post_type  Post type to check field keys against.
	 * @param FieldRegistry|null  $registry   Registry, when field checks are wanted.
	 *
	 * @return array<int,array{level:string,message:string}> Problems found.
	 */
	public function validate( Rule $rule, array $known = array(), string $post_type = '', ?FieldRegistry $registry = null ): array {
		$problems = array();

		if ( '' === $rule->id() ) {
			$problems[] = array(
				'level'   => 'error',
				'message' => __( 'The rule needs a name that produces a usable identifier.', 'wp-event-publisher' ),
			);
		}

		if ( empty( $rule->actions() ) ) {
			$problems[] = array(
				'level'   => 'warning',
				'message' => __( 'The rule has no actions, so matching it will not change anything.', 'wp-event-publisher' ),
			);
		}

		$profiles     = (array) ( $known['profiles'] ?? array() );
		$destinations = (array) ( $known['destinations'] ?? array() );

		foreach ( $rule->actions() as $action ) {
			$value = is_scalar( $action['value'] ) ? (string) $action['value'] : '';

			if ( Rule::ACTION_PROFILE === $action['type'] && ! empty( $profiles ) && ! in_array( $value, $profiles, true ) ) {
				$problems[] = array(
					'level'   => 'error',
					/* translators: %s: profile identifier. */
					'message' => sprintf( __( 'The rule assigns the profile "%s", which does not exist.', 'wp-event-publisher' ), $value ),
				);
			}

			if ( in_array( $action['type'], array( Rule::ACTION_DESTINATION, Rule::ACTION_ADD_DEST ), true ) && ! empty( $destinations ) && ! in_array( $value, $destinations, true ) ) {
				$problems[] = array(
					'level'   => 'error',
					/* translators: %s: destination identifier. */
					'message' => sprintf( __( 'The rule sends to the destination "%s", which is not configured.', 'wp-event-publisher' ), $value ),
				);
			}
		}

		if ( $registry instanceof FieldRegistry && '' !== $post_type ) {
			$discovered = $registry->discover( $post_type );

			foreach ( $this->condition_keys( $rule->conditions() ) as $key ) {
				if ( '' !== $key && ! isset( $discovered[ $key ] ) ) {
					$problems[] = array(
						'level'   => 'warning',
						/* translators: 1: field key, 2: post type. */
						'message' => sprintf( __( 'A condition reads the field "%1$s", which was not discovered on "%2$s". It will be read straight from post meta instead.', 'wp-event-publisher' ), $key, $post_type ),
					);
				}
			}
		}

		return $problems;
	}

	/**
	 * Collects every field key referenced by a condition group.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $group Condition group.
	 * @param int                 $depth Nesting depth.
	 *
	 * @return string[] Field keys.
	 */
	private function condition_keys( array $group, int $depth = 0 ): array {
		if ( $depth > self::MAX_DEPTH ) {
			return array();
		}

		$keys = array();

		foreach ( (array) ( $group['conditions'] ?? array() ) as $condition ) {
			if ( ! is_array( $condition ) ) {
				continue;
			}

			if ( isset( $condition['conditions'] ) || isset( $condition['match'] ) ) {
				$keys = array_merge( $keys, $this->condition_keys( $condition, $depth + 1 ) );

				continue;
			}

			if ( in_array( (string) ( $condition['subject'] ?? '' ), array( 'field', 'text', 'select', 'number', 'boolean', 'price' ), true ) ) {
				$keys[] = Field::sanitize_key( (string) ( $condition['key'] ?? '' ) );
			}
		}

		return array_values( array_unique( array_filter( $keys ) ) );
	}

	/**
	 * Exports every rule.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,mixed> Export document.
	 */
	public function export(): array {
		$rules = array();

		foreach ( $this->all() as $rule ) {
			$rules[] = $rule->to_array();
		}

		return array(
			'format'   => 'wpep-rules',
			'version'  => WPEP_VERSION,
			'exported' => gmdate( 'c' ),
			'rules'    => $rules,
		);
	}

	/**
	 * Imports rules from an export document.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $document Export document.
	 * @param bool                $replace  Discard existing rules first.
	 *
	 * @return array{imported:int,errors:string[]} Import result.
	 */
	public function import( array $document, bool $replace = false ): array {
		$result = array(
			'imported' => 0,
			'errors'   => array(),
		);

		if ( 'wpep-rules' !== ( $document['format'] ?? '' ) ) {
			$result['errors'][] = __( 'این فایل، خروجی قوانین انتشار جارچی نیست.', 'wp-event-publisher' );

			return $result;
		}

		$rules = $replace ? array() : $this->all();

		foreach ( (array) ( $document['rules'] ?? array() ) as $data ) {
			if ( ! is_array( $data ) ) {
				continue;
			}

			$rule = new Rule( $data );

			if ( '' === $rule->id() ) {
				continue;
			}

			if ( isset( $rules[ $rule->id() ] ) && ! $replace ) {
				$rule = $rule->with( array( 'id' => $this->unique_id( $rule->name() ) ) );
			}

			$rules[ $rule->id() ] = $rule;

			++$result['imported'];
		}

		$this->persist( $rules );

		return $result;
	}

	/**
	 * Writes the rule option and drops the cache.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,Rule> $rules Rules to store.
	 *
	 * @return bool True when written.
	 */
	private function persist( array $rules ): bool {
		$stored = array();

		uasort( $rules, static fn( Rule $a, Rule $b ): int => $a->priority() <=> $b->priority() );

		foreach ( $rules as $id => $rule ) {
			if ( $rule instanceof Rule ) {
				$stored[ (string) $id ] = $rule->to_array();
			}
		}

		$this->rules = $rules;

		return update_option( self::OPTION, $stored, false );
	}

	/**
	 * Drops the in-memory cache.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function flush(): void {
		$this->rules = null;
	}
}
