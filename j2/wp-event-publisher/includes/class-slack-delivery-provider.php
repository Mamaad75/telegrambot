<?php
/**
 * Slack delivery provider.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Posts an advertisement to Slack through an incoming webhook.
 *
 * Uses Block Kit so the listing reads as a card rather than a wall of
 * text, and falls back to a plain `text` field, which is what Slack shows
 * in notifications and on clients that do not render blocks.
 *
 * @since 1.5.0
 */
class SlackDeliveryProvider extends BaseDeliveryProvider {

	/**
	 * Provider identifier.
	 *
	 * @var string
	 */
	public const ID = 'slack';

	/**
	 * Slack's limit on a section text block.
	 *
	 * @var int
	 */
	private const SECTION_LIMIT = 3000;

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
		return __( 'Slack', 'wp-event-publisher' );
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
			'url'   => array(
				'label'       => __( 'Slack webhook URL', 'wp-event-publisher' ),
				'type'        => 'url',
				'required'    => true,
				'placeholder' => 'https://hooks.slack.com/services/…',
				'description' => __( 'Create an incoming webhook in your Slack app and paste its URL here.', 'wp-event-publisher' ),
			),
			'style' => array(
				'label'   => __( 'Message style', 'wp-event-publisher' ),
				'type'    => 'select',
				'default' => 'blocks',
				'options' => array(
					'blocks' => __( 'Block Kit card', 'wp-event-publisher' ),
					'plain'  => __( 'Plain text message', 'wp-event-publisher' ),
				),
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
			$problems[] = __( 'The Slack webhook URL must be an absolute HTTPS address.', 'wp-event-publisher' );
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
		// Always present: it is what a notification shows and what a client
		// that cannot render blocks falls back to.
		$fallback = trim( $publication->title() . "\n" . $publication->message() );

		$body = array( 'text' => $this->clamp( $fallback, self::SECTION_LIMIT ) );

		if ( 'plain' === (string) ( $config['style'] ?? 'blocks' ) ) {
			return $this->post_json( (string) ( $config['url'] ?? '' ), $body );
		}

		$blocks = array();

		if ( '' !== $publication->title() ) {
			$blocks[] = array(
				'type' => 'header',
				'text' => array(
					'type'  => 'plain_text',
					'text'  => $this->clamp( $publication->title(), 150 ),
					'emoji' => true,
				),
			);
		}

		$section = array(
			'type' => 'section',
			'text' => array(
				'type' => 'mrkdwn',
				'text' => $this->clamp( '' !== $publication->message() ? $publication->message() : $publication->title(), self::SECTION_LIMIT ),
			),
		);

		$image = $publication->primary_image();

		if ( '' !== $image ) {
			$section['accessory'] = array(
				'type'      => 'image',
				'image_url' => $image,
				'alt_text'  => $this->clamp( $publication->title(), 150 ),
			);
		}

		$blocks[] = $section;

		$url = $publication->url();

		if ( '' !== $url ) {
			$blocks[] = array(
				'type'     => 'context',
				'elements' => array(
					array(
						'type' => 'mrkdwn',
						'text' => '<' . $url . '|' . $this->clamp( $url, 120 ) . '>',
					),
				),
			);
		}

		$body['blocks'] = $blocks;

		return $this->post_json( (string) ( $config['url'] ?? '' ), $body );
	}

	/**
	 * {@inheritDoc}
	 *
	 * Slack shows one image accessory per section; a full gallery needs an
	 * upload API this adapter does not use.
	 *
	 * @since 1.5.0
	 *
	 * @return bool False.
	 */
	public function supports_gallery(): bool {
		return false;
	}
}
