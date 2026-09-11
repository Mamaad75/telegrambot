<?php
/**
 * Publication workflow.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

use WP_Post;
use WP_Term;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Turns a detected event into one or more delivered messages.
 *
 * The workflow, in order, each step doing one thing:
 *
 *     event → context → rules → profile → mapped fields → message
 *           → publication → destinations → adapters → log
 *
 * Two properties are worth stating because everything else depends on
 * them:
 *
 * - **Building is free of side effects.** {@see self::build()} produces a
 *   publication and a plan without sending anything, which is what lets
 *   the Rule Tester show an administrator exactly what would happen.
 * - **The primary destination is the old path.** A site with one Telegram
 *   destination and no rules gets the identical payload, to the identical
 *   endpoint, through the identical transport as before this class
 *   existed. The platform is additive.
 *
 * @since 1.5.0
 */
class Publisher {

	/**
	 * Cron hook delivering to one secondary destination.
	 *
	 * @var string
	 */
	public const CRON_HOOK = 'wpep_deliver_destination';

	/**
	 * Field registry.
	 *
	 * @var FieldRegistry
	 */
	private FieldRegistry $registry;

	/**
	 * Field resolver.
	 *
	 * @var FieldResolver
	 */
	private FieldResolver $resolver;

	/**
	 * Profile repository.
	 *
	 * @var ProfileRepository
	 */
	private ProfileRepository $profiles;

	/**
	 * Rule engine.
	 *
	 * @var RuleEngine
	 */
	private RuleEngine $rules;

	/**
	 * Destination registry.
	 *
	 * @var DestinationRegistry
	 */
	private DestinationRegistry $destinations;

	/**
	 * Message renderer.
	 *
	 * @var MessageTemplate
	 */
	private MessageTemplate $template;

	/**
	 * Mapped field payload assembler.
	 *
	 * @var DynamicPayload
	 */
	private DynamicPayload $dynamic;

	/**
	 * Logger.
	 *
	 * @var Logger
	 */
	private Logger $logger;

	/**
	 * Constructor.
	 *
	 * @since 1.5.0
	 *
	 * @param FieldRegistry       $registry     Field registry.
	 * @param FieldResolver       $resolver     Field resolver.
	 * @param ProfileRepository   $profiles     Profile repository.
	 * @param RuleEngine          $rules        Rule engine.
	 * @param DestinationRegistry $destinations Destination registry.
	 * @param MessageTemplate     $template     Message renderer.
	 * @param DynamicPayload      $dynamic      Payload assembler.
	 * @param Logger              $logger       Logger.
	 */
	public function __construct(
		FieldRegistry $registry,
		FieldResolver $resolver,
		ProfileRepository $profiles,
		RuleEngine $rules,
		DestinationRegistry $destinations,
		MessageTemplate $template,
		DynamicPayload $dynamic,
		Logger $logger
	) {
		$this->registry     = $registry;
		$this->resolver     = $resolver;
		$this->profiles     = $profiles;
		$this->rules        = $rules;
		$this->destinations = $destinations;
		$this->template     = $template;
		$this->dynamic      = $dynamic;
		$this->logger       = $logger;
	}

	/**
	 * Registers the cron callback that delivers secondary destinations.
	 *
	 * @since 1.5.0
	 *
	 * @return void
	 */
	public function register(): void {
		add_action( self::CRON_HOOK, array( $this, 'run_scheduled' ), 10, 3 );
	}

	/**
	 * Builds the complete plan for an event, without sending anything.
	 *
	 * @since 1.5.0
	 *
	 * @param Event               $event Event being delivered.
	 * @param WP_Post             $post  Post being published.
	 * @param array<string,mixed> $flat  Normalized payload from the normalizer.
	 *
	 * @return array{
	 *     publication:Publication|null,
	 *     outcome:RuleOutcome,
	 *     profile:Profile,
	 *     destinations:array<string,array<string,mixed>>,
	 *     skipped:bool,
	 *     reason:string
	 * } The plan.
	 */
	public function build( Event $event, WP_Post $post, array $flat ): array {
		$resolution = $this->profiles->for_post( $post );
		$profile    = $resolution['profile'];
		$term       = $resolution['term'] instanceof WP_Term ? $resolution['term'] : null;

		$context = new RuleContext(
			$post,
			$this->registry,
			$this->resolver,
			(string) $resolution['taxonomy'],
			$term
		);

		$outcome = $this->rules->evaluate( $context );

		// A rule may name a different profile than the assignment did.
		if ( '' !== $outcome->profile() && $this->profiles->exists( $outcome->profile() ) ) {
			$profile = $this->profiles->resolve( $outcome->profile() );
		}

		if ( $outcome->is_skipped() ) {
			return array(
				'publication'  => null,
				'outcome'      => $outcome,
				'profile'      => $profile,
				'destinations' => array(),
				'skipped'      => true,
				'reason'       => $outcome->skip_reason(),
			);
		}

		$mapping = $this->effective_mapping( $profile, $outcome, $post->post_type );

		// One pass produces the values and the descriptions of those values;
		// a rule that hid a field removes it from both, so the two cannot
		// disagree about what was sent.
		$described = $this->dynamic->describe( $post, $mapping );
		$fields    = $described['fields'];
		$images    = $this->images( $post, $profile, $outcome, $mapping );
		$message   = $this->message( $post, $profile, $outcome, $mapping );

		$payload                  = $flat;
		$payload['message']       = $message;
		$payload['fields']        = $fields;
		$payload['field_meta']    = $described['field_meta'];
		$payload['images']        = $images;
		$payload['image']         = $images[0] ?? '';
		$payload['profile']       = $profile->id();
		$payload['matched_rules'] = $outcome->matched();

		$publication = new Publication(
			$event,
			$profile,
			$outcome,
			$message,
			$payload,
			$images,
			$fields,
			array(
				'post_type' => $post->post_type,
				'taxonomy'  => (string) $resolution['taxonomy'],
				'term'      => $term instanceof WP_Term ? (int) $term->term_id : 0,
				'scope'     => (string) $resolution['scope'],
				'assigned'  => (string) $resolution['assigned'],
			)
		);

		return array(
			'publication'  => $publication,
			'outcome'      => $outcome,
			'profile'      => $profile,
			'destinations' => $this->destinations->resolve( $profile, $outcome ),
			'skipped'      => false,
			'reason'       => '',
		);
	}

	/**
	 * Applies a profile's mapping plus the rules' field overrides.
	 *
	 * @since 1.5.0
	 *
	 * @param Profile     $profile   Profile in use.
	 * @param RuleOutcome $outcome   Rule decisions.
	 * @param string      $post_type Post type slug.
	 *
	 * @return array<string,array<string,mixed>> Effective mapping.
	 */
	public function effective_mapping( Profile $profile, RuleOutcome $outcome, string $post_type ): array {
		$mapping    = $profile->fields();
		$discovered = $this->registry->discover( $post_type );

		if ( empty( $mapping ) ) {
			$mapping = $this->profiles->default_profile( $post_type )->fields();
		}

		foreach ( $outcome->hidden_fields() as $key ) {
			if ( isset( $mapping[ $key ] ) ) {
				$mapping[ $key ]['enabled'] = false;
			}
		}

		foreach ( $outcome->shown_fields() as $key ) {
			if ( ! isset( $discovered[ $key ] ) ) {
				continue;
			}

			$mapping[ $key ] = array_merge(
				array(
					'label'      => $discovered[ $key ]->label(),
					'visibility' => Field::VISIBILITY_TELEGRAM,
					'order'      => 999,
					'format'     => FieldResolver::FORMAT_INLINE,
					'separator'  => '، ',
				),
				$mapping[ $key ] ?? array(),
				array( 'enabled' => true )
			);
		}

		// A field the post type no longer has is dropped rather than sent
		// empty, exactly as the mapping store does.
		foreach ( array_keys( $mapping ) as $key ) {
			if ( ! isset( $discovered[ $key ] ) ) {
				unset( $mapping[ $key ] );
			}
		}

		uasort(
			$mapping,
			static fn( array $a, array $b ): int => ( (int) ( $a['order'] ?? 0 ) ) <=> ( (int) ( $b['order'] ?? 0 ) )
		);

		return $mapping;
	}

	/**
	 * Renders the message for a post under a profile and its rules.
	 *
	 * @since 1.5.0
	 *
	 * @param WP_Post                           $post    Post being published.
	 * @param Profile                           $profile Profile in use.
	 * @param RuleOutcome                       $outcome Rule decisions.
	 * @param array<string,array<string,mixed>> $mapping Effective mapping.
	 *
	 * @return string Rendered message.
	 */
	public function message( WP_Post $post, Profile $profile, RuleOutcome $outcome, array $mapping ): string {
		$template = $outcome->template();

		if ( '' === $template ) {
			$template = $profile->template();
		}

		try {
			$values = $this->template->values( $post, $mapping );

			$message = '' === trim( $template )
				? $this->template->render( $post )
				: $this->template->apply( $template, $values );
		} catch ( \Throwable $e ) {
			// A broken template must cost the formatting, never the
			// advertisement: fall back to the title and the link.
			$this->logger->event(
				'publish.template_failed',
				Logger::STATUS_FAILED,
				sprintf(
					/* translators: %s: error message. */
					__( 'The message template could not be rendered, so a minimal message was sent instead: %s', 'wp-event-publisher' ),
					$e->getMessage()
				),
				array( 'post_id' => $post->ID )
			);

			$message = trim( get_the_title( $post ) . "\n" . get_permalink( $post ) );
		}

		$formatting = $profile->formatting();

		$message = trim(
			implode(
				"\n",
				array_filter(
					array(
						(string) ( $formatting['prepend'] ?? '' ),
						$message,
						(string) ( $formatting['append'] ?? '' ),
					),
					static fn( string $part ): bool => '' !== trim( $part )
				)
			)
		);

		return $outcome->decorate( $message );
	}

	/**
	 * Collects the images a publication carries.
	 *
	 * The profile chooses which images, a rule may cap how many, and the
	 * lower of the two caps wins — a rule that says "five" never widens a
	 * profile that said "three".
	 *
	 * @since 1.5.0
	 *
	 * @param WP_Post                           $post    Post being published.
	 * @param Profile                           $profile Profile in use.
	 * @param RuleOutcome                       $outcome Rule decisions.
	 * @param array<string,array<string,mixed>> $mapping Effective mapping.
	 *
	 * @return string[] Absolute image URLs.
	 */
	public function images( WP_Post $post, Profile $profile, RuleOutcome $outcome, array $mapping ): array {
		$settings = $profile->images();
		$mode     = (string) $settings['mode'];

		if ( Profile::IMAGES_NONE === $mode ) {
			return array();
		}

		$key = match ( $mode ) {
			Profile::IMAGES_FEATURED => ImageProvider::FEATURED,
			Profile::IMAGES_GALLERY  => ImageProvider::GALLERY,
			default                  => ImageProvider::IMAGES,
		};

		$field = $this->registry->field( $post->post_type, $key );

		if ( ! $field instanceof Field ) {
			return array();
		}

		try {
			$value = $this->resolver->value( $field, $post );
		} catch ( \Throwable $e ) {
			return array();
		}

		$images = array();

		if ( is_array( $value ) ) {
			$images = array_values( array_filter( array_map( 'strval', $value ) ) );
		} elseif ( is_string( $value ) && '' !== $value ) {
			$images = array( $value );
		}

		$limit = (int) $settings['max'];
		$rule  = $outcome->image_limit();

		if ( null !== $rule ) {
			$limit = $limit > 0 ? min( $limit, $rule ) : $rule;
		}

		if ( $limit >= 0 && $limit < count( $images ) ) {
			$images = array_slice( $images, 0, $limit );
		}

		unset( $mapping );

		return $images;
	}

	/**
	 * Delivers a publication to one destination.
	 *
	 * @since 1.5.0
	 *
	 * @param Publication         $publication Publication to send.
	 * @param array<string,mixed> $destination Destination configuration.
	 *
	 * @return array{success:bool,code:int,message:string,body:string,retryable:bool} Result.
	 */
	public function deliver( Publication $publication, array $destination ): array {
		$provider = $this->destinations->provider( (string) ( $destination['provider'] ?? '' ) );

		if ( ! $provider instanceof DeliveryProvider ) {
			return array(
				'success'   => false,
				'code'      => 0,
				'message'   => sprintf(
					/* translators: %s: provider identifier. */
					__( 'The delivery provider "%s" is not registered, so this destination was skipped.', 'wp-event-publisher' ),
					(string) ( $destination['provider'] ?? '' )
				),
				'body'      => '',
				'retryable' => false,
			);
		}

		$prepared = $this->prepare_for( $publication, $destination, $provider );

		$started = microtime( true );

		try {
			$result = $provider->send( $prepared, (array) ( $destination['config'] ?? array() ) );
		} catch ( \Throwable $e ) {
			// An adapter is third-party code by design. A throw becomes a
			// failed delivery, never a fatal on a publish request.
			$result = array(
				'success'   => false,
				'code'      => 0,
				'message'   => sprintf(
					/* translators: %s: error message. */
					__( 'The delivery provider raised an error: %s', 'wp-event-publisher' ),
					$e->getMessage()
				),
				'body'      => '',
				'retryable' => true,
			);
		}

		$duration = round( microtime( true ) - $started, 3 );

		$this->logger->event(
			! empty( $result['success'] ) ? 'destination.sent' : 'destination.failed',
			! empty( $result['success'] ) ? Logger::STATUS_SUCCESS : Logger::STATUS_FAILED,
			sprintf(
				/* translators: 1: destination name, 2: result message. */
				__( 'Destination "%1$s": %2$s', 'wp-event-publisher' ),
				(string) ( $destination['name'] ?? $destination['id'] ),
				(string) ( $result['message'] ?? '' )
			),
			array(
				'event_id'      => $publication->event()->id(),
				'event_type'    => $publication->event()->type(),
				'post_id'       => $publication->event()->post_id(),
				'response_code' => (int) ( $result['code'] ?? 0 ),
				'response_body' => mb_substr( (string) ( $result['body'] ?? '' ), 0, 1000 ),
				'data'          => array(
					'destination' => (string) ( $destination['id'] ?? '' ),
					'provider'    => $provider->id(),
					'profile'     => $publication->profile()->id(),
					'images'      => count( $prepared->images() ),
					'duration'    => $duration,
					'rules'       => $publication->outcome()->matched(),
				),
			)
		);

		/**
		 * Fires after one destination was attempted.
		 *
		 * @since 1.5.0
		 *
		 * @param array<string,mixed> $result      Delivery result.
		 * @param Publication         $publication Publication sent.
		 * @param array<string,mixed> $destination Destination configuration.
		 */
		do_action( 'wpep_destination_delivered', $result, $prepared, $destination );

		return array(
			'success'   => ! empty( $result['success'] ),
			'code'      => (int) ( $result['code'] ?? 0 ),
			'message'   => (string) ( $result['message'] ?? '' ),
			'body'      => (string) ( $result['body'] ?? '' ),
			'retryable' => ! empty( $result['retryable'] ),
		);
	}

	/**
	 * Adapts a publication to one destination's own overrides.
	 *
	 * @since 1.5.0
	 *
	 * @param Publication         $publication Publication.
	 * @param array<string,mixed> $destination Destination configuration.
	 * @param DeliveryProvider    $provider    Provider handling it.
	 *
	 * @return Publication Adapted publication.
	 */
	private function prepare_for( Publication $publication, array $destination, DeliveryProvider $provider ): Publication {
		$prepared = $publication;

		$template = trim( (string) ( $destination['template'] ?? '' ) );

		if ( '' !== $template ) {
			$post = get_post( $publication->event()->post_id() );

			if ( $post instanceof WP_Post ) {
				try {
					$mapping = $this->effective_mapping( $publication->profile(), $publication->outcome(), $post->post_type );
					$values  = $this->template->values( $post, $mapping );

					$prepared = $prepared->with_message(
						$publication->outcome()->decorate( $this->template->apply( $template, $values ) )
					);
				} catch ( \Throwable $e ) {
					unset( $e );
				}
			}
		}

		$limit = (int) ( $destination['images'] ?? -1 );

		if ( $limit >= 0 ) {
			$prepared = $prepared->with_image_limit( $limit );
		}

		if ( ! $provider->supports_images() ) {
			$prepared = $prepared->with_image_limit( 0 );
		} elseif ( ! $provider->supports_gallery() && count( $prepared->images() ) > 1 ) {
			$prepared = $prepared->with_image_limit( 1 );
		}

		return $prepared;
	}

	/**
	 * Schedules a destination's delivery for later.
	 *
	 * @since 1.5.0
	 *
	 * @param Publication $publication Publication to send.
	 * @param string      $destination Destination identifier.
	 * @param int         $delay       Delay in seconds.
	 *
	 * @return bool True when WP-Cron accepted the job.
	 */
	public function schedule( Publication $publication, string $destination, int $delay ): bool {
		$event = $publication->event();

		$scheduled = wp_schedule_single_event(
			time() + max( 60, $delay ),
			self::CRON_HOOK,
			array( $event->id(), $event->type(), $event->post_id(), $destination ),
			true
		);

		if ( is_wp_error( $scheduled ) || false === $scheduled ) {
			return false;
		}

		$this->logger->event(
			'destination.scheduled',
			Logger::STATUS_PENDING,
			sprintf(
				/* translators: 1: destination identifier, 2: delay in seconds. */
				__( 'Delivery to "%1$s" was scheduled for %2$d seconds from now.', 'wp-event-publisher' ),
				$destination,
				max( 60, $delay )
			),
			array(
				'event_id'   => $event->id(),
				'event_type' => $event->type(),
				'post_id'    => $event->post_id(),
				'data'       => array( 'destination' => $destination ),
			)
		);

		return true;
	}

	/**
	 * Cron callback: rebuilds a publication and delivers one destination.
	 *
	 * The publication is rebuilt rather than stored, so a delayed delivery
	 * reflects the advertisement as it is when it is finally sent. An
	 * advertisement edited during the delay goes out corrected, and one
	 * deleted during the delay does not go out at all.
	 *
	 * @since 1.5.0
	 *
	 * @param string $event_id   Event identifier.
	 * @param string $event_type Event type.
	 * @param int    $post_id    Post identifier.
	 * @param string $destination Destination identifier.
	 *
	 * @return void
	 */
	public function run_scheduled( string $event_id, string $event_type = '', int $post_id = 0, string $destination = '' ): void {
		$post = get_post( $post_id );

		if ( ! $post instanceof WP_Post ) {
			$this->logger->event(
				'destination.obsolete',
				Logger::STATUS_SKIPPED,
				__( 'The advertisement no longer exists, so its delayed delivery was dropped.', 'wp-event-publisher' ),
				array(
					'event_id' => $event_id,
					'post_id'  => $post_id,
					'data'     => array( 'destination' => $destination ),
				)
			);

			return;
		}

		$config = $this->destinations->find( $destination );

		if ( null === $config || empty( $config['enabled'] ) ) {
			$this->logger->event(
				'destination.obsolete',
				Logger::STATUS_SKIPPED,
				__( 'The destination was removed or disabled before its delayed delivery ran.', 'wp-event-publisher' ),
				array(
					'event_id' => $event_id,
					'post_id'  => $post_id,
					'data'     => array( 'destination' => $destination ),
				)
			);

			return;
		}

		/**
		 * Filters the normalized payload used to rebuild a delayed
		 * publication.
		 *
		 * @since 1.5.0
		 *
		 * @param array<string,mixed> $flat Normalized payload.
		 * @param WP_Post             $post Post being published.
		 */
		$flat = (array) apply_filters( 'wpep_delayed_payload', array(), $post );

		$plan = $this->build( new Event( $event_id, '' !== $event_type ? $event_type : Event::TYPE_UPDATED, $post_id ), $post, $flat );

		if ( $plan['skipped'] || ! $plan['publication'] instanceof Publication ) {
			$this->logger->event(
				'destination.skipped',
				Logger::STATUS_SKIPPED,
				'' !== $plan['reason'] ? $plan['reason'] : __( 'The rules now say this advertisement should not be published.', 'wp-event-publisher' ),
				array(
					'event_id' => $event_id,
					'post_id'  => $post_id,
					'data'     => array( 'destination' => $destination ),
				)
			);

			return;
		}

		$this->deliver( $plan['publication'], $config );
	}

	/**
	 * Returns the destination registry.
	 *
	 * @since 1.5.0
	 *
	 * @return DestinationRegistry Destination registry.
	 */
	public function destinations(): DestinationRegistry {
		return $this->destinations;
	}

	/**
	 * Returns the profile repository.
	 *
	 * @since 1.5.0
	 *
	 * @return ProfileRepository Profile repository.
	 */
	public function profiles(): ProfileRepository {
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
		return $this->rules;
	}
}
