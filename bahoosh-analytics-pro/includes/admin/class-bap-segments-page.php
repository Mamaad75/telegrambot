<?php
/**
 * Customer Segments & AI Actions screen.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Shows what the ML service found (segments, predictions, insights, timing),
 * every action it proposed with the policy decision, and the buttons that turn
 * a proposal into a change: approve, reject, roll back. Also where the shop
 * owner sets the policy and connects the service.
 *
 * All state-changing buttons are admin-post forms with nonces and capability
 * checks; nothing here is reachable without a logged-in, authorised user.
 *
 * @since 4.8.0
 */
class BAP_Segments_Page {

	const SLUG = 'bahoosh-analytics-segments';

	/**
	 * Hooks.
	 *
	 * @return void
	 */
	public static function init() {
		foreach ( array( 'save_policy', 'rotate_secret', 'download_bundle', 'decide', 'manual_coupon', 'manual_campaign' ) as $handler ) {
			add_action( 'admin_post_bap_ml_' . $handler, array( __CLASS__, 'handle_' . $handler ) );
		}
	}

	/**
	 * Status labels.
	 *
	 * @return array
	 */
	private static function status_labels() {
		return array(
			'pending_approval'    => __( 'در انتظار تأیید', 'bahoosh-analytics-pro' ),
			'auto_approved'       => __( 'تأیید خودکار (در صف اجرا)', 'bahoosh-analytics-pro' ),
			'approved'            => __( 'تأییدشده', 'bahoosh-analytics-pro' ),
			'executing'           => __( 'در حال اجرا', 'bahoosh-analytics-pro' ),
			'executed'            => __( 'اجراشده', 'bahoosh-analytics-pro' ),
			'scheduled'           => __( 'زمان‌بندی‌شده', 'bahoosh-analytics-pro' ),
			'sending'             => __( 'در حال ارسال', 'bahoosh-analytics-pro' ),
			'failed'              => __( 'ناموفق', 'bahoosh-analytics-pro' ),
			'rejected'            => __( 'ردشده', 'bahoosh-analytics-pro' ),
			'rejected_by_policy'  => __( 'رد توسط سیاست فروشگاه', 'bahoosh-analytics-pro' ),
			'recommendation_only' => __( 'فقط پیشنهاد', 'bahoosh-analytics-pro' ),
			'rolled_back'         => __( 'بازگردانده‌شده', 'bahoosh-analytics-pro' ),
		);
	}

	/**
	 * Action type labels.
	 *
	 * @return array
	 */
	private static function type_labels() {
		return array(
			'create_customer_segment'   => __( 'ثبت بخش مشتری', 'bahoosh-analytics-pro' ),
			'create_coupon_for_segment' => __( 'کد تخفیف برای بخش', 'bahoosh-analytics-pro' ),
			'create_product_coupon'     => __( 'کد تخفیف محصول', 'bahoosh-analytics-pro' ),
			'update_sale_price'         => __( 'تغییر قیمت فروش ویژه', 'bahoosh-analytics-pro' ),
			'recommend_price_change'    => __( 'پیشنهاد تغییر قیمت', 'bahoosh-analytics-pro' ),
			'create_campaign'           => __( 'ساخت کمپین', 'bahoosh-analytics-pro' ),
			'schedule_campaign'         => __( 'زمان‌بندی کمپین', 'bahoosh-analytics-pro' ),
			'send_campaign'             => __( 'ارسال کمپین', 'bahoosh-analytics-pro' ),
		);
	}

	/**
	 * Formats a probability.
	 *
	 * @param mixed $p Value.
	 * @return string
	 */
	private static function pct( $p ) {
		return is_numeric( $p ) ? number_format_i18n( 100 * (float) $p, 0 ) . '٪' : '—';
	}

	/**
	 * Renders the screen.
	 *
	 * @return void
	 */
	public static function render() {
		if ( ! BAP_Entitlements::can( 'revenue_intelligence' ) ) {
			wp_die( esc_html__( 'هوش مشتریان در پلن فعلی فعال نیست.', 'bahoosh-analytics-pro' ) );
		}
		if ( ! current_user_can( BAP_Admin::reports_capability() ) ) {
			wp_die( esc_html__( 'اجازه مشاهده این صفحه را ندارید.', 'bahoosh-analytics-pro' ) );
		}
		$policy   = BAP_ML_Policy::get();
		$segments = BAP_ML_Store::segments();
		$insights = (array) get_option( 'bap_ml_insights', array() );
		$actions  = BAP_ML_Store::actions( array( 'limit' => 100 ) );
		$results  = BAP_ML_Store::latest_results( wp_list_pluck( $actions, 'action_id' ) );
		$types    = self::type_labels();
		$statuses = self::status_labels();
		$can_edit = current_user_can( BAP_Admin::settings_capability() );
		$currency = function_exists( 'get_woocommerce_currency_symbol' ) ? get_woocommerce_currency_symbol() : '';
		$post_url = admin_url( 'admin-post.php' );
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only.
		$notice = isset( $_GET['bap_notice'] ) ? sanitize_text_field( wp_unslash( $_GET['bap_notice'] ) ) : '';
		$total_customers = 0;
		$total_revenue = 0.0;
		$weighted_churn = 0.0;
		foreach ( $segments as $segment ) {
			$count = (int) ( $segment['customer_count'] ?? 0 );
			$total_customers += $count;
			$total_revenue += (float) ( $segment['total_revenue'] ?? 0 );
			if ( is_numeric( $segment['avg_churn_probability'] ?? null ) ) {
				$weighted_churn += $count * (float) $segment['avg_churn_probability'];
			}
		}
		$avg_churn = $total_customers ? $weighted_churn / $total_customers : null;
		$pending_actions = count( array_filter( $actions, static function ( $action ) { return in_array( (string) ( $action['status'] ?? '' ), array( 'needs_approval', 'approved', 'scheduled' ), true ); } ) );
		?>
		<div class="wrap bap-wrap bap-studio" data-bap-screen="segments">
			<?php
			BAP_Admin::render_page_header(
				__( 'بخش‌بندی مشتریان و اقدام‌های هوشمند', 'bahoosh-analytics-pro' ),
				__( 'مدل‌های یادگیری ماشین مشتریان را از روی سفارش‌های واقعی بخش‌بندی می‌کنند، احتمال خرید مجدد را تخمین می‌زنند و اقدام پیشنهاد می‌دهند. هیچ اقدامی بدون عبور از سیاست فروشگاه اجرا نمی‌شود.', 'bahoosh-analytics-pro' ),
				self::SLUG
			);
			?>
			<?php if ( '' !== $notice ) : ?>
				<div class="notice notice-info"><p><?php echo esc_html( $notice ); ?></p></div>
			<?php endif; ?>

			<div class="bap-kpi-grid bap-customer-kpis">
				<div class="bap-kpi-card"><div class="bap-kpi-card__icon"><span class="dashicons dashicons-groups"></span></div><div><span><?php esc_html_e( 'مشتریان مدل‌شده', 'bahoosh-analytics-pro' ); ?></span><strong><?php echo esc_html( number_format_i18n( $total_customers ) ); ?></strong><small><?php echo esc_html( sprintf( __( '%d بخش رفتاری', 'bahoosh-analytics-pro' ), count( $segments ) ) ); ?></small></div></div>
				<div class="bap-kpi-card"><div class="bap-kpi-card__icon"><span class="dashicons dashicons-money-alt"></span></div><div><span><?php esc_html_e( 'ارزش تاریخی بخش‌ها', 'bahoosh-analytics-pro' ); ?></span><strong><?php echo esc_html( number_format_i18n( $total_revenue ) . ' ' . $currency ); ?></strong><small><?php esc_html_e( 'بر اساس سفارش‌های همگام‌شده', 'bahoosh-analytics-pro' ); ?></small></div></div>
				<div class="bap-kpi-card"><div class="bap-kpi-card__icon"><span class="dashicons dashicons-chart-line"></span></div><div><span><?php esc_html_e( 'ریسک ریزش میانگین', 'bahoosh-analytics-pro' ); ?></span><strong><?php echo esc_html( self::pct( $avg_churn ) ); ?></strong><small><?php esc_html_e( 'وزن‌دهی‌شده بر اساس اندازه هر دسته', 'bahoosh-analytics-pro' ); ?></small></div></div>
				<div class="bap-kpi-card"><div class="bap-kpi-card__icon"><span class="dashicons dashicons-controls-forward"></span></div><div><span><?php esc_html_e( 'اقدام‌های باز', 'bahoosh-analytics-pro' ); ?></span><strong><?php echo esc_html( number_format_i18n( $pending_actions ) ); ?></strong><small><?php esc_html_e( 'در انتظار تأیید، اجرا یا ارسال', 'bahoosh-analytics-pro' ); ?></small></div></div>
			</div>

			<?php if ( ! $segments ) : ?>
				<section class="bap-section">
					<div class="bap-empty-state">
						<?php esc_html_e( 'هنوز نتیجه‌ای از سرویس یادگیری ماشین نرسیده است. ابتدا اتصال را در پایین همین صفحه فعال کنید و سرویس پایتون را اجرا کنید (راهنما: ml-service/README.md).', 'bahoosh-analytics-pro' ); ?>
					</div>
				</section>
			<?php else : ?>
				<section class="bap-section bap-customer-intelligence">
					<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'شناخت مشتری', 'bahoosh-analytics-pro' ); ?></span>
						<h2><?php esc_html_e( 'بخش‌های مشتری و فرصت‌های فروش', 'bahoosh-analytics-pro' ); ?></h2><p><?php esc_html_e( 'هر کارت یک گروه واقعی از مشتریان همین فروشگاه است؛ تصمیم بازاریابی را با ریسک ریزش، احتمال خرید و ارزش گروه کنار هم ببینید.', 'bahoosh-analytics-pro' ); ?></p></div><span class="bap-section-badge"><?php echo esc_html( sprintf( __( '%d دسته فعال', 'bahoosh-analytics-pro' ), count( $segments ) ) ); ?></span></div>
					<div class="bap-segment-grid">
					<?php foreach ( $segments as $key => $seg ) : ?>
						<article class="bap-segment-card">
							<header><div><span class="bap-segment-eyebrow"><?php echo esc_html( $key ); ?></span><h3><?php echo esc_html( $seg['label'] ); ?></h3></div><span class="bap-segment-share"><?php echo esc_html( number_format_i18n( (float) ( $seg['percentage'] ?? 0 ), 1 ) . '٪' ); ?></span></header>
							<div class="bap-segment-primary"><strong><?php echo esc_html( number_format_i18n( (int) ( $seg['customer_count'] ?? 0 ) ) ); ?></strong><span><?php esc_html_e( 'مشتری', 'bahoosh-analytics-pro' ); ?></span><b><?php echo esc_html( number_format_i18n( (float) ( $seg['total_revenue'] ?? 0 ) ) . ' ' . $currency ); ?></b><small><?php esc_html_e( 'ارزش تاریخی', 'bahoosh-analytics-pro' ); ?></small></div>
							<div class="bap-segment-metrics">
								<div><span><?php esc_html_e( 'سبد میانگین', 'bahoosh-analytics-pro' ); ?></span><strong><?php echo esc_html( number_format_i18n( (float) ( $seg['average_aov'] ?? 0 ) ) ); ?></strong></div>
								<div><span><?php esc_html_e( 'روز از خرید', 'bahoosh-analytics-pro' ); ?></span><strong><?php echo esc_html( number_format_i18n( (float) ( $seg['average_recency'] ?? 0 ) ) ); ?></strong></div>
								<div><span><?php esc_html_e( 'خرید ۳۰ روز', 'bahoosh-analytics-pro' ); ?></span><strong class="is-positive"><?php echo esc_html( self::pct( $seg['avg_repeat_purchase_probability'] ?? null ) ); ?></strong></div>
								<div><span><?php esc_html_e( 'ریسک ریزش', 'bahoosh-analytics-pro' ); ?></span><strong class="is-risk"><?php echo esc_html( self::pct( $seg['avg_churn_probability'] ?? null ) ); ?></strong></div>
							</div>
							<?php if ( ! empty( $seg['characteristics'] ) ) : ?><div class="bap-chip-row"><?php foreach ( array_slice( (array) $seg['characteristics'], 0, 4 ) as $c ) : ?><span><?php echo esc_html( (string) $c ); ?></span><?php endforeach; ?></div><?php endif; ?>
							<footer class="bap-segment-actions">
								<?php if ( $can_edit && current_user_can( 'edit_shop_coupons' ) ) : ?><details><summary><span class="dashicons dashicons-tickets-alt"></span><?php esc_html_e( 'کد تخفیف', 'bahoosh-analytics-pro' ); ?></summary><form method="post" action="<?php echo esc_url( $post_url ); ?>"><?php wp_nonce_field( 'bap_ml_manual_coupon' ); ?><input type="hidden" name="action" value="bap_ml_manual_coupon"><input type="hidden" name="segment_key" value="<?php echo esc_attr( $key ); ?>"><div class="bap-inline-fields"><label><?php esc_html_e( 'درصد', 'bahoosh-analytics-pro' ); ?><input type="number" name="discount_value" min="1" max="<?php echo esc_attr( $policy['max_discount_percent'] ); ?>" value="<?php echo esc_attr( min( 10, $policy['max_discount_percent'] ) ); ?>"></label><label><?php esc_html_e( 'روز', 'bahoosh-analytics-pro' ); ?><input type="number" name="duration_days" min="1" max="<?php echo esc_attr( $policy['max_coupon_duration_days'] ); ?>" value="7"></label></div><button class="button button-primary bap-primary"><?php esc_html_e( 'ساخت کد', 'bahoosh-analytics-pro' ); ?></button></form></details><?php endif; ?>
								<?php if ( $can_edit ) : ?><details><summary><span class="dashicons dashicons-email-alt"></span><?php esc_html_e( 'کمپین', 'bahoosh-analytics-pro' ); ?></summary><form method="post" action="<?php echo esc_url( $post_url ); ?>"><?php wp_nonce_field( 'bap_ml_manual_campaign' ); ?><input type="hidden" name="action" value="bap_ml_manual_campaign"><input type="hidden" name="segment_key" value="<?php echo esc_attr( $key ); ?>"><input type="text" name="subject" required maxlength="120" placeholder="<?php esc_attr_e( 'موضوع کمپین', 'bahoosh-analytics-pro' ); ?>"><textarea name="message" required rows="3" maxlength="2000" placeholder="<?php esc_attr_e( 'پیام کمپین', 'bahoosh-analytics-pro' ); ?>"></textarea><label><?php esc_html_e( 'زمان ارسال', 'bahoosh-analytics-pro' ); ?><input type="datetime-local" name="send_at"></label><button class="button button-primary bap-primary"><?php esc_html_e( 'زمان‌بندی', 'bahoosh-analytics-pro' ); ?></button></form></details><?php endif; ?>
								<a class="bap-segment-action-link" href="#bap-ml-actions"><span class="dashicons dashicons-lightbulb"></span><?php esc_html_e( 'پیشنهادهای AI', 'bahoosh-analytics-pro' ); ?></a>
							</footer>
						</article>
					<?php endforeach; ?>
					</div>
					<p class="bap-muted bap-footnote"><?php esc_html_e( 'نام Segmentها از توزیع داده همین فروشگاه تفسیر می‌شود. ریسک ریزش بر مبنای احتمال نداشتن خرید در ۶۰ روز آینده است و قطعیت رفتاری محسوب نمی‌شود.', 'bahoosh-analytics-pro' ); ?></p>
				</section>
			<?php endif; ?>

			<?php if ( ! empty( $insights['insights'] ) || ! empty( $insights['recommendations'] ) ) : ?>
				<section class="bap-section bap-insights-section">
					<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'تحلیل', 'bahoosh-analytics-pro' ); ?></span>
						<h2><?php esc_html_e( 'بینش‌ها و پیشنهادها', 'bahoosh-analytics-pro' ); ?></h2></div></div>
					<?php foreach ( (array) ( $insights['insights'] ?? array() ) as $i ) : ?>
						<div class="bap-card bap-insight-card"><h3><?php echo esc_html( (string) ( $i['title'] ?? '' ) ); ?></h3><p><?php echo esc_html( (string) ( $i['detail'] ?? '' ) ); ?></p>
							<?php if ( ! empty( $i['evidence'] ) ) : ?><ul class="bap-muted"><?php foreach ( (array) $i['evidence'] as $e ) : ?><li><?php echo esc_html( (string) $e ); ?></li><?php endforeach; ?></ul><?php endif; ?></div>
					<?php endforeach; ?>
					<?php foreach ( (array) ( $insights['recommendations'] ?? array() ) as $r ) : ?>
						<div class="bap-card"><h3><?php echo esc_html( (string) ( $r['title'] ?? '' ) ); ?></h3><p><?php echo esc_html( (string) ( $r['detail'] ?? '' ) ); ?></p></div>
					<?php endforeach; ?>
					<?php if ( ! empty( $insights['timing']['recommended_period'] ) ) : ?>
						<div class="bap-card"><h3><?php esc_html_e( 'زمان پیشنهادی کمپین', 'bahoosh-analytics-pro' ); ?></h3>
							<p><?php echo esc_html( sprintf( '%s، %s تا %s — %s: %s', $insights['timing']['recommended_period']['weekday'] ?? '', $insights['timing']['recommended_period']['hour_from'] ?? '', $insights['timing']['recommended_period']['hour_to'] ?? '', __( 'اطمینان', 'bahoosh-analytics-pro' ), self::pct( $insights['timing']['confidence'] ?? null ) ) ); ?></p>
							<ul class="bap-muted"><?php foreach ( (array) ( $insights['timing']['reason'] ?? array() ) as $e ) : ?><li><?php echo esc_html( (string) $e ); ?></li><?php endforeach; ?></ul></div>
					<?php endif; ?>
					<p class="bap-muted"><?php echo esc_html( sprintf( /* translators: 1: planner 2: date */ __( 'تولیدکننده: %1$s — دریافت: %2$s', 'bahoosh-analytics-pro' ), 'llm' === ( $insights['planner']['source'] ?? '' ) ? __( 'مدل زبانی', 'bahoosh-analytics-pro' ) : __( 'موتور قانون‌محور', 'bahoosh-analytics-pro' ), (string) ( $insights['received_at'] ?? '' ) ) ); ?></p>
				</section>
			<?php endif; ?>

			<section class="bap-section" id="bap-ml-actions">
				<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'اقدام‌ها', 'bahoosh-analytics-pro' ); ?></span>
					<h2><?php esc_html_e( 'پیشنهاد، تأیید، اجرا، نتیجه', 'bahoosh-analytics-pro' ); ?></h2></div></div>
				<?php if ( ! $actions ) : ?>
					<div class="bap-empty-state"><?php esc_html_e( 'هنوز اقدامی پیشنهاد نشده است.', 'bahoosh-analytics-pro' ); ?></div>
				<?php else : ?>
				<table class="widefat striped bap-ml-table">
					<thead><tr>
						<th><?php esc_html_e( 'نوع', 'bahoosh-analytics-pro' ); ?></th>
						<th><?php esc_html_e( 'هدف و پارامترها', 'bahoosh-analytics-pro' ); ?></th>
						<th><?php esc_html_e( 'دلیل', 'bahoosh-analytics-pro' ); ?></th>
						<th><?php esc_html_e( 'اطمینان', 'bahoosh-analytics-pro' ); ?></th>
						<th><?php esc_html_e( 'وضعیت', 'bahoosh-analytics-pro' ); ?></th>
						<th><?php esc_html_e( 'نتیجه', 'bahoosh-analytics-pro' ); ?></th>
						<th></th>
					</tr></thead>
					<tbody>
					<?php foreach ( $actions as $a ) : ?>
						<?php
						$target = $a['target'];
						if ( isset( $target['segment_key'] ) && isset( $segments[ $target['segment_key'] ] ) ) {
							$target_label = $segments[ $target['segment_key'] ]['label'];
						} elseif ( isset( $target['product_id'] ) ) {
							$product      = function_exists( 'wc_get_product' ) ? wc_get_product( (int) $target['product_id'] ) : null;
							$target_label = $product ? $product->get_name() : '#' . (int) $target['product_id'];
						} else {
							$target_label = (string) ( $target['segment_key'] ?? '' );
						}
						$metrics = $results[ $a['action_id'] ] ?? array();
						?>
						<tr>
							<td><?php echo esc_html( $types[ $a['action_type'] ] ?? $a['action_type'] ); ?><br><small class="bap-muted"><?php echo esc_html( $a['source'] ); ?></small></td>
							<td><strong><?php echo esc_html( $target_label ); ?></strong><br><code><?php echo esc_html( wp_json_encode( $a['parameters'], JSON_UNESCAPED_UNICODE ) ); ?></code></td>
							<td><?php echo esc_html( implode( ' — ', (array) $a['reason'] ) ); ?>
								<?php if ( ! empty( $a['policy']['violations'] ) ) : ?><br><span class="bap-ml-violation"><?php echo esc_html( implode( '؛ ', (array) $a['policy']['violations'] ) ); ?></span><?php endif; ?>
								<?php if ( ! empty( $a['error'] ) ) : ?><br><span class="bap-ml-violation"><?php echo esc_html( $a['error'] ); ?></span><?php endif; ?></td>
							<td><?php echo esc_html( self::pct( $a['confidence'] ) ); ?></td>
							<td><?php echo esc_html( $statuses[ $a['status'] ] ?? $a['status'] ); ?></td>
							<td><?php if ( $a['result'] ) : ?><code><?php echo esc_html( wp_json_encode( array_diff_key( $a['result'], array( 'queue' => 1, 'recipient_keys' => 1 ) ), JSON_UNESCAPED_UNICODE ) ); ?></code><?php endif; ?>
								<?php if ( $a['clicks'] ) : ?><br><?php echo esc_html( sprintf( /* translators: %d clicks */ __( '%d کلیک', 'bahoosh-analytics-pro' ), (int) $a['clicks'] ) ); ?><?php endif; ?>
								<?php if ( $metrics ) : ?><br><small><?php echo esc_html( wp_json_encode( $metrics, JSON_UNESCAPED_UNICODE ) ); ?></small><?php endif; ?></td>
							<td>
								<?php if ( in_array( $a['status'], array( 'pending_approval', 'auto_approved' ), true ) && current_user_can( BAP_ML_Policy::capability_for( $a['action_type'] ) ) ) : ?>
									<?php self::decision_button( $a['action_id'], 'approve', __( 'تأیید و اجرا', 'bahoosh-analytics-pro' ), 'button-primary' ); ?>
								<?php endif; ?>
								<?php if ( in_array( $a['status'], array( 'pending_approval', 'auto_approved', 'recommendation_only' ), true ) && $can_edit ) : ?>
									<?php self::decision_button( $a['action_id'], 'reject', __( 'رد', 'bahoosh-analytics-pro' ), '' ); ?>
								<?php endif; ?>
								<?php if ( in_array( $a['status'], array( 'executed', 'scheduled' ), true ) && in_array( $a['action_type'], array( 'update_sale_price', 'create_coupon_for_segment', 'create_product_coupon', 'create_customer_segment', 'schedule_campaign' ), true ) && current_user_can( BAP_ML_Policy::capability_for( $a['action_type'] ) ) ) : ?>
									<?php self::decision_button( $a['action_id'], 'rollback', __( 'بازگردانی', 'bahoosh-analytics-pro' ), '' ); ?>
								<?php endif; ?>
							</td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
				<?php endif; ?>
			</section>

			<?php if ( $can_edit ) : ?>
				<?php self::render_settings( $policy ); ?>
			<?php endif; ?>

			<section class="bap-section">
				<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'گزارش ممیزی', 'bahoosh-analytics-pro' ); ?></span>
					<h2><?php esc_html_e( 'هر تصمیم، کی و توسط چه کسی', 'bahoosh-analytics-pro' ); ?></h2></div></div>
				<table class="widefat striped"><tbody>
				<?php foreach ( BAP_ML_Store::audit_log( 30 ) as $row ) : ?>
					<tr><td><?php echo esc_html( $row['created_at'] ); ?></td><td><?php echo esc_html( $row['event'] ); ?></td><td><code><?php echo esc_html( $row['action_id'] ); ?></code></td>
						<td><?php echo esc_html( $row['actor'] ? ( get_userdata( (int) $row['actor'] ) ? get_userdata( (int) $row['actor'] )->display_name : '#' . $row['actor'] ) : 'system' ); ?></td></tr>
				<?php endforeach; ?>
				</tbody></table>
			</section>
		</div>
		<?php
	}

	/**
	 * One decision form button.
	 *
	 * @param string $id       Action id.
	 * @param string $decision approve|reject|rollback.
	 * @param string $label    Label.
	 * @param string $class    Extra class.
	 * @return void
	 */
	private static function decision_button( $id, $decision, $label, $class ) {
		?>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline">
			<?php wp_nonce_field( 'bap_ml_decide_' . $id ); ?>
			<input type="hidden" name="action" value="bap_ml_decide">
			<input type="hidden" name="action_id" value="<?php echo esc_attr( $id ); ?>">
			<input type="hidden" name="decision" value="<?php echo esc_attr( $decision ); ?>">
			<button class="button <?php echo esc_attr( $class ); ?>"><?php echo esc_html( $label ); ?></button>
		</form>
		<?php
	}

	/**
	 * Connection and policy forms.
	 *
	 * @param array $policy Policy.
	 * @return void
	 */
	private static function render_settings( array $policy ) {
		$post_url = admin_url( 'admin-post.php' );
		?>
		<section class="bap-section">
			<div class="bap-section-title"><div><span class="bap-kicker"><?php esc_html_e( 'اتصال و سیاست', 'bahoosh-analytics-pro' ); ?></span>
				<h2><?php esc_html_e( 'سرویس یادگیری ماشین به چه چیزی دسترسی دارد و چه کاری اجازه دارد', 'bahoosh-analytics-pro' ); ?></h2></div></div>

			<form method="post" action="<?php echo esc_url( $post_url ); ?>">
				<?php wp_nonce_field( 'bap_ml_save_policy' ); ?>
				<input type="hidden" name="action" value="bap_ml_save_policy">
				<table class="form-table">
					<tr><th><?php esc_html_e( 'اتصال سرویس ML', 'bahoosh-analytics-pro' ); ?></th>
						<td><label><input type="checkbox" name="connection_enabled" value="1" <?php checked( $policy['connection_enabled'] ); ?>> <?php esc_html_e( 'اجازه خواندن داده (با نام مستعار، بدون نام/ایمیل/تلفن/آدرس) و ارسال نتیجه', 'bahoosh-analytics-pro' ); ?></label></td></tr>
					<tr><th><?php esc_html_e( 'اجرای اقدام‌ها', 'bahoosh-analytics-pro' ); ?></th>
						<td><label><input type="checkbox" name="execution_enabled" value="1" <?php checked( $policy['execution_enabled'] ); ?>> <?php esc_html_e( 'کلید اضطراری: خاموش = هیچ اقدامی اجرا نمی‌شود', 'bahoosh-analytics-pro' ); ?></label></td></tr>
					<tr><th><?php esc_html_e( 'حداکثر درصد تخفیف', 'bahoosh-analytics-pro' ); ?></th><td><input type="number" name="max_discount_percent" min="1" max="<?php echo esc_attr( BAP_Commerce_Agent::HARD_MAX_DISCOUNT ); ?>" value="<?php echo esc_attr( $policy['max_discount_percent'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'حداکثر تخفیف مبلغ ثابت', 'bahoosh-analytics-pro' ); ?></th><td><input type="number" name="max_fixed_discount_amount" min="0" value="<?php echo esc_attr( $policy['max_fixed_discount_amount'] ); ?>"> <span class="bap-muted"><?php esc_html_e( '۰ = تخفیف مبلغ ثابت مجاز نیست', 'bahoosh-analytics-pro' ); ?></span></td></tr>
					<tr><th><?php esc_html_e( 'حداکثر درصد تغییر قیمت', 'bahoosh-analytics-pro' ); ?></th><td><input type="number" name="max_price_change_percent" min="1" max="<?php echo esc_attr( BAP_ML_Policy::HARD_MAX_PRICE_CHANGE ); ?>" value="<?php echo esc_attr( $policy['max_price_change_percent'] ); ?>"> <span class="bap-muted"><?php esc_html_e( 'تغییر قیمت همیشه نیاز به تأیید دستی دارد.', 'bahoosh-analytics-pro' ); ?></span></td></tr>
					<tr><th><?php esc_html_e( 'حداکثر مدت کد تخفیف (روز)', 'bahoosh-analytics-pro' ); ?></th><td><input type="number" name="max_coupon_duration_days" min="1" max="30" value="<?php echo esc_attr( $policy['max_coupon_duration_days'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'گروه کنترل پیش‌فرض (٪)', 'bahoosh-analytics-pro' ); ?></th><td><input type="number" name="default_holdout_percent" min="0" max="50" value="<?php echo esc_attr( $policy['default_holdout_percent'] ); ?>"> <span class="bap-muted"><?php esc_html_e( 'بخشی از مشتریان عمداً پیشنهاد را دریافت نمی‌کنند تا اثر واقعی اقدام قابل اندازه‌گیری باشد.', 'bahoosh-analytics-pro' ); ?></span></td></tr>
					<tr><th><?php esc_html_e( 'اجرای خودکار', 'bahoosh-analytics-pro' ); ?></th><td>
						<label><input type="checkbox" name="auto_segment" value="1" <?php checked( $policy['auto_segment'] ); ?>> <?php esc_html_e( 'ثبت بخش مشتری', 'bahoosh-analytics-pro' ); ?></label><br>
						<label><input type="checkbox" name="auto_coupon" value="1" <?php checked( $policy['auto_coupon'] ); ?>> <?php esc_html_e( 'ساخت کد تخفیف', 'bahoosh-analytics-pro' ); ?></label><br>
						<label><input type="checkbox" name="auto_campaign" value="1" <?php checked( $policy['auto_campaign'] ); ?>> <?php esc_html_e( 'ساخت و ارسال کمپین', 'bahoosh-analytics-pro' ); ?></label><br>
						<label><input type="checkbox" disabled> <?php esc_html_e( 'تغییر قیمت (غیرقابل فعال‌سازی)', 'bahoosh-analytics-pro' ); ?></label></td></tr>
					<tr><th><?php esc_html_e( 'حداقل اطمینان برای اجرای خودکار', 'bahoosh-analytics-pro' ); ?></th><td><input type="number" step="0.05" min="0.5" max="1" name="min_confidence_for_auto" value="<?php echo esc_attr( $policy['min_confidence_for_auto'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'حداکثر اقدام در هر اجرا', 'bahoosh-analytics-pro' ); ?></th><td><input type="number" min="1" max="25" name="max_actions_per_run" value="<?php echo esc_attr( $policy['max_actions_per_run'] ); ?>"></td></tr>
					<tr><th><?php esc_html_e( 'کلید متای رضایت بازاریابی', 'bahoosh-analytics-pro' ); ?></th><td><input type="text" name="campaign_consent_meta_key" value="<?php echo esc_attr( $policy['campaign_consent_meta_key'] ); ?>" class="regular-text"> <p class="description"><?php esc_html_e( 'اگر پر شود، ایمیل کمپین فقط به کاربرانی ارسال می‌شود که این فیلد اطلاعات کاربری برایشان مقدار دارد. مسئولیت داشتن رضایت دریافت ایمیل تبلیغاتی با فروشگاه است.', 'bahoosh-analytics-pro' ); ?></p></td></tr>
					<tr><th><?php esc_html_e( 'اقدام‌های مجاز', 'bahoosh-analytics-pro' ); ?></th><td>
						<?php foreach ( self::type_labels() as $type => $label ) : ?>
							<label><input type="checkbox" name="allowed_actions[]" value="<?php echo esc_attr( $type ); ?>" <?php checked( in_array( $type, (array) $policy['allowed_actions'], true ) ); ?>> <?php echo esc_html( $label ); ?></label><br>
						<?php endforeach; ?></td></tr>
				</table>
				<?php submit_button( __( 'ذخیره سیاست', 'bahoosh-analytics-pro' ) ); ?>
			</form>

			<h3><?php esc_html_e( 'اطلاعات اتصال برای سرویس پایتون', 'bahoosh-analytics-pro' ); ?></h3>
			<table class="form-table">
				<tr><th>store_id</th><td><code><?php echo esc_html( BAP_Settings::resolved_site_id() ); ?></code></td></tr>
				<tr><th>wp_rest_base</th><td><code><?php echo esc_html( untrailingslashit( get_rest_url() ) ); ?></code></td></tr>
				<tr><th><?php esc_html_e( 'کلید امضا', 'bahoosh-analytics-pro' ); ?></th><td><details><summary><?php esc_html_e( 'نمایش', 'bahoosh-analytics-pro' ); ?></summary><code><?php echo esc_html( BAP_ML_Auth::secret() ); ?></code></details></td></tr>
				<tr><th><?php esc_html_e( 'آخرین نتیجه دریافتی', 'bahoosh-analytics-pro' ); ?></th><td><?php echo esc_html( (string) get_option( 'bap_ml_last_results_at', '—' ) ); ?></td></tr>
			</table>
			<form method="post" action="<?php echo esc_url( $post_url ); ?>" style="display:inline">
				<?php wp_nonce_field( 'bap_ml_rotate_secret' ); ?>
				<input type="hidden" name="action" value="bap_ml_rotate_secret">
				<button class="button" onclick="return confirm('<?php echo esc_js( __( 'کلید قبلی بلافاصله از کار می‌افتد. ادامه؟', 'bahoosh-analytics-pro' ) ); ?>')"><?php esc_html_e( 'ساخت کلید جدید', 'bahoosh-analytics-pro' ); ?></button>
			</form>
			<form method="post" action="<?php echo esc_url( $post_url ); ?>" style="display:inline">
				<?php wp_nonce_field( 'bap_ml_download_bundle' ); ?>
				<input type="hidden" name="action" value="bap_ml_download_bundle">
				<button class="button"><?php esc_html_e( 'دانلود دیتاست (JSON) برای گوگل کولب', 'bahoosh-analytics-pro' ); ?></button>
			</form>
			<p class="bap-muted"><?php esc_html_e( 'فایل دانلودی شامل نام، ایمیل، تلفن یا آدرس مشتری نیست؛ مشتریان با شناسه مستعار مشخص می‌شوند. با این حال آن را مثل داده محرمانه فروشگاه نگه دارید.', 'bahoosh-analytics-pro' ); ?></p>
		</section>
		<?php
	}

	// -------------------------------------------------------------- handlers

	/**
	 * Redirects back with a notice.
	 *
	 * @param string $message Notice.
	 * @return void
	 */
	private static function back( $message ) {
		wp_safe_redirect( add_query_arg( 'bap_notice', rawurlencode( $message ), admin_url( 'admin.php?page=' . self::SLUG ) ) );
		exit;
	}

	/**
	 * Capability + nonce guard for handlers.
	 *
	 * @param string $nonce_action Nonce action.
	 * @param string $capability   Capability.
	 * @return void
	 */
	private static function guard( $nonce_action, $capability = '' ) {
		if ( ! current_user_can( '' !== $capability ? $capability : BAP_Admin::settings_capability() ) ) {
			wp_die( esc_html__( 'اجازه این کار را ندارید.', 'bahoosh-analytics-pro' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( $nonce_action );
	}

	/** Saves the policy. */
	public static function handle_save_policy() {
		self::guard( 'bap_ml_save_policy' );
		BAP_ML_Policy::save( wp_unslash( $_POST ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- sanitised field by field in save().
		self::back( __( 'سیاست ذخیره شد.', 'bahoosh-analytics-pro' ) );
	}

	/** Rotates the signing secret. */
	public static function handle_rotate_secret() {
		self::guard( 'bap_ml_rotate_secret' );
		BAP_ML_Auth::rotate_secret();
		BAP_ML_Store::audit( '', 'secret_rotated' );
		self::back( __( 'کلید جدید ساخته شد. آن را در سرویس پایتون هم به‌روز کنید.', 'bahoosh-analytics-pro' ) );
	}

	/** Streams the dataset bundle. */
	public static function handle_download_bundle() {
		self::guard( 'bap_ml_download_bundle' );
		if ( ! BAP_Commerce_Facts::available() ) {
			self::back( __( 'ووکامرس فعال نیست.', 'bahoosh-analytics-pro' ) );
		}
		BAP_ML_Store::audit( '', 'bundle_downloaded' );
		BAP_ML_Export::stream_bundle();
	}

	/** Approve / reject / rollback. */
	public static function handle_decide() {
		$id       = isset( $_POST['action_id'] ) ? sanitize_text_field( wp_unslash( $_POST['action_id'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing -- verified in guard().
		$decision = isset( $_POST['decision'] ) ? sanitize_key( wp_unslash( $_POST['decision'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Missing
		// Type-specific capabilities are checked again inside approve()/rollback().
		self::guard( 'bap_ml_decide_' . $id, BAP_Admin::reports_capability() );
		switch ( $decision ) {
			case 'approve':
				$result = BAP_ML_Actions::approve( $id );
				break;
			case 'reject':
				$result = current_user_can( BAP_Admin::settings_capability() ) ? BAP_ML_Actions::reject( $id ) : new WP_Error( 'forbidden', 'forbidden' );
				break;
			case 'rollback':
				$result = BAP_ML_Actions::rollback( $id );
				break;
			default:
				$result = new WP_Error( 'bap_ml_decision', 'unknown decision' );
		}
		self::back( is_wp_error( $result ) ? $result->get_error_message() : __( 'انجام شد.', 'bahoosh-analytics-pro' ) );
	}

	/**
	 * Creates, validates and runs an admin-authored action.
	 *
	 * @param array $action Action without id/status.
	 * @return array|WP_Error Action with status.
	 */
	private static function run_manual( array $action ) {
		$action = array_merge(
			array( 'action_id' => wp_generate_uuid4(), 'run_id' => BAP_ML_Store::latest_run(), 'reason' => array( __( 'ایجادشده دستی توسط مدیر', 'bahoosh-analytics-pro' ) ), 'confidence' => null, 'source' => 'admin' ),
			$action
		);
		$decision = BAP_ML_Policy::evaluate( $action );
		if ( 'rejected_by_policy' === $decision['status'] ) {
			return new WP_Error( 'bap_ml_policy', implode( '؛ ', $decision['violations'] ) );
		}
		// A person wrote it, so it is approved by that person, but it still went
		// through the same policy and runs through the same executor and audit.
		$action['status'] = 'approved';
		$action['policy'] = $decision;
		BAP_ML_Store::insert_action( $action );
		BAP_ML_Store::update_action( $action['action_id'], array( 'approved_at' => BAP_ML_Store::now(), 'approved_by' => get_current_user_id() ) );
		BAP_ML_Store::audit( $action['action_id'], 'created_by_admin' );
		$result = BAP_ML_Actions::execute( $action['action_id'], false );
		return is_wp_error( $result ) ? $result : $action;
	}

	/** Manual segment coupon. */
	public static function handle_manual_coupon() {
		self::guard( 'bap_ml_manual_coupon', 'edit_shop_coupons' );
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- verified in guard().
		$result = self::run_manual(
			array(
				'action_type' => 'create_coupon_for_segment',
				'target'      => array( 'segment_key' => sanitize_key( wp_unslash( $_POST['segment_key'] ?? '' ) ) ),
				'parameters'  => array(
					'discount_type'        => 'percent',
					'discount_value'       => (float) ( $_POST['discount_value'] ?? 0 ),
					'duration_days'        => (int) ( $_POST['duration_days'] ?? 0 ),
					'usage_limit_per_user' => 1,
					'holdout_percent'      => (int) BAP_ML_Policy::get()['default_holdout_percent'],
				),
			)
		);
		// phpcs:enable
		self::back( is_wp_error( $result ) ? $result->get_error_message() : __( 'کد تخفیف ساخته شد.', 'bahoosh-analytics-pro' ) );
	}

	/** Manual campaign: create + send now or schedule. */
	public static function handle_manual_campaign() {
		self::guard( 'bap_ml_manual_campaign' );
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- verified in guard().
		$campaign = self::run_manual(
			array(
				'action_type' => 'create_campaign',
				'target'      => array( 'segment_key' => sanitize_key( wp_unslash( $_POST['segment_key'] ?? '' ) ) ),
				'parameters'  => array(
					'channel' => 'email',
					'subject' => sanitize_text_field( wp_unslash( $_POST['subject'] ?? '' ) ),
					'message' => sanitize_textarea_field( wp_unslash( $_POST['message'] ?? '' ) ),
				),
			)
		);
		if ( is_wp_error( $campaign ) ) {
			self::back( $campaign->get_error_message() );
		}
		$send_at = sanitize_text_field( wp_unslash( $_POST['send_at'] ?? '' ) );
		// phpcs:enable
		if ( '' !== $send_at ) {
			$local = date_create( $send_at, wp_timezone() );
			$send  = self::run_manual(
				array(
					'action_type' => 'schedule_campaign',
					'target'      => array(),
					'parameters'  => array( 'campaign_action_id' => $campaign['action_id'], 'send_at' => $local ? $local->format( 'c' ) : '' ),
				)
			);
		} else {
			$send = self::run_manual( array( 'action_type' => 'send_campaign', 'target' => array(), 'parameters' => array( 'campaign_action_id' => $campaign['action_id'] ) ) );
		}
		self::back( is_wp_error( $send ) ? $send->get_error_message() : __( 'کمپین ثبت شد.', 'bahoosh-analytics-pro' ) );
	}
}
