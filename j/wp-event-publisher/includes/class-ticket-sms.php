<?php
/**
 * SMS provider abstraction for Jarchi ticket notifications.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Sends a transactional notification when an administrator replies to a ticket.
 *
 * The configuration is provider-aware, while the ticket domain only knows one
 * operation: notify the ticket owner. This keeps future Iranian SMS panels
 * isolated from the ticket workflow.
 */
final class TicketSms {

	private const OPTION = '_jarchi_ticket_sms_settings';

	/**
	 * Available provider presets.
	 *
	 * @return array<string,array<string,mixed>>
	 */
	public static function providers(): array {
		return array(
			'sms_ir' => array(
				'label'       => 'SMS.ir',
				'auth'        => 'api_key',
				'pattern'     => true,
				'default_url' => 'https://api.sms.ir/v1/send/verify',
				'note'        => 'ارسال با Verify/Pattern؛ API Key و شناسه الگو مورد نیاز است.',
			),
			'kavenegar' => array(
				'label'       => 'کاوه‌نگار',
				'auth'        => 'api_key',
				'pattern'     => true,
				'default_url' => 'https://api.kavenegar.com/v1/{api_key}/verify/lookup.json',
				'note'        => 'ارسال Verify/Lookup؛ API Key و نام الگو مورد نیاز است.',
			),
			'ippanel' => array(
				'label'       => 'IPPanel',
				'auth'        => 'api_key',
				'pattern'     => true,
				'default_url' => 'https://edge.ippanel.com/v1/api/send',
				'note'        => 'ارسال Pattern با API Token، خط ارسال و کد پترن.',
			),
			'farapayamak' => array(
				'label'       => 'فراپیامک',
				'auth'        => 'username_password',
				'pattern'     => false,
				'default_url' => 'https://rest.payamak-panel.com/api/SendSMS/SendSMS',
				'note'        => 'ارسال وب‌سرویس با نام کاربری/رمز عبور و خط اختصاصی.',
			),
			'melipayamak' => array(
				'label'       => 'ملی پیامک',
				'auth'        => 'api_key_or_password',
				'pattern'     => true,
				'default_url' => '',
				'note'        => 'بسته به نوع وب‌سرویس پنل؛ Endpoint و مشخصات سرویس قابل تنظیم است.',
			),
			'farazsms' => array(
				'label'       => 'فراز اس‌ام‌اس',
				'auth'        => 'username_api_key',
				'pattern'     => false,
				'default_url' => 'https://legacy-support.farazsms.com/class/sms/webservice/send_url.php',
				'note'        => 'ارسال وب‌سرویس مستقیم؛ نام کاربری، کلید دسترسی و خط ارسال را وارد کنید.',
			),
			'sabapayamak' => array(
				'label'       => 'صبا پیامک',
				'auth'        => 'token',
				'pattern'     => false,
				'default_url' => '',
				'note'        => 'وب‌سرویس صبا پیامک؛ Token و Endpoint سرویس پنل را وارد کنید.',
			),
			'custom' => array(
				'label'       => 'API سفارشی',
				'auth'        => 'custom',
				'pattern'     => false,
				'default_url' => '',
				'note'        => 'برای پنل‌هایی که API اختصاصی یا Endpoint سفارشی دارند.',
			),
		);
	}

	/**
	 * @return array<string,mixed>
	 */
	public function settings(): array {
		$defaults = array(
			'enabled'       => false,
			'provider'      => 'sms_ir',
			'api_key'       => '',
			'username'      => '',
			'password'      => '',
			'pattern_id'    => '',
			'endpoint'      => 'https://api.sms.ir/v1/send/verify',
			'sender'        => '',
			'param_title'   => 'TICKET_TITLE',
			'param_link'    => 'TICKET_LINK',
			'param_id'      => 'TICKET_ID',
			'param_token_2' => 'TICKET_ID',
			'param_token_3' => 'TICKET_LINK',
			'sms_encoding'  => 'utf-8',
		);

		$value = get_option( self::OPTION, array() );
		$settings = wp_parse_args( is_array( $value ) ? $value : array(), $defaults );
		$provider = isset( self::providers()[ $settings['provider'] ] ) ? $settings['provider'] : 'sms_ir';
		$settings['provider'] = $provider;

		if ( '' === (string) $settings['endpoint'] && ! empty( self::providers()[ $provider ]['default_url'] ) ) {
			$settings['endpoint'] = self::providers()[ $provider ]['default_url'];
		}

		return $settings;
	}

	/**
	 * @param array<string,mixed> $settings Settings to persist.
	 */
	public function save_settings( array $settings ): void {
		$current = $this->settings();
		$provider = sanitize_key( (string) ( $settings['provider'] ?? $current['provider'] ) );
		if ( ! isset( self::providers()[ $provider ] ) ) {
			$provider = 'sms_ir';
		}
		$settings['provider'] = $provider;
		update_option( self::OPTION, array_merge( $current, $settings ), false );
	}

	public function enabled(): bool {
		$settings = $this->settings();
		return ! empty( $settings['enabled'] ) && $this->is_configured( $settings );
	}

	/**
	 * @param array<string,mixed> $settings Settings.
	 */
	private function is_configured( array $settings ): bool {
		$provider = (string) $settings['provider'];
		if ( empty( self::providers()[ $provider ] ) ) {
			return false;
		}

		if ( '' === trim( (string) $settings['endpoint'] ) && ! in_array( $provider, array( 'sms_ir', 'kavenegar', 'ippanel', 'farapayamak', 'farazsms' ), true ) ) {
			return false;
		}

		if ( in_array( $provider, array( 'sms_ir', 'kavenegar', 'ippanel' ), true ) ) {
			return '' !== trim( (string) $settings['api_key'] ) && '' !== trim( (string) $settings['pattern_id'] ) && ( 'kavenegar' !== $provider || '' !== trim( (string) $settings['api_key'] ) );
		}

		if ( in_array( $provider, array( 'farapayamak', 'melipayamak' ), true ) ) {
			return ( '' !== trim( (string) $settings['username'] ) && '' !== trim( (string) $settings['password'] ) ) || '' !== trim( (string) $settings['api_key'] );
		}

		if ( 'farazsms' === $provider ) {
			return '' !== trim( (string) $settings['username'] ) && '' !== trim( (string) $settings['api_key'] ) && '' !== trim( (string) $settings['sender'] );
		}

		if ( 'sabapayamak' === $provider ) {
			return '' !== trim( (string) $settings['endpoint'] ) && '' !== trim( (string) $settings['api_key'] );
		}

		return '' !== trim( (string) $settings['endpoint'] );
	}

	/**
	 * Notify the ticket owner that an administrator replied.
	 *
	 * @param int    $ticket_id Ticket ID.
	 * @param string $body      Reply body.
	 * @return true|\WP_Error
	 */
	public function send_admin_reply( int $ticket_id, string $body = '' ) {
		if ( ! $this->enabled() ) {
			return true;
		}

		$ticket = get_post( $ticket_id );
		if ( ! $ticket || Tickets::POST_TYPE !== $ticket->post_type ) {
			return new \WP_Error( 'invalid_ticket', __( 'تیکت معتبر نیست.', 'wp-event-publisher' ) );
		}

		$user = get_user_by( 'id', (int) $ticket->post_author );
		$mobile = $this->user_mobile( $user );
		if ( '' === $mobile ) {
			return new \WP_Error( 'missing_mobile', __( 'شماره موبایل کاربر برای ارسال پیامک پیدا نشد.', 'wp-event-publisher' ) );
		}

		$settings = $this->settings();
		$provider = (string) $settings['provider'];
		$title    = mb_substr( wp_strip_all_tags( $ticket->post_title ), 0, 120 );
		$link     = add_query_arg( 'jarchi_ticket', $ticket_id, wpep()->tickets()->ticket_page_url() );
		$id       = (string) $ticket_id;

		$payload = array(
			'title' => $title,
			'link'  => $link,
			'id'    => $id,
			'body'  => wp_strip_all_tags( $body ),
		);

		switch ( $provider ) {
			case 'sms_ir':
				return $this->send_sms_ir( $settings, $mobile, $payload, $ticket_id );
			case 'kavenegar':
				return $this->send_kavenegar( $settings, $mobile, $payload, $ticket_id );
			case 'ippanel':
				return $this->send_ippanel( $settings, $mobile, $payload, $ticket_id );
			case 'farapayamak':
				return $this->send_farapayamak( $settings, $mobile, $payload, $ticket_id );
			case 'melipayamak':
				return $this->send_melipayamak( $settings, $mobile, $payload, $ticket_id );
			case 'farazsms':
				return $this->send_farazsms( $settings, $mobile, $payload, $ticket_id );
			case 'sabapayamak':
				return $this->send_sabapayamak( $settings, $mobile, $payload, $ticket_id );
			default:
				return $this->send_custom( $settings, $mobile, $payload, $ticket_id );
		}
	}

	private function send_sms_ir( array $settings, string $mobile, array $payload, int $ticket_id ) {
		$endpoint = (string) $settings['endpoint'] ?: 'https://api.sms.ir/v1/send/verify';
		$parameters = array(
			array( 'name' => (string) $settings['param_title'], 'value' => $payload['title'] ),
			array( 'name' => (string) $settings['param_link'], 'value' => $payload['link'] ),
			array( 'name' => (string) $settings['param_id'], 'value' => $payload['id'] ),
		);
		return $this->post_json( $endpoint, array(
			'headers' => array( 'X-API-KEY' => (string) $settings['api_key'] ),
			'body'    => array( 'mobile' => $mobile, 'templateId' => (int) $settings['pattern_id'], 'parameters' => $parameters ),
			'ticket_id' => $ticket_id,
		) );
	}

	private function send_kavenegar( array $settings, string $mobile, array $payload, int $ticket_id ) {
		$endpoint = (string) $settings['endpoint'];
		if ( '' === $endpoint ) {
			$endpoint = 'https://api.kavenegar.com/v1/{api_key}/verify/lookup.json';
		}
		$endpoint = str_replace( '{api_key}', rawurlencode( (string) $settings['api_key'] ), $endpoint );
		$body = array(
			'receptor' => $mobile,
			'template' => (string) $settings['pattern_id'],
			'token'    => $payload['title'],
			'token2'   => $payload['id'],
			'token3'   => $payload['link'],
		);
		return $this->post_form( $endpoint, array( 'body' => $body, 'ticket_id' => $ticket_id ) );
	}

	private function send_ippanel( array $settings, string $mobile, array $payload, int $ticket_id ) {
		$endpoint = (string) $settings['endpoint'] ?: 'https://edge.ippanel.com/v1/api/send';
		$params = array();
		$params[ (string) $settings['param_title'] ] = $payload['title'];
		$params[ (string) $settings['param_id'] ]    = $payload['id'];
		$params[ (string) $settings['param_link'] ]  = $payload['link'];
		return $this->post_json( $endpoint, array(
			'headers' => array( 'Authorization' => 'API ' . (string) $settings['api_key'] ),
			'body' => array(
				'sending_type' => 'pattern',
				'from_number'  => (string) $settings['sender'],
				'code'         => (string) $settings['pattern_id'],
				'recipients'   => array( $mobile ),
				'params'       => $params,
			),
			'ticket_id' => $ticket_id,
		) );
	}

	private function send_farapayamak( array $settings, string $mobile, array $payload, int $ticket_id ) {
		$endpoint = (string) $settings['endpoint'] ?: 'https://rest.payamak-panel.com/api/SendSMS/SendSMS';
		$text = sprintf( 'پاسخ جدید تیکت #%s - %s\n%s', $payload['id'], $payload['title'], $payload['link'] );
		return $this->post_form( $endpoint, array(
			'body' => array(
				'username' => (string) $settings['username'],
				'password' => (string) $settings['password'],
				'to'       => $mobile,
				'from'     => (string) $settings['sender'],
				'text'     => $text,
			),
			'ticket_id' => $ticket_id,
		) );
	}

	private function send_melipayamak( array $settings, string $mobile, array $payload, int $ticket_id ) {
		// Melipayamak has multiple web-service modes. Keep the endpoint editable
		// so the administrator can use the exact service exposed by their panel.
		$endpoint = (string) $settings['endpoint'];
		if ( '' === $endpoint ) {
			return new \WP_Error( 'sms_endpoint_missing', __( 'برای ملی پیامک باید Endpoint وب‌سرویس را وارد کنید.', 'wp-event-publisher' ) );
		}
		$text = sprintf( 'پاسخ جدید تیکت #%s - %s\n%s', $payload['id'], $payload['title'], $payload['link'] );
		$body = array(
			'username' => (string) $settings['username'],
			'password' => (string) $settings['password'],
			'to'       => $mobile,
			'from'     => (string) $settings['sender'],
			'text'     => $text,
		);
		if ( '' !== trim( (string) $settings['api_key'] ) ) {
			$body['apiKey'] = (string) $settings['api_key'];
		}
		return $this->post_form( $endpoint, array( 'body' => $body, 'ticket_id' => $ticket_id ) );
	}

	private function send_farazsms( array $settings, string $mobile, array $payload, int $ticket_id ) {
		$endpoint = (string) $settings['endpoint'];
		if ( '' === $endpoint ) {
			$endpoint = 'https://legacy-support.farazsms.com/class/sms/webservice/send_url.php';
		}
		$endpoint = add_query_arg(
			array(
				'from'   => (string) $settings['sender'],
				'to'     => $mobile,
				'msg'    => sprintf( 'پاسخ جدید تیکت #%s - %s\n%s', $payload['id'], $payload['title'], $payload['link'] ),
				'uname'  => (string) $settings['username'],
				'pass'   => (string) $settings['api_key'],
			),
			$endpoint
		);
		$response = wp_remote_get( $endpoint, array( 'timeout' => 15 ) );
		return $this->handle_response( $response, $ticket_id );
	}

	private function send_sabapayamak( array $settings, string $mobile, array $payload, int $ticket_id ) {
		$endpoint = (string) $settings['endpoint'];
		if ( '' === $endpoint ) {
			return new \WP_Error( 'sms_endpoint_missing', __( 'برای صبا پیامک باید Endpoint وب‌سرویس را وارد کنید.', 'wp-event-publisher' ) );
		}
		$text = sprintf( 'پاسخ جدید تیکت #%s - %s\n%s', $payload['id'], $payload['title'], $payload['link'] );
		$body = array(
			'message' => $text,
			'text'    => $text,
			'to'      => array( $mobile ),
			'recipients' => array( $mobile ),
			'token'   => (string) $settings['api_key'],
			'apiKey'  => (string) $settings['api_key'],
			'from'    => (string) $settings['sender'],
		);
		$token = trim( (string) $settings['api_key'] );
		return $this->post_json( $endpoint, array(
			'headers'   => $token !== '' ? array( 'Authorization' => 'Bearer ' . $token ) : array(),
			'body'      => $body,
			'ticket_id' => $ticket_id,
		) );
	}

	private function send_custom( array $settings, string $mobile, array $payload, int $ticket_id ) {
		$endpoint = (string) $settings['endpoint'];
		$text = sprintf( 'پاسخ جدید تیکت #%s - %s\n%s', $payload['id'], $payload['title'], $payload['link'] );
		return $this->post_json( $endpoint, array(
			'headers' => array_filter( array( 'X-API-KEY' => (string) $settings['api_key'] ) ),
			'body' => array(
				'mobile' => $mobile,
				'to' => $mobile,
				'phone' => $mobile,
				'message' => $text,
				'title' => $payload['title'],
				'ticket_id' => $payload['id'],
				'ticket_link' => $payload['link'],
				'username' => (string) $settings['username'],
				'password' => (string) $settings['password'],
			),
			'ticket_id' => $ticket_id,
		) );
	}

	/** @param array<string,mixed> $args */
	private function post_json( string $endpoint, array $args ) {
		$headers = array_merge( array( 'Content-Type' => 'application/json', 'Accept' => 'application/json' ), (array) ( $args['headers'] ?? array() ) );
		$response = wp_remote_post( $endpoint, array(
			'timeout' => 15,
			'headers' => $headers,
			'body' => wp_json_encode( (array) ( $args['body'] ?? array() ) ),
		) );
		return $this->handle_response( $response, (int) $args['ticket_id'] );
	}

	/** @param array<string,mixed> $args */
	private function post_form( string $endpoint, array $args ) {
		$response = wp_remote_post( $endpoint, array(
			'timeout' => 15,
			'body' => (array) ( $args['body'] ?? array() ),
		) );
		return $this->handle_response( $response, (int) $args['ticket_id'] );
	}

	private function handle_response( $response, int $ticket_id ) {
		if ( is_wp_error( $response ) ) {
			$this->log( 'request_error', $response->get_error_message(), $ticket_id );
			return $response;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );
		if ( $code < 200 || $code >= 300 ) {
			$this->log( 'http_error', sprintf( 'HTTP %d: %s', $code, mb_substr( wp_strip_all_tags( $body ), 0, 500 ) ), $ticket_id );
			return new \WP_Error( 'sms_http_error', __( 'ارسال پیامک با خطا مواجه شد.', 'wp-event-publisher' ) );
		}
		return true;
	}

	private function user_mobile( $user ): string {
		if ( ! $user instanceof \WP_User ) {
			return '';
		}
		$keys = array( 'billing_phone', 'phone', 'mobile', 'phone_number', 'digits_phone', 'digits_phone_number' );
		foreach ( $keys as $key ) {
			$value = trim( (string) get_user_meta( $user->ID, $key, true ) );
			if ( '' !== $value ) {
				return $this->normalize_mobile( $value );
			}
		}
		return '';
	}

	private function normalize_mobile( string $value ): string {
		$value = preg_replace( '/[^0-9+]/', '', $value );
		if ( '' === $value ) {
			return '';
		}
		if ( 0 === strpos( $value, '+98' ) ) {
			return '0' . substr( $value, 3 );
		}
		if ( 0 === strpos( $value, '0098' ) ) {
			return '0' . substr( $value, 4 );
		}
		if ( 0 === strpos( $value, '98' ) && 12 === strlen( $value ) ) {
			return '0' . substr( $value, 2 );
		}
		return $value;
	}

	private function log( string $type, string $message, int $ticket_id ): void {
		if ( class_exists( Logger::class ) ) {
			wpep()->logger()->error( '[ticket-sms] ' . $type . ' for ticket #' . $ticket_id . ': ' . $message );
		}
	}
}
