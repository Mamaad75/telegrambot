<?php
/**
 * Discord delivery provider.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Posts an advertisement to a Discord channel through an incoming webhook.
 *
 * Discord takes an embed, which suits an advertisement well: a title that
 * links to the listing, the message as the body, the first image, and the
 * mapped fields as inline columns. No bot token and no OAuth application
 * is involved — a channel webhook URL is the whole configuration.
 *
 * @since 1.5.0
 */
class DiscordDeliveryProvider extends BaseDeliveryProvider {

	/**
	 * Provider identifier.
	 *
	 * @var string
	 */
	public const ID = 'discord';

	/**
	 * Discord's hard limit on an embed description.
	 *
	 * @var int
	 */
	private const DESCRIPTION_LIMIT = 4096;

	/**
	 * Discord's hard limit on embed fields.
	 *
	 * @var int
	 */
	private const FIELD_LIMIT = 25;

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
		return __( 'Discord', 'wp-event-publisher' );
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
			'url'      => array(
				'label'       => __( 'Discord webhook URL', 'wp-event-publisher' ),
				'type'        => 'url',
				'required'    => true,
				'placeholder' => 'https://discord.com/api/webhooks/…',
				'description' => __( 'Channel Settings → Integrations → Webhooks → Copy Webhook URL.', 'wp-event-publisher' ),
			),
			'username' => array(
				'label'       => __( 'Post as', 'wp-event-publisher' ),
				'type'        => 'text',
				'description' => __( 'Optional display name for the webhook.', 'wp-event-publisher' ),
			),
			'style'    => array(
				'label'   => __( 'Message style', 'wp-event-publisher' ),
				'type'    => 'select',
				'default' => 'embed',
				'options' => array(
					'embed' => __( 'Rich embed (title, image, fields)', 'wp-event-publisher' ),
					'plain' => __( 'Plain text message', 'wp-event-publisher' ),
				),
			),
			'colour'   => array(
				'label'       => __( 'Embed colour', 'wp-event-publisher' ),
				'type'        => 'text',
				'default'     => '#2b90d9',
				'placeholder' => '#2b90d9',
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

		if ( '' !== $url ) {
			if ( '' === $this->safe_url( $url ) ) {
				$problems[] = __( 'The Discord webhook URL must be an absolute HTTPS address.', 'wp-event-publisher' );
			} elseif ( ! preg_match( '#^https://(?:\w+\.)?discord(?:app)?\.com/api/webhooks/#i', $url ) ) {
				$problems[] = __( 'That does not look like a Discord webhook URL. It should start with https://discord.com/api/webhooks/.', 'wp-event-publisher' );
			}
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
		$username = trim( (string) ( $config['username'] ?? '' ) );
		$body     = array();

		if ( '' !== $username ) {
			$body['username'] = mb_substr( $username, 0, 80 );
		}

		if ( 'plain' === (string) ( $config['style'] ?? 'embed' ) ) {
			$text = trim( $publication->message() . "\n" . $publication->url() );

			$body['content'] = $this->clamp( $text, 2000 );

			return $this->post_json( (string) ( $config['url'] ?? '' ), $body );
		}

		$embed = array(
			'title'       => $this->clamp( $publication->title(), 256 ),
			'description' => $this->clamp( $publication->message(), self::DESCRIPTION_LIMIT ),
			'color'       => $this->colour( (string) ( $config['colour'] ?? '' ) ),
			'timestamp'   => gmdate( 'c' ),
		);

		$url = $publication->url();

		if ( '' !== $url ) {
			$embed['url'] = $url;
		}

		$image = $publication->primary_image();

		if ( '' !== $image ) {
			$embed['image'] = array( 'url' => $image );
		}

		$fields = array();

		foreach ( $publication->fields() as $key => $value ) {
			if ( count( $fields ) >= self::FIELD_LIMIT ) {
				break;
			}

			$text = $this->flatten( $value );

			if ( '' === $text ) {
				continue;
			}

			$fields[] = array(
				'name'   => $this->clamp( (string) $key, 256 ),
				'value'  => $this->clamp( $text, 1024 ),
				'inline' => mb_strlen( $text ) <= 40,
			);
		}

		if ( ! empty( $fields ) ) {
			$embed['fields'] = $fields;
		}

		$body['embeds'] = array( $embed );

		// Discord shows one image per embed; the rest become bare embeds so
		// a gallery still arrives.
		foreach ( array_slice( $publication->images(), 1, 3 ) as $extra ) {
			$body['embeds'][] = array(
				'url'   => '' !== $url ? $url : null,
				'image' => array( 'url' => $extra ),
			);
		}

		return $this->post_json( (string) ( $config['url'] ?? '' ), $body );
	}

	/**
	 * Converts a hex colour into Discord's integer form.
	 *
	 * @since 1.5.0
	 *
	 * @param string $hex Hex colour, with or without a leading hash.
	 *
	 * @return int Colour value.
	 */
	private function colour( string $hex ): int {
		$hex = ltrim( trim( $hex ), '#' );

		if ( 3 === strlen( $hex ) ) {
			$hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
		}

		if ( ! preg_match( '/^[0-9a-f]{6}$/i', $hex ) ) {
			return 0x2B90D9;
		}

		return (int) hexdec( $hex );
	}

	/**
	 * Renders any mapped value as one line of text.
	 *
	 * @since 1.5.0
	 *
	 * @param mixed $value Mapped value.
	 *
	 * @return string Text, empty when there is nothing to show.
	 */
	private function flatten( mixed $value ): string {
		if ( is_bool( $value ) ) {
			return $value ? __( 'Yes', 'wp-event-publisher' ) : __( 'No', 'wp-event-publisher' );
		}

		if ( is_scalar( $value ) ) {
			return trim( (string) $value );
		}

		if ( ! is_array( $value ) ) {
			return '';
		}

		$parts = array();

		foreach ( $value as $item ) {
			if ( is_scalar( $item ) ) {
				$parts[] = trim( (string) $item );
			} elseif ( is_array( $item ) ) {
				$inner = array_filter( array_map( static fn( $cell ): string => is_scalar( $cell ) ? trim( (string) $cell ) : '', $item ) );

				if ( ! empty( $inner ) ) {
					$parts[] = implode( ' — ', $inner );
				}
			}
		}

		return implode( ', ', array_filter( $parts ) );
	}
}
