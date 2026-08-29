<?php
/**
 * Main plugin container.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Plugin service container and lifecycle manager.
 *
 * Instantiates every service exactly once, wires them together and owns
 * the activation / deactivation lifecycle. All services are resolved
 * lazily so that unused subsystems cost nothing on the front end.
 *
 * @since 1.0.0
 */
final class Plugin {

	/**
	 * Shared instance.
	 *
	 * @var Plugin|null
	 */
	private static ?Plugin $instance = null;

	/**
	 * Settings service.
	 *
	 * @var Settings|null
	 */
	private ?Settings $settings = null;

	/**
	 * Validator service.
	 *
	 * @var Validator|null
	 */
	private ?Validator $validator = null;

	/**
	 * Logger service.
	 *
	 * @var Logger|null
	 */
	private ?Logger $logger = null;

	/**
	 * Normalizer service.
	 *
	 * @var Normalizer|null
	 */
	private ?Normalizer $normalizer = null;

	/**
	 * Webhook client.
	 *
	 * @var Webhook|null
	 */
	private ?Webhook $webhook = null;

	/**
	 * Hook manager (event detection).
	 *
	 * @var Hooks|null
	 */
	private ?Hooks $hooks = null;

	/**
	 * Signature service.
	 *
	 * @var Signer|null
	 */
	private ?Signer $signer = null;

	/**
	 * Contract builder.
	 *
	 * @var Contract|null
	 */
	private ?Contract $contract = null;

	/**
	 * Event identifier service.
	 *
	 * @var EventId|null
	 */
	private ?EventId $event_id = null;

	/**
	 * Event store (legacy facade over the queue).
	 *
	 * @var EventStore|null
	 */
	private ?EventStore $event_store = null;

	/**
	 * Durable delivery queue.
	 *
	 * @var Queue|null
	 */
	private ?Queue $queue = null;

	/**
	 * Retry policy.
	 *
	 * @var RetryPolicy|null
	 */
	private ?RetryPolicy $retry = null;

	/**
	 * Field resolution across field frameworks.
	 *
	 * @var FieldMap|null
	 */
	private ?FieldMap $field_map = null;

	/**
	 * Field discovery across providers.
	 *
	 * @var FieldRegistry|null
	 */
	private ?FieldRegistry $field_registry = null;

	/**
	 * Field value resolver.
	 *
	 * @var FieldResolver|null
	 */
	private ?FieldResolver $field_resolver = null;

	/**
	 * Field mapping store.
	 *
	 * @var FieldMapping|null
	 */
	private ?FieldMapping $field_mapping = null;

	/**
	 * Per-post publication channel metabox.
	 *
	 * @since 1.6.0
	 * @var ChannelMetabox|null
	 */
	private ?ChannelMetabox $channel_metabox = null;

	/**
	 * WooCommerce order events.
	 *
	 * @since 1.7.0
	 * @var WooCommerceOrders|null
	 */
	private ?WooCommerceOrders $orders = null;

	/**
	 * Announcement placement registry.
	 *
	 * @since 1.7.0
	 * @var AnnouncementPlacements|null
	 */
	private ?AnnouncementPlacements $placements = null;

	/**
	 * Admin application shell.
	 *
	 * @since 1.7.0
	 * @var AdminShell|null
	 */
	private ?AdminShell $admin_shell = null;

	/**
	 * Announcement builder screen.
	 *
	 * @since 1.7.1
	 * @var AnnouncementBuilder|null
	 */
	private ?AnnouncementBuilder $announcement_builder = null;

	/**
	 * Announcement post type.
	 *
	 * @since 1.6.0
	 * @var Announcements|null
	 */
	private ?Announcements $announcements = null;

	/**
	 * Ticketing and support center.
	 *
	 * @since 1.7.6
	 * @var Tickets|null
	 */
	private ?Tickets $tickets = null;

	/** @var TicketSms|null */
	private ?TicketSms $tickets_sms = null;

	/** @var CustomerHub|null */
	private ?CustomerHub $customer_hub = null;

	/** @var TicketOperations|null */
	private ?TicketOperations $ticket_operations = null;

	/** @var TicketNotifications|null */
	private ?TicketNotifications $ticket_notifications = null;

	/** @var TicketAutomations|null */
	private ?TicketAutomations $ticket_automations = null;

	/**
	 * Ticket cleanup service.
	 *
	 * @var TicketCleanup|null
	 */
	private ?TicketCleanup $ticket_cleanup = null;

	/**
	 * Announcement front end.
	 *
	 * @since 1.6.0
	 * @var AnnouncementsFrontend|null
	 */
	private ?AnnouncementsFrontend $announcements_frontend = null;

	/**
	 * Message template renderer.
	 *
	 * @var MessageTemplate|null
	 */
	private ?MessageTemplate $message_template = null;

	/**
	 * Mapped field payload assembler.
	 *
	 * @var DynamicPayload|null
	 */
	private ?DynamicPayload $dynamic_payload = null;

	/**
	 * Profile repository.
	 *
	 * @var ProfileRepository|null
	 */
	private ?ProfileRepository $profiles = null;

	/**
	 * Rule engine.
	 *
	 * @var RuleEngine|null
	 */
	private ?RuleEngine $rules = null;

	/**
	 * Destination registry.
	 *
	 * @var DestinationRegistry|null
	 */
	private ?DestinationRegistry $destinations = null;

	/**
	 * Publication workflow.
	 *
	 * @var Publisher|null
	 */
	private ?Publisher $publisher = null;

	/**
	 * Platform admin screens.
	 *
	 * @var PlatformAdmin|null
	 */
	private ?PlatformAdmin $platform_admin = null;

	/**
	 * Hook router.
	 *
	 * @var HookRouter|null
	 */
	private ?HookRouter $router = null;

	/**
	 * Diagnostics service.
	 *
	 * @var Diagnostics|null
	 */
	private ?Diagnostics $diagnostics = null;

	/**
	 * Event detector.
	 *
	 * @var EventDetector|null
	 */
	private ?EventDetector $detector = null;

	/**
	 * Delivery dispatcher.
	 *
	 * @var Dispatcher|null
	 */
	private ?Dispatcher $dispatcher = null;

	/**
	 * Migration runner.
	 *
	 * @var Migrator|null
	 */
	private ?Migrator $migrator = null;

	/**
	 * REST controller.
	 *
	 * @var Rest|null
	 */
	private ?Rest $rest = null;

	/**
	 * Admin UI controller.
	 *
	 * @var Admin|null
	 */
	private ?Admin $admin = null;

	/**
	 * Field Mapping screen controller.
	 *
	 * @var FieldMappingAdmin|null
	 */
	private ?FieldMappingAdmin $field_mapping_admin = null;

	/**
	 * Whether boot() already ran.
	 *
	 * @var bool
	 */
	private bool $booted = false;

	/**
	 * Private constructor; use instance().
	 */
	private function __construct() {}

	/**
	 * Prevents cloning of the container.
	 *
	 * @return void
	 */
	private function __clone() {}

	/**
	 * Returns the shared plugin instance.
	 *
	 * @since 1.0.0
	 *
	 * @return Plugin Shared instance.
	 */
	public static function instance(): Plugin {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	/**
	 * Boots every subsystem. Idempotent.
	 *
	 * Fires the `wpep_booted` action once all services are registered so
	 * third parties can safely interact with the container.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public function boot(): void {
		if ( $this->booted ) {
			return;
		}

		$this->booted = true;

		try {
			$this->boot_services();
		} catch ( \Throwable $e ) {
			// A publishing plugin must never be the reason an administrator
			// cannot reach their own dashboard. Anything unexpected during
			// boot becomes a notice naming the file and line, and the rest of
			// WordPress carries on.
			$this->report_failure( $e, __( 'بارگذاری جارچی کامل نشد.', 'wp-event-publisher' ) );

			return;
		}

		/**
		 * Fires after Jarchi finished booting.
		 *
		 * @since 1.0.0
		 *
		 * @param Plugin $plugin Plugin container instance.
		 */
		do_action( 'wpep_booted', $this );
	}

	/**
	 * Wires and registers every subsystem.
	 *
	 * Separated from {@see self::boot()} so the guard around it stays one
	 * readable block.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	private function boot_services(): void {

		// The plugin ships its own Persian translation. Resolving the
		// locale for this text domain alone keeps the rest of the admin in
		// whatever language the site uses.
		add_filter( 'plugin_locale', array( $this, 'filter_plugin_locale' ), 10, 2 );

		load_plugin_textdomain( 'wp-event-publisher', false, dirname( WPEP_PLUGIN_BASENAME ) . '/languages' );

		// Bring an installation upgraded from an older release up to date
		// before anything reads the new settings or log columns.
		$this->migrator()->maybe_migrate();

		// Keep the log and queue schemas current after plugin updates.
		$this->logger()->maybe_upgrade();
		$this->queue()->maybe_install();

		// The event ledger is what makes duplicate automated tickets
		// impossible, so a site upgraded rather than freshly activated must
		// get it too — otherwise the protection silently is not there.
		AutomationLedger::install();

		$this->settings()->register();
		$this->router()->register();
		$this->dispatcher()->register();
		$this->field_registry()->register();
		$this->destinations()->register();
		$this->publisher()->register();
		$this->rest()->register();
		$this->announcements()->register();
		$this->tickets()->register();
		$this->ticket_notifications()->register();
		$this->ticket_automations()->register();
		$this->ticket_cleanup()->register();
		$this->ticket_operations()->register();
		$this->customer_hub()->register();
		// Registers nothing when WooCommerce is absent.
		$this->orders()->register();
		$this->announcements_frontend()->register();
		$this->placements()->register();

		// JetFormBuilder captures submissions through its own hook; the
		// provider registers nothing when JetFormBuilder is absent.
		foreach ( $this->field_registry()->providers() as $wpep_provider ) {
			if ( $wpep_provider instanceof JetFormBuilderProvider ) {
				$wpep_provider->register_hooks();
			}
		}

		// The dispatcher owns retries and the queue; the publisher owns
		// rules, profiles and fan-out. Joining them here keeps the
		// dispatcher usable on its own, which is what the 1.4.0 tests
		// exercise and what a site without the platform layer runs.
		$this->dispatcher()->set_publisher( $this->publisher() );

		if ( is_admin() ) {
			$this->admin_shell()->register();
			$this->announcement_builder()->register();
			$this->admin()->register();
			$this->field_mapping_admin()->register();
			$this->platform_admin()->register();
			$this->channel_metabox()->register();
		}
	}

	/**
	 * Turns an unexpected failure into an admin notice.
	 *
	 * Never echoes anything on the front end and never re-throws: the point
	 * is that a broken third-party provider, a corrupt option or a missing
	 * file produces an explanation rather than a white screen.
	 *
	 * @since 1.5.0
	 *
	 * @param \Throwable $error   What went wrong.
	 * @param string     $context One sentence of context.
	 *
	 * @return void
	 */
	public function report_failure( \Throwable $error, string $context ): void {
		$detail = sprintf(
			/* translators: 1: error message, 2: file name, 3: line number. */
			__( '%1$s (in %2$s on line %3$d)', 'wp-event-publisher' ),
			$error->getMessage(),
			basename( $error->getFile() ),
			(int) $error->getLine()
		);

		if ( function_exists( 'error_log' ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- a failure the administrator needs to be able to find.
			error_log( 'Jarchi: ' . $context . ' ' . $detail );
		}

		if ( ! is_admin() ) {
			return;
		}

		add_action(
			'admin_notices',
			static function () use ( $context, $detail ): void {
				if ( ! current_user_can( 'manage_options' ) ) {
					return;
				}

				printf(
					'<div class="notice notice-error"><p><strong>%s</strong> %s</p><p>%s</p></div>',
					esc_html__( 'جارچی', 'wp-event-publisher' ),
					esc_html( $context ),
					esc_html( $detail )
				);
			}
		);
	}

	/**
	 * Resolves the locale used for this plugin's own translations.
	 *
	 * @since 1.2.1
	 *
	 * @param string $locale Locale WordPress resolved.
	 * @param string $domain Text domain being loaded.
	 *
	 * @return string Locale to load.
	 */
	public function filter_plugin_locale( string $locale, string $domain ): string {
		if ( 'wp-event-publisher' !== $domain ) {
			return $locale;
		}

		$configured = $this->settings()->admin_locale();

		return Settings::LOCALE_SITE === $configured ? $locale : $configured;
	}

	/**
	 * Plugin activation callback.
	 *
	 * Creates the log table, seeds default options and registers the
	 * queue sweeper.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function activate(): void {
		$plugin = self::instance();

		// Decided before anything else writes an option, because it is decided
		// by whether this database has ever held Jarchi settings. Once
		// seed_defaults() runs, that question can no longer be answered.
		$is_fresh_install = false === get_option( Settings::OPTION, false )
			&& '' === (string) get_option( Migrator::OPTION_VERSION, '' );

		$plugin->logger()->install();
		$plugin->queue()->install();
		AutomationLedger::install();
		$plugin->settings()->seed_defaults();

		// A fresh install starts with every field off, so nothing — least of all
		// a phone number — is published until an administrator chooses it. An
		// upgrade keeps the legacy defaults instead; see
		// FieldMapping::OPTION_DEFAULTS_MODE for why the two differ.
		add_option(
			FieldMapping::OPTION_DEFAULTS_MODE,
			$is_fresh_install ? FieldMapping::DEFAULTS_OFF : FieldMapping::DEFAULTS_LEGACY,
			'',
			false
		);

		// Marks where this site's back catalogue ends. Advertisements
		// published before this moment are never announced by a later edit;
		// see EventDetector::published_since_install(). add_option() leaves
		// an existing value alone, so reactivating never moves the line.
		add_option( 'wpep_installed_at', time(), '', false );

		$plugin->migrator()->maybe_migrate();
		$plugin->dispatcher()->ensure_sweep_scheduled();

		// The set of installed field frameworks may have changed while the
		// plugin was inactive.
		$plugin->field_registry()->flush();

		/**
		 * Fires when Jarchi is activated.
		 *
		 * @since 1.0.0
		 */
		do_action( 'wpep_activated' );
	}

	/**
	 * Plugin deactivation callback.
	 *
	 * Unschedules all pending webhook cron events. Data (logs, options,
	 * post meta) is intentionally preserved; removal happens in
	 * uninstall.php.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function deactivate(): void {
		wp_unschedule_hook( Dispatcher::CRON_HOOK );
		wp_unschedule_hook( Dispatcher::LEGACY_CRON_HOOK );
		wp_unschedule_hook( Dispatcher::SWEEP_HOOK );

		/**
		 * Fires when Jarchi is deactivated.
		 *
		 * @since 1.0.0
		 */
		do_action( 'wpep_deactivated' );
	}

	/**
	 * Returns the settings service.
	 *
	 * @since 1.0.0
	 *
	 * @return Settings Settings service.
	 */
	public function settings(): Settings {
		if ( null === $this->settings ) {
			$this->settings = new Settings( $this->validator() );
		}

		return $this->settings;
	}

	/**
	 * Returns the validator service.
	 *
	 * @since 1.0.0
	 *
	 * @return Validator Validator service.
	 */
	public function validator(): Validator {
		if ( null === $this->validator ) {
			$this->validator = new Validator();
		}

		return $this->validator;
	}

	/**
	 * Returns the logger service.
	 *
	 * @since 1.0.0
	 *
	 * @return Logger Logger service.
	 */
	public function logger(): Logger {
		if ( null === $this->logger ) {
			$this->logger = new Logger( $this->settings() );
		}

		return $this->logger;
	}

	/**
	 * Returns the normalizer service.
	 *
	 * @since 1.0.0
	 *
	 * @return Normalizer Normalizer service.
	 */
	public function normalizer(): Normalizer {
		if ( null === $this->normalizer ) {
			// Assign before wiring the mapping. field_mapping() resolves
			// field_registry(), which asks for this normalizer back; if the
			// property were still null at that point the container would
			// recurse into itself until the process died.
			$this->normalizer = new Normalizer( $this->settings(), $this->field_map() );
			$this->normalizer->set_field_mapping( $this->field_mapping() );
		}

		return $this->normalizer;
	}

	/**
	 * Returns the webhook client.
	 *
	 * @since 1.0.0
	 *
	 * @return Webhook Webhook client.
	 */
	public function webhook(): Webhook {
		if ( null === $this->webhook ) {
			$this->webhook = new Webhook(
				$this->settings(),
				$this->logger(),
				$this->validator(),
				$this->signer(),
				$this->contract(),
				$this->event_id()
			);
		}

		return $this->webhook;
	}

	/**
	 * Returns the signature service.
	 *
	 * @since 1.1.0
	 *
	 * @return Signer Signature service.
	 */
	public function signer(): Signer {
		if ( null === $this->signer ) {
			$this->signer = new Signer();
		}

		return $this->signer;
	}

	/**
	 * Returns the contract builder.
	 *
	 * @since 1.1.0
	 *
	 * @return Contract Contract builder.
	 */
	public function contract(): Contract {
		if ( null === $this->contract ) {
			$this->contract = new Contract( $this->settings() );
		}

		return $this->contract;
	}

	/**
	 * Returns the event identifier service.
	 *
	 * @since 1.1.0
	 *
	 * @return EventId Event identifier service.
	 */
	public function event_id(): EventId {
		if ( null === $this->event_id ) {
			$this->event_id = new EventId();
		}

		return $this->event_id;
	}

	/**
	 * Returns the event store.
	 *
	 * @since 1.1.0
	 *
	 * @return EventStore Event store.
	 */
	public function event_store(): EventStore {
		if ( null === $this->event_store ) {
			$this->event_store = new EventStore( $this->queue() );
		}

		return $this->event_store;
	}

	/**
	 * Returns the durable delivery queue.
	 *
	 * @since 1.3.0
	 *
	 * @return Queue Delivery queue.
	 */
	public function queue(): Queue {
		if ( null === $this->queue ) {
			$this->queue = new Queue();
		}

		return $this->queue;
	}

	/**
	 * Returns the retry policy.
	 *
	 * @since 1.3.0
	 *
	 * @return RetryPolicy Retry policy.
	 */
	public function retry_policy(): RetryPolicy {
		if ( null === $this->retry ) {
			$this->retry = new RetryPolicy();
		}

		return $this->retry;
	}

	/**
	 * Returns the advertisement field resolver.
	 *
	 * @since 1.3.0
	 *
	 * @return FieldMap Field resolver.
	 */
	public function field_map(): FieldMap {
		if ( null === $this->field_map ) {
			$this->field_map = new FieldMap( $this->settings() );
		}

		return $this->field_map;
	}

	/**
	 * Returns the field registry.
	 *
	 * @since 1.4.0
	 *
	 * @return FieldRegistry Field registry.
	 */
	public function field_registry(): FieldRegistry {
		if ( null === $this->field_registry ) {
			$this->field_registry = new FieldRegistry( $this->settings(), $this->normalizer() );
		}

		return $this->field_registry;
	}

	/**
	 * Returns the field value resolver.
	 *
	 * @since 1.4.0
	 *
	 * @return FieldResolver Field resolver.
	 */
	public function field_resolver(): FieldResolver {
		if ( null === $this->field_resolver ) {
			$this->field_resolver = new FieldResolver( $this->field_registry(), $this->settings() );
		}

		return $this->field_resolver;
	}

	/**
	 * Returns the announcement post type service.
	 *
	 * @since 1.6.0
	 *
	 * @return Announcements Announcement service.
	 */
	/**
	 * Returns the ticketing service.
	 *
	 * @since 1.7.6
	 *
	 * @return Tickets Ticketing service.
	 */
	public function tickets(): Tickets {
		if ( null === $this->tickets ) {
			$this->tickets = new Tickets();
		}

		return $this->tickets;
	}


	public function ticket_operations(): TicketOperations {
		if ( null === $this->ticket_operations ) {
			$this->ticket_operations = new TicketOperations();
		}
		return $this->ticket_operations;
	}

	public function ticket_notifications(): TicketNotifications {
		if ( null === $this->ticket_notifications ) {
			$this->ticket_notifications = new TicketNotifications();
		}
		return $this->ticket_notifications;
	}

	public function ticket_automations(): TicketAutomations {
		if ( null === $this->ticket_automations ) {
			$this->ticket_automations = new TicketAutomations();
		}
		return $this->ticket_automations;
	}

	public function ticket_cleanup(): TicketCleanup {
		if ( null === $this->ticket_cleanup ) {
			$this->ticket_cleanup = new TicketCleanup();
		}
		return $this->ticket_cleanup;
	}

	public function customer_hub(): CustomerHub {
		if ( null === $this->customer_hub ) {
			$this->customer_hub = new CustomerHub();
		}

		return $this->customer_hub;
	}

	public function tickets_sms(): TicketSms {
		if ( null === $this->tickets_sms ) {
			$this->tickets_sms = new TicketSms();
		}

		return $this->tickets_sms;
	}

	public function announcements(): Announcements {
		if ( null === $this->announcements ) {
			$this->announcements = new Announcements();
		}

		return $this->announcements;
	}

	/**
	 * Returns the announcement front-end renderer.
	 *
	 * @since 1.6.0
	 *
	 * @return AnnouncementsFrontend Front-end renderer.
	 */
	public function announcements_frontend(): AnnouncementsFrontend {
		if ( null === $this->announcements_frontend ) {
			$this->announcements_frontend = new AnnouncementsFrontend( $this->announcements() );
		}

		return $this->announcements_frontend;
	}

	/**
	 * Returns the announcement placement registry.
	 *
	 * @since 1.7.0
	 *
	 * @return AnnouncementPlacements Placement registry.
	 */
	public function placements(): AnnouncementPlacements {
		if ( null === $this->placements ) {
			$this->placements = new AnnouncementPlacements(
				$this->announcements(),
				$this->announcements_frontend()
			);
		}

		return $this->placements;
	}

	/**
	 * Returns the admin application shell.
	 *
	 * @since 1.7.0
	 *
	 * @return AdminShell Shell service.
	 */
	public function admin_shell(): AdminShell {
		if ( null === $this->admin_shell ) {
			$this->admin_shell = new AdminShell( $this->settings() );
		}

		return $this->admin_shell;
	}

	/**
	 * Returns the announcement builder screen.
	 *
	 * @since 1.7.1
	 *
	 * @return AnnouncementBuilder Builder service.
	 */
	public function announcement_builder(): AnnouncementBuilder {
		if ( null === $this->announcement_builder ) {
			$this->announcement_builder = new AnnouncementBuilder(
				$this->announcements(),
				$this->placements(),
				$this->announcements_frontend()
			);
		}

		return $this->announcement_builder;
	}

	/**
	 * Returns the WooCommerce order event service.
	 *
	 * @since 1.7.0
	 *
	 * @return WooCommerceOrders Order event service.
	 */
	public function orders(): WooCommerceOrders {
		if ( null === $this->orders ) {
			$this->orders = new WooCommerceOrders(
				$this->settings(),
				$this->dispatcher(),
				$this->event_id(),
				$this->logger()
			);
		}

		return $this->orders;
	}

	/**
	 * Returns the per-post publication channel metabox.
	 *
	 * @since 1.6.0
	 *
	 * @return ChannelMetabox Channel metabox.
	 */
	public function channel_metabox(): ChannelMetabox {
		if ( null === $this->channel_metabox ) {
			$this->channel_metabox = new ChannelMetabox( $this->settings() );
		}

		return $this->channel_metabox;
	}

	/**
	 * Returns the field mapping store.
	 *
	 * @since 1.4.0
	 *
	 * @return FieldMapping Mapping store.
	 */
	public function field_mapping(): FieldMapping {
		if ( null === $this->field_mapping ) {
			$this->field_mapping = new FieldMapping( $this->field_registry() );
		}

		return $this->field_mapping;
	}

	/**
	 * Returns the message template renderer.
	 *
	 * @since 1.4.0
	 *
	 * @return MessageTemplate Template renderer.
	 */
	public function message_template(): MessageTemplate {
		if ( null === $this->message_template ) {
			$this->message_template = new MessageTemplate(
				$this->field_registry(),
				$this->field_resolver(),
				$this->field_mapping()
			);
		}

		return $this->message_template;
	}

	/**
	 * Returns the mapped field payload assembler.
	 *
	 * @since 1.4.0
	 *
	 * @return DynamicPayload Payload assembler.
	 */
	public function dynamic_payload(): DynamicPayload {
		if ( null === $this->dynamic_payload ) {
			$this->dynamic_payload = new DynamicPayload(
				$this->field_registry(),
				$this->field_resolver(),
				$this->field_mapping(),
				$this->message_template()
			);
		}

		return $this->dynamic_payload;
	}

	/**
	 * Returns the profile repository.
	 *
	 * @since 1.5.0
	 *
	 * @return ProfileRepository Profile repository.
	 */
	public function profiles(): ProfileRepository {
		if ( null === $this->profiles ) {
			$this->profiles = new ProfileRepository( $this->field_registry(), $this->field_mapping() );
		}

		return $this->profiles;
	}

	/**
	 * Returns the rule engine.
	 *
	 * @since 1.5.0
	 *
	 * @return RuleEngine Rule engine.
	 */
	public function rules(): RuleEngine {
		if ( null === $this->rules ) {
			$this->rules = new RuleEngine();
		}

		return $this->rules;
	}

	/**
	 * Returns the destination registry.
	 *
	 * @since 1.5.0
	 *
	 * @return DestinationRegistry Destination registry.
	 */
	public function destinations(): DestinationRegistry {
		if ( null === $this->destinations ) {
			$this->destinations = new DestinationRegistry( $this->webhook(), $this->settings(), $this->signer() );
		}

		return $this->destinations;
	}

	/**
	 * Returns the publication workflow.
	 *
	 * @since 1.5.0
	 *
	 * @return Publisher Publisher.
	 */
	public function publisher(): Publisher {
		if ( null === $this->publisher ) {
			$this->publisher = new Publisher(
				$this->field_registry(),
				$this->field_resolver(),
				$this->profiles(),
				$this->rules(),
				$this->destinations(),
				$this->message_template(),
				$this->dynamic_payload(),
				$this->logger()
			);
		}

		return $this->publisher;
	}

	/**
	 * Returns the platform admin screens.
	 *
	 * @since 1.5.0
	 *
	 * @return PlatformAdmin Platform admin controller.
	 */
	public function platform_admin(): PlatformAdmin {
		if ( null === $this->platform_admin ) {
			$this->platform_admin = new PlatformAdmin(
				$this->profiles(),
				$this->rules(),
				$this->destinations(),
				$this->publisher(),
				$this->field_registry(),
				$this->field_resolver(),
				$this->normalizer(),
				$this->contract(),
				$this->settings()
			);
		}

		return $this->platform_admin;
	}

	/**
	 * Returns the hook router.
	 *
	 * @since 1.3.0
	 *
	 * @return HookRouter Hook router.
	 */
	public function router(): HookRouter {
		if ( null === $this->router ) {
			$this->router = new HookRouter( $this->hooks(), $this->logger() );
		}

		return $this->router;
	}

	/**
	 * Returns the diagnostics service.
	 *
	 * @since 1.3.0
	 *
	 * @return Diagnostics Diagnostics service.
	 */
	public function diagnostics(): Diagnostics {
		if ( null === $this->diagnostics ) {
			$this->diagnostics = new Diagnostics(
				$this->settings(),
				$this->webhook(),
				$this->queue(),
				$this->dispatcher(),
				$this->validator()
			);
		}

		return $this->diagnostics;
	}

	/**
	 * Returns the event detector.
	 *
	 * @since 1.1.0
	 *
	 * @return EventDetector Event detector.
	 */
	public function detector(): EventDetector {
		if ( null === $this->detector ) {
			$this->detector = new EventDetector( $this->settings(), $this->logger() );
		}

		return $this->detector;
	}

	/**
	 * Returns the delivery dispatcher.
	 *
	 * @since 1.1.0
	 *
	 * @return Dispatcher Delivery dispatcher.
	 */
	public function dispatcher(): Dispatcher {
		if ( null === $this->dispatcher ) {
			$this->dispatcher = new Dispatcher(
				$this->settings(),
				$this->normalizer(),
				$this->contract(),
				$this->webhook(),
				$this->logger(),
				$this->event_id(),
				$this->queue(),
				$this->detector(),
				$this->retry_policy(),
				$this->dynamic_payload()
			);
		}

		return $this->dispatcher;
	}

	/**
	 * Returns the migration runner.
	 *
	 * @since 1.1.0
	 *
	 * @return Migrator Migration runner.
	 */
	public function migrator(): Migrator {
		if ( null === $this->migrator ) {
			$this->migrator = new Migrator( $this->settings(), $this->logger() );
		}

		return $this->migrator;
	}

	/**
	 * Returns the hook manager.
	 *
	 * @since 1.0.0
	 *
	 * @return Hooks Hook manager.
	 */
	public function hooks(): Hooks {
		if ( null === $this->hooks ) {
			$this->hooks = new Hooks(
				$this->settings(),
				$this->detector(),
				$this->dispatcher(),
				$this->normalizer(),
				$this->contract(),
				$this->signer(),
				$this->logger()
			);
		}

		return $this->hooks;
	}

	/**
	 * Returns the REST controller.
	 *
	 * @since 1.0.0
	 *
	 * @return Rest REST controller.
	 */
	public function rest(): Rest {
		if ( null === $this->rest ) {
			$this->rest = new Rest(
				$this->settings(),
				$this->logger(),
				$this->webhook(),
				$this->normalizer(),
				$this->signer()
			);
		}

		return $this->rest;
	}

	/**
	 * Returns the admin UI controller.
	 *
	 * @since 1.0.0
	 *
	 * @return Admin Admin controller.
	 */
	public function admin(): Admin {
		if ( null === $this->admin ) {
			$this->admin = new Admin(
				$this->settings(),
				$this->logger(),
				$this->webhook(),
				$this->normalizer(),
				$this->contract(),
				$this->event_id(),
				$this->signer(),
				$this->dispatcher(),
				$this->detector(),
				$this->validator(),
				$this->diagnostics()
			);
		}

		return $this->admin;
	}

	/**
	 * Returns the Field Mapping screen controller.
	 *
	 * @since 1.4.0
	 *
	 * @return FieldMappingAdmin Screen controller.
	 */
	public function field_mapping_admin(): FieldMappingAdmin {
		if ( null === $this->field_mapping_admin ) {
			$this->field_mapping_admin = new FieldMappingAdmin(
				$this->field_registry(),
				$this->field_resolver(),
				$this->field_mapping(),
				$this->message_template(),
				$this->settings()
			);

			// Favourites and the "NEW" badge read the assigned profile.
			$this->field_mapping_admin->set_profiles( $this->profiles() );
		}

		return $this->field_mapping_admin;
	}
}
