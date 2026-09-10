<?php
/**
 * Builds v3 events on the server.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Server-side counterpart of the JavaScript EventFactory.
 *
 * The important addition here is `deterministic_event_id()`: server events are
 * emitted from hooks that WordPress may fire more than once (order status
 * transitions, thank-you page reloads, cron retries). Deriving the event id
 * from the business key makes a repeat emission produce the *same* event id,
 * so the outbox's unique index and the collector's unique index both collapse
 * it into one event.
 */
class BAP_Event_Factory {

	/**
	 * Builds an event envelope.
	 *
	 * @param string $type      Event type.
	 * @param array  $data      Type-specific payload.
	 * @param array  $overrides `event_id`, `identity`, `page_view_id`, `page`,
	 *                          `timestamp_client`.
	 * @return array
	 */
	public static function build( $type, array $data = array(), array $overrides = array() ) {
		$event_id = isset( $overrides['event_id'] )
			? $overrides['event_id']
			: 'evt_' . str_replace( '-', '', wp_generate_uuid4() );

		$identity = isset( $overrides['identity'] )
			? $overrides['identity']
			: BAP_Identity::payload();

		$page_view_id = isset( $overrides['page_view_id'] )
			? $overrides['page_view_id']
			: self::server_page_view_id( $event_id );

		$event = array(
			'schema_version'   => BAP_SCHEMA_VERSION,
			'event_id'         => $event_id,
			'site_id'          => BAP_Settings::get( 'site_id' ),
			'page_view_id'     => $page_view_id,
			'identity'         => $identity,
			'event_type'       => $type,
			'timestamp_client' => isset( $overrides['timestamp_client'] )
				? $overrides['timestamp_client']
				: gmdate( 'Y-m-d\TH:i:s.v\Z' ),
			'timestamp_server' => gmdate( 'Y-m-d\TH:i:s.v\Z' ),
			'origin'           => 'server',
			'page'             => isset( $overrides['page'] ) ? $overrides['page'] : self::current_page(),
			'context'          => self::context(),
			'consent'          => BAP_Consent::payload(),
			'data'             => $data,
		);

		/**
		 * Filters a server-built event before it is queued.
		 *
		 * @param array  $event Event envelope.
		 * @param string $type  Event type.
		 */
		return apply_filters( 'bap_server_event', $event, $type );
	}

	/**
	 * Derives a stable event id from a business key.
	 *
	 * Same key in, same id out — forever. This is what guarantees one
	 * `purchase` event per order no matter how many times the hook fires.
	 *
	 * @param string $id_namespace Logical namespace, e.g. 'purchase'.
	 * @param string $key          Business key, e.g. the order id.
	 * @return string
	 */
	public static function deterministic_event_id( $id_namespace, $key ) {
		$site_id = (string) BAP_Settings::get( 'site_id' );
		$digest  = hash( 'sha256', $site_id . '|' . $id_namespace . '|' . $key );
		return 'evt_' . substr( $digest, 0, 32 );
	}

	/**
	 * A page view id for server-originated events.
	 *
	 * A WooCommerce order completed by a gateway webhook has no page view: no
	 * browser is present, and there may not have been one for hours. Forcing
	 * such an event into a real page view would corrupt exactly the grouping
	 * `page_view_id` exists to provide.
	 *
	 * So server events get their own, derived from the event id. That makes it
	 * deterministic — a re-fired hook produces the same id, not a second one —
	 * and visibly distinct, so reporting can exclude server events from
	 * page-view analysis rather than silently mixing them in.
	 *
	 * @param string $event_id The event's own id.
	 * @return string
	 */
	public static function server_page_view_id( $event_id ) {
		return 'pv_srv_' . substr( hash( 'sha256', (string) $event_id ), 0, 24 );
	}

	/**
	 * Page block for the current request.
	 *
	 * @return array
	 */
	public static function current_page() {
		$url = '';
		if ( isset( $_SERVER['HTTP_HOST'], $_SERVER['REQUEST_URI'] ) ) {
			$scheme = is_ssl() ? 'https' : 'http';
			$host   = sanitize_text_field( wp_unslash( $_SERVER['HTTP_HOST'] ) );
			$uri    = esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) );
			$url    = $scheme . '://' . $host . $uri;
		}

		return array(
			'url'      => $url,
			'title'    => '',
			'referrer' => isset( $_SERVER['HTTP_REFERER'] )
				? esc_url_raw( wp_unslash( $_SERVER['HTTP_REFERER'] ) )
				: '',
		);
	}

	/**
	 * Minimal context block for server events.
	 *
	 * No user-agent parsing here: the request may come from cron or a payment
	 * gateway callback, where the UA describes neither the shopper nor their
	 * device.
	 *
	 * @return array
	 */
	public static function context() {
		return array(
			'library'         => 'bahoosh-analytics-pro',
			'library_version' => BAP_VERSION,
			'origin'          => 'server',
			'language'        => get_locale(),
			'timezone'        => wp_timezone_string(),
			'ip'              => self::client_ip(),
		);
	}

	/**
	 * Returns the client IP, anonymised when the setting is on.
	 *
	 * Proxy headers are only trusted when the site explicitly opts in, because
	 * `X-Forwarded-For` is attacker-controlled on a directly reachable server.
	 *
	 * @return string
	 */
	public static function client_ip() {
		$ip = isset( $_SERVER['REMOTE_ADDR'] )
			? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) )
			: '';

		/**
		 * Filters whether forwarded-for headers may be trusted.
		 *
		 * @param bool $trust Default false.
		 */
		if ( apply_filters( 'bap_trust_proxy_headers', false ) && ! empty( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) {
			$forwarded = sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_FORWARDED_FOR'] ) );
			$parts     = explode( ',', $forwarded );
			$candidate = trim( $parts[0] );
			if ( filter_var( $candidate, FILTER_VALIDATE_IP ) ) {
				$ip = $candidate;
			}
		}

		if ( '' === $ip || ! filter_var( $ip, FILTER_VALIDATE_IP ) ) {
			return '';
		}

		return BAP_Settings::get( 'anonymize_ip' ) ? self::anonymize_ip( $ip ) : $ip;
	}

	/**
	 * Zeroes the host portion of an IP address.
	 *
	 * IPv4 keeps its first three octets (/24); IPv6 keeps its first 48 bits.
	 *
	 * @param string $ip IP address.
	 * @return string
	 */
	public static function anonymize_ip( $ip ) {
		if ( filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 ) ) {
			$parts    = explode( '.', $ip );
			$parts[3] = '0';
			return implode( '.', $parts );
		}

		// Validate before converting: inet_pton() emits a warning on malformed
		// input, and an anonymizer must never be the thing that fills the log.
		if ( ! filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6 ) ) {
			return '';
		}

		$packed = inet_pton( $ip );
		if ( false === $packed || 16 !== strlen( $packed ) ) {
			return '';
		}

		$masked = substr( $packed, 0, 6 ) . str_repeat( "\0", 10 );
		$result = inet_ntop( $masked );
		return false === $result ? '' : $result;
	}
}
