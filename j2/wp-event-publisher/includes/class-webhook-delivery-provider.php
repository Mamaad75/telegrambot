<?php
/**
 * Generic webhook delivery provider.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Posts the publication as JSON to any endpoint.
 *
 * The escape hatch: a service the plugin has never heard of, an automation
 * platform, a CRM, a queue. It sends the whole contract plus the rendered
 * message, so the receiver can use whichever half it prefers.
 *
 * @since 1.5.0
 */
class WebhookDeliveryProvider extends BaseDeliveryProvider {

	/**
	 * Provider identifier.
	 *
	 * @var string
	 */
	public const ID = 'webhook';

	/**
	 * Signature service, so a generic receiver can verify the sender.
	 *
	 * @var Signer
	 */
	private Signer $signer;

	/**
	 * Constructor.
	 *
	 * @since 1.5.0
	 *
	 * @param Signer $signer Signature service.
	 */
	public function __construct( Signer $signer ) {
		$this->signer = $signer;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.5.0
	 *
	 * @return string Provider id.
	 */
	public function id(): string {
		return self::ID;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.5.0
	 *
	 * @return string Provider label.
	 */
	public function label(): string {
		return __( 'Generic webhook', 'wp-event-publisher' );
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,array<string,mixed>> Setting descriptions.
	 */
	public function settings_schema(): array {
		return array(
			'url'     => array(
				'label'    => __( 'Endpoint URL', 'wp-event-publisher' ),
				'type'     => 'url',
				'required' => true,
			),
			'secret'  => array(
				'label'       => __( 'Shared secret', 'wp-event-publisher' ),
				'type'        => 'password',
				'description' => __( 'Optional. When set, every request carries an HMAC-SHA256 signature over the timestamp and the raw body. The value is stored but never displayed again.', 'wp-event-publisher' ),
			),
			'header'  => array(
				'label'       => __( 'Extra header', 'wp-event-publisher' ),
				'type'        => 'text',
				'placeholder' => 'X-Custom-Token: value',
				'description' => __( 'Optional. One "Name: value" header, for services that authenticate with their own header.', 'wp-event-publisher' ),
			),
			'timeout' => array(
				'label'   => __( 'Timeout (seconds)', 'wp-event-publisher' ),
				'type'    => 'number',
				'default' => 15,
			),
		);
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $config Destination configuration.
	 *
	 * @return string[] Problems found.
	 */
	public function validate( array $config ): array {
		$problems = parent::validate( $config );

		$url = trim( (string) ( $config['url'] ?? '' ) );

		if ( '' !== $url && '' === $this->safe_url( $url ) ) {
			$problems[] = __( 'The endpoint must be an absolute HTTPS address and must not point at a private network.', 'wp-event-publisher' );
		}

		$header = trim( (string) ( $config['header'] ?? '' ) );

		if ( '' !== $header && ! str_contains( $header, ':' ) ) {
			$problems[] = __( 'The extra header must be written as "Name: value".', 'wp-event-publisher' );
		}

		return $problems;
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.5.0
	 *
	 * @param Publication         $publication Normalized publication.
	 * @param array<string,mixed> $config      Destination configuration.
	 *
	 * @return array{success:bool,code:int,message:string,body:string,retryable:bool} Result.
	 */
	public function send( Publication $publication, array $config ): array {
		$body = $publication->payload();

		$body['message'] = $publication->message();
		$body['images']  = $publication->images();
		$body['image']   = $publication->primary_image();

		$headers = array(
			'X-Event-ID'       => $publication->event()->id(),
			'X-Idempotency-Key' => $publication->event()->id(),
		);

		$secret = (string) ( $config['secret'] ?? '' );

		if ( '' !== $secret ) {
			$encoded   = (string) wp_json_encode( $body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );
			$timestamp = (string) time();

			$headers['X-Timestamp'] = $timestamp;
			$headers['X-Signature'] = $this->signer->sign( $timestamp, $encoded, $secret );
		}

		$header = trim( (string) ( $config['header'] ?? '' ) );

		if ( '' !== $header && str_contains( $header, ':' ) ) {
			list( $name, $value ) = array_map( 'trim', explode( ':', $header, 2 ) );

			// A header name may only be a token; anything else could inject
			// a second header into the request.
			if ( '' !== $name && preg_match( '/^[A-Za-z0-9\-_]+$/', $name ) ) {
				$headers[ $name ] = str_replace( array( "\r", "\n" ), '', $value );
			}
		}

		return $this->post_json( (string) ( $config['url'] ?? '' ), $body, $headers, (int) ( $config['timeout'] ?? 15 ) );
	}
}
