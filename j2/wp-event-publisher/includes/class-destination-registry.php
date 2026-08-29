<?php
/**
 * Destination storage and provider registration.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Knows which delivery providers exist and which destinations are
 * configured.
 *
 * A **provider** is a kind of service; a **destination** is one configured
 * instance of it. Five Telegram channels are five destinations sharing one
 * provider, each with its own configuration, profile override and schedule.
 *
 * The registry never sends anything. It resolves names to adapters and
 * hands the caller a configuration; {@see Publisher} does the sending.
 *
 * @since 1.5.0
 */
class DestinationRegistry {

	/**
	 * Option holding every configured destination.
	 *
	 * @var string
	 */
	public const OPTION = 'wpep_destinations';

	/**
	 * Identifier of the destination created for an upgraded installation.
	 *
	 * @var string
	 */
	public const PRIMARY_ID = 'primary';

	/**
	 * Webhook transport, needed by the Telegram provider.
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
	 * Signature service, needed by the generic webhook provider.
	 *
	 * @var Signer
	 */
	private Signer $signer;

	/**
	 * Registered providers.
	 *
	 * @var array<string,DeliveryProvider>|null
	 */
	private ?array $providers = null;

	/**
	 * Configured destinations.
	 *
	 * @var array<string,array<string,mixed>>|null
	 */
	private ?array $destinations = null;

	/**
	 * Constructor.
	 *
	 * @since 1.5.0
	 *
	 * @param Webhook  $webhook  Webhook transport.
	 * @param Settings $settings Settings service.
	 * @param Signer   $signer   Signature service.
	 */
	public function __construct( Webhook $webhook, Settings $settings, Signer $signer ) {
		$this->webhook  = $webhook;
		$this->settings = $settings;
		$this->signer   = $signer;
	}

	/**
	 * Returns every registered delivery provider.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,DeliveryProvider> Providers keyed by id.
	 */
	public function providers(): array {
		if ( null !== $this->providers ) {
			return $this->providers;
		}

		$providers = array(
			new TelegramDeliveryProvider( $this->webhook, $this->settings ),
			new WebhookDeliveryProvider( $this->signer ),
			new DiscordDeliveryProvider(),
			new SlackDeliveryProvider(),
			new EmailDeliveryProvider(),
		);

		/**
		 * Filters the registered delivery providers.
		 *
		 * Append a class implementing {@see DeliveryProvider} to add a
		 * service. The core plugin needs no change for a new destination:
		 * the Destinations screen builds its settings form from the
		 * provider's own schema.
		 *
		 * @since 1.5.0
		 *
		 * @param DeliveryProvider[] $providers Provider instances.
		 */
		$providers = (array) apply_filters( 'wpep_delivery_providers', $providers );

		$indexed = array();

		foreach ( $providers as $provider ) {
			if ( $provider instanceof DeliveryProvider ) {
				$indexed[ $provider->id() ] = $provider;
			}
		}

		$this->providers = $indexed;

		return $indexed;
	}

	/**
	 * Returns one provider.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id Provider identifier.
	 *
	 * @return DeliveryProvider|null Provider, null when unknown.
	 */
	public function provider( string $id ): ?DeliveryProvider {
		return $this->providers()[ $id ] ?? null;
	}

	/**
	 * Returns every configured destination.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,array<string,mixed>> Destinations keyed by id.
	 */
	public function all(): array {
		if ( null !== $this->destinations ) {
			return $this->destinations;
		}

		$stored = get_option( self::OPTION, array() );
		$clean  = array();

		if ( is_array( $stored ) ) {
			foreach ( $stored as $id => $destination ) {
				if ( ! is_array( $destination ) ) {
					continue;
				}

				$id = Profile::sanitize_id( (string) ( $destination['id'] ?? $id ) );

				if ( '' === $id ) {
					continue;
				}

				$clean[ $id ] = $this->normalize( array_merge( $destination, array( 'id' => $id ) ) );
			}
		}

		$this->destinations = $clean;

		return $clean;
	}

	/**
	 * Fills in a destination's structure.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $destination Raw destination.
	 *
	 * @return array<string,mixed> Complete destination.
	 */
	private function normalize( array $destination ): array {
		$provider_id = Profile::sanitize_id( (string) ( $destination['provider'] ?? TelegramDeliveryProvider::ID ) );
		$provider    = $this->provider( $provider_id );

		$config = (array) ( $destination['config'] ?? array() );

		if ( $provider instanceof DeliveryProvider ) {
			try {
				$config = $provider->initialize( $config );
			} catch ( \Throwable $e ) {
				// A provider that cannot prepare its own configuration must
				// not take the screen down with it.
				unset( $e );
			}
		}

		return array(
			'id'       => (string) $destination['id'],
			'name'     => trim( (string) ( $destination['name'] ?? $destination['id'] ) ),
			'provider' => $provider_id,
			'enabled'  => ! isset( $destination['enabled'] ) || ! empty( $destination['enabled'] ),
			'profile'  => Profile::sanitize_id( (string) ( $destination['profile'] ?? '' ) ),
			'template' => (string) ( $destination['template'] ?? '' ),
			'delay'    => max( 0, (int) ( $destination['delay'] ?? 0 ) ),
			'images'   => isset( $destination['images'] ) ? max( -1, (int) $destination['images'] ) : -1,
			'config'   => $config,
			'created'  => (string) ( $destination['created'] ?? gmdate( 'Y-m-d H:i:s' ) ),
			'updated'  => (string) ( $destination['updated'] ?? gmdate( 'Y-m-d H:i:s' ) ),
		);
	}

	/**
	 * Returns one destination.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id Destination identifier.
	 *
	 * @return array<string,mixed>|null Destination, null when unknown.
	 */
	public function find( string $id ): ?array {
		return $this->all()[ Profile::sanitize_id( $id ) ] ?? null;
	}

	/**
	 * Whether a destination exists.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id Destination identifier.
	 *
	 * @return bool True when configured.
	 */
	public function exists( string $id ): bool {
		return null !== $this->find( $id );
	}

	/**
	 * Returns every enabled destination.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,array<string,mixed>> Enabled destinations.
	 */
	public function enabled(): array {
		return array_filter( $this->all(), static fn( array $d ): bool => ! empty( $d['enabled'] ) );
	}

	/**
	 * Stores a destination.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $destination Destination to store.
	 *
	 * @return bool True when written.
	 */
	public function save( array $destination ): bool {
		$id = Profile::sanitize_id( (string) ( $destination['id'] ?? '' ) );

		if ( '' === $id ) {
			return false;
		}

		$destinations         = $this->all();
		$destination['id']    = $id;
		$destination['updated'] = gmdate( 'Y-m-d H:i:s' );

		$destinations[ $id ] = $this->normalize( $destination );

		return $this->persist( $destinations );
	}

	/**
	 * Deletes a destination.
	 *
	 * @since 1.5.0
	 *
	 * @param string $id Destination identifier.
	 *
	 * @return bool True when deleted.
	 */
	public function delete( string $id ): bool {
		$id           = Profile::sanitize_id( $id );
		$destinations = $this->all();

		if ( ! isset( $destinations[ $id ] ) ) {
			return false;
		}

		unset( $destinations[ $id ] );

		return $this->persist( $destinations );
	}

	/**
	 * Copies a destination under a new identifier.
	 *
	 * The copy is created disabled: two identical destinations publishing
	 * the same advertisement twice is never what someone means by
	 * "duplicate".
	 *
	 * @since 1.5.0
	 *
	 * @param string $id   Destination to copy.
	 * @param string $name Name for the copy.
	 *
	 * @return array<string,mixed>|null The copy, null when the source is unknown.
	 */
	public function duplicate( string $id, string $name = '' ): ?array {
		$source = $this->find( $id );

		if ( null === $source ) {
			return null;
		}

		if ( '' === trim( $name ) ) {
			/* translators: %s: source destination name. */
			$name = sprintf( __( '%s (copy)', 'wp-event-publisher' ), (string) $source['name'] );
		}

		$copy = array_merge(
			$source,
			array(
				'id'      => $this->unique_id( $name ),
				'name'    => $name,
				'enabled' => false,
				'created' => gmdate( 'Y-m-d H:i:s' ),
			)
		);

		return $this->save( $copy ) ? $this->find( (string) $copy['id'] ) : null;
	}

	/**
	 * Builds an identifier that is not taken.
	 *
	 * @since 1.5.0
	 *
	 * @param string $name Desired name.
	 *
	 * @return string Free identifier.
	 */
	public function unique_id( string $name ): string {
		$base = Profile::sanitize_id( $name );
		$base = '' === $base ? 'destination' : $base;
		$id   = $base;
		$n    = 2;

		while ( $this->exists( $id ) ) {
			$id = $base . '_' . $n;
			++$n;
		}

		return $id;
	}

	/**
	 * Reports what is wrong with a destination.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,mixed> $destination Destination to check.
	 *
	 * @return string[] Problems found.
	 */
	public function validate( array $destination ): array {
		$problems = array();

		if ( '' === trim( (string) ( $destination['name'] ?? '' ) ) ) {
			$problems[] = __( 'The destination needs a name.', 'wp-event-publisher' );
		}

		$provider = $this->provider( (string) ( $destination['provider'] ?? '' ) );

		if ( ! $provider instanceof DeliveryProvider ) {
			$problems[] = __( 'That delivery provider is not registered. If it came from another plugin, activate that plugin first.', 'wp-event-publisher' );

			return $problems;
		}

		try {
			$problems = array_merge( $problems, $provider->validate( (array) ( $destination['config'] ?? array() ) ) );
		} catch ( \Throwable $e ) {
			$problems[] = sprintf(
				/* translators: %s: error message. */
				__( 'The provider could not check its settings: %s', 'wp-event-publisher' ),
				$e->getMessage()
			);
		}

		return $problems;
	}

	/**
	 * Resolves the destinations one publication should reach.
	 *
	 * A rule's choice wins over the profile's, the profile's over "all
	 * enabled destinations". Anything a rule *adds* is merged on top of
	 * whichever of those applied.
	 *
	 * @since 1.5.0
	 *
	 * @param Profile     $profile Profile in use.
	 * @param RuleOutcome $outcome Rule decisions.
	 *
	 * @return array<string,array<string,mixed>> Destinations to publish to.
	 */
	public function resolve( Profile $profile, RuleOutcome $outcome ): array {
		$enabled = $this->enabled();

		$chosen = $outcome->destinations();

		if ( empty( $chosen ) ) {
			$chosen = $profile->destinations();
		}

		$selected = array();

		if ( empty( $chosen ) ) {
			$selected = $enabled;
		} else {
			foreach ( $chosen as $id ) {
				if ( isset( $enabled[ $id ] ) ) {
					$selected[ $id ] = $enabled[ $id ];
				}
			}
		}

		foreach ( $outcome->added_destinations() as $id ) {
			if ( isset( $enabled[ $id ] ) ) {
				$selected[ $id ] = $enabled[ $id ];
			}
		}

		/**
		 * Filters the destinations one publication will reach.
		 *
		 * @since 1.5.0
		 *
		 * @param array<string,array<string,mixed>> $selected Destinations.
		 * @param Profile                           $profile  Profile in use.
		 * @param RuleOutcome                       $outcome  Rule decisions.
		 */
		return (array) apply_filters( 'wpep_resolved_destinations', $selected, $profile, $outcome );
	}

	/**
	 * Creates the destination an upgraded installation needs.
	 *
	 * It carries no configuration of its own, so it publishes to the
	 * endpoint and credentials in Settings — exactly what the plugin did
	 * before destinations existed.
	 *
	 * @since 1.5.0
	 *
	 * @return array<string,mixed> The primary destination.
	 */
	public function ensure_primary(): array {
		$existing = $this->find( self::PRIMARY_ID );

		if ( null !== $existing ) {
			return $existing;
		}

		$destination = array(
			'id'       => self::PRIMARY_ID,
			'name'     => __( 'Telegram Publisher', 'wp-event-publisher' ),
			'provider' => TelegramDeliveryProvider::ID,
			'enabled'  => true,
			'config'   => array(),
		);

		$this->save( $destination );

		return $this->find( self::PRIMARY_ID ) ?? $destination;
	}

	/**
	 * Writes the destination option and drops the cache.
	 *
	 * @since 1.5.0
	 *
	 * @param array<string,array<string,mixed>> $destinations Destinations.
	 *
	 * @return bool True when written.
	 */
	private function persist( array $destinations ): bool {
		$this->destinations = $destinations;

		return update_option( self::OPTION, $destinations, false );
	}

	/**
	 * Registers the hooks other components use to ask about destinations.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function register(): void {
		add_filter(
			'wpep_destination_exists',
			function ( bool $known, string $id ): bool {
				unset( $known );

				return $this->exists( $id );
			},
			10,
			2
		);
	}

	/**
	 * Drops the in-memory caches.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function flush(): void {
		$this->destinations = null;
		$this->providers    = null;
	}
}
