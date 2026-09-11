<?php
/**
 * Telegram Publisher delivery provider.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The default destination: the Node.js Telegram Publisher webhook.
 *
 * This adapter is the plugin's existing delivery path wearing the new
 * interface. It sends the same signed payload, to the same endpoint, with
 * the same authentication headers — WordPress still never talks to Telegram
 * directly; the Node.js service does, and this posts to it.
 *
 * A destination of this provider may override the endpoint and name a
 * channel, which is how one site publishes to several channels: five
 * destinations, one adapter, each carrying its own `channel` in the
 * payload for the service to route on.
 *
 * Leaving both blank uses the endpoint and credentials from Settings, so
 * an installation upgraded from 1.4.0 delivers byte-for-byte what it did
 * before.
 *
 * @since 1.5.0
 */
class TelegramDeliveryProvider extends BaseDeliveryProvider {

	/**
	 * Provider identifier.
	 *
	 * @var string
	 */
	public const ID = 'telegram';

	/**
	 * Webhook transport, which owns signing and the timeout guards.
	 *
	 * @var Webhook
	 */
	private Webhook $webhook;

	/**
	 * Settings service.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Constructor.
	 *
	 * @since 1.5.0
	 *
	 * @param Webhook  $webhook  Webhook transport.
	 * @param Settings $settings Settings service.
	 */
	public function __construct( Webhook $webhook, Settings $settings ) {
		$this->webhook  = $webhook;
		$this->settings = $settings;
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
		return __( 'Telegram Publisher (Node.js webhook)', 'wp-event-publisher' );
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
			'endpoint' => array(
				'label'       => __( 'Webhook URL', 'wp-event-publisher' ),
				'type'        => 'url',
				'description' => __( 'Leave empty to use the URL from Settings. Set it to publish through a different Telegram Publisher instance.', 'wp-event-publisher' ),
			),
			'channel'  => array(
				'label'       => __( 'Channel', 'wp-event-publisher' ),
				'type'        => 'text',
				'placeholder' => '@example_channel',
				'description' => __( 'Sent as "channel" in the payload so the service knows where to post. Leave empty for the service default.', 'wp-event-publisher' ),
			),
			'bot'      => array(
				'label'       => __( 'Bot identifier', 'wp-event-publisher' ),
				'type'        => 'text',
				'description' => __( 'Optional. Sent as "bot" so a service that manages several bots can pick one. This is a name, not a token — never put a bot token here.', 'wp-event-publisher' ),
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

		$endpoint = trim( (string) ( $config['endpoint'] ?? '' ) );

		if ( '' !== $endpoint && '' === $this->safe_url( $endpoint ) ) {
			$problems[] = __( 'The webhook URL must be an absolute HTTPS address and must not point at a private network.', 'wp-event-publisher' );
		}

		if ( '' === $endpoint && '' === $this->settings->endpoint() ) {
			$problems[] = __( 'No webhook URL is configured here or in Settings, so this destination has nowhere to send.', 'wp-event-publisher' );
		}

		// A bot token in this box would be a credential stored where it is
		// displayed back to the browser. Refuse it outright.
		if ( preg_match( '/^\d{6,}:[A-Za-z0-9_\-]{30,}$/', trim( (string) ( $config['bot'] ?? '' ) ) ) ) {
			$problems[] = __( 'That looks like a Telegram bot token. Bot tokens belong in the Node.js service, never in WordPress. Use a short name here instead.', 'wp-event-publisher' );
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
		$payload = $publication->payload();

		// The rendered message and the destination's routing travel with the
		// existing contract rather than replacing any of it.
		$payload['message'] = $publication->message();
		$payload['images']  = $publication->images();
		$payload['image']   = $publication->primary_image();

		$channel = trim( (string) ( $config['channel'] ?? '' ) );
		$bot     = trim( (string) ( $config['bot'] ?? '' ) );

		if ( '' !== $channel ) {
			$payload['channel'] = $channel;
		}

		if ( '' !== $bot ) {
			$payload['bot'] = $bot;
		}

		$endpoint = trim( (string) ( $config['endpoint'] ?? '' ) );

		$result = $this->webhook->send_event(
			$publication->event(),
			$payload,
			'' !== $endpoint ? $this->safe_url( $endpoint ) : ''
		);

		$code = (int) ( $result['code'] ?? 0 );

		return array(
			'success'   => ! empty( $result['success'] ),
			'code'      => $code,
			'message'   => (string) ( $result['message'] ?? '' ),
			'body'      => (string) ( $result['body'] ?? '' ),
			'retryable' => empty( $result['success'] ) && ! in_array( $code, array( 400, 401, 403, 404, 405, 409, 410, 413, 422 ), true ),
		);
	}

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.5.0
	 *
	 * @return bool True.
	 */
	public function supports_buttons(): bool {
		return true;
	}
}
