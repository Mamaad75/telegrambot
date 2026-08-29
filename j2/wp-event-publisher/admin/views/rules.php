<?php
/**
 * Rules admin view.
 *
 * @package WPEventPublisher
 *
 * @var array<int,array<string,mixed>>              $profiles     Stored profiles.
 * @var array<int,array<string,mixed>>              $destinations Configured destinations.
 * @var array<int,array<string,mixed>>              $rules        Stored rules.
 * @var array<string,array{label:string,needs_key:bool}> $subjects Condition subjects.
 * @var array<string,string>                        $operators    Condition operators.
 * @var array<string,array{label:string,hint:string}> $rule_actions Rule actions.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="wrap wpep-wrap wpep-platform-wrap" data-screen="rules">
	<h1><?php esc_html_e( 'قوانین انتشار', 'wp-event-publisher' ); ?></h1>

	<p class="description">
		<?php esc_html_e( 'Rules run in order before every publication and decide what happens: which profile, which template, which destinations, whether to publish at all. A rule that matches applies its actions and, unless it says to stop, the next rule still runs and can add to the decision.', 'wp-event-publisher' ); ?>
	</p>

	<div class="wpep-result" id="wpep-platform-notice" role="status" aria-live="polite" hidden></div>

	<div class="wpep-platform-grid">
		<div class="wpep-platform-list">
			<h2><?php esc_html_e( 'Rules', 'wp-event-publisher' ); ?></h2>

			<p>
				<button type="button" class="button button-primary" id="wpep-new-rule">
					<?php esc_html_e( 'Create Rule', 'wp-event-publisher' ); ?>
				</button>
			</p>

			<ul class="wpep-item-list wpep-rule-list" id="wpep-rule-list">
				<?php foreach ( $rules as $wpep_rule ) : ?>
					<li data-id="<?php echo esc_attr( (string) $wpep_rule['id'] ); ?>">
						<span class="wpep-drag" title="<?php esc_attr_e( 'Drag to reorder', 'wp-event-publisher' ); ?>">⋮⋮</span>
						<button type="button" class="wpep-item" data-id="<?php echo esc_attr( (string) $wpep_rule['id'] ); ?>">
							<span class="wpep-item-name">
								<?php echo esc_html( (string) $wpep_rule['name'] ); ?>
								<?php if ( empty( $wpep_rule['enabled'] ) ) : ?>
									<span class="wpep-badge wpep-badge-skipped"><?php esc_html_e( 'Disabled', 'wp-event-publisher' ); ?></span>
								<?php endif; ?>
							</span>
							<span class="wpep-item-meta">
								<?php
								printf(
									/* translators: 1: number of conditions, 2: number of actions. */
									esc_html__( '%1$d conditions · %2$d actions', 'wp-event-publisher' ),
									count( (array) ( $wpep_rule['conditions']['conditions'] ?? array() ) ),
									count( (array) $wpep_rule['actions'] )
								);
								?>
							</span>
						</button>
					</li>
				<?php endforeach; ?>
			</ul>

			<?php if ( empty( $rules ) ) : ?>
				<p class="description"><?php esc_html_e( 'No rules are defined, so every advertisement is published with whichever profile its category resolves to — exactly the behaviour of earlier versions.', 'wp-event-publisher' ); ?></p>
			<?php endif; ?>
		</div>

		<div class="wpep-platform-editor" id="wpep-rule-editor" hidden>
			<h2 id="wpep-rule-title"><?php esc_html_e( 'Edit rule', 'wp-event-publisher' ); ?></h2>

			<div class="wpep-validation" id="wpep-rule-problems" hidden></div>

			<table class="form-table" role="presentation">
				<tbody>
					<tr>
						<th scope="row"><label for="wpep-rule-name"><?php esc_html_e( 'Name', 'wp-event-publisher' ); ?></label></th>
						<td><input type="text" id="wpep-rule-name" class="regular-text" /></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Enabled', 'wp-event-publisher' ); ?></th>
						<td>
							<label>
								<input type="checkbox" id="wpep-rule-enabled" />
								<?php esc_html_e( 'Evaluate this rule when publishing', 'wp-event-publisher' ); ?>
							</label>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="wpep-rule-match"><?php esc_html_e( 'Match', 'wp-event-publisher' ); ?></label></th>
						<td>
							<select id="wpep-rule-match">
								<option value="all"><?php esc_html_e( 'All conditions must hold (AND)', 'wp-event-publisher' ); ?></option>
								<option value="any"><?php esc_html_e( 'Any condition is enough (OR)', 'wp-event-publisher' ); ?></option>
							</select>
							<p class="description"><?php esc_html_e( 'A rule with no conditions applies to every advertisement.', 'wp-event-publisher' ); ?></p>
						</td>
					</tr>
				</tbody>
			</table>

			<h3><?php esc_html_e( 'Conditions', 'wp-event-publisher' ); ?></h3>

			<div id="wpep-rule-conditions" class="wpep-conditions"></div>

			<p>
				<button type="button" class="button" id="wpep-add-condition"><?php esc_html_e( 'Add condition', 'wp-event-publisher' ); ?></button>
				<button type="button" class="button" id="wpep-add-group"><?php esc_html_e( 'Add nested group', 'wp-event-publisher' ); ?></button>
			</p>

			<h3><?php esc_html_e( 'Actions', 'wp-event-publisher' ); ?></h3>

			<div id="wpep-rule-actions" class="wpep-actions"></div>

			<p>
				<button type="button" class="button" id="wpep-add-action"><?php esc_html_e( 'Add action', 'wp-event-publisher' ); ?></button>
			</p>

			<p class="wpep-editor-actions">
				<button type="button" class="button button-primary" id="wpep-save-rule"><?php esc_html_e( 'Save Rule', 'wp-event-publisher' ); ?></button>
				<button type="button" class="button button-link-delete" id="wpep-delete-rule"><?php esc_html_e( 'Delete', 'wp-event-publisher' ); ?></button>
			</p>
		</div>
	</div>

	<h2><?php esc_html_e( 'Rule Tester', 'wp-event-publisher' ); ?></h2>

	<p class="description">
		<?php esc_html_e( 'Pick a real advertisement and see exactly what would happen to it: which rules matched and which did not, which profile and template won, which destinations it would reach, the final message and the final payload. Nothing is sent.', 'wp-event-publisher' ); ?>
	</p>

	<p>
		<label for="wpep-test-post"><?php esc_html_e( 'Advertisement ID', 'wp-event-publisher' ); ?></label>
		<input type="number" id="wpep-test-post" class="small-text" min="1" />
		<button type="button" class="button button-secondary" id="wpep-run-test"><?php esc_html_e( 'Test Rules', 'wp-event-publisher' ); ?></button>
	</p>

	<div id="wpep-test-output" class="wpep-test-output" hidden></div>

	<?php // The condition and action row markup lives here so every string stays in the PHP catalogue and is escaped by WordPress. ?>
	<script type="text/template" id="wpep-condition-template">
		<div class="wpep-condition">
			<select class="wpep-condition-subject">
				<?php foreach ( $subjects as $wpep_subject => $wpep_subject_meta ) : ?>
					<option value="<?php echo esc_attr( $wpep_subject ); ?>" data-needs-key="<?php echo esc_attr( ! empty( $wpep_subject_meta['needs_key'] ) ? '1' : '0' ); ?>">
						<?php echo esc_html( (string) $wpep_subject_meta['label'] ); ?>
					</option>
				<?php endforeach; ?>
			</select>
			<input type="text" class="wpep-condition-key regular-text" placeholder="<?php esc_attr_e( 'field key', 'wp-event-publisher' ); ?>" />
			<select class="wpep-condition-operator">
				<?php foreach ( $operators as $wpep_operator => $wpep_operator_label ) : ?>
					<option value="<?php echo esc_attr( $wpep_operator ); ?>"><?php echo esc_html( $wpep_operator_label ); ?></option>
				<?php endforeach; ?>
			</select>
			<input type="text" class="wpep-condition-value regular-text" placeholder="<?php esc_attr_e( 'value', 'wp-event-publisher' ); ?>" />
			<button type="button" class="button-link wpep-remove" title="<?php esc_attr_e( 'Remove', 'wp-event-publisher' ); ?>">✕</button>
		</div>
	</script>

	<script type="text/template" id="wpep-group-template">
		<div class="wpep-condition-group">
			<p>
				<label>
					<?php esc_html_e( 'Nested group:', 'wp-event-publisher' ); ?>
					<select class="wpep-group-match">
						<option value="all"><?php esc_html_e( 'all (AND)', 'wp-event-publisher' ); ?></option>
						<option value="any"><?php esc_html_e( 'any (OR)', 'wp-event-publisher' ); ?></option>
					</select>
				</label>
				<button type="button" class="button button-small wpep-group-add"><?php esc_html_e( 'Add condition', 'wp-event-publisher' ); ?></button>
				<button type="button" class="button-link wpep-remove" title="<?php esc_attr_e( 'Remove', 'wp-event-publisher' ); ?>">✕</button>
			</p>
			<div class="wpep-group-conditions"></div>
		</div>
	</script>

	<script type="text/template" id="wpep-action-template">
		<div class="wpep-action">
			<select class="wpep-action-type">
				<?php foreach ( $rule_actions as $wpep_action => $wpep_action_meta ) : ?>
					<option value="<?php echo esc_attr( $wpep_action ); ?>" data-hint="<?php echo esc_attr( (string) $wpep_action_meta['hint'] ); ?>">
						<?php echo esc_html( (string) $wpep_action_meta['label'] ); ?>
					</option>
				<?php endforeach; ?>
			</select>
			<textarea class="wpep-action-value large-text" rows="1"></textarea>
			<button type="button" class="button-link wpep-remove" title="<?php esc_attr_e( 'Remove', 'wp-event-publisher' ); ?>">✕</button>
		</div>
	</script>
</div>
