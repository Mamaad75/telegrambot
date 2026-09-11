<?php
/**
 * Version upgrade and data migration.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Brings an existing installation up to the current plugin version.
 *
 * Migrations are additive and idempotent: they only fill in what a newer
 * version needs, never rewrite or discard what an older version stored.
 * A site upgrading from 1.0.0 or 1.1.0 keeps its settings, its logs and
 * its delivery history, and keeps publishing without any manual step.
 *
 * @since 1.1.0
 */
class Migrator {

	/**
	 * Option storing the plugin version an installation last ran.
	 *
	 * @var string
	 */
	public const OPTION_VERSION = 'wpep_version';

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Logger dependency.
	 *
	 * @var Logger
	 */
	private Logger $logger;

	/**
	 * Constructor.
	 *
	 * @since 1.1.0
	 *
	 * @param Settings $settings Settings service.
	 * @param Logger   $logger   Logger service.
	 */
	public function __construct( Settings $settings, Logger $logger ) {
		$this->settings = $settings;
		$this->logger   = $logger;
	}

	/**
	 * Returns the version an installation last ran.
	 *
	 * Installations from before version 1.1.0 predate this option; they
	 * are recognised by the presence of the settings option and reported
	 * as 1.0.0 so their migrations run.
	 *
	 * @since 1.1.0
	 *
	 * @return string Semantic version, empty string for a fresh install.
	 */
	public function installed_version(): string {
		$version = (string) get_option( self::OPTION_VERSION, '' );

		if ( '' !== $version ) {
			return $version;
		}

		return false === get_option( Settings::OPTION, false ) ? '' : '1.0.0';
	}

	/**
	 * Runs any migration the installation still needs.
	 *
	 * Safe to call on every request: the common path is a single option
	 * read and a version comparison.
	 *
	 * @since 1.1.0
	 *
	 * @return void
	 */
	public function maybe_migrate(): void {
		$from = $this->installed_version();

		if ( WPEP_VERSION === $from ) {
			return;
		}

		if ( '' === $from ) {
			// Fresh installation: activation already prepared everything.
			$this->finish( $from );

			return;
		}

		if ( version_compare( $from, '1.1.0', '<' ) ) {
			$this->to_1_1_0();
		}

		if ( version_compare( $from, '1.2.0', '<' ) ) {
			$this->to_1_2_0();
		}

		if ( version_compare( $from, '1.2.1', '<' ) ) {
			$this->to_1_2_1();
		}

		if ( version_compare( $from, '1.3.0', '<' ) ) {
			$this->to_1_3_0();
		}

		if ( version_compare( $from, '1.3.1', '<' ) ) {
			$this->to_1_3_1();
		}

		if ( version_compare( $from, '1.3.2', '<' ) ) {
			$this->to_1_3_2();
		}

		if ( version_compare( $from, '1.4.0', '<' ) ) {
			$this->to_1_4_0();
		}

		if ( version_compare( $from, '1.5.0', '<' ) ) {
			$this->to_1_5_0();
		}

		if ( version_compare( $from, '1.6.0', '<' ) ) {
			$this->to_1_6_0();
		}

		$this->finish( $from );
	}

	/**
	 * Migrates an installation to version 1.1.0.
	 *
	 * Adds the event columns to the log table and gives the two new
	 * settings safe values, so an upgraded site keeps delivering without
	 * anyone visiting the settings screen.
	 *
	 * @since 1.1.0
	 *
	 * @return void
	 */
	private function to_1_1_0(): void {
		// Adds event_id, event_type and site_id to the log table. dbDelta
		// only appends the missing columns; existing rows are untouched.
		$this->logger->install();

		$settings = $this->stored_settings();

		if ( empty( $settings['site_id'] ) ) {
			$settings['site_id'] = $this->settings->derive_site_id();
		}

		if ( ! isset( $settings['signature_tolerance'] ) ) {
			$settings['signature_tolerance'] = 300;
		}

		$this->store_settings( $settings );

		/**
		 * Fires after the 1.1.0 migration has run.
		 *
		 * @since 1.1.0
		 */
		do_action( 'wpep_migrated_to_1_1_0' );
	}

	/**
	 * Migrates an installation to version 1.2.0.
	 *
	 * Adds the lifecycle columns to the log table, seeds the settings
	 * introduced in this release and points installations that never had
	 * an endpoint at the default production webhook. Anything the
	 * administrator already configured is left exactly as it is.
	 *
	 * @since 1.2.0
	 *
	 * @return void
	 */
	private function to_1_2_0(): void {
		// Adds stage, attempt and message to the log table.
		$this->logger->install();

		$settings = $this->stored_settings();
		$defaults = $this->settings->defaults();

		foreach ( array( 'allowed_event_types', 'dispatch_mode', 'auth_style', 'debug_mode', 'trash_as_deleted', 'price_meta_keys', 'location_meta_keys', 'image_meta_keys', 'description_source', 'max_images' ) as $key ) {
			if ( ! array_key_exists( $key, $settings ) ) {
				$settings[ $key ] = $defaults[ $key ];
			}
		}

		if ( empty( $settings['node_api_url'] ) ) {
			$settings['node_api_url'] = Settings::DEFAULT_ENDPOINT;
		}

		if ( empty( $settings['allowed_post_statuses'] ) ) {
			$settings['allowed_post_statuses'] = array( 'publish' );
		}

		$this->store_settings( $settings );

		/**
		 * Fires after the 1.2.0 migration has run.
		 *
		 * @since 1.2.0
		 */
		do_action( 'wpep_migrated_to_1_2_0' );
	}

	/**
	 * Migrates an installation to version 1.2.1.
	 *
	 * Seeds the settings introduced in this release and repairs a webhook
	 * timeout that is too small to survive a TLS handshake — the value
	 * behind "cURL error 28: Operation timed out after 3002 milliseconds"
	 * on an endpoint that is actually healthy.
	 *
	 * @since 1.2.1
	 *
	 * @return void
	 */
	private function to_1_2_1(): void {
		$settings = $this->stored_settings();
		$defaults = $this->settings->defaults();

		foreach ( array( 'phone_meta_keys', 'admin_locale' ) as $key ) {
			if ( ! array_key_exists( $key, $settings ) ) {
				$settings[ $key ] = $defaults[ $key ];
			}
		}

		$timeout = (int) ( $settings['webhook_timeout'] ?? 0 );

		if ( $timeout > 0 && $timeout < 10 ) {
			$settings['webhook_timeout'] = 15;

			$this->logger->event(
				'migration.timeout',
				Logger::STATUS_INFO,
				sprintf(
					/* translators: %d: previous timeout in seconds. */
					__( 'The webhook timeout was %d seconds, which is too short for a remote TLS handshake and produces spurious cURL error 28 failures. It has been raised to 15 seconds.', 'wp-event-publisher' ),
					$timeout
				)
			);
		}

		$this->store_settings( $settings );

		/**
		 * Fires after the 1.2.1 migration has run.
		 *
		 * @since 1.2.1
		 */
		do_action( 'wpep_migrated_to_1_2_1' );
	}

	/**
	 * Migrates an installation to version 1.3.0.
	 *
	 * Creates the queue table and carries any event still held in the old
	 * transient store across, so an upgrade performed while advertisements
	 * are in flight does not drop them.
	 *
	 * @since 1.3.0
	 *
	 * @return void
	 */
	private function to_1_3_0(): void {
		global $wpdb;

		$queue = new Queue();
		$queue->install();

		$settings = $this->stored_settings();
		$defaults = $this->settings->defaults();

		foreach ( array( 'post_type_mode', 'connect_timeout', 'custom_headers', 'queue_retention_days' ) as $key ) {
			if ( ! array_key_exists( $key, $settings ) ) {
				$settings[ $key ] = $defaults[ $key ];
			}
		}

		$this->store_settings( $settings );

		// Move in-flight events out of the transient store.
		$index = get_option( 'wpep_event_index', array() );
		$moved = 0;

		if ( is_array( $index ) ) {
			foreach ( array_keys( $index ) as $event_id ) {
				$data = get_transient( 'wpep_evt_' . md5( (string) $event_id ) );

				if ( ! is_array( $data ) ) {
					continue;
				}

				$event = Event::from_array( $data );

				if ( $event instanceof Event && $queue->push( $event ) ) {
					++$moved;
				}

				delete_transient( 'wpep_evt_' . md5( (string) $event_id ) );
			}
		}

		delete_option( 'wpep_event_index' );

		// The completion markers become queue rows, so the transients that
		// used to carry them are no longer read by anything.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off upgrade cleanup.
		$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_wpep_done_%' OR option_name LIKE '_transient_timeout_wpep_done_%'" );

		$this->logger->event(
			'migration.queue',
			Logger::STATUS_INFO,
			sprintf(
				/* translators: %d: number of migrated events. */
				__( 'The delivery queue now lives in its own database table instead of transients, which an object cache could evict. %d in-flight events were carried over.', 'wp-event-publisher' ),
				$moved
			)
		);

		/**
		 * Fires after the 1.3.0 migration has run.
		 *
		 * @since 1.3.0
		 */
		do_action( 'wpep_migrated_to_1_3_0' );
	}

	/**
	 * Migrates an installation to version 1.3.1.
	 *
	 * No schema change: it only re-derives the autoloaded flag that tells
	 * the sweeper whether anything is waiting, so an upgrade performed with
	 * a non-empty queue does not leave those events unattended.
	 *
	 * @since 1.3.1
	 *
	 * @return void
	 */
	private function to_1_3_1(): void {
		$queue = new Queue();
		$queue->maybe_install();
		$queue->set_work_flag( $queue->count_pending() > 0 );

		/**
		 * Fires after the 1.3.1 migration has run.
		 *
		 * @since 1.3.1
		 */
		do_action( 'wpep_migrated_to_1_3_1' );
	}

	/**
	 * Migrates an installation to version 1.3.2.
	 *
	 * No schema change. It records where the site's back catalogue ends, so
	 * that editing an advertisement published long before this upgrade is
	 * treated as an edit rather than as a first announcement. Anything
	 * published from now on is announced normally.
	 *
	 * @since 1.3.2
	 *
	 * @return void
	 */
	private function to_1_3_2(): void {
		// add_option() never overwrites, so a site that already carries the
		// marker keeps its original line.
		$added = add_option( 'wpep_installed_at', time(), '', false );

		if ( $added ) {
			$this->logger->event(
				'migration.backfill',
				Logger::STATUS_INFO,
				__( 'Advertisements published before this upgrade are now treated as back catalogue: editing one no longer announces it as new. Use Tools → Send One Advertisement Now to send an older advertisement deliberately.', 'wp-event-publisher' )
			);
		}

		/**
		 * Fires after the 1.3.2 migration has run.
		 *
		 * @since 1.3.2
		 */
		do_action( 'wpep_migrated_to_1_3_2' );
	}

	/**
	 * Migrates an installation to version 1.4.0.
	 *
	 * Field mappings arrive in this release. Nothing is written: a post type
	 * with no stored mapping falls back to the generated default, which
	 * reproduces exactly the payload the site was already sending, so an
	 * upgrade changes nothing downstream until somebody opens the Field
	 * Mapping screen and decides otherwise.
	 *
	 * What this does do is drop the discovery cache, because the providers
	 * that fill it did not exist a moment ago.
	 *
	 * @since 1.4.0
	 *
	 * @return void
	 */
	private function to_1_4_0(): void {
		update_option( FieldRegistry::OPTION_GENERATION, (string) time(), false );

		$this->logger->event(
			'migration.fields',
			Logger::STATUS_INFO,
			__( 'تنظیم فیلدها از مسیر جارچی ← فیلدها در دسترس است. تا زمانی که تنظیمی ذخیره نشود، هر نوع محتوا دقیقاً همان چیزی را می‌فرستد که پیش‌تر می‌فرستاد؛ بنابراین ارتقا چیزی را تغییر نمی‌دهد.', 'wp-event-publisher' )
		);

		/**
		 * Fires after the 1.4.0 migration has run.
		 *
		 * @since 1.4.0
		 */
		do_action( 'wpep_migrated_to_1_4_0' );
	}

	/**
	 * Migrates an installation to version 1.6.0.
	 *
	 * Deliberately conservative. 1.6.0 changes a great deal of the interface and
	 * almost nothing about the data, and the one thing it must not do is change
	 * what a live site publishes.
	 *
	 * What it writes:
	 *
	 * - `wpep_field_defaults_mode` = `legacy`, so a site that never saved a
	 *   field mapping keeps sending exactly what 1.5.x sent. New installations
	 *   get `off` from the activation hook instead.
	 * - `wpep_platforms` defaults, with Telegram inheriting whatever the site
	 *   had configured and Bale and WhatsApp off. Nobody was publishing to two
	 *   platforms that did not exist, so switching them on would be inventing
	 *   traffic.
	 *
	 * What it deliberately does **not** do: delete a single legacy option.
	 * `price_meta_keys`, `location_meta_keys`, `phone_meta_keys`,
	 * `image_meta_keys`, `allowed_post_statuses` and `custom_headers` all leave
	 * the settings screen in this release, and all of them stay in the database.
	 * They are still read by the normaliser, and a site that downgrades or an
	 * administrator who wants them back loses nothing.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	private function to_1_6_0(): void {
		// Existing sites keep the 1.5.x field defaults. add_option() is a no-op
		// when the value already exists, so a reactivation cannot flip a site
		// that has already been decided.
		add_option( FieldMapping::OPTION_DEFAULTS_MODE, FieldMapping::DEFAULTS_LEGACY, '', false );

		$settings = $this->stored_settings();

		// Telegram inherits the site's existing enabled state: an upgraded site
		// that was publishing keeps publishing, one that was switched off stays
		// off. Bale and WhatsApp are new and start closed.
		if ( ! isset( $settings['platforms'] ) ) {
			$telegram_was_live = ! empty( $settings['enabled'] ) && ! empty( $settings['webhooks_enabled'] );

			$settings['platforms'] = array(
				'telegram' => array( 'enabled' => $telegram_was_live ),
				'bale'     => array( 'enabled' => false ),
				'whatsapp' => array( 'enabled' => false ),
			);

			$this->store_settings( $settings );
		}

		$this->logger->event(
			'migration.platforms',
			Logger::STATUS_INFO,
			__( 'جارچی ۱.۶.۰ نصب شد. تنظیم فیلدها، کلیدهای قدیمی و تاریخچه انتقال دست‌نخورده باقی مانده‌اند. بله و واتس‌اپ به‌صورت پیش‌فرض خاموش هستند و از منوی جارچی فعال می‌شوند.', 'wp-event-publisher' )
		);

		/**
		 * Fires after the 1.6.0 migration has run.
		 *
		 * @since 1.6.0
		 */
		do_action( 'wpep_migrated_to_1_6_0' );
	}

	/**
	 * Migrates an installation to version 1.5.0.
	 *
	 * Profiles, rules and destinations arrive in this release. The
	 * migration creates exactly enough of each that an upgraded site keeps
	 * behaving identically, and not one thing more:
	 *
	 * - a **Default profile** carrying whatever the 1.4.0 mapping screen
	 *   stored for the post type scope, so the fields, labels, order and
	 *   template an administrator already chose are what the profile
	 *   system starts from;
	 * - one **primary destination** with no configuration of its own,
	 *   which therefore publishes to the endpoint and credentials in
	 *   Settings — the same request to the same place;
	 * - **no rules at all**, because a site with no rules publishes
	 *   everything, which is the pre-1.5.0 behaviour. A default
	 *   "publish everything" rule would be a no-op that only makes the
	 *   Rules screen look busier.
	 *
	 * Nothing existing is rewritten or removed: the 1.4.0 mapping option
	 * stays exactly where it is and keeps working for any scope no profile
	 * is assigned to.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	private function to_1_5_0(): void {
		$profiles = get_option( ProfileRepository::OPTION, array() );

		if ( ! is_array( $profiles ) || ! isset( $profiles[ Profile::DEFAULT_ID ] ) ) {
			$mappings = get_option( FieldMapping::OPTION, array() );
			$fields   = array();
			$template = '';

			// The broadest stored scope is the closest thing an upgraded
			// site has to "how this site publishes".
			if ( is_array( $mappings ) ) {
				foreach ( $mappings as $scope => $mapping ) {
					if ( ! is_array( $mapping ) || str_contains( (string) $scope, ':' ) ) {
						continue;
					}

					if ( ! empty( $mapping['fields'] ) && empty( $fields ) ) {
						$fields = (array) $mapping['fields'];
					}

					if ( '' === $template && ! empty( $mapping['template'] ) ) {
						$template = (string) $mapping['template'];
					}
				}
			}

			$profiles = is_array( $profiles ) ? $profiles : array();

			$profiles[ Profile::DEFAULT_ID ] = ( new Profile(
				array(
					'id'       => Profile::DEFAULT_ID,
					'name'     => __( 'Default profile', 'wp-event-publisher' ),
					'fields'   => $fields,
					'template' => $template,
					'locked'   => true,
				)
			) )->to_array();

			update_option( ProfileRepository::OPTION, $profiles, false );
		}

		$destinations = get_option( DestinationRegistry::OPTION, array() );

		if ( ! is_array( $destinations ) || empty( $destinations ) ) {
			update_option(
				DestinationRegistry::OPTION,
				array(
					DestinationRegistry::PRIMARY_ID => array(
						'id'       => DestinationRegistry::PRIMARY_ID,
						'name'     => __( 'Telegram Publisher', 'wp-event-publisher' ),
						'provider' => TelegramDeliveryProvider::ID,
						'enabled'  => true,
						'config'   => array(),
						'created'  => gmdate( 'Y-m-d H:i:s' ),
						'updated'  => gmdate( 'Y-m-d H:i:s' ),
					),
				),
				false
			);
		}

		$this->logger->event(
			'migration.platform',
			Logger::STATUS_INFO,
			__( 'Profiles, Rules and Destinations are now available. A Default profile was created from the field mapping this site already had, and the Telegram Publisher webhook became its first destination, so nothing about what is published or where it goes has changed.', 'wp-event-publisher' )
		);

		/**
		 * Fires after the 1.5.0 migration has run.
		 *
		 * @since 1.5.0
		 */
		do_action( 'wpep_migrated_to_1_5_0' );
	}

	/**
	 * Reads the raw stored settings.
	 *
	 * @since 1.2.0
	 *
	 * @return array<string,mixed> Stored settings.
	 */
	private function stored_settings(): array {
		$settings = get_option( Settings::OPTION, array() );

		return is_array( $settings ) ? $settings : array();
	}

	/**
	 * Writes the raw settings back and refreshes the runtime cache.
	 *
	 * @since 1.2.0
	 *
	 * @param array<string,mixed> $settings Settings to store.
	 *
	 * @return void
	 */
	private function store_settings( array $settings ): void {
		update_option( Settings::OPTION, $settings );
		$this->settings->flush_cache();
	}

	/**
	 * Records the version the installation now runs.
	 *
	 * @since 1.1.0
	 *
	 * @param string $from Version migrated from.
	 *
	 * @return void
	 */
	private function finish( string $from ): void {
		update_option( self::OPTION_VERSION, WPEP_VERSION );

		/**
		 * Fires after the plugin finished migrating to a new version.
		 *
		 * @since 1.1.0
		 *
		 * @param string $to   Version now installed.
		 * @param string $from Version migrated from, empty for a fresh install.
		 */
		do_action( 'wpep_migrated', WPEP_VERSION, $from );
	}
}
