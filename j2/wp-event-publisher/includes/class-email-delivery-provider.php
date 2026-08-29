<?php
/**
 * E-mail delivery provider.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Sends an advertisement by e-mail through `wp_mail()`.
 *
 * The only adapter that does not make an HTTP request, which is exactly
 * why the interface exists: the core hands it the same publication and it
 * does something completely different with it.
 *
 * Images are linked rather than attached — an advertisement gallery as
 * attachments would be megabytes per message — and the HTML body is
 * assembled from escaped values only.
 *
 * @since 1.5.0
 */
class EmailDeliveryProvider extends BaseDeliveryProvider {

	/**
	 * Provider identifier.
	 *
	 * @var string
	 */
	public const ID = 'email';

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
		return __( 'E-mail', 'wp-event-publisher' );
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
			'to'      => array(
				'label'       => __( 'Recipients', 'wp-event-publisher' ),
				'type'        => 'text',
				'required'    => true,
				'description' => __( 'One or more addresses, separated by commas.', 'wp-event-publisher' ),
			),
			'subject' => array(
				'label'       => __( 'Subject', 'wp-event-publisher' ),
				'type'        => 'text',
				'default'     => '{{title}}',
				'description' => __( 'Placeholders work here too: {{title}}, {{price}}, and any mapped field.', 'wp-event-publisher' ),
			),
			'format'  => array(
				'label'   => __( 'Format', 'wp-event-publisher' ),
				'type'    => 'select',
				'default' => 'html',
				'options' => array(
					'html'  => __( 'HTML', 'wp-event-publisher' ),
					'plain' => __( 'Plain text', 'wp-event-publisher' ),
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
		$problems  = parent::validate( $config );
		$addresses = $this->recipients( (string) ( $config['to'] ?? '' ) );

		if ( '' !== trim( (string) ( $config['to'] ?? '' ) ) && empty( $addresses ) ) {
			$problems[] = __( 'None of the recipients is a valid e-mail address.', 'wp-event-publisher' );
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
		$recipients = $this->recipients( (string) ( $config['to'] ?? '' ) );

		if ( empty( $recipients ) ) {
			return $this->failure( 0, __( 'This destination has no valid recipient address.', 'wp-event-publisher' ), false );
		}

		$subject = $this->fill( (string) ( $config['subject'] ?? '{{title}}' ), $publication );
		$subject = '' !== trim( $subject ) ? $subject : $publication->title();
		$subject = $this->clamp( wp_strip_all_tags( $subject ), 180 );

		$html = 'html' === (string) ( $config['format'] ?? 'html' );

		$body    = $html ? $this->html_body( $publication ) : $this->text_body( $publication );
		$headers = $html ? array( 'Content-Type: text/html; charset=UTF-8' ) : array();

		$sent = wp_mail( $recipients, $subject, $body, $headers );

		if ( $sent ) {
			return $this->success(
				sprintf(
					/* translators: %d: number of recipients. */
					_n( 'Sent to %d recipient.', 'Sent to %d recipients.', count( $recipients ), 'wp-event-publisher' ),
					count( $recipients )
				)
			);
		}

		// wp_mail() failing is usually a mail transport problem on the site,
		// which the next attempt may well survive.
		return $this->failure( 0, __( 'WordPress could not hand the message to the mail server. Check the site\'s mail configuration.', 'wp-event-publisher' ), true );
	}

	/**
	 * Builds the HTML body.
	 *
	 * Every value is escaped: an advertisement is user-authored content and
	 * an e-mail is rendered by a client that will happily run what it is
	 * given.
	 *
	 * @since 1.5.0
	 *
	 * @param Publication $publication Publication.
	 *
	 * @return string HTML body.
	 */
	private function html_body( Publication $publication ): string {
		$parts = array();

		$parts[] = '<h2 style="margin:0 0 12px">' . esc_html( $publication->title() ) . '</h2>';

		$image = $publication->primary_image();

		if ( '' !== $image ) {
			$parts[] = '<p><img src="' . esc_url( $image ) . '" alt="" style="max-width:100%;height:auto" /></p>';
		}

		$message = trim( $publication->message() );

		if ( '' !== $message ) {
			$parts[] = '<div style="white-space:pre-wrap;line-height:1.7">' . esc_html( $message ) . '</div>';
		}

		$rows = '';

		foreach ( $publication->fields() as $key => $value ) {
			$text = $this->flatten( $value );

			if ( '' === $text ) {
				continue;
			}

			$rows .= '<tr><th align="left" style="padding:4px 12px 4px 0;vertical-align:top">'
				. esc_html( (string) $key )
				. '</th><td style="padding:4px 0">' . esc_html( $text ) . '</td></tr>';
		}

		if ( '' !== $rows ) {
			$parts[] = '<table style="margin-top:16px;border-collapse:collapse">' . $rows . '</table>';
		}

		$url = $publication->url();

		if ( '' !== $url ) {
			$parts[] = '<p style="margin-top:16px"><a href="' . esc_url( $url ) . '">' . esc_html( $url ) . '</a></p>';
		}

		$gallery = array_slice( $publication->images(), 1 );

		if ( ! empty( $gallery ) ) {
			$links = array();

			foreach ( $gallery as $extra ) {
				$links[] = '<a href="' . esc_url( $extra ) . '"><img src="' . esc_url( $extra ) . '" alt="" width="120" style="margin:0 6px 6px 0" /></a>';
			}

			$parts[] = '<p>' . implode( '', $links ) . '</p>';
		}

		return '<div style="font-family:sans-serif;max-width:640px">' . implode( "\n", $parts ) . '</div>';
	}

	/**
	 * Builds the plain text body.
	 *
	 * @since 1.5.0
	 *
	 * @param Publication $publication Publication.
	 *
	 * @return string Text body.
	 */
	private function text_body( Publication $publication ): string {
		$parts = array( $publication->title(), '', $publication->message() );

		foreach ( $publication->fields() as $key => $value ) {
			$text = $this->flatten( $value );

			if ( '' !== $text ) {
				$parts[] = $key . ': ' . $text;
			}
		}

		$url = $publication->url();

		if ( '' !== $url ) {
			$parts[] = '';
			$parts[] = $url;
		}

		return trim( implode( "\n", $parts ) );
	}

	/**
	 * Substitutes mapped fields into a subject line.
	 *
	 * @since 1.5.0
	 *
	 * @param string      $text        Subject with placeholders.
	 * @param Publication $publication Publication.
	 *
	 * @return string Filled subject.
	 */
	private function fill( string $text, Publication $publication ): string {
		$values = array( 'title' => $publication->title(), 'url' => $publication->url() );

		foreach ( $publication->fields() as $key => $value ) {
			$values[ (string) $key ] = $this->flatten( $value );
		}

		return (string) preg_replace_callback(
			'/\{\{\s*([a-z0-9_]+)\s*\}\}/u',
			static fn( array $m ): string => (string) ( $values[ $m[1] ] ?? '' ),
			$text
		);
	}

	/**
	 * Parses and validates the recipient list.
	 *
	 * @since 1.5.0
	 *
	 * @param string $raw Comma separated addresses.
	 *
	 * @return string[] Valid addresses.
	 */
	private function recipients( string $raw ): array {
		$found = array();

		foreach ( explode( ',', $raw ) as $candidate ) {
			$address = sanitize_email( trim( $candidate ) );

			if ( '' !== $address && is_email( $address ) ) {
				$found[] = $address;
			}
		}

		return array_values( array_unique( $found ) );
	}

	/**
	 * Renders any mapped value as one line of text.
	 *
	 * @since 1.5.0
	 *
	 * @param mixed $value Mapped value.
	 *
	 * @return string Text.
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

	/**
	 * {@inheritDoc}
	 *
	 * @since 1.5.0
	 *
	 * @return bool False; the body carries links, not attachments.
	 */
	public function supports_gallery(): bool {
		return true;
	}
}
