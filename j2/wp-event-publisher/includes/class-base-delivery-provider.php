<?php
/**
 * Shared delivery provider behaviour.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The parts of sending that are the same for every HTTP service.
 *
 * Posting JSON, classifying the response, deciding whether a failure is
 * worth retrying and refusing a URL that points at the local network are
 * one job, not five. Adapters describe their service; this does the wire.
 *
 * @since 1.5.0
 */
abstract class BaseDeliveryProvider implements DeliveryProvider {

	/**
	 * Status codes that will never succeed on a retry.
	 *
	 * @var int[]
	 */
	private const PERMANENT = array( 400, 401, 403, 404, 405, 409, 410, 413, 422 );

	/**
	 * Fills in a configuration from the schema's defaults.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $config Stored configuration.
	 *
	 * @return array<string,mixed> Prepared configuration.
	 */
	public function initialize( array $config ): array {
		foreach ( $this->settings_schema() as $key => $setting ) {
			if ( ! array_key_exists( $key, $config ) && array_key_exists( 'default', $setting ) ) {
				$config[ $key ] = $setting['default'];
			}
		}

		return $config;
	}

	/**
	 * Reports missing required settings.
	 *
	 * Adapters override this and call `parent::validate()` first, so the
	 * required-field check exists once.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $config Destination configuration.
	 *
	 * @return string[] Problems found.
	 */
	public function validate( array $config ): array {
		$problems = array();

		foreach ( $this->settings_schema() as $key => $setting ) {
			if ( empty( $setting['required'] ) ) {
				continue;
			}

			if ( '' === trim( (string) ( $config[ $key ] ?? '' ) ) ) {
				$problems[] = sprintf(
					/* translators: %s: setting label. */
					__( '"%s" is required.', 'wp-event-publisher' ),
					(string) ( $setting['label'] ?? $key )
				);
			}
		}

		return $problems;
	}

	/**
	 * Most services take images.
	 *
	 * @since 1.5.0
	 *
	 * @return bool True.
	 */
	public function supports_images(): bool {
		return true;
	}

	/**
	 * Most services take more than one image.
	 *
	 * @since 1.5.0
	 *
	 * @return bool True.
	 */
	public function supports_gallery(): bool {
		return true;
	}

	/**
	 * Most services render some markup.
	 *
	 * @since 1.5.0
	 *
	 * @return bool True.
	 */
	public function supports_formatting(): bool {
		return true;
	}

	/**
	 * Few services take buttons.
	 *
	 * @since 1.5.0
	 *
	 * @return bool False.
	 */
	public function supports_buttons(): bool {
		return false;
	}

	/**
	 * Scheduling is done by the plugin's own queue unless a service says
	 * otherwise.
	 *
	 * @since 1.5.0
	 *
	 * @return bool False.
	 */
	public function supports_scheduling(): bool {
		return false;
	}

	/**
	 * Posts a JSON document and classifies the answer.
	 *
	 * @since 1.5.0
	 *
	 * @param string               $url     Absolute HTTPS endpoint.
	 * @param array<string,mixed>  $body    Document to send.
	 * @param array<string,string> $headers Extra request headers.
	 * @param int                  $timeout Request timeout in seconds.
	 *
	 * @return array{success:bool,code:int,message:string,body:string,retryable:bool} Result.
	 */
	protected function post_json( string $url, array $body, array $headers = array(), int $timeout = 15 ): array {
		$url = $this->safe_url( $url );

		if ( '' === $url ) {
			return $this->failure( 0, __( 'The endpoint URL is missing, is not HTTPS, or points at a private network address.', 'wp-event-publisher' ), false );
		}

		$encoded = wp_json_encode( $body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );

		if ( ! is_string( $encoded ) ) {
			return $this->failure( 0, __( 'The message could not be encoded as JSON.', 'wp-event-publisher' ), false );
		}

		$response = wp_remote_post(
			$url,
			array(
				'timeout'     => max( 5, $timeout ),
				'redirection' => 3,
				'sslverify'   => true,
				'blocking'    => true,
				'headers'     => array_merge(
					array(
						'Content-Type' => 'application/json; charset=utf-8',
						'Accept'       => 'application/json',
						'User-Agent'   => 'WPEventPublisher/' . WPEP_VERSION . '; ' . home_url(),
					),
					$headers
				),
				'body'        => $encoded,
			)
		);

		if ( is_wp_error( $response ) ) {
			// A transport failure is almost always worth another attempt.
			return $this->failure( 0, $response->get_error_message(), true );
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$text = (string) wp_remote_retrieve_body( $response );

		if ( $code >= 200 && $code < 300 ) {
			return array(
				'success'   => true,
				'code'      => $code,
				'message'   => sprintf(
					/* translators: %d: HTTP status code. */
					__( 'Accepted (HTTP %d).', 'wp-event-publisher' ),
					$code
				),
				'body'      => mb_substr( $text, 0, 2000 ),
				'retryable' => false,
			);
		}

		return array(
			'success'   => false,
			'code'      => $code,
			'message'   => sprintf(
				/* translators: %d: HTTP status code. */
				__( 'The service rejected the message (HTTP %d).', 'wp-event-publisher' ),
				$code
			),
			'body'      => mb_substr( $text, 0, 2000 ),
			'retryable' => ! in_array( $code, self::PERMANENT, true ),
		);
	}

	/**
	 * Builds a failure result.
	 *
	 * @since 1.5.0
	 *
	 * @param int    $code      HTTP status, 0 when there was no response.
	 * @param string $message   Explanation.
	 * @param bool   $retryable Whether another attempt could succeed.
	 *
	 * @return array{success:bool,code:int,message:string,body:string,retryable:bool} Result.
	 */
	protected function failure( int $code, string $message, bool $retryable ): array {
		return array(
			'success'   => false,
			'code'      => $code,
			'message'   => $message,
			'body'      => '',
			'retryable' => $retryable,
		);
	}

	/**
	 * Builds a success result.
	 *
	 * @since 1.5.0
	 *
	 * @param string $message Explanation.
	 *
	 * @return array{success:bool,code:int,message:string,body:string,retryable:bool} Result.
	 */
	protected function success( string $message ): array {
		return array(
			'success'   => true,
			'code'      => 200,
			'message'   => $message,
			'body'      => '',
			'retryable' => false,
		);
	}

	/**
	 * Refuses a URL that must not be requested.
	 *
	 * A destination URL is administrator input that the server then
	 * fetches, which is the shape of a server-side request forgery. Only
	 * absolute HTTPS URLs to non-private addresses are allowed through.
	 *
	 * @since 1.5.0
	 *
	 * @param string $url Candidate URL.
	 *
	 * @return string The URL, or an empty string when it must not be used.
	 */
	protected function safe_url( string $url ): string {
		$url = trim( $url );

		if ( '' === $url ) {
			return '';
		}

		$parts = wp_parse_url( $url );

		if ( ! is_array( $parts ) || empty( $parts['host'] ) ) {
			return '';
		}

		$scheme = strtolower( (string) ( $parts['scheme'] ?? '' ) );

		/**
		 * Filters whether a plain HTTP destination is allowed.
		 *
		 * Off by default: a message and its credentials must not cross the
		 * network in the clear.
		 *
		 * @since 1.5.0
		 *
		 * @param bool   $allow Whether to allow http://. Default false.
		 * @param string $url   Candidate URL.
		 */
		$allow_http = (bool) apply_filters( 'wpep_allow_insecure_destination', false, $url );

		if ( 'https' !== $scheme && ! ( 'http' === $scheme && $allow_http ) ) {
			return '';
		}

		$host = strtolower( (string) $parts['host'] );

		if ( in_array( $host, array( 'localhost', '127.0.0.1', '::1', '0.0.0.0' ), true ) ) {
			return '';
		}

		// A literal private or link-local address is never a real
		// destination and is the classic SSRF target.
		if ( filter_var( $host, FILTER_VALIDATE_IP ) && ! filter_var( $host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE ) ) {
			return '';
		}

		return esc_url_raw( $url );
	}

	/**
	 * Shortens a message to a service's limit without cutting a word.
	 *
	 * @since 1.5.0
	 *
	 * @param string $text  Message text.
	 * @param int    $limit Maximum characters.
	 *
	 * @return string Shortened text.
	 */
	protected function clamp( string $text, int $limit ): string {
		if ( $limit <= 0 || mb_strlen( $text ) <= $limit ) {
			return $text;
		}

		$cut   = mb_substr( $text, 0, $limit - 1 );
		$space = mb_strrpos( $cut, ' ' );

		if ( false !== $space && $space > $limit * 0.6 ) {
			$cut = mb_substr( $cut, 0, $space );
		}

		return rtrim( $cut ) . '…';
	}
}
