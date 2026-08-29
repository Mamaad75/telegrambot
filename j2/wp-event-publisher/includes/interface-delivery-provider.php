<?php
/**
 * Delivery provider contract.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * One kind of place an advertisement can be sent.
 *
 * This is the seam that turns a Telegram publisher into a publishing
 * platform. The core builds one normalized {@see Publication} and hands the
 * same object to every configured destination; each adapter knows how to
 * put it on the wire for its own service and nothing else.
 *
 * A provider is a *type* of destination (Telegram publisher, Discord,
 * Slack, e-mail, a generic webhook). A **destination** is one configured
 * instance of a provider — "Channel A", "Channel B", "the dealer webhook" —
 * so a site can have five Telegram channels, each with its own profile,
 * template and schedule, all served by one adapter.
 *
 * Adding a service must never require touching the core plugin: implement
 * this interface and register it with the `wpep_delivery_providers` filter.
 *
 * @since 1.5.0
 */
interface DeliveryProvider {

	/**
	 * Machine readable identifier.
	 *
	 * Stored inside every destination, so it must be stable.
	 *
	 * @since 1.5.0
	 *
	 * @return string Provider id.
	 */
	public function id(): string;

	/**
	 * Human readable name shown when choosing a provider.
	 *
	 * @since 1.5.0
	 *
	 * @return string Provider label.
	 */
	public function label(): string;

	/**
	 * Describes the settings one destination of this provider needs.
	 *
	 * The Destinations screen renders the form from this description, so a
	 * new provider gets a working settings form without shipping any admin
	 * code of its own.
	 *
	 * Each entry is keyed by setting name and carries at least `label` and
	 * `type` (`text`, `password`, `url`, `number`, `select`, `checkbox`,
	 * `textarea`), optionally `options`, `placeholder`, `description`,
	 * `required` and `default`.
	 *
	 * A field of type `password` is never rendered back to the browser.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,array<string,mixed>> Setting descriptions.
	 */
	public function settings_schema(): array;

	/**
	 * Prepares a destination's configuration for use.
	 *
	 * Called before `validate()` and before `send()`. Fill in defaults and
	 * normalize here; never perform network access.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $config Stored destination configuration.
	 *
	 * @return array<string,mixed> Prepared configuration.
	 */
	public function initialize( array $config ): array;

	/**
	 * Reports what is wrong with a configuration.
	 *
	 * Must not perform network access: this runs on every save.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $config Destination configuration.
	 *
	 * @return string[] Human readable problems; empty when usable.
	 */
	public function validate( array $config ): array;

	/**
	 * Delivers one publication.
	 *
	 * Must not throw: return a failure result instead. The caller decides
	 * whether to retry based on `retryable`.
	 *
	 * @since 1.5.0
	 *
	 * @param Publication         $publication Normalized publication.
	 * @param array<string,mixed> $config      Destination configuration.
	 *
	 * @return array{success:bool,code:int,message:string,body:string,retryable:bool} Delivery result.
	 */
	public function send( Publication $publication, array $config ): array;

	/**
	 * Whether the service accepts images.
	 *
	 * @since 1.5.0
	 *
	 * @return bool True when images can be delivered.
	 */
	public function supports_images(): bool;

	/**
	 * Whether the service accepts more than one image per message.
	 *
	 * @since 1.5.0
	 *
	 * @return bool True when a gallery can be delivered.
	 */
	public function supports_gallery(): bool;

	/**
	 * Whether the service renders markup in the message body.
	 *
	 * @since 1.5.0
	 *
	 * @return bool True when formatting is meaningful.
	 */
	public function supports_formatting(): bool;

	/**
	 * Whether the service accepts interactive buttons.
	 *
	 * @since 1.5.0
	 *
	 * @return bool True when buttons can be attached.
	 */
	public function supports_buttons(): bool;

	/**
	 * Whether the service can be asked to publish at a future time.
	 *
	 * A provider that returns false is still schedulable: the plugin holds
	 * the publication in its own queue instead. This reports whether the
	 * *service* does the waiting.
	 *
	 * @since 1.5.0
	 *
	 * @return bool True when the service schedules natively.
	 */
	public function supports_scheduling(): bool;
}
