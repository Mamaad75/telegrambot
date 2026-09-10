<?php
/**
 * Event Inspector, Queue Inspector and Debug Log.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Shows what the plugin is actually doing.
 *
 * Three tabs, because the data lives in three different places and pretending
 * otherwise would be dishonest:
 *
 *   Events      Server-side events in `{prefix}bap_outbox`. PHP owns these, so
 *               they can be rendered directly.
 *   Local queue The browser's IndexedDB queue. PHP cannot see it at all — the
 *               tab loads a small script that opens the same origin-scoped
 *               database and reports what is really there. No server-side
 *               guesses, no fabricated counts.
 *   Debug log   The plugin's own redacted activity log.
 */
class BAP_Inspector_Page {

	const NONCE_ACTION = 'bap_inspector';
	const NONCE_FIELD  = 'bap_inspector_nonce';
	const PER_PAGE     = 25;

	/**
	 * Registers hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_post_bap_clear_debug_log', array( __CLASS__, 'handle_clear_debug_log' ) );
	}

	/**
	 * Renders the screen.
	 *
	 * @return void
	 */
	public static function render() {
		if ( ! current_user_can( BAP_Admin::reports_capability() ) ) {
			wp_die( esc_html__( 'اجازه مشاهده این صفحه را ندارید.', 'bahoosh-analytics-pro' ) );
		}

		$tab = self::current_tab();
		?>
		<div class="wrap bap-wrap bap-settings bap-unified-screen">
			<?php BAP_Admin::render_page_header(
				__( 'بازرس رویدادها', 'bahoosh-analytics-pro' ),
				__( 'رویدادهای سمت سرور، صف مرورگر و لاگ دیباگ را در یک محیط واحد بررسی کنید.', 'bahoosh-analytics-pro' ),
				BAP_Admin::INSPECTOR_SLUG
			); ?>

			<nav class="bap-secondary-nav" aria-label="<?php esc_attr_e( 'بخش‌های بازرس', 'bahoosh-analytics-pro' ); ?>">
				<?php foreach ( self::tabs() as $slug => $label ) : ?>
					<a class="<?php echo $tab === $slug ? 'is-active' : ''; ?>"
						<?php echo $tab === $slug ? 'aria-current="page"' : ''; ?>
						href="<?php echo esc_url( self::tab_url( $slug ) ); ?>">
						<?php echo esc_html( $label ); ?>
					</a>
				<?php endforeach; ?>
			</nav>

			<section class="bap-section bap-inspector-section">
			<?php
			switch ( $tab ) {
				case 'queue':
					self::render_queue_tab();
					break;
				case 'log':
					self::render_log_tab();
					break;
				default:
					self::render_events_tab();
			}
			?>
			</section>
		</div>
		<?php
	}

	/**
	 * Tab definitions.
	 *
	 * @return array<string,string>
	 */
	private static function tabs() {
		return array(
			'events' => __( 'رویدادهای سرور', 'bahoosh-analytics-pro' ),
			'queue'  => __( 'صف مرورگر', 'bahoosh-analytics-pro' ),
			'log'    => __( 'گزارش دیباگ', 'bahoosh-analytics-pro' ),
		);
	}

	/**
	 * The requested tab, validated against the known set.
	 *
	 * @return string
	 */
	private static function current_tab() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only navigation.
		$requested = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : 'events';
		return array_key_exists( $requested, self::tabs() ) ? $requested : 'events';
	}

	/**
	 * URL for a tab.
	 *
	 * @param string $slug Tab slug.
	 * @return string
	 */
	private static function tab_url( $slug ) {
		return admin_url( 'admin.php?page=' . BAP_Admin::INSPECTOR_SLUG . '&tab=' . rawurlencode( $slug ) );
	}

	// ---------- Events tab ----------

	/**
	 * Renders server-side events with filters and payload inspection.
	 *
	 * @return void
	 */
	private static function render_events_tab() {
		$filters = self::read_filters();
		$result  = BAP_Outbox::recent( $filters );
		$total   = (int) $result['total'];
		$page    = max( 1, (int) ( $filters['offset'] / self::PER_PAGE ) + 1 );
		$pages   = max( 1, (int) ceil( $total / self::PER_PAGE ) );
		?>
		<p class="description">
			<?php
			esc_html_e(
				'رویدادهای تولیدشده در سرور مانند خرید و بازپرداخت ووکامرس اینجا نمایش داده می‌شوند. رویدادهای مرورگر مستقیم ارسال می‌شوند؛ برای آن‌ها تب صف مرورگر را ببینید.',
				'bahoosh-analytics-pro'
			);
			?>
		</p>

		<form method="get" class="bap-filters">
			<input type="hidden" name="page" value="<?php echo esc_attr( BAP_Admin::INSPECTOR_SLUG ); ?>" />
			<input type="hidden" name="tab" value="events" />

			<label for="bap-filter-type" class="screen-reader-text">
				<?php esc_html_e( 'فیلتر بر اساس نوع رویداد', 'bahoosh-analytics-pro' ); ?>
			</label>
			<select id="bap-filter-type" name="event_type">
				<option value=""><?php esc_html_e( 'همه نوع رویداد', 'bahoosh-analytics-pro' ); ?></option>
				<?php foreach ( BAP_Outbox::known_event_types() as $type ) : ?>
					<option value="<?php echo esc_attr( $type ); ?>" <?php selected( $filters['event_type'], $type ); ?>>
						<?php echo esc_html( $type ); ?>
					</option>
				<?php endforeach; ?>
			</select>

			<label for="bap-filter-status" class="screen-reader-text">
				<?php esc_html_e( 'فیلتر بر اساس وضعیت ارسال', 'bahoosh-analytics-pro' ); ?>
			</label>
			<select id="bap-filter-status" name="status">
				<option value=""><?php esc_html_e( 'همه وضعیت‌ها', 'bahoosh-analytics-pro' ); ?></option>
				<?php foreach ( self::statuses() as $value => $label ) : ?>
					<option value="<?php echo esc_attr( $value ); ?>" <?php selected( $filters['status'], $value ); ?>>
						<?php echo esc_html( $label ); ?>
					</option>
				<?php endforeach; ?>
			</select>

			<label for="bap-filter-since" class="screen-reader-text">
				<?php esc_html_e( 'نمایش رویدادها از تاریخ', 'bahoosh-analytics-pro' ); ?>
			</label>
			<input type="hidden" id="bap-filter-since" name="since"
				value="<?php echo esc_attr( $filters['since_date'] ); ?>" />
			<input type="text" id="bap-filter-since-jalali" class="bap-jalali-input" readonly placeholder="از تاریخ" data-bap-jalali-target="bap-filter-since" />

			<?php submit_button( __( 'فیلتر', 'bahoosh-analytics-pro' ), 'secondary', 'submit', false ); ?>
			<a class="button-link" href="<?php echo esc_url( self::tab_url( 'events' ) ); ?>">
				<?php esc_html_e( 'بازنشانی', 'bahoosh-analytics-pro' ); ?>
			</a>
		</form>

		<?php if ( empty( $result['rows'] ) ) : ?>
			<p class="bap-muted"><?php esc_html_e( 'هیچ رویداد سمت سروری با این فیلترها مطابقت ندارد.', 'bahoosh-analytics-pro' ); ?></p>
			<?php return; ?>
		<?php endif; ?>

		<table class="widefat striped bap-events">
			<caption class="screen-reader-text"><?php esc_html_e( 'رویدادهای اخیر سمت سرور', 'bahoosh-analytics-pro' ); ?></caption>
			<thead>
				<tr>
					<th scope="col"><?php esc_html_e( 'رویداد', 'bahoosh-analytics-pro' ); ?></th>
					<th scope="col"><?php esc_html_e( 'ایجادشده', 'bahoosh-analytics-pro' ); ?></th>
					<th scope="col"><?php esc_html_e( 'هویت', 'bahoosh-analytics-pro' ); ?></th>
					<th scope="col"><?php esc_html_e( 'صفحه', 'bahoosh-analytics-pro' ); ?></th>
					<th scope="col"><?php esc_html_e( 'ارسال', 'bahoosh-analytics-pro' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $result['rows'] as $row ) : ?>
					<?php self::render_event_row( $row ); ?>
				<?php endforeach; ?>
			</tbody>
		</table>

		<?php if ( $pages > 1 ) : ?>
			<div class="tablenav"><div class="tablenav-pages">
				<?php
				echo wp_kses_post(
					paginate_links(
						array(
							'base'      => add_query_arg( 'paged', '%#%' ),
							'format'    => '',
							'current'   => $page,
							'total'     => $pages,
							'prev_text' => __( '&laquo; قبلی', 'bahoosh-analytics-pro' ),
							'next_text' => __( 'بعدی &raquo;', 'bahoosh-analytics-pro' ),
						)
					)
				);
				?>
			</div></div>
		<?php endif; ?>
		<?php
	}

	/**
	 * Renders one event row plus its collapsible payload.
	 *
	 * Every value is escaped on output. Payloads contain page URLs and product
	 * names — attacker-influenced strings — so none of it is ever treated as
	 * markup.
	 *
	 * @param array $row Outbox row.
	 * @return void
	 */
	private static function render_event_row( array $row ) {
		$payload  = json_decode( $row['payload'], true );
		$payload  = is_array( $payload ) ? $payload : array();
		$identity = isset( $payload['identity'] ) && is_array( $payload['identity'] ) ? $payload['identity'] : array();
		$view_id  = isset( $payload['page_view_id'] ) ? (string) $payload['page_view_id'] : '';
		$page     = isset( $payload['page'] ) && is_array( $payload['page'] ) ? $payload['page'] : array();
		$row_id   = 'bap-payload-' . md5( $row['event_id'] );
		?>
		<tr>
			<td>
				<strong><?php echo esc_html( $row['event_type'] ); ?></strong><br />
				<code class="bap-id" title="<?php echo esc_attr( $row['event_id'] ); ?>">
					<?php echo esc_html( BAP_Debug_Log::mask( $row['event_id'] ) ); ?>
				</code>
			</td>
			<td>
				<?php echo esc_html( self::format_time( $row['created_at'] ) ); ?>
			</td>
			<td>
				<?php if ( ! empty( $identity['anonymous_id'] ) ) : ?>
					<span class="bap-muted"><?php esc_html_e( 'ناشناس', 'bahoosh-analytics-pro' ); ?></span>
					<code class="bap-id"><?php echo esc_html( BAP_Debug_Log::mask( $identity['anonymous_id'] ) ); ?></code><br />
				<?php endif; ?>
				<?php if ( ! empty( $identity['wp_user_id'] ) ) : ?>
					<span class="bap-muted"><?php esc_html_e( 'کاربر', 'bahoosh-analytics-pro' ); ?></span>
					<?php echo esc_html( (string) (int) $identity['wp_user_id'] ); ?><br />
				<?php endif; ?>
				<?php if ( '' !== $view_id ) : ?>
					<span class="bap-muted"><?php esc_html_e( 'نمایش', 'bahoosh-analytics-pro' ); ?></span>
					<code class="bap-id"><?php echo esc_html( BAP_Debug_Log::mask( $view_id ) ); ?></code>
				<?php endif; ?>
			</td>
			<td class="bap-url">
				<?php echo esc_html( isset( $page['url'] ) ? $page['url'] : '—' ); ?>
			</td>
			<td>
				<span class="bap-badge <?php echo esc_attr( self::status_class( $row['status'] ) ); ?>">
					<?php echo esc_html( self::status_label( $row['status'] ) ); ?>
				</span>
				<?php if ( (int) $row['attempts'] > 0 ) : ?>
					<br /><span class="bap-muted">
						<?php
						printf(
							/* translators: %d: number of delivery attempts. */
							esc_html( _n( '%d تلاش', '%d تلاش', (int) $row['attempts'], 'bahoosh-analytics-pro' ) ),
							(int) $row['attempts']
						);
						?>
					</span>
				<?php endif; ?>
				<?php if ( ! empty( $row['last_error'] ) ) : ?>
					<br /><span class="bap-error"><?php echo esc_html( $row['last_error'] ); ?></span>
				<?php endif; ?>
			</td>
		</tr>
		<tr class="bap-payload-row">
			<td colspan="5">
				<details id="<?php echo esc_attr( $row_id ); ?>">
					<summary><?php esc_html_e( 'داده کامل', 'bahoosh-analytics-pro' ); ?></summary>
					<pre class="bap-code"><code>
					<?php
						echo esc_html( wp_json_encode( $payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) );
					?>
					</code></pre>
				</details>
			</td>
		</tr>
		<?php
	}

	/**
	 * Reads and validates the filter inputs.
	 *
	 * @return array
	 */
	private static function read_filters() {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only filtering.
		$status = isset( $_GET['status'] ) ? sanitize_key( wp_unslash( $_GET['status'] ) ) : '';
		$type   = isset( $_GET['event_type'] ) ? sanitize_text_field( wp_unslash( $_GET['event_type'] ) ) : '';
		$since  = isset( $_GET['since'] ) ? sanitize_text_field( wp_unslash( $_GET['since'] ) ) : '';
		$paged  = isset( $_GET['paged'] ) ? max( 1, (int) $_GET['paged'] ) : 1;
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		if ( ! array_key_exists( $status, self::statuses() ) ) {
			$status = '';
		}
		if ( '' !== $type && ! BAP_Event_Validator::is_allowed_type( $type ) ) {
			$type = '';
		}
		$since_date = BAP_Reports::sanitize_date( $since );

		return array(
			'status'     => $status,
			'event_type' => $type,
			'since'      => '' !== $since_date ? $since_date . ' 00:00:00' : '',
			'since_date' => $since_date,
			'limit'      => self::PER_PAGE,
			'offset'     => ( $paged - 1 ) * self::PER_PAGE,
		);
	}

	/**
	 * Delivery statuses and their labels.
	 *
	 * @return array<string,string>
	 */
	private static function statuses() {
		return array(
			BAP_Outbox::STATUS_PENDING => __( 'در انتظار', 'bahoosh-analytics-pro' ),
			BAP_Outbox::STATUS_SENDING => __( 'در حال ارسال', 'bahoosh-analytics-pro' ),
			BAP_Outbox::STATUS_DONE    => __( 'تأییدشده', 'bahoosh-analytics-pro' ),
			BAP_Outbox::STATUS_FAILED  => __( 'ناموفق', 'bahoosh-analytics-pro' ),
		);
	}

	/**
	 * Label for a status.
	 *
	 * @param string $status Status.
	 * @return string
	 */
	private static function status_label( $status ) {
		$statuses = self::statuses();
		return isset( $statuses[ $status ] ) ? $statuses[ $status ] : $status;
	}

	/**
	 * CSS modifier for a status badge.
	 *
	 * @param string $status Status.
	 * @return string
	 */
	private static function status_class( $status ) {
		switch ( $status ) {
			case BAP_Outbox::STATUS_DONE:
				return 'is-good';
			case BAP_Outbox::STATUS_FAILED:
				return 'is-critical';
			case BAP_Outbox::STATUS_SENDING:
				return 'is-recommended';
			default:
				return '';
		}
	}

	/**
	 * Formats a stored UTC timestamp in the site's timezone.
	 *
	 * @param string $mysql_utc Datetime string.
	 * @return string
	 */
	private static function format_time( $mysql_utc ) {
		if ( empty( $mysql_utc ) ) {
			return '—';
		}
		$timestamp = strtotime( $mysql_utc . ' UTC' );
		if ( ! $timestamp ) {
			return $mysql_utc;
		}
		return wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $timestamp );
	}

	// ---------- Queue tab ----------

	/**
	 * Renders the browser queue shell.
	 *
	 * Everything below is filled in by `queue-inspector.js`, which reads the
	 * visitor's own IndexedDB. PHP contributes no numbers here because PHP has
	 * none to contribute.
	 *
	 * @return void
	 */
	private static function render_queue_tab() {
		?>
		<p class="description">
			<?php
			esc_html_e(
				'صف رهگیری در همین مرورگر قرار دارد، نه روی سرور. این اعداد مستقیماً از فضای ذخیره همین مرورگر خوانده می‌شوند و فقط وضعیت مرورگر شما را نشان می‌دهند.',
				'bahoosh-analytics-pro'
			);
			?>
		</p>

		<div id="bap-queue-inspector" data-bap-queue-inspector>
			<p class="bap-muted" data-queue-loading>
				<?php esc_html_e( 'در حال خواندن صف محلی…', 'bahoosh-analytics-pro' ); ?>
			</p>

			<div class="bap-grid" data-queue-summary hidden>
				<div class="bap-card"><h3><?php esc_html_e( 'در انتظار', 'bahoosh-analytics-pro' ); ?></h3><div class="bap-value" data-count="pending">0</div></div>
				<div class="bap-card"><h3><?php esc_html_e( 'در حال ارسال', 'bahoosh-analytics-pro' ); ?></h3><div class="bap-value" data-count="sending">0</div></div>
				<div class="bap-card"><h3><?php esc_html_e( 'ناموفق', 'bahoosh-analytics-pro' ); ?></h3><div class="bap-value" data-count="failed">0</div></div>
				<div class="bap-card"><h3><?php esc_html_e( 'کل در صف', 'bahoosh-analytics-pro' ); ?></h3><div class="bap-value" data-count="total">0</div></div>
			</div>

			<table class="widefat striped" data-queue-details hidden>
				<caption class="screen-reader-text"><?php esc_html_e( 'جزئیات صف محلی', 'bahoosh-analytics-pro' ); ?></caption>
				<tbody>
					<tr><th scope="row"><?php esc_html_e( 'موتور ذخیره‌سازی', 'bahoosh-analytics-pro' ); ?></th><td data-field="driver">—</td></tr>
					<tr><th scope="row"><?php esc_html_e( 'قدیمی‌ترین رویداد صف', 'bahoosh-analytics-pro' ); ?></th><td data-field="oldest">—</td></tr>
					<tr><th scope="row"><?php esc_html_e( 'آخرین ارسال موفق', 'bahoosh-analytics-pro' ); ?></th><td data-field="last_success">—</td></tr>
					<tr><th scope="row"><?php esc_html_e( 'آخرین ارسال ناموفق', 'bahoosh-analytics-pro' ); ?></th><td data-field="last_failure">—</td></tr>
					<tr><th scope="row"><?php esc_html_e( 'آخرین خطا', 'bahoosh-analytics-pro' ); ?></th><td data-field="last_error">—</td></tr>
					<tr><th scope="row"><?php esc_html_e( 'شبکه', 'bahoosh-analytics-pro' ); ?></th><td data-field="online">—</td></tr>
					<tr><th scope="row"><?php esc_html_e( 'هویت ناشناس', 'bahoosh-analytics-pro' ); ?></th><td data-field="anonymous_id">—</td></tr>
					<tr><th scope="row"><?php esc_html_e( 'بازدید صفحه', 'bahoosh-analytics-pro' ); ?></th><td data-field="page_view_id">—</td></tr>
					<tr><th scope="row"><?php esc_html_e( 'رضایت', 'bahoosh-analytics-pro' ); ?></th><td data-field="consent">—</td></tr>
					<tr><th scope="row"><?php esc_html_e( 'فضای ذخیره مرورگر', 'bahoosh-analytics-pro' ); ?></th><td data-field="storage">—</td></tr>
				</tbody>
			</table>

			<h2><?php esc_html_e( 'عملیات صف', 'bahoosh-analytics-pro' ); ?></h2>
			<p class="description">
				<?php esc_html_e( 'این عملیات فقط روی همین مرورگر اثر دارند. رویدادهای در انتظار فقط پس از ارسال موفق یا پاک‌کردن صریح حذف می‌شوند.', 'bahoosh-analytics-pro' ); ?>
			</p>
			<p>
				<button type="button" class="button" data-queue-action="refresh"><?php esc_html_e( 'به‌روزرسانی', 'bahoosh-analytics-pro' ); ?></button>
				<button type="button" class="button" data-queue-action="flush"><?php esc_html_e( 'ارسال فوری صف', 'bahoosh-analytics-pro' ); ?></button>
				<button type="button" class="button" data-queue-action="retry"><?php esc_html_e( 'ارسال مجدد رویدادهای ناموفق', 'bahoosh-analytics-pro' ); ?></button>
				<button type="button" class="button" data-queue-action="clear-failed"><?php esc_html_e( 'پاک‌کردن رویدادهای ناموفق', 'bahoosh-analytics-pro' ); ?></button>
				<button type="button" class="button button-link-delete" data-queue-action="clear-all"><?php esc_html_e( 'پاک‌کردن تمام داده‌های محلی تحلیل', 'bahoosh-analytics-pro' ); ?></button>
			</p>
			<p class="bap-status" data-queue-status role="status" aria-live="polite"></p>

			<h2><?php esc_html_e( 'رویدادهای در صف', 'bahoosh-analytics-pro' ); ?></h2>
			<table class="widefat striped">
				<caption class="screen-reader-text"><?php esc_html_e( 'رویدادهای در انتظار این مرورگر', 'bahoosh-analytics-pro' ); ?></caption>
				<thead>
					<tr>
						<th scope="col"><?php esc_html_e( 'رویداد', 'bahoosh-analytics-pro' ); ?></th>
						<th scope="col"><?php esc_html_e( 'وضعیت', 'bahoosh-analytics-pro' ); ?></th>
						<th scope="col"><?php esc_html_e( 'تلاش‌ها', 'bahoosh-analytics-pro' ); ?></th>
						<th scope="col"><?php esc_html_e( 'در صف', 'bahoosh-analytics-pro' ); ?></th>
						<th scope="col"><?php esc_html_e( 'آخرین خطا', 'bahoosh-analytics-pro' ); ?></th>
					</tr>
				</thead>
				<tbody data-queue-rows>
					<tr><td colspan="5" class="bap-muted"><?php esc_html_e( 'صف خالی است.', 'bahoosh-analytics-pro' ); ?></td></tr>
				</tbody>
			</table>
		</div>
		<?php
	}

	// ---------- Debug log tab ----------

	/**
	 * Renders the debug log.
	 *
	 * @return void
	 */
	private static function render_log_tab() {
		$enabled = BAP_Debug_Log::enabled();
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only filtering.
		$channel = isset( $_GET['channel'] ) ? sanitize_key( wp_unslash( $_GET['channel'] ) ) : '';
		$entries = BAP_Debug_Log::recent( $channel, 200 );
		?>
		<?php if ( ! $enabled ) : ?>
			<div class="notice notice-info inline">
				<p>
					<?php esc_html_e( 'حالت دیباگ خاموش است و مورد جدیدی ثبت نمی‌شود.', 'bahoosh-analytics-pro' ); ?>
					<a href="<?php echo esc_url( admin_url( 'admin.php?page=' . BAP_Admin::SETTINGS_SLUG ) ); ?>">
						<?php esc_html_e( 'آن را در تنظیمات فعال کنید', 'bahoosh-analytics-pro' ); ?>
					</a>
				</p>
			</div>
		<?php endif; ?>

		<p class="description">
			<?php
			printf(
				/* translators: 1: entry count, 2: maximum entries, 3: approximate size. */
				esc_html__( '%1$d از حداکثر %2$d ورودی، حدود %3$s. اطلاعات محرمانه حذف شده‌اند و این گزارش برای ارسال به پشتیبانی امن است.', 'bahoosh-analytics-pro' ),
				count( BAP_Debug_Log::all() ),
				(int) BAP_Debug_Log::MAX_ENTRIES,
				esc_html( size_format( BAP_Debug_Log::size() ) )
			);
			?>
		</p>

		<form method="get" class="bap-filters">
			<input type="hidden" name="page" value="<?php echo esc_attr( BAP_Admin::INSPECTOR_SLUG ); ?>" />
			<input type="hidden" name="tab" value="log" />
			<label for="bap-log-channel" class="screen-reader-text"><?php esc_html_e( 'فیلتر بر اساس کانال', 'bahoosh-analytics-pro' ); ?></label>
			<select id="bap-log-channel" name="channel">
				<option value=""><?php esc_html_e( 'همه کانال‌ها', 'bahoosh-analytics-pro' ); ?></option>
				<?php foreach ( BAP_Debug_Log::channels() as $name ) : ?>
					<option value="<?php echo esc_attr( $name ); ?>" <?php selected( $channel, $name ); ?>>
						<?php echo esc_html( $name ); ?>
					</option>
				<?php endforeach; ?>
			</select>
			<?php submit_button( __( 'فیلتر', 'bahoosh-analytics-pro' ), 'secondary', 'submit', false ); ?>
		</form>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"
			onsubmit="return confirm('<?php echo esc_js( __( 'همه ورودی‌های گزارش دیباگ حذف شوند؟', 'bahoosh-analytics-pro' ) ); ?>');">
			<input type="hidden" name="action" value="bap_clear_debug_log" />
			<?php wp_nonce_field( self::NONCE_ACTION, self::NONCE_FIELD ); ?>
			<?php submit_button( __( 'پاک‌کردن گزارش دیباگ', 'bahoosh-analytics-pro' ), 'secondary', 'submit', false ); ?>
		</form>

		<?php if ( empty( $entries ) ) : ?>
			<p class="bap-muted"><?php esc_html_e( 'گزارشی وجود ندارد.', 'bahoosh-analytics-pro' ); ?></p>
			<?php return; ?>
		<?php endif; ?>

		<table class="widefat striped bap-log">
			<caption class="screen-reader-text"><?php esc_html_e( 'ورودی‌های گزارش دیباگ', 'bahoosh-analytics-pro' ); ?></caption>
			<thead>
				<tr>
					<th scope="col"><?php esc_html_e( 'زمان', 'bahoosh-analytics-pro' ); ?></th>
					<th scope="col"><?php esc_html_e( 'کانال', 'bahoosh-analytics-pro' ); ?></th>
					<th scope="col"><?php esc_html_e( 'پیام', 'bahoosh-analytics-pro' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $entries as $entry ) : ?>
					<tr>
						<td><?php echo esc_html( wp_date( 'H:i:s', (int) $entry['at'] ) ); ?></td>
						<td><code><?php echo esc_html( $entry['channel'] ); ?></code></td>
						<td>
							<?php echo esc_html( $entry['message'] ); ?>
							<?php if ( ! empty( $entry['context'] ) ) : ?>
								<details>
									<summary><?php esc_html_e( 'زمینه', 'bahoosh-analytics-pro' ); ?></summary>
									<pre class="bap-code"><code>
									<?php
										echo esc_html( wp_json_encode( $entry['context'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) );
									?>
									</code></pre>
								</details>
							<?php endif; ?>
						</td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
		<?php
	}

	/**
	 * Empties the debug log.
	 *
	 * @return void
	 */
	public static function handle_clear_debug_log() {
		if ( ! current_user_can( BAP_Admin::settings_capability() ) ) {
			wp_die( esc_html__( 'اجازه انجام این عملیات را ندارید.', 'bahoosh-analytics-pro' ) );
		}

		check_admin_referer( self::NONCE_ACTION, self::NONCE_FIELD );
		BAP_Debug_Log::clear();

		wp_safe_redirect( self::tab_url( 'log' ) );
		exit;
	}
}
