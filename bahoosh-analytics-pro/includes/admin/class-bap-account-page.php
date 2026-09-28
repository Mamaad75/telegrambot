<?php
/** License, subscription and release channel UI. @package Bahoosh_Analytics_Pro */

defined( 'ABSPATH' ) || exit;

class BAP_Account_Page {

	const SLUG = 'bahoosh-analytics-account';

	/** @return void */
	public static function init() {
		foreach ( array( 'activate', 'deactivate', 'validate', 'channel' ) as $action ) {
			add_action( 'admin_post_bap_license_' . $action, array( __CLASS__, 'handle_' . $action ) );
		}
	}

	/** @return void */
	public static function render() {
		if ( ! current_user_can( BAP_Admin::settings_capability() ) ) {
			wp_die( esc_html__( 'اجازه مشاهده این صفحه را ندارید.', 'bahoosh-analytics-pro' ) );
		}
		$snapshot = BAP_License_Manager::snapshot();
		$update   = BAP_License_Manager::update_info();
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display-only notice.
		$notice = isset( $_GET['bap_notice'] ) ? sanitize_text_field( wp_unslash( $_GET['bap_notice'] ) ) : '';
		$states = array(
			'active'             => __( 'فعال', 'bahoosh-analytics-pro' ),
			'inactive'           => __( 'غیرفعال', 'bahoosh-analytics-pro' ),
			'expired'            => __( 'منقضی', 'bahoosh-analytics-pro' ),
			'suspended'          => __( 'تعلیق‌شده', 'bahoosh-analytics-pro' ),
			'invalid'            => __( 'نامعتبر', 'bahoosh-analytics-pro' ),
			'site_limit_reached' => __( 'سقف سایت‌ها پر شده', 'bahoosh-analytics-pro' ),
			'grace_period'       => __( 'مهلت آفلاین', 'bahoosh-analytics-pro' ),
			'unknown'            => __( 'نامشخص', 'bahoosh-analytics-pro' ),
		);
		$status = (string) $snapshot['status'];
		?>
		<div class="wrap bap-wrap bap-account" data-bap-screen="account">
			<?php BAP_Admin::render_page_header(
				__( 'اشتراک و انتشار', 'bahoosh-analytics-pro' ),
				__( 'لایسنس، پلن، دسترسی قابلیت‌ها و آپدیت امن افزونه را از یک جا مدیریت کنید.', 'bahoosh-analytics-pro' ),
				self::SLUG,
				__( 'سرویس ابری باهوش', 'bahoosh-analytics-pro' )
			); ?>

			<?php if ( '' !== $notice ) : ?>
				<div class="bap-toast bap-toast--info"><span class="dashicons dashicons-info-outline"></span><p><?php echo esc_html( $notice ); ?></p></div>
			<?php endif; ?>

			<div class="bap-account-hero">
				<div class="bap-account-hero__copy">
					<span class="bap-eyebrow"><?php esc_html_e( 'وضعیت حساب', 'bahoosh-analytics-pro' ); ?></span>
					<h2><?php echo esc_html( $states[ $status ] ?? $status ); ?></h2>
					<p><?php esc_html_e( 'قطعی موقت سرویس لایسنس، جمع‌آوری داده و داشبورد موجود را از کار نمی‌اندازد.', 'bahoosh-analytics-pro' ); ?></p>
				</div>
				<div class="bap-license-orbit" aria-hidden="true"><span></span><strong><?php echo esc_html( strtoupper( (string) $snapshot['plan'] ) ); ?></strong></div>
			</div>

			<div class="bap-kpi-grid bap-kpi-grid--compact">
				<?php self::stat_card( __( 'پلن', 'bahoosh-analytics-pro' ), $snapshot['plan'] ?: '—', 'dashicons-awards' ); ?>
				<?php self::stat_card( __( 'سایت متصل', 'bahoosh-analytics-pro' ), wp_parse_url( home_url(), PHP_URL_HOST ) ?: home_url(), 'dashicons-admin-site-alt3' ); ?>
				<?php self::stat_card( __( 'انقضا', 'bahoosh-analytics-pro' ), $snapshot['expires_at'] ? wp_date( 'Y/m/d', strtotime( $snapshot['expires_at'] ) ) : '—', 'dashicons-calendar-alt' ); ?>
				<?php self::stat_card( __( 'نسخه نصب‌شده', 'bahoosh-analytics-pro' ), 'v' . BAP_VERSION, 'dashicons-update' ); ?>
			</div>

			<div class="bap-layout-2 bap-layout-2--account">
				<section class="bap-section bap-section--elevated">
					<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'لایسنس', 'bahoosh-analytics-pro' ); ?></span><h2><?php esc_html_e( 'فعال‌سازی و اعتبارسنجی', 'bahoosh-analytics-pro' ); ?></h2></div><span class="bap-status-chip bap-status-chip--<?php echo esc_attr( self::status_class( $status ) ); ?>"><?php echo esc_html( $states[ $status ] ?? $status ); ?></span></div>
					<dl class="bap-detail-list">
						<div><dt><?php esc_html_e( 'آخرین اعتبارسنجی موفق', 'bahoosh-analytics-pro' ); ?></dt><dd><?php echo esc_html( self::date_or_dash( $snapshot['last_successful_validation'] ) ); ?></dd></div>
						<div><dt><?php esc_html_e( 'آخرین تلاش', 'bahoosh-analytics-pro' ); ?></dt><dd><?php echo esc_html( self::date_or_dash( $snapshot['last_attempt'] ) ); ?></dd></div>
						<div><dt><?php esc_html_e( 'کانال انتشار', 'bahoosh-analytics-pro' ); ?></dt><dd><?php echo esc_html( BAP_License_Manager::release_channel() ); ?></dd></div>
						<div><dt><?php esc_html_e( 'سرویس تجاری', 'bahoosh-analytics-pro' ); ?></dt><dd><?php echo BAP_License_Manager::api_base() ? esc_html__( 'پیکربندی شده', 'bahoosh-analytics-pro' ) : esc_html__( 'نیازمند پیکربندی نسخه', 'bahoosh-analytics-pro' ); ?></dd></div>
					</dl>
					<?php if ( ! empty( $snapshot['last_error'] ) ) : ?><div class="bap-inline-alert bap-inline-alert--warning"><?php echo esc_html( $snapshot['last_error'] ); ?></div><?php endif; ?>

					<?php if ( ! BAP_License_Manager::has_license_key() ) : ?>
					<form class="bap-form-stack" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
						<?php wp_nonce_field( 'bap_license_activate' ); ?>
						<input type="hidden" name="action" value="bap_license_activate">
						<label><span><?php esc_html_e( 'کلید لایسنس', 'bahoosh-analytics-pro' ); ?></span><input type="password" name="license_key" autocomplete="off" required placeholder="BAP-••••-••••-••••"></label>
						<button class="button button-primary bap-primary"><?php esc_html_e( 'فعال‌سازی روی این سایت', 'bahoosh-analytics-pro' ); ?></button>
					</form>
					<?php else : ?>
					<div class="bap-inline-actions">
						<?php self::simple_form( 'validate', __( 'اعتبارسنجی الآن', 'bahoosh-analytics-pro' ), 'button button-primary bap-primary' ); ?>
						<?php self::simple_form( 'deactivate', __( 'غیرفعال‌سازی لایسنس', 'bahoosh-analytics-pro' ), 'button', true ); ?>
					</div>
					<?php endif; ?>
				</section>

				<section class="bap-section bap-section--elevated">
					<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'به‌روزرسانی', 'bahoosh-analytics-pro' ); ?></span><h2><?php esc_html_e( 'انتشار و سازگاری', 'bahoosh-analytics-pro' ); ?></h2></div></div>
					<?php if ( is_wp_error( $update ) ) : ?>
						<div class="bap-empty-mini"><span class="dashicons dashicons-cloud-saved"></span><p><?php echo esc_html( $update->get_error_message() ); ?></p></div>
					<?php else : ?>
						<div class="bap-release-card">
							<div><span><?php esc_html_e( 'نسخه منتشرشده', 'bahoosh-analytics-pro' ); ?></span><strong><?php echo esc_html( $update['version'] ?: BAP_VERSION ); ?></strong></div>
							<div><span><?php esc_html_e( 'نسخه قرارداد API', 'bahoosh-analytics-pro' ); ?></span><strong><?php echo esc_html( $update['api_contract'] ?: BAP_API_CONTRACT ); ?></strong></div>
							<div><span><?php esc_html_e( 'حداقل PHP', 'bahoosh-analytics-pro' ); ?></span><strong><?php echo esc_html( $update['requires_php'] ?: '—' ); ?></strong></div>
							<div><span><?php esc_html_e( 'حداقل WordPress', 'bahoosh-analytics-pro' ); ?></span><strong><?php echo esc_html( $update['requires_wordpress'] ?: '—' ); ?></strong></div>
							<div><span><?php esc_html_e( 'حداقل نسخه سرور', 'bahoosh-analytics-pro' ); ?></span><strong><?php echo esc_html( $update['minimum_backend_version'] ?: '—' ); ?></strong></div>
							<div><span><?php esc_html_e( 'کانال پاسخ', 'bahoosh-analytics-pro' ); ?></span><strong><?php echo esc_html( $update['release_channel'] ?: BAP_License_Manager::release_channel() ); ?></strong></div>
						</div>
						<?php if ( $update['version'] && version_compare( $update['version'], BAP_VERSION, '>' ) ) : ?><p class="bap-positive-copy"><?php esc_html_e( 'نسخه جدید را از صفحه افزونه‌های وردپرس با دکمه «به‌روزرسانی» نصب کنید.', 'bahoosh-analytics-pro' ); ?></p><?php else : ?><p class="bap-muted"><?php esc_html_e( 'این نصب روی آخرین نسخه شناخته‌شده است.', 'bahoosh-analytics-pro' ); ?></p><?php endif; ?>
					<?php endif; ?>

					<form class="bap-channel-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
						<?php wp_nonce_field( 'bap_license_channel' ); ?><input type="hidden" name="action" value="bap_license_channel">
						<label for="bap-release-channel"><?php esc_html_e( 'کانال انتشار', 'bahoosh-analytics-pro' ); ?></label>
						<select id="bap-release-channel" name="channel"><option value="stable" <?php selected( 'stable', BAP_License_Manager::release_channel() ); ?>>Stable</option><option value="beta" <?php selected( 'beta', BAP_License_Manager::release_channel() ); ?>>Beta</option></select>
						<button class="button"><?php esc_html_e( 'ذخیره', 'bahoosh-analytics-pro' ); ?></button>
					</form>
				</section>
			</div>

			<section class="bap-section bap-section--elevated">
				<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'دسترسی‌ها', 'bahoosh-analytics-pro' ); ?></span><h2><?php esc_html_e( 'قابلیت‌های این اشتراک', 'bahoosh-analytics-pro' ); ?></h2></div></div>
				<div class="bap-entitlement-grid">
					<?php $ents = (array) $snapshot['entitlements']; if ( ! $ents ) : ?><div class="bap-empty-mini"><?php esc_html_e( 'بعد از فعال‌سازی، دسترسی قابلیت‌های پلن در اینجا نمایش داده می‌شود.', 'bahoosh-analytics-pro' ); ?></div><?php else : foreach ( $ents as $key => $enabled ) : ?>
						<div class="bap-entitlement <?php echo $enabled ? 'is-on' : 'is-off'; ?>"><span class="dashicons <?php echo $enabled ? 'dashicons-yes-alt' : 'dashicons-minus'; ?>"></span><code><?php echo esc_html( $key ); ?></code><strong><?php echo $enabled ? esc_html__( 'فعال', 'bahoosh-analytics-pro' ) : esc_html__( 'غیرفعال', 'bahoosh-analytics-pro' ); ?></strong></div>
					<?php endforeach; endif; ?>
				</div>
			</section>

			<section class="bap-section bap-section--elevated bap-rollout-section">
				<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'انتشار تدریجی', 'bahoosh-analytics-pro' ); ?></span><h2><?php esc_html_e( 'قابلیت‌های آزمایشی', 'bahoosh-analytics-pro' ); ?></h2><p><?php esc_html_e( 'این گزینه‌ها از پلن و دسترسی‌های اشتراک جدا هستند و برای انتشار تدریجی قابلیت‌های تازه به کار می‌روند.', 'bahoosh-analytics-pro' ); ?></p></div></div>
				<div class="bap-entitlement-grid">
					<?php $flags = BAP_Feature_Flags::all(); if ( ! $flags ) : ?><div class="bap-empty-mini"><span class="dashicons dashicons-controls-repeat"></span><?php esc_html_e( 'در حال حاضر قابلیت آزمایشی فعالی برای این نصب ثبت نشده است.', 'bahoosh-analytics-pro' ); ?></div><?php else : foreach ( $flags as $key => $enabled ) : ?>
						<div class="bap-entitlement <?php echo $enabled ? 'is-on' : 'is-off'; ?>"><span class="dashicons <?php echo $enabled ? 'dashicons-controls-repeat' : 'dashicons-hidden'; ?>"></span><code><?php echo esc_html( $key ); ?></code><strong><?php echo $enabled ? esc_html__( 'انتشار', 'bahoosh-analytics-pro' ) : esc_html__( 'خاموش', 'bahoosh-analytics-pro' ); ?></strong></div>
					<?php endforeach; endif; ?>
				</div>
			</section>
		</div>
		<?php
	}

	private static function stat_card( $label, $value, $icon ) {
		?><div class="bap-kpi-card"><div class="bap-kpi-card__icon"><span class="dashicons <?php echo esc_attr( $icon ); ?>"></span></div><div><span><?php echo esc_html( $label ); ?></span><strong><?php echo esc_html( $value ); ?></strong></div></div><?php
	}

	private static function status_class( $status ) {
		if ( 'active' === $status ) { return 'success'; }
		if ( 'grace_period' === $status || 'unknown' === $status ) { return 'warning'; }
		return 'danger';
	}

	private static function date_or_dash( $value ) {
		$ts = $value ? strtotime( (string) $value ) : false;
		return $ts ? wp_date( 'Y/m/d H:i', $ts ) : '—';
	}

	private static function simple_form( $action, $label, $class, $confirm = false ) {
		?><form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="bap-inline-form"><?php wp_nonce_field( 'bap_license_' . $action ); ?><input type="hidden" name="action" value="bap_license_<?php echo esc_attr( $action ); ?>"><button class="<?php echo esc_attr( $class ); ?>" <?php echo $confirm ? 'onclick="return confirm(\'' . esc_js( __( 'لایسنس این سایت غیرفعال شود؟', 'bahoosh-analytics-pro' ) ) . '\')"' : ''; ?>><?php echo esc_html( $label ); ?></button></form><?php
	}

	private static function guard( $nonce ) {
		if ( ! current_user_can( BAP_Admin::settings_capability() ) ) { wp_die( esc_html__( 'اجازه این کار را ندارید.', 'bahoosh-analytics-pro' ), '', array( 'response' => 403 ) ); }
		check_admin_referer( $nonce );
	}

	private static function back( $message ) {
		wp_safe_redirect( add_query_arg( 'bap_notice', rawurlencode( $message ), admin_url( 'admin.php?page=' . self::SLUG ) ) );
		exit;
	}

	public static function handle_activate() {
		self::guard( 'bap_license_activate' );
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- verified above.
		$key = isset( $_POST['license_key'] ) ? sanitize_text_field( wp_unslash( $_POST['license_key'] ) ) : '';
		$result = BAP_License_Manager::activate( $key );
		self::back( is_wp_error( $result ) ? $result->get_error_message() : __( 'لایسنس فعال شد.', 'bahoosh-analytics-pro' ) );
	}
	public static function handle_deactivate() { self::guard( 'bap_license_deactivate' ); $r = BAP_License_Manager::deactivate(); self::back( is_wp_error( $r ) ? $r->get_error_message() : __( 'لایسنس غیرفعال شد.', 'bahoosh-analytics-pro' ) ); }
	public static function handle_validate() { self::guard( 'bap_license_validate' ); $r = BAP_License_Manager::validate( true ); self::back( is_wp_error( $r ) ? $r->get_error_message() : __( 'وضعیت لایسنس به‌روزرسانی شد.', 'bahoosh-analytics-pro' ) ); }
	public static function handle_channel() { self::guard( 'bap_license_channel' ); /* phpcs:ignore WordPress.Security.NonceVerification.Missing */ $c = isset( $_POST['channel'] ) ? sanitize_key( wp_unslash( $_POST['channel'] ) ) : 'stable'; BAP_License_Manager::set_release_channel( $c ); self::back( __( 'کانال انتشار ذخیره شد.', 'bahoosh-analytics-pro' ) ); }
}
