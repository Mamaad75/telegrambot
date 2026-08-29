<?php
/**
 * Ticket notification center and Web Push delivery.
 *
 * This subsystem is intentionally local to WordPress. It has no dependency
 * on the Jarchi Backend or Mini App.
 *
 * @package WPEventPublisher
 */
namespace WPEventPublisher;

if ( ! defined( 'ABSPATH' ) ) { exit; }

final class TicketNotifications {
	public const OPTION = 'wpep_ticket_notification_settings';
	public const SUBSCRIPTIONS_META = '_jarchi_web_push_subscriptions';
	public const PAGE = 'wp-event-publisher-ticket-notifications';
	private const NONCE = 'wpep_ticket_notifications';

	/**
	 * The most notifications kept per user.
	 *
	 * @var int
	 */
	private const MAX_STORED = 50;

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
		add_action( 'jarchi_push_deliver', array( $this, 'deliver_push' ), 10, 2 );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ), 20 );
		// Screen registration is centralized in Admin::register_menu(); registering
		// it here as well produced a second $submenu entry for the same slug.
		add_action( 'admin_post_wpep_ticket_notification_save', array( $this, 'save_settings' ) );
	}

	public function defaults(): array {
		return array(
			'enabled' => true,
			'browser_prompt' => true,
			'sound' => false,
			'vapid_subject' => home_url( '/' ),
			'vapid_private' => '',
			'vapid_public' => '',
		);
	}

	public function settings(): array {
		$stored = get_option( self::OPTION, array() );
		$settings = wp_parse_args( is_array( $stored ) ? $stored : array(), $this->defaults() );
		if ( empty( $settings['vapid_private'] ) || empty( $settings['vapid_public'] ) ) {
			$settings = array_merge( $settings, $this->ensure_vapid_keys() );
		}
		return $settings;
	}

	private function ensure_vapid_keys(): array {
		$current = get_option( self::OPTION, array() );
		if ( is_array( $current ) && ! empty( $current['vapid_private'] ) && ! empty( $current['vapid_public'] ) ) {
			return array( 'vapid_private' => $current['vapid_private'], 'vapid_public' => $current['vapid_public'] );
		}
		if ( ! function_exists( 'openssl_pkey_new' ) || ! defined( 'OPENSSL_KEYTYPE_EC' ) ) {
			return array( 'vapid_private' => '', 'vapid_public' => '' );
		}
		$key = openssl_pkey_new( array( 'private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1' ) );
		if ( ! $key ) { return array( 'vapid_private' => '', 'vapid_public' => '' ); }
		$private = '';
		if ( ! openssl_pkey_export( $key, $private ) ) { return array( 'vapid_private' => '', 'vapid_public' => '' ); }
		$details = openssl_pkey_get_details( $key );
		$x = $details['ec']['x'] ?? '';
		$y = $details['ec']['y'] ?? '';
		if ( ! is_string( $x ) || ! is_string( $y ) || strlen( $x ) !== 32 || strlen( $y ) !== 32 ) {
			return array( 'vapid_private' => '', 'vapid_public' => '' );
		}
		$public = $this->base64url_encode( "\x04" . $x . $y );
		$merged = array( 'vapid_private' => $private, 'vapid_public' => $public );
		update_option( self::OPTION, array_merge( $this->defaults(), is_array( $current ) ? $current : array(), $merged ), false );
		return $merged;
	}

	public function register_admin_page(): void {
		// Navigation is centralized in Admin::register_menu().
	}

	public function save_settings(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) { wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) ); }
		check_admin_referer( self::NONCE );
		$settings = $this->settings();
		$settings['enabled'] = ! empty( $_POST['enabled'] );
		$settings['browser_prompt'] = ! empty( $_POST['browser_prompt'] );
		$settings['sound'] = ! empty( $_POST['sound'] );
		$settings['vapid_subject'] = esc_url_raw( wp_unslash( $_POST['vapid_subject'] ?? home_url( '/' ) ) );
		$settings = array_merge( $settings, $this->ensure_vapid_keys() );
		update_option( self::OPTION, $settings, false );
		wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE, 'updated' => 1 ), admin_url( 'admin.php' ) ) );
		exit;
	}

	public function enqueue(): void {
		if ( ! is_user_logged_in() ) { return; }
		$js = WPEP_PLUGIN_DIR . 'assets/js/ticket-notifications.js';
		if ( ! is_readable( $js ) ) { return; }
		wp_enqueue_script( 'wpep-ticket-notifications', WPEP_PLUGIN_URL . 'assets/js/ticket-notifications.js', array(), WPEP_VERSION . '.' . filemtime( $js ), true );
		wp_localize_script( 'wpep-ticket-notifications', 'jarchiTicketNotifications', array(
			'enabled' => ! empty( $this->settings()['enabled'] ),
			'prompt' => ! empty( $this->settings()['browser_prompt'] ),
			'vapidPublicKey' => (string) $this->settings()['vapid_public'],
			'restUrl' => esc_url_raw( rest_url( 'jarchi/v1/notifications/' ) ),
			'swUrl' => esc_url_raw( WPEP_PLUGIN_URL . 'assets/js/jarchi-ticket-push-sw.js' ),
			'restNonce' => wp_create_nonce( 'wp_rest' ),
			'pageUrl' => esc_url_raw( wpep()->tickets()->ticket_page_url() ),
			'sound' => ! empty( $this->settings()['sound'] ),
			/*
			 * One message per outcome, including the ones that used to be
			 * silent. A button that reports nothing when it fails is
			 * indistinguishable from a button that does nothing, which is
			 * exactly how this was reported.
			 */
			'i18n' => array(
				'enable'          => __( 'فعال‌سازی اعلان‌های تیکت', 'wp-event-publisher' ),
				'enabled'         => __( 'اعلان‌ها فعال شد. از این پس پاسخ تیکت‌ها را همین‌جا دریافت می‌کنید.', 'wp-event-publisher' ),
				'blocked'         => __( 'اعلان‌ها را قبلاً برای این سایت مسدود کرده‌اید. از تنظیمات مرورگر (بخش Notifications) دوباره اجازه دهید.', 'wp-event-publisher' ),
				'dismissed'       => __( 'اجازهٔ اعلان داده نشد. هر وقت خواستید دوباره همین دکمه را بزنید.', 'wp-event-publisher' ),
				// iOS refuses web push outside a Home Screen install. This is
				// not a browser limitation the reader can wait out; it is a
				// step they can take, so it is spelled out.
				'ios-home-screen' => __( 'در آیفون و آیپد ابتدا باید این سایت را به صفحهٔ اصلی اضافه کنید: دکمهٔ Share ← Add to Home Screen. سپس از همان آیکن وارد شوید و این دکمه را بزنید.', 'wp-event-publisher' ),
				'unsupported'     => __( 'مرورگر شما از اعلان فوری پشتیبانی نمی‌کند. اعلان‌ها همچنان با ایمیل و پیامک ارسال می‌شود.', 'wp-event-publisher' ),
				'insecure'        => __( 'اعلان فقط روی HTTPS کار می‌کند. لطفاً به مدیر سایت اطلاع دهید.', 'wp-event-publisher' ),
				'unconfigured'    => __( 'اعلان فوری هنوز روی سایت تنظیم نشده است. لطفاً به مدیر سایت اطلاع دهید.', 'wp-event-publisher' ),
				'saveFailed'      => __( 'اشتراک اعلان روی سرور ذخیره نشد. کمی بعد دوباره تلاش کنید.', 'wp-event-publisher' ),
				'failed'          => __( 'فعال‌سازی اعلان انجام نشد. کمی بعد دوباره تلاش کنید.', 'wp-event-publisher' ),
				'newTicket'       => __( 'تیکت جدید برای شما ثبت شد', 'wp-event-publisher' ),
				'newReply'        => __( 'پاسخ جدید برای تیکت شما', 'wp-event-publisher' ),
			),
		) );
	}

	public function register_rest_routes(): void {
		register_rest_route( 'jarchi/v1', '/notifications/summary', array(
			'method' => \WP_REST_Server::READABLE,
			'callback' => array( $this, 'rest_summary' ),
			'permission_callback' => function() { return is_user_logged_in(); },
		) );
		register_rest_route( 'jarchi/v1', '/notifications', array(
			'method' => \WP_REST_Server::READABLE,
			'callback' => array( $this, 'rest_list' ),
			'permission_callback' => function() { return is_user_logged_in(); },
		) );
		register_rest_route( 'jarchi/v1', '/notifications/read', array(
			'method' => \WP_REST_Server::CREATABLE,
			'callback' => array( $this, 'rest_read' ),
			'permission_callback' => function() { return is_user_logged_in(); },
		) );
		register_rest_route( 'jarchi/v1', '/notifications/subscribe', array(
			'method' => \WP_REST_Server::CREATABLE,
			'callback' => array( $this, 'rest_subscribe' ),
			'permission_callback' => function() { return is_user_logged_in(); },
		) );
		register_rest_route( 'jarchi/v1', '/notifications/unsubscribe', array(
			'method' => \WP_REST_Server::CREATABLE,
			'callback' => array( $this, 'rest_unsubscribe' ),
			'permission_callback' => function() { return is_user_logged_in(); },
		) );
	}

	private function notifications_for( int $user_id ): array {
		$items = get_user_meta( $user_id, '_jarchi_notifications', true );
		return is_array( $items ) ? array_values( $items ) : array();
	}

	public function add( int $user_id, string $type, string $title, string $message, string $url = '', array $data = array() ): void {
		if ( $user_id <= 0 ) { return; }
		$items = $this->notifications_for( $user_id );
		$items[] = array(
			'id' => wp_generate_uuid4(),
			'type' => sanitize_key( $type ),
			'title' => sanitize_text_field( $title ),
			'message' => wp_strip_all_tags( $message ),
			'url' => esc_url_raw( $url ),
			'created_at' => current_time( 'mysql' ),
			'read' => false,
			'data' => $data,
		);
		// Capped, so the row cannot grow without limit. It is autoloaded user
		// meta: an unbounded array is read on every request that touches the
		// user.
		if ( count( $items ) > self::MAX_STORED ) { $items = array_slice( $items, -self::MAX_STORED ); }

		$latest = end( $items ) ?: array();

		update_user_meta( $user_id, '_jarchi_notifications', $items );
		set_transient( 'jarchi_push_payload_' . $user_id, $latest, MINUTE_IN_SECONDS );

		/*
		 * Push is handed to cron, not performed here.
		 *
		 * Each subscription is an HTTPS round trip to a push service. A
		 * customer with a phone, a laptop and a work machine is three of them,
		 * in series, inside the request that is trying to save a ticket reply
		 * — so a slow or unreachable push endpoint became a slow ticket. The
		 * ticket is already committed by this point, so delivery can safely
		 * happen on the next tick.
		 */
		if ( ! $this->has_subscriptions( $user_id ) ) {
			return;
		}

		$scheduled = wp_schedule_single_event( time() + 5, 'jarchi_push_deliver', array( $user_id, $latest ) );

		// Cron is disabled on some installations. Falling back to sending in
		// the request is better than silently never notifying anybody.
		if ( false === $scheduled ) {
			$this->push_user( $user_id, $latest );
		}
	}

	/**
	 * Delivers one queued push notification.
	 *
	 * @since 1.19.2
	 *
	 * @param int   $user_id      Recipient.
	 * @param array $notification The notification.
	 *
	 * @return void
	 */
	public function deliver_push( $user_id = 0, $notification = array() ): void {
		$user_id = (int) $user_id;

		if ( $user_id <= 0 || ! is_array( $notification ) ) {
			return;
		}

		try {
			$this->push_user( $user_id, $notification );
		} catch ( \Throwable $e ) {
			// Push is optional. A failure here must never surface anywhere.
			unset( $e );
		}
	}

	/**
	 * Whether the user has any push subscription at all.
	 *
	 * Checked before scheduling, so a site where nobody has granted
	 * permission — the overwhelming majority — books no cron events.
	 *
	 * @since 1.19.2
	 *
	 * @param int $user_id User.
	 *
	 * @return bool True when at least one subscription exists.
	 */
	private function has_subscriptions( int $user_id ): bool {
		$subs = get_user_meta( $user_id, self::SUBSCRIPTIONS_META, true );

		return is_array( $subs ) && ! empty( $subs );
	}

	public function notify_ticket_created( int $ticket_id ): void {
		$ticket = get_post( $ticket_id );
		if ( ! $ticket ) { return; }
		$user_id = (int) $ticket->post_author;
		$this->add( $user_id, 'ticket_created', __( 'تیکت جدید برای شما ثبت شد', 'wp-event-publisher' ), $ticket->post_title, add_query_arg( array( 'jarchi_ticket' => $ticket_id ), wpep()->tickets()->ticket_page_url() ), array( 'ticket_id' => $ticket_id ) );
	}

	public function notify_ticket_reply( int $ticket_id, string $body = '' ): void {
		$ticket = get_post( $ticket_id );
		if ( ! $ticket ) { return; }
		$user_id = (int) $ticket->post_author;
		$preview = wp_trim_words( wp_strip_all_tags( $body ), 18 );
		$this->add( $user_id, 'ticket_reply', __( 'پاسخ جدید برای تیکت شما', 'wp-event-publisher' ), $preview ?: $ticket->post_title, add_query_arg( array( 'jarchi_ticket' => $ticket_id ), wpep()->tickets()->ticket_page_url() ), array( 'ticket_id' => $ticket_id ) );
	}

	public function rest_summary(): \WP_REST_Response {
		$items = $this->notifications_for( get_current_user_id() );
		$unread = array_values( array_filter( $items, static fn( $n ) => empty( $n['read'] ) ) );
		$ticket_unread = wpep()->tickets()->unread_count( get_current_user_id() );
		return new \WP_REST_Response( array( 'success' => true, 'unread' => count( $unread ), 'ticket_unread' => $ticket_unread, 'latest' => array_slice( array_reverse( $unread ), 0, 10 ) ), 200 );
	}

	public function rest_list(): \WP_REST_Response { return $this->rest_summary(); }

	public function rest_read( \WP_REST_Request $request ): \WP_REST_Response {
		$id = sanitize_text_field( (string) $request->get_param( 'id' ) );
		$items = $this->notifications_for( get_current_user_id() );
		foreach ( $items as &$item ) { if ( $id === (string) ( $item['id'] ?? '' ) ) { $item['read'] = true; } }
		unset( $item );
		update_user_meta( get_current_user_id(), '_jarchi_notifications', $items );
		return new \WP_REST_Response( array( 'success' => true ), 200 );
	}

	public function rest_subscribe( \WP_REST_Request $request ): \WP_REST_Response {
		$data = $request->get_json_params();
		if ( ! is_array( $data ) ) { $data = array(); }
		$endpoint = esc_url_raw( (string) ( $data['endpoint'] ?? '' ) );
		$p256dh = sanitize_text_field( (string) ( $data['keys']['p256dh'] ?? '' ) );
		$auth = sanitize_text_field( (string) ( $data['keys']['auth'] ?? '' ) );
		if ( '' === $endpoint || '' === $p256dh || '' === $auth ) { return new \WP_REST_Response( array( 'success' => false, 'error' => 'Invalid subscription' ), 400 ); }
		$subs = get_user_meta( get_current_user_id(), self::SUBSCRIPTIONS_META, true );
		$subs = is_array( $subs ) ? $subs : array();
		$hash = hash( 'sha256', $endpoint );
		$subs[ $hash ] = array( 'endpoint' => $endpoint, 'keys' => array( 'p256dh' => $p256dh, 'auth' => $auth ), 'created_at' => time() );
		if ( count( $subs ) > 5 ) { uasort( $subs, static fn( $a, $b ) => (int) ( $a['created_at'] ?? 0 ) <=> (int) ( $b['created_at'] ?? 0 ) ); $subs = array_slice( $subs, -5, null, true ); }
		update_user_meta( get_current_user_id(), self::SUBSCRIPTIONS_META, $subs );
		return new \WP_REST_Response( array( 'success' => true ), 200 );
	}

	public function rest_unsubscribe( \WP_REST_Request $request ): \WP_REST_Response {
		$endpoint = esc_url_raw( (string) $request->get_param( 'endpoint' ) );
		$subs = get_user_meta( get_current_user_id(), self::SUBSCRIPTIONS_META, true );
		$subs = is_array( $subs ) ? $subs : array();
		unset( $subs[ hash( 'sha256', $endpoint ) ] );
		update_user_meta( get_current_user_id(), self::SUBSCRIPTIONS_META, $subs );
		return new \WP_REST_Response( array( 'success' => true ), 200 );
	}

	private function push_user( int $user_id, array $notification ): void {
		$settings = $this->settings();
		if ( empty( $settings['enabled'] ) || empty( $settings['vapid_private'] ) || empty( $settings['vapid_public'] ) ) { return; }
		$subs = get_user_meta( $user_id, self::SUBSCRIPTIONS_META, true );
		if ( ! is_array( $subs ) || ! $subs ) { return; }
		$dead = array();
		foreach ( $subs as $hash => $subscription ) {
			if ( empty( $subscription['endpoint'] ) ) { $dead[] = $hash; continue; }
			$status = $this->send_push( $subscription, $settings, $notification );
			if ( in_array( $status, array( 404, 410 ), true ) ) { $dead[] = $hash; }
		}
		foreach ( $dead as $hash ) { unset( $subs[ $hash ] ); }
		update_user_meta( $user_id, self::SUBSCRIPTIONS_META, $subs );
	}

	private function send_push( array $subscription, array $settings, array $notification = array() ): int {
		$endpoint = (string) ( $subscription['endpoint'] ?? '' );
		if ( '' === $endpoint || empty( $subscription['keys']['p256dh'] ) || empty( $subscription['keys']['auth'] ) ) { return 0; }
		$parsed = wp_parse_url( $endpoint );
		$scheme = (string) ( $parsed['scheme'] ?? '' );
		$host   = (string) ( $parsed['host'] ?? '' );
		if ( '' === $scheme || '' === $host ) { return 0; }
		$aud = $scheme . '://' . $host . ( ! empty( $parsed['port'] ) ? ':' . $parsed['port'] : '' );

		$now = time();
		$header = $this->base64url_encode( wp_json_encode( array( 'typ' => 'JWT', 'alg' => 'ES256' ) ) );
		$payload = $this->base64url_encode( wp_json_encode( array( 'aud' => $aud, 'exp' => $now + 43200, 'sub' => (string) $settings['vapid_subject'] ) ) );
		$key = openssl_pkey_get_private( (string) $settings['vapid_private'] );
		if ( ! $key ) { return 0; }
		$signature = '';
		if ( ! openssl_sign( $header . '.' . $payload, $signature, $key, OPENSSL_ALGO_SHA256 ) ) { return 0; }
		$jwt = $header . '.' . $payload . '.' . $this->base64url_encode( $this->der_to_jose( $signature ) );

		$encrypted = $this->encrypt_push_payload( $subscription, $settings, array( 'title' => (string) ( $notification['title'] ?? __( 'اعلان جدید جارچی', 'wp-event-publisher' ) ), 'body' => (string) ( $notification['message'] ?? '' ), 'url' => (string) ( $notification['url'] ?? wpep()->tickets()->ticket_page_url() ) ) );
		if ( is_wp_error( $encrypted ) ) { return 0; }
		/*
		 * Blocking, deliberately.
		 *
		 * This used to be a fire-and-forget request, which meant
		 * wp_remote_retrieve_response_code() below always returned 0 — so the
		 * 404/410 branch that prunes expired subscriptions could never run.
		 * Every browser the customer ever granted permission on stayed in user
		 * meta for good, and the site kept posting to endpoints that had been
		 * gone for months. Two seconds is short enough not to hold up a reply.
		 */
		$response = wp_remote_post( $endpoint, array(
			'timeout' => 2,
			'blocking' => true,
			'headers' => array(
				'Authorization' => 'vapid t=' . $jwt . ', k=' . (string) $settings['vapid_public'],
				'TTL' => '300',
				'Content-Type' => 'application/octet-stream',
				'Content-Encoding' => 'aes128gcm',
			),
			'body' => $encrypted,
		) );
		if ( is_wp_error( $response ) ) { return 0; }
		return (int) wp_remote_retrieve_response_code( $response );
	}

	private function encrypt_push_payload( array $subscription, array $settings, array $payload ) : string|\WP_Error {
		$ua_public = $this->base64url_decode( (string) $subscription['keys']['p256dh'] );
		$auth = $this->base64url_decode( (string) $subscription['keys']['auth'] );
		if ( 65 !== strlen( $ua_public ) || 16 !== strlen( $auth ) || "\x04" !== $ua_public[0] ) { return new \WP_Error( 'invalid_push_key' ); }
		$server = openssl_pkey_new( array( 'private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1' ) );
		if ( ! $server ) { return new \WP_Error( 'push_ecdh_failed' ); }
		$details = openssl_pkey_get_details( $server );
		$sx = $details['ec']['x'] ?? ''; $sy = $details['ec']['y'] ?? '';
		$server_public = "\x04" . $sx . $sy;
		$server_pem = $this->spki_pem_from_uncompressed_public_key( $server_public );
		if ( ! $server_pem ) { return new \WP_Error( 'push_public_key_failed' ); }
		$ua_pem = $this->spki_pem_from_uncompressed_public_key( $ua_public );
		if ( ! $ua_pem ) { return new \WP_Error( 'push_subscription_key_failed' ); }
		$ua_key = openssl_pkey_get_public( $ua_pem );
		if ( ! $ua_key ) { return new \WP_Error( 'push_subscription_key_invalid' ); }
		$ecdh = openssl_pkey_derive( $ua_key, $server, 32 );
		if ( false === $ecdh ) { return new \WP_Error( 'push_ecdh_failed' ); }
		$info = "WebPush: info\x00" . $ua_public . $server_public;
		$prk_key = hash_hmac( 'sha256', $ecdh, $auth, true );
		$ikm = $this->hkdf_expand( $prk_key, $info, 32 );
		$salt = random_bytes( 16 );
		$prk = hash_hmac( 'sha256', $ikm, $salt, true );
		$cek = $this->hkdf_expand( $prk, "Content-Encoding: aes128gcm\x00", 16 );
		$nonce = $this->hkdf_expand( $prk, "Content-Encoding: nonce\x00", 12 );
		$plain = wp_json_encode( $payload ) . "\x02";
		$tag = '';
		$cipher = openssl_encrypt( $plain, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag );
		if ( false === $cipher ) { return new \WP_Error( 'push_encrypt_failed' ); }
		$record_size = pack( 'N', 4096 );
		$header = $salt . $record_size . chr( 65 ) . $server_public;
		return $header . $cipher . $tag;
	}

	private function hkdf_expand( string $prk, string $info, int $length ): string {
		$out = ''; $t = ''; $counter = 1;
		while ( strlen( $out ) < $length ) {
			$t = hash_hmac( 'sha256', $t . $info . chr( $counter++ ), $prk, true );
			$out .= $t;
		}
		return substr( $out, 0, $length );
	}

	private function spki_pem_from_uncompressed_public_key( string $public ): string {
		if ( 65 !== strlen( $public ) || "\x04" !== $public[0] ) { return ''; }
		$algorithm = "\x30\x13\x06\x07\x2A\x86\x48\xCE\x3D\x02\x01\x06\x08\x2A\x86\x48\xCE\x3D\x03\x01\x07";
		$bit_string = "\x03\x42\x00" . $public;
		$der = "\x30\x59" . $algorithm . $bit_string;
		return "-----BEGIN PUBLIC KEY-----\n" . chunk_split( base64_encode( $der ), 64, "\n" ) . "-----END PUBLIC KEY-----\n";
	}

	private function base64url_decode( string $value ): string {
		$padding = strlen( $value ) % 4; if ( $padding ) { $value .= str_repeat( '=', 4 - $padding ); }
		$decoded = base64_decode( strtr( $value, '-_', '+/' ), true );
		return false === $decoded ? '' : $decoded;
	}

	private function der_to_jose( string $der ): string {
		$pos = 0; if ( ord( $der[ $pos++ ] ) !== 0x30 ) { return $der; } $this->read_der_length( $der, $pos );
		if ( ord( $der[ $pos++ ] ) !== 0x02 ) { return $der; } $rlen = $this->read_der_length( $der, $pos ); $r = substr( $der, $pos, $rlen ); $pos += $rlen;
		if ( ord( $der[ $pos++ ] ) !== 0x02 ) { return $der; } $slen = $this->read_der_length( $der, $pos ); $s = substr( $der, $pos, $slen );
		$r = ltrim( $r, "\x00" ); $s = ltrim( $s, "\x00" ); $r = str_pad( $r, 32, "\x00", STR_PAD_LEFT ); $s = str_pad( $s, 32, "\x00", STR_PAD_LEFT );
		return substr( $r, -32 ) . substr( $s, -32 );
	}

	private function read_der_length( string $der, int &$pos ): int {
		$len = ord( $der[ $pos++ ] ); if ( $len < 0x80 ) { return $len; } $bytes = $len & 0x7f; $len = 0; for ( $i = 0; $i < $bytes; $i++ ) { $len = ( $len << 8 ) | ord( $der[ $pos++ ] ); } return $len;
	}

	private function base64url_encode( string $value ): string { return rtrim( strtr( base64_encode( $value ), '+/', '-_' ), '=' ); }

	public function render_admin(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) { wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) ); }
		$s = $this->settings();
		$public = (string) $s['vapid_public'];
		?><div class="wrap" dir="rtl"><div class="jarchi-ops-page"><div class="jarchi-ops-hero"><div><span class="jarchi-ops-kicker">NOTIFICATIONS CENTER</span><h1>اعلان‌های تیکت</h1><p>اعلان لحظه‌ای پاسخ تیکت برای موبایل و دسکتاپ، مستقل از مینی‌اپ و بک‌اند.</p></div></div><div class="jarchi-ops-panel"><form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"><?php wp_nonce_field( self::NONCE ); ?><input type="hidden" name="action" value="wpep_ticket_notification_save"><p><label><input type="checkbox" name="enabled" value="1" <?php checked( $s['enabled'] ); ?>> فعال‌سازی اعلان‌های تیکت</label></p><p><label><input type="checkbox" name="browser_prompt" value="1" <?php checked( $s['browser_prompt'] ); ?>> نمایش پیشنهاد فعال‌سازی اعلان برای کاربران</label></p><p><label><input type="checkbox" name="sound" value="1" <?php checked( $s['sound'] ); ?>> پخش صدای کوتاه هنگام اعلان داخل سایت</label></p><p><label>Subject VAPID<input type="url" class="regular-text" name="vapid_subject" value="<?php echo esc_attr( $s['vapid_subject'] ); ?>"></label></p><p><label>Public Key</label><br><code style="word-break:break-all;"><?php echo esc_html( $public ); ?></code></p><p><button class="button button-primary">ذخیره تنظیمات</button></p></form></div></div></div><?php
	}
}
