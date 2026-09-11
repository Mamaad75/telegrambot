<?php
/**
 * Normalized publication object.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * One advertisement, ready to send, independent of where it is going.
 *
 * This is the join between message generation and delivery. Everything
 * upstream — discovery, mapping, the profile, the template, the rules —
 * ends here; everything downstream is an adapter putting this object on a
 * wire. Two properties follow from that and both matter:
 *
 * - **Every destination receives identical data.** Discord and Telegram
 *   cannot drift apart, because neither of them builds anything.
 * - **A publication is inspectable.** The rule tester renders one without
 *   sending it, and the audit log stores one.
 *
 * @since 1.5.0
 */
class Publication {

	/**
	 * Event that produced this publication.
	 *
	 * @var Event
	 */
	private Event $event;

	/**
	 * Rendered message text.
	 *
	 * @var string
	 */
	private string $message;

	/**
	 * Complete webhook payload, the 1.4.0 contract.
	 *
	 * @var array<string,mixed>
	 */
	private array $payload;

	/**
	 * Absolute image URLs, already limited.
	 *
	 * @var string[]
	 */
	private array $images;

	/**
	 * Mapped field values.
	 *
	 * @var array<string,mixed>
	 */
	private array $fields;

	/**
	 * Profile that produced this publication.
	 *
	 * @var Profile
	 */
	private Profile $profile;

	/**
	 * Rule decisions that shaped it.
	 *
	 * @var RuleOutcome
	 */
	private RuleOutcome $outcome;

	/**
	 * Context describing the source advertisement.
	 *
	 * @var array<string,mixed>
	 */
	private array $context;

	/**
	 * Constructor.
	 *
	 * @since 1.5.0
	 *
	 * @param Event               $event   Source event.
	 * @param Profile             $profile Profile used.
	 * @param RuleOutcome         $outcome Rule decisions.
	 * @param string              $message Rendered message.
	 * @param array<string,mixed> $payload Webhook payload.
	 * @param string[]            $images  Image URLs.
	 * @param array<string,mixed> $fields  Mapped field values.
	 * @param array<string,mixed> $context Source description.
	 */
	public function __construct(
		Event $event,
		Profile $profile,
		RuleOutcome $outcome,
		string $message,
		array $payload,
		array $images = array(),
		array $fields = array(),
		array $context = array()
	) {
		$this->event   = $event;
		$this->profile = $profile;
		$this->outcome = $outcome;
		$this->message = $message;
		$this->payload = $payload;
		$this->images  = array_values( array_filter( array_map( 'strval', $images ) ) );
		$this->fields  = $fields;
		$this->context = $context;
	}

	/**
	 * Returns the source event.
	 *
	 * @since 1.5.0
	 *
	 * @return Event Event.
	 */
	public function event(): Event {
		return $this->event;
	}

	/**
	 * Returns the rendered message.
	 *
	 * @since 1.5.0
	 *
	 * @return string Message text.
	 */
	public function message(): string {
		return $this->message;
	}

	/**
	 * Returns the webhook payload.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,mixed> Payload.
	 */
	public function payload(): array {
		return $this->payload;
	}

	/**
	 * Returns the image URLs.
	 *
	 * @since 1.5.0
	 *
	 * @return string[] Absolute URLs.
	 */
	public function images(): array {
		return $this->images;
	}

	/**
	 * Returns the first image, which is what a single-image service uses.
	 *
	 * @since 1.5.0
	 *
	 * @return string URL, empty when there are none.
	 */
	public function primary_image(): string {
		return $this->images[0] ?? '';
	}

	/**
	 * Returns the mapped field values.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,mixed> Field values.
	 */
	public function fields(): array {
		return $this->fields;
	}

	/**
	 * Returns one payload value.
	 *
	 * @since 1.5.0
	 *
	 * @param string $key      Payload key.
	 * @param mixed  $fallback Value when absent.
	 *
	 * @return mixed Payload value.
	 */
	public function get( string $key, mixed $fallback = null ): mixed {
		return $this->payload[ $key ] ?? $fallback;
	}

	/**
	 * Returns the advertisement title.
	 *
	 * @since 1.5.0
	 *
	 * @return string Title.
	 */
	public function title(): string {
		return (string) $this->get( 'title', '' );
	}

	/**
	 * Returns the advertisement URL.
	 *
	 * @since 1.5.0
	 *
	 * @return string Permalink.
	 */
	public function url(): string {
		return (string) $this->get( 'url', '' );
	}

	/**
	 * Returns the profile used.
	 *
	 * @since 1.5.0
	 *
	 * @return Profile Profile.
	 */
	public function profile(): Profile {
		return $this->profile;
	}

	/**
	 * Returns the rule decisions.
	 *
	 * @since 1.5.0
	 *
	 * @return RuleOutcome Outcome.
	 */
	public function outcome(): RuleOutcome {
		return $this->outcome;
	}

	/**
	 * Returns the source description.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,mixed> Context.
	 */
	public function context(): array {
		return $this->context;
	}

	/**
	 * Returns a copy with a different message.
	 *
	 * Used by destinations that decorate the text for their own service.
	 *
	 * @since 1.5.0
	 *
	 * @param string $message New message.
	 *
	 * @return Publication New instance.
	 */
	public function with_message( string $message ): self {
		return new self( $this->event, $this->profile, $this->outcome, $message, $this->payload, $this->images, $this->fields, $this->context );
	}

	/**
	 * Returns a copy carrying at most a number of images.
	 *
	 * @since 1.5.0
	 *
	 * @param int $limit Maximum images; 0 removes them all.
	 *
	 * @return Publication New instance.
	 */
	public function with_image_limit( int $limit ): self {
		$images = $limit <= 0 ? array() : array_slice( $this->images, 0, $limit );

		return new self( $this->event, $this->profile, $this->outcome, $this->message, $this->payload, $images, $this->fields, $this->context );
	}

	/**
	 * Returns the publication as a plain array, for logging and previews.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,mixed> Publication summary.
	 */
	public function to_array(): array {
		return array(
			'event_id'   => $this->event->id(),
			'event_type' => $this->event->type(),
			'post_id'    => $this->event->post_id(),
			'profile'    => $this->profile->id(),
			'message'    => $this->message,
			'images'     => $this->images,
			'fields'     => $this->fields,
			'context'    => $this->context,
			'outcome'    => $this->outcome->to_array(),
		);
	}
}
