<?php
/**
 * Iran Exim ad submission guard and moderation tools.
 * Intended for the Code Snippets plugin.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function iex_ad_post_types() {
	return array(
		'jobs',
		'companies-services',
		'imports-exports',
		'importation',
		'exportation',
		'rial-currency-advice',
		'investing',
		'events-training',
	);
}

function iex_ad_create_form_ids() {
	return array(
		12125, 12126, // Exhibition and training.
		6340, 6337,   // Employer and job seeker.
		6332, 6329, 6326, 6323, // Company and service forms.
		6320, 6317,   // Investment forms.
		6314, 6312,   // Import against export.
		6305, 6302,   // Currency consultation.
		6299, 6296, 6291, // Export forms.
		6284, 6281, 6278, 6219, // Import forms.
	);
}

function iex_ad_normalize_payload( $value ) {
	if ( ! is_array( $value ) ) {
		return is_scalar( $value ) ? (string) $value : '';
	}

	foreach ( $value as $key => $item ) {
		$value[ $key ] = iex_ad_normalize_payload( $item );
	}

	ksort( $value );
	return $value;
}

/**
 * Stop two concurrent JetFormBuilder requests from creating two ads.
 */
add_action(
	'jet-form-builder/form-handler/before-send',
	function ( $handler ) {
		$form_id = is_object( $handler ) && method_exists( $handler, 'get_form_id' )
			? absint( $handler->get_form_id() )
			: 0;

		if ( ! in_array( $form_id, iex_ad_create_form_ids(), true ) ) {
			return;
		}

		$GLOBALS['iex_current_create_form_id'] = $form_id;

		$payload = function_exists( 'jet_fb_context' )
			? jet_fb_context()->resolve_request()
			: wp_unslash( $_POST );

		$ignore = array(
			'_wpnonce',
			'_jet_engine_refer',
			'_jfb_current_render_states',
			'_user_journey',
			'jet_form_builder_submit',
			'action',
			'__is_ajax',
			'__refer',
		);

		foreach ( $ignore as $key ) {
			unset( $payload[ $key ] );
		}

		$payload = iex_ad_normalize_payload( $payload );
		$user_id = get_current_user_id();
		$hash    = md5( $form_id . '|' . $user_id . '|' . wp_json_encode( $payload ) );
		$key     = 'iex_jfb_lock_' . $hash;
		$now     = time();
		$until   = (int) get_option( $key, 0 );

		if ( $until && $until <= $now ) {
			delete_option( $key );
			$until = 0;
		}

		if ( $until > $now || ! add_option( $key, $now + 20, '', false ) ) {
			throw new \Jet_Form_Builder\Exceptions\Action_Exception( 'success' );
		}

		wp_schedule_single_event( $now + 60, 'iex_release_jfb_submission_lock', array( $key ) );
	},
	1
);

add_action(
	'iex_release_jfb_submission_lock',
	function ( $key ) {
		if ( is_string( $key ) && 0 === strpos( $key, 'iex_jfb_lock_' ) ) {
			delete_option( $key );
		}
	}
);

/**
 * Every new front-end ad enters the moderation queue.
 */
add_filter(
	'wp_insert_post_data',
	function ( $data, $postarr ) {
		$form_id = isset( $GLOBALS['iex_current_create_form_id'] )
			? absint( $GLOBALS['iex_current_create_form_id'] )
			: 0;

		if (
			$form_id &&
			in_array( $form_id, iex_ad_create_form_ids(), true ) &&
			in_array( $data['post_type'], iex_ad_post_types(), true ) &&
			empty( $postarr['ID'] )
		) {
			$data['post_status'] = 'pending';
		}

		return $data;
	},
	20,
	2
);

/**
 * Prevent a second browser submit event while the first request is running.
 */
add_action(
	'wp_footer',
	function () {
		if ( is_admin() ) {
			return;
		}
		?>
		<script id="iex-jetform-single-submit">
		(function () {
			'use strict';

			function unlock(form) {
				form.removeAttribute('data-iex-submitting');
				form.removeAttribute('aria-busy');
			}

			function guard(form) {
				if (!form || form.getAttribute('data-iex-submit-guard') === '1') {
					return;
				}

				form.setAttribute('data-iex-submit-guard', '1');
				form.addEventListener('submit', function (event) {
					var now = Date.now();
					var lockedAt = Number(form.getAttribute('data-iex-submitting') || 0);

					if (lockedAt && now - lockedAt < 8000) {
						event.preventDefault();
						event.stopImmediatePropagation();
						return false;
					}

					form.setAttribute('data-iex-submitting', String(now));
					form.setAttribute('aria-busy', 'true');
					window.setTimeout(function () { unlock(form); }, 8000);
				}, true);
			}

			function init() {
				document.querySelectorAll('form.jet-form-builder').forEach(guard);
			}

			if (document.readyState === 'loading') {
				document.addEventListener('DOMContentLoaded', init);
			} else {
				init();
			}

			new MutationObserver(init).observe(document.documentElement, {
				childList: true,
				subtree: true
			});
		}());
		</script>
		<?php
	},
	5
);

function iex_default_rejection_reasons() {
	return array(
		'اطلاعات آگهی ناقص است',
		'دسته‌بندی آگهی اشتباه انتخاب شده است',
		'عنوان یا توضیحات آگهی نیاز به اصلاح دارد',
		'تصویر آگهی نامناسب یا بی‌کیفیت است',
		'اطلاعات تماس یا هویت آگهی‌دهنده قابل تأیید نیست',
		'این آگهی تکراری است',
		'محتوای آگهی با قوانین ایران اگزیم مغایرت دارد',
		'سایر موارد',
	);
}

function iex_get_rejection_reasons() {
	$reasons = get_option( 'iex_ad_rejection_reasons', array() );
	$reasons = is_array( $reasons ) ? array_filter( array_map( 'sanitize_text_field', $reasons ) ) : array();
	return $reasons ? array_values( $reasons ) : iex_default_rejection_reasons();
}

function iex_moderation_label( $post_id ) {
	$status = get_post_status( $post_id );
	$review = get_post_meta( $post_id, '_iex_moderation_status', true );

	if ( 'rejected' === $review ) {
		return 'رد شده';
	}
	if ( 'pending' === $status ) {
		return 'در انتظار بررسی';
	}
	if ( 'publish' === $status ) {
		return 'تأیید و منتشر شده';
	}
	return 'پیش‌نویس';
}

add_action(
	'admin_menu',
	function () {
		add_menu_page(
			'بررسی و تأیید آگهی‌ها',
			'بررسی آگهی‌ها',
			'edit_others_posts',
			'iex-ad-moderation',
			'iex_render_moderation_page',
			'dashicons-shield-alt',
			24
		);

		add_submenu_page(
			'iex-ad-moderation',
			'دلایل رد آگهی',
			'دلایل رد آگهی',
			'manage_options',
			'iex-rejection-reasons',
			'iex_render_reasons_page'
		);
	},
	20
);

add_action(
	'admin_menu',
	function () {
		remove_submenu_page( 'edit.php?post_type=events-training', 'rejection-reasons' );
	},
	999
);

function iex_render_admin_notice() {
	if ( empty( $_GET['iex_notice'] ) ) {
		return;
	}
	$messages = array(
		'approved'      => 'آگهی تأیید و منتشر شد.',
		'rejected'      => 'آگهی رد شد و دلیل رد ذخیره شد.',
		'reasons_saved' => 'دلایل رد آگهی ذخیره شد.',
		'error'         => 'عملیات انجام نشد. دوباره تلاش کنید.',
	);
	$key = sanitize_key( wp_unslash( $_GET['iex_notice'] ) );
	if ( isset( $messages[ $key ] ) ) {
		echo '<div class="notice notice-' . ( 'error' === $key ? 'error' : 'success' ) . ' is-dismissible"><p>' . esc_html( $messages[ $key ] ) . '</p></div>';
	}
}

function iex_render_moderation_page() {
	if ( ! current_user_can( 'edit_others_posts' ) ) {
		wp_die( esc_html__( 'You do not have permission to access this page.' ) );
	}

	$view    = isset( $_GET['view'] ) ? sanitize_key( wp_unslash( $_GET['view'] ) ) : 'pending';
	$paged   = max( 1, isset( $_GET['paged'] ) ? absint( $_GET['paged'] ) : 1 );
	$post_id = isset( $_GET['post_id'] ) ? absint( $_GET['post_id'] ) : 0;
	$args    = array(
		'post_type'      => iex_ad_post_types(),
		'posts_per_page' => 25,
		'paged'          => $paged,
		'orderby'        => 'date',
		'order'          => 'DESC',
	);

	if ( $post_id ) {
		$args['p']           = $post_id;
		$args['post_status'] = array( 'pending', 'publish', 'draft' );
	} elseif ( 'rejected' === $view ) {
		$args['post_status'] = 'draft';
		$args['meta_query']  = array(
			array(
				'key'   => '_iex_moderation_status',
				'value' => 'rejected',
			),
		);
	} elseif ( 'approved' === $view ) {
		$args['post_status'] = 'publish';
	} elseif ( 'all' === $view ) {
		$args['post_status'] = array( 'pending', 'publish', 'draft' );
	} else {
		$view                = 'pending';
		$args['post_status'] = 'pending';
	}

	$query   = new WP_Query( $args );
	$reasons = iex_get_rejection_reasons();
	$base    = admin_url( 'admin.php?page=iex-ad-moderation' );
	?>
	<div class="wrap iex-moderation-wrap" dir="rtl">
		<h1>بررسی و تأیید آگهی‌ها</h1>
		<?php iex_render_admin_notice(); ?>
		<nav class="nav-tab-wrapper">
			<a class="nav-tab <?php echo 'pending' === $view ? 'nav-tab-active' : ''; ?>" href="<?php echo esc_url( add_query_arg( 'view', 'pending', $base ) ); ?>">در انتظار بررسی</a>
			<a class="nav-tab <?php echo 'rejected' === $view ? 'nav-tab-active' : ''; ?>" href="<?php echo esc_url( add_query_arg( 'view', 'rejected', $base ) ); ?>">رد شده</a>
			<a class="nav-tab <?php echo 'approved' === $view ? 'nav-tab-active' : ''; ?>" href="<?php echo esc_url( add_query_arg( 'view', 'approved', $base ) ); ?>">تأیید شده</a>
			<a class="nav-tab <?php echo 'all' === $view ? 'nav-tab-active' : ''; ?>" href="<?php echo esc_url( add_query_arg( 'view', 'all', $base ) ); ?>">همه</a>
		</nav>

		<table class="widefat striped iex-moderation-table">
			<thead><tr><th>آگهی</th><th>دسته اصلی</th><th>آگهی‌دهنده</th><th>وضعیت</th><th>تاریخ</th><th>عملیات</th></tr></thead>
			<tbody>
			<?php if ( ! $query->have_posts() ) : ?>
				<tr><td colspan="6">آگهی‌ای در این بخش وجود ندارد.</td></tr>
			<?php else : ?>
				<?php while ( $query->have_posts() ) : $query->the_post(); ?>
					<?php
					$current_id = get_the_ID();
					$type_obj   = get_post_type_object( get_post_type( $current_id ) );
					$reason     = get_post_meta( $current_id, '_iex_rejection_reason', true );
					$note       = get_post_meta( $current_id, '_iex_rejection_note', true );
					?>
					<tr>
						<td><strong><a href="<?php echo esc_url( get_edit_post_link( $current_id ) ); ?>"><?php echo esc_html( get_the_title() ?: '(بدون عنوان)' ); ?></a></strong></td>
						<td><?php echo esc_html( $type_obj ? $type_obj->labels->singular_name : get_post_type( $current_id ) ); ?></td>
						<td><?php echo esc_html( get_the_author_meta( 'display_name', (int) get_post_field( 'post_author', $current_id ) ) ); ?></td>
						<td>
							<strong><?php echo esc_html( iex_moderation_label( $current_id ) ); ?></strong>
							<?php if ( $reason ) : ?><br><small><?php echo esc_html( $reason ); ?><?php echo $note ? ' — ' . esc_html( $note ) : ''; ?></small><?php endif; ?>
						</td>
						<td><?php echo esc_html( get_the_date( 'Y/m/d H:i', $current_id ) ); ?></td>
						<td class="iex-actions">
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
								<input type="hidden" name="action" value="iex_approve_ad">
								<input type="hidden" name="post_id" value="<?php echo esc_attr( $current_id ); ?>">
								<input type="hidden" name="redirect" value="<?php echo esc_url( remove_query_arg( 'iex_notice' ) ); ?>">
								<?php wp_nonce_field( 'iex_moderate_ad_' . $current_id ); ?>
								<button class="button button-primary" type="submit">تأیید و انتشار</button>
							</form>
							<form class="iex-reject-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
								<input type="hidden" name="action" value="iex_reject_ad">
								<input type="hidden" name="post_id" value="<?php echo esc_attr( $current_id ); ?>">
								<input type="hidden" name="redirect" value="<?php echo esc_url( remove_query_arg( 'iex_notice' ) ); ?>">
								<?php wp_nonce_field( 'iex_moderate_ad_' . $current_id ); ?>
								<select name="reason" required aria-label="دلیل رد آگهی">
									<option value="">انتخاب دلیل رد</option>
									<?php foreach ( $reasons as $item ) : ?><option value="<?php echo esc_attr( $item ); ?>"><?php echo esc_html( $item ); ?></option><?php endforeach; ?>
								</select>
								<input type="text" name="note" maxlength="300" placeholder="توضیح تکمیلی (اختیاری)">
								<button class="button iex-reject-button" type="submit">رد آگهی</button>
							</form>
						</td>
					</tr>
				<?php endwhile; ?>
			<?php endif; ?>
			</tbody>
		</table>
		<?php
		echo wp_kses_post(
			paginate_links(
				array(
					'base'    => add_query_arg( 'paged', '%#%', remove_query_arg( 'paged' ) ),
					'current' => $paged,
					'total'   => max( 1, (int) $query->max_num_pages ),
				)
			)
		);
		wp_reset_postdata();
		?>
	</div>
	<?php
}

function iex_render_reasons_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'You do not have permission to access this page.' ) );
	}
	?>
	<div class="wrap" dir="rtl">
		<h1>مدیریت دلایل رد آگهی</h1>
		<?php iex_render_admin_notice(); ?>
		<p>هر دلیل را در یک خط بنویسید. این موارد در فهرست انتخاب دلیل رد نمایش داده می‌شوند.</p>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="iex_save_rejection_reasons">
			<?php wp_nonce_field( 'iex_save_rejection_reasons' ); ?>
			<textarea name="reasons" rows="12" class="large-text code"><?php echo esc_textarea( implode( "\n", iex_get_rejection_reasons() ) ); ?></textarea>
			<?php submit_button( 'ذخیره دلایل' ); ?>
		</form>
	</div>
	<?php
}

function iex_moderation_redirect( $notice, $fallback = '' ) {
	$redirect = isset( $_POST['redirect'] ) ? esc_url_raw( wp_unslash( $_POST['redirect'] ) ) : '';
	if ( ! $redirect ) {
		$redirect = $fallback ?: admin_url( 'admin.php?page=iex-ad-moderation' );
	}
	wp_safe_redirect( add_query_arg( 'iex_notice', $notice, $redirect ) );
	exit;
}

add_action(
	'admin_post_iex_approve_ad',
	function () {
		$post_id = isset( $_POST['post_id'] ) ? absint( $_POST['post_id'] ) : 0;
		if (
			! $post_id ||
			! in_array( get_post_type( $post_id ), iex_ad_post_types(), true ) ||
			! current_user_can( 'edit_post', $post_id ) ||
			! check_admin_referer( 'iex_moderate_ad_' . $post_id )
		) {
			iex_moderation_redirect( 'error' );
		}

		update_post_meta( $post_id, '_iex_moderation_status', 'approved' );
		update_post_meta( $post_id, '_iex_moderated_at', current_time( 'mysql' ) );
		update_post_meta( $post_id, '_iex_moderated_by', get_current_user_id() );
		delete_post_meta( $post_id, '_iex_rejection_reason' );
		delete_post_meta( $post_id, '_iex_rejection_note' );
		wp_update_post( array( 'ID' => $post_id, 'post_status' => 'publish' ) );
		do_action( 'iex_ad_approved', $post_id );
		iex_moderation_redirect( 'approved' );
	}
);

add_action(
	'admin_post_iex_reject_ad',
	function () {
		$post_id = isset( $_POST['post_id'] ) ? absint( $_POST['post_id'] ) : 0;
		$reason  = isset( $_POST['reason'] ) ? sanitize_text_field( wp_unslash( $_POST['reason'] ) ) : '';
		$note    = isset( $_POST['note'] ) ? sanitize_text_field( wp_unslash( $_POST['note'] ) ) : '';
		if (
			! $post_id ||
			! $reason ||
			! in_array( get_post_type( $post_id ), iex_ad_post_types(), true ) ||
			! in_array( $reason, iex_get_rejection_reasons(), true ) ||
			! current_user_can( 'edit_post', $post_id ) ||
			! check_admin_referer( 'iex_moderate_ad_' . $post_id )
		) {
			iex_moderation_redirect( 'error' );
		}

		update_post_meta( $post_id, '_iex_moderation_status', 'rejected' );
		update_post_meta( $post_id, '_iex_rejection_reason', $reason );
		update_post_meta( $post_id, '_iex_rejection_note', $note );
		update_post_meta( $post_id, '_iex_moderated_at', current_time( 'mysql' ) );
		update_post_meta( $post_id, '_iex_moderated_by', get_current_user_id() );
		wp_update_post( array( 'ID' => $post_id, 'post_status' => 'draft' ) );
		do_action( 'iex_ad_rejected', $post_id, $reason, $note );
		iex_moderation_redirect( 'rejected' );
	}
);

add_action(
	'admin_post_iex_save_rejection_reasons',
	function () {
		if ( ! current_user_can( 'manage_options' ) || ! check_admin_referer( 'iex_save_rejection_reasons' ) ) {
			iex_moderation_redirect( 'error', admin_url( 'admin.php?page=iex-rejection-reasons' ) );
		}
		$raw     = isset( $_POST['reasons'] ) ? wp_unslash( $_POST['reasons'] ) : '';
		$reasons = preg_split( '/\r\n|\r|\n/', $raw );
		$reasons = array_values( array_unique( array_filter( array_map( 'sanitize_text_field', $reasons ) ) ) );
		update_option( 'iex_ad_rejection_reasons', $reasons, false );
		wp_safe_redirect( add_query_arg( 'iex_notice', 'reasons_saved', admin_url( 'admin.php?page=iex-rejection-reasons' ) ) );
		exit;
	}
);

add_action(
	'transition_post_status',
	function ( $new_status, $old_status, $post ) {
		if ( in_array( $post->post_type, iex_ad_post_types(), true ) && 'publish' === $new_status && 'publish' !== $old_status ) {
			update_post_meta( $post->ID, '_iex_moderation_status', 'approved' );
		}
	},
	10,
	3
);

foreach ( iex_ad_post_types() as $iex_post_type ) {
	add_filter(
		'manage_' . $iex_post_type . '_posts_columns',
		function ( $columns ) {
			$columns['iex_moderation'] = 'وضعیت بررسی';
			return $columns;
		}
	);

	add_action(
		'manage_' . $iex_post_type . '_posts_custom_column',
		function ( $column, $post_id ) {
			if ( 'iex_moderation' !== $column ) {
				return;
			}
			$reason = get_post_meta( $post_id, '_iex_rejection_reason', true );
			echo '<strong>' . esc_html( iex_moderation_label( $post_id ) ) . '</strong>';
			if ( $reason ) {
				echo '<br><small>' . esc_html( $reason ) . '</small>';
			}
			$url = add_query_arg(
				array(
					'page'    => 'iex-ad-moderation',
					'post_id' => $post_id,
				),
				admin_url( 'admin.php' )
			);
			echo '<br><a href="' . esc_url( $url ) . '">بررسی آگهی</a>';
		},
		10,
		2
	);
}

add_action(
	'admin_head',
	function () {
		if ( empty( $_GET['page'] ) || ! in_array( sanitize_key( wp_unslash( $_GET['page'] ) ), array( 'iex-ad-moderation', 'iex-rejection-reasons' ), true ) ) {
			return;
		}
		?>
		<style>
		.iex-moderation-wrap{max-width:1600px}.iex-moderation-wrap .nav-tab-wrapper{margin:18px 0}.iex-moderation-table th,.iex-moderation-table td{text-align:right;vertical-align:top}.iex-moderation-table th:first-child{width:20%}.iex-actions{min-width:390px}.iex-actions form{margin:0 0 10px}.iex-reject-form{display:grid;grid-template-columns:minmax(150px,1fr) minmax(160px,1fr) auto;gap:7px}.iex-reject-button{color:#b42318!important;border-color:#b42318!important}.iex-reject-button:hover{color:#fff!important;background:#b42318!important}@media(max-width:900px){.iex-actions{min-width:260px}.iex-reject-form{grid-template-columns:1fr}.iex-moderation-table{display:block;overflow-x:auto}}
		</style>
		<?php
	}
);
