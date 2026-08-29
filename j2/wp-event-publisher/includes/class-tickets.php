<?php
/**
 * Jarchi ticketing and support center.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Lightweight ticketing layer built on WordPress posts/comments so it stays
 * fast, searchable and compatible with normal WordPress user accounts.
 *
 * Tickets are posts; messages are comments of a dedicated comment type;
 * departments are a hierarchical taxonomy; attachments are normal media
 * attachments referenced from comment meta.
 */
final class Tickets {

	public const POST_TYPE   = 'jarchi_ticket';
	public const TAXONOMY    = 'jarchi_ticket_department';
	public const CATEGORY   = 'jarchi_ticket_category';
	public const COMMENT_TYPE = 'jarchi_ticket';
	public const PAGE         = 'wp-event-publisher-support';
	public const PAGE_LEGACY = 'wp-event-publisher-tickets';
	public const PAGE_DEPTS   = 'wp-event-publisher-ticket-departments';
	public const PAGE_SMS     = 'wp-event-publisher-ticket-sms';
	public const PAGE_UI      = 'wp-event-publisher-ticket-ui';
	public const PAGE_ADVANCED = 'wp-event-publisher-ticket-advanced';
	public const PAGE_BOT     = 'wp-event-publisher-ticket-bot';
	public const PAGE_CANNED  = 'wp-event-publisher-ticket-canned';
	public const PAGE_FAQ     = 'wp-event-publisher-ticket-faq';
	public const PAGE_NEW     = 'wp-event-publisher-ticket-new';
	private const UI_OPTION   = '_jarchi_ticket_ui_settings';
	public const NONCE        = 'wpep_ticket_nonce';
	public const AJAX_NONCE   = 'wpep_ticket_ajax';

	/**
	 * Ticket meta: whether the customer may reply to this thread.
	 *
	 * Stored per ticket rather than derived, because the answer has to survive
	 * the rule being edited or deleted afterwards. `'1'` means replies are
	 * open; anything else means the thread is an announcement.
	 *
	 * @var string
	 */
	public const META_ALLOW_REPLY = '_jarchi_ticket_allow_reply';

	/** Ticket meta: this thread was produced by an automation rule. */
	public const META_AUTOMATED = '_jarchi_ticket_automated';

	/** Ticket meta: attachment ids. */
	public const META_ATTACHMENTS = '_jarchi_ticket_attachments';

	/** User meta: the departments one support agent answers for. */
	public const META_AGENT_DEPARTMENTS = '_jarchi_agent_departments';

	/** Records that the starter department and category were seeded once. */
	public const OPTION_TERMS_SEEDED = '_jarchi_ticket_terms_seeded';

	/** Option holding a broadcast still being delivered. */
	public const OPTION_BROADCAST = '_jarchi_ticket_broadcast_state';

	/** Recipients handled per broadcast batch. */
	public const BROADCAST_BATCH = 25;

	/** Files accepted on one ticket. */
	public const MAX_ATTACHMENTS = 5;

	public function register(): void {
		add_action( 'init', array( $this, 'register_content_types' ) );
		add_shortcode( 'jarchi_tickets', array( $this, 'shortcode_center' ) );
		add_shortcode( 'jarchi_ticket_icon', array( $this, 'shortcode_icon' ) );
		add_filter( 'the_content', array( $this, 'filter_ticket_page_content' ), 20 );

		add_action( 'admin_post_wpep_ticket_submit', array( $this, 'handle_submit' ) );
		add_action( 'admin_post_wpep_ticket_reply', array( $this, 'handle_reply' ) );
		add_action( 'admin_post_wpep_ticket_admin_create', array( $this, 'handle_admin_create' ) );
		add_action( 'admin_post_wpep_ticket_bot_settings', array( $this, 'handle_bot_settings' ) );
		add_action( 'admin_post_wpep_ticket_status', array( $this, 'handle_status' ) );
		add_action( 'admin_post_wpep_ticket_department', array( $this, 'handle_department' ) );
		add_action( 'admin_post_wpep_ticket_sms_save', array( $this, 'handle_sms_save' ) );
		// Whichever route deletes a ticket — the cleanup tool, the posts
		// screen, the rollback after a failed submit — its uploads go with it.
		add_action( 'before_delete_post', array( $this, 'delete_ticket_attachments' ) );

		// Any nav-menu item pointing at the ticket page carries the live count.
		add_filter( 'nav_menu_link_attributes', array( $this, 'menu_link_attributes' ), 10, 2 );
		add_filter( 'nav_menu_item_title', array( $this, 'menu_item_title' ), 10, 2 );
		add_action( 'wp_ajax_wpep_ticket_unread', array( $this, 'ajax_unread' ) );
		add_action( 'wp_ajax_wpep_ticket_read', array( $this, 'ajax_mark_read' ) );
		add_action( 'wp_ajax_wpep_ticket_user_search', array( $this, 'ajax_user_search' ) );
		add_action( 'elementor/widgets/register', array( $this, 'register_elementor_widgets' ) );
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
		add_action( 'init', array( $this, 'ensure_support_role' ), 5 );
		add_action( 'admin_post_wpep_ticket_assign_agent', array( $this, 'handle_assign_agent' ) );
		add_action( 'admin_post_wpep_ticket_rating', array( $this, 'save_rating' ) );
		add_action( 'jarchi_ticket_auto_close', array( $this, 'run_auto_close' ) );
		add_action( 'jarchi_ticket_broadcast', array( $this, 'run_broadcast_batch' ) );
		add_action( 'jarchi_ticket_normalize_legacy', array( $this, 'run_legacy_normalization' ) );
		add_action( 'wp', array( $this, 'maybe_schedule_auto_close' ) );
	}

	/**
	 * Secure REST gateway used by the Jarchi backend/Mini App.
	 * The backend already owns the site webhook secret; WordPress stays the
	 * source of truth for tickets and support agents.
	 */
	public function register_rest_routes(): void {
		register_rest_route( 'jarchi/v1', '/tickets', array(
			array(
				'method' => \WP_REST_Server::READABLE,
				'callback' => array( $this, 'rest_list_tickets' ),
				'permission_callback' => array( $this, 'rest_permission' ),
			),
			array(
				'method' => \WP_REST_Server::CREATABLE,
				'callback' => array( $this, 'rest_create_ticket' ),
				'permission_callback' => array( $this, 'rest_permission' ),
			)
		) );
		register_rest_route( 'jarchi/v1', '/tickets/(?P<id>\\d+)', array(
			'method' => \WP_REST_Server::READABLE,
			'callback' => array( $this, 'rest_get_ticket' ),
			'permission_callback' => array( $this, 'rest_permission' ),
		) );
		foreach ( array( 'reply', 'status', 'assign', 'mark-read' ) as $action ) {
			register_rest_route( 'jarchi/v1', '/tickets/(?P<id>\\d+)/' . $action, array(
				'method' => \WP_REST_Server::CREATABLE,
				'callback' => array( $this, 'rest_ticket_action' ),
				'permission_callback' => array( $this, 'rest_permission' ),
				'args' => array( 'action' => array( 'default' => $action ) ),
			) );
		}
		register_rest_route( 'jarchi/v1', '/tickets/(?P<id>\d+)/rating', array(
			'method' => \WP_REST_Server::CREATABLE,
			'callback' => array( $this, 'rest_ticket_rating' ),
			'permission_callback' => array( $this, 'rest_permission' ),
		) );
		register_rest_route( 'jarchi/v1', '/agents', array(
			array(
				'method' => \WP_REST_Server::READABLE,
				'callback' => array( $this, 'rest_agents' ),
				'permission_callback' => array( $this, 'rest_permission' ),
			),
			array(
				'method' => \WP_REST_Server::CREATABLE,
				'callback' => array( $this, 'rest_agent_action' ),
				'permission_callback' => array( $this, 'rest_permission' ),
			)
		) );
		register_rest_route( 'jarchi/v1', '/meta', array(
			'method' => \WP_REST_Server::READABLE,
			'callback' => array( $this, 'rest_meta' ),
			'permission_callback' => array( $this, 'rest_permission' ),
		) );
		register_rest_route( 'jarchi/v1', '/canned-replies', array(
			'method' => \WP_REST_Server::READABLE,
			'callback' => array( $this, 'rest_canned_replies' ),
			'permission_callback' => array( $this, 'rest_permission' ),
		) );
		register_rest_route( 'jarchi/v1', '/customers', array(
			'method' => \WP_REST_Server::READABLE,
			'callback' => array( $this, 'rest_customers' ),
			'permission_callback' => array( $this, 'rest_permission' ),
		) );
		register_rest_route( 'jarchi/v1', '/tickets/unread', array(
			'method' => \WP_REST_Server::READABLE,
			'callback' => array( $this, 'rest_unread' ),
			'permission_callback' => array( $this, 'rest_permission' ),
		) );
	}

	public function rest_permission( \WP_REST_Request $request ): bool {
		$expected = (string) wpep()->settings()->get( 'api_secret', '' );
		$supplied = (string) $request->get_header( 'X-Jarchi-Secret' );
		if ( '' === $supplied ) {
			$supplied = (string) $request->get_header( 'X-Webhook-Secret' );
		}
		return '' !== $expected && '' !== $supplied && hash_equals( $expected, $supplied );
	}

	private function rest_ticket_view( int $ticket_id, bool $full = false ): array {
		$ticket = get_post( $ticket_id );
		if ( ! $ticket || self::POST_TYPE !== $ticket->post_type ) return array();
		// false, not null, when the account is gone — and user_mobile_value()
		// below takes ?WP_User.
		$user = get_user_by( 'id', (int) $ticket->post_author ) ?: null;
		$departments = wp_get_post_terms( $ticket_id, self::TAXONOMY );
		$categories = wp_get_post_terms( $ticket_id, self::CATEGORY );
		$out = array(
			'id' => $ticket_id,
			'number' => (string) $ticket_id,
			'subject' => $ticket->post_title,
			'status' => $this->canonical_status( $this->status( $ticket_id ) ),
			'priority' => (string) get_post_meta( $ticket_id, '_jarchi_ticket_priority', true ),
			'department' => ! empty( $departments ) && ! is_wp_error( $departments ) ? (string) $departments[0]->name : '',
			'department_id' => ! empty( $departments ) && ! is_wp_error( $departments ) ? (int) $departments[0]->term_id : 0,
			'category' => ! empty( $categories ) && ! is_wp_error( $categories ) ? (string) $categories[0]->name : '',
			'category_id' => ! empty( $categories ) && ! is_wp_error( $categories ) ? (int) $categories[0]->term_id : 0,
			'agent_id' => (int) get_post_meta( $ticket_id, '_jarchi_ticket_agent', true ),
			'unread_for_user' => (bool) get_post_meta( $ticket_id, '_jarchi_ticket_user_unread', true ),
			'unread_for_support' => (bool) get_post_meta( $ticket_id, '_jarchi_ticket_admin_unread', true ),
			'rating' => absint( get_post_meta( $ticket_id, '_jarchi_ticket_rating', true ) ),
			'created_at' => get_post_time( 'c', true, $ticket ),
			'updated_at' => get_post_modified_time( 'c', true, $ticket ),
			'custom_fields' => (array) get_post_meta( $ticket_id, '_jarchi_ticket_custom_fields', true ),
			'customer' => array(
				'id' => $user ? (int) $user->ID : 0,
				'name' => $user ? $user->display_name : '',
				'email' => $user ? $user->user_email : '',
				'phone' => $this->user_mobile_value( $user ),
			),
		);
		if ( $full ) {
			$out['messages'] = array_map(
				function( $message ) {
					$sender = (string) get_comment_meta( $message->comment_ID, '_jarchi_ticket_sender', true );
					$attachments = array();
					foreach ( $this->attachments( (int) $message->comment_ID ) as $attachment_id ) {
						$url = wp_get_attachment_url( $attachment_id );
						if ( $url ) $attachments[] = array( 'id' => $attachment_id, 'url' => $url, 'mime' => (string) get_post_mime_type( $attachment_id ), 'name' => (string) get_the_title( $attachment_id ) );
					}
					return array(
						'id' => (int) $message->comment_ID,
						'body' => $message->comment_content,
						'sender' => $sender ?: 'user',
						'author' => get_comment_author( $message ),
						'created_at' => get_comment_date( 'c', $message ),
						'attachments' => $attachments,
					);
				},
				$this->messages( $ticket_id )
			);
		}
		return $out;
	}

	private function rest_customer_id( \WP_REST_Request $request ): int {
		$customer_id = absint( $request->get_param( 'customer_id' ) );
		$email = sanitize_email( (string) $request->get_param( 'customer_email' ) );
		if ( ! $customer_id && $email ) { $user = get_user_by( 'email', $email ); $customer_id = $user ? (int) $user->ID : 0; }
		return $customer_id;
	}

	private function rest_ticket_owned_by_customer( int $ticket_id, int $customer_id ): bool {
		$ticket = get_post( $ticket_id );
		return $ticket instanceof \WP_Post && self::POST_TYPE === $ticket->post_type && (int) $ticket->post_author === $customer_id;
	}

	public function rest_list_tickets( \WP_REST_Request $request ): \WP_REST_Response {
		$page = max( 1, absint( $request->get_param( 'page' ) ?: 1 ) );
		$per_page = min( 100, max( 1, absint( $request->get_param( 'per_page' ) ?: 25 ) ) );
		$meta = array();
		$scope = sanitize_key( (string) $request->get_param( 'scope' ) );
		$customer_id = 'customer' === $scope ? $this->rest_customer_id( $request ) : 0;
		if ( 'customer' === $scope && ! $customer_id ) {
			return new \WP_REST_Response( array( 'success' => false, 'error' => 'Customer identity not resolved' ), 403 );
		}
		$status = sanitize_key( (string) $request->get_param( 'status' ) );
		if ( $status ) $meta[] = array( 'key' => '_jarchi_ticket_status', 'value' => $status );
		$priority = sanitize_key( (string) $request->get_param( 'priority' ) );
		if ( $priority ) $meta[] = array( 'key' => '_jarchi_ticket_priority', 'value' => $priority );
		$agent = absint( $request->get_param( 'agent' ) );
		if ( $agent ) $meta[] = array( 'key' => '_jarchi_ticket_agent', 'value' => $agent );
		$args = array(
			'post_type' => self::POST_TYPE,
			'post_status' => array( 'publish', 'private' ),
			'posts_per_page' => $per_page,
			'paged' => $page,
			'orderby' => 'modified',
			'order' => 'DESC',
			'no_found_rows' => false,
			'meta_query' => $meta,
		);
		if ( 'customer' === $scope ) {
			$args['author'] = $customer_id;
		}
		$search = trim( (string) $request->get_param( 'search' ) );
		if ( '' !== $search ) $args['s'] = $search;
		$department = absint( $request->get_param( 'department' ) );
		$category = absint( $request->get_param( 'category' ) );
		$tax_query = array();
		if ( $department ) $tax_query[] = array( 'taxonomy' => self::TAXONOMY, 'field' => 'term_id', 'terms' => array( $department ) );
		if ( $category ) $tax_query[] = array( 'taxonomy' => self::CATEGORY, 'field' => 'term_id', 'terms' => array( $category ) );
		if ( count( $tax_query ) > 1 ) $tax_query['relation'] = 'AND';
		if ( ! empty( $tax_query ) ) $args['tax_query'] = $tax_query;
		$q = new \WP_Query( $args );
		$items = array_map( fn( $id ) => $this->rest_ticket_view( (int) $id, false ), $q->posts );
		return new \WP_REST_Response( array( 'success' => true, 'tickets' => $items, 'pagination' => array( 'page' => $page, 'per_page' => $per_page, 'total' => (int) $q->found_posts, 'pages' => (int) $q->max_num_pages ), 'filters' => array( 'statuses' => $this->ticket_status_counts( $customer_id ?: null ), 'unread' => $customer_id ? $this->unread_count( $customer_id ) : $this->unread_count() ) ), 200 );
	}

	/**
	 * How many tickets sit in each status.
	 *
	 * Grouped in SQL rather than counted in PHP.
	 *
	 * This used to fetch every ticket id with posts_per_page => -1 and then ask
	 * for each one's status meta separately — so a site with fifty thousand
	 * tickets ran fifty thousand queries and held fifty thousand ids in memory
	 * to produce five numbers, on a screen that is opened all day. One GROUP BY
	 * returns the same five numbers in one round trip whatever the volume.
	 *
	 * @since 1.9.0
	 *
	 * @param int|null $customer_id Limit to one customer's tickets.
	 *
	 * @return array<string,int> Count per status.
	 */
	private function ticket_status_counts( ?int $customer_id = null ): array {
		global $wpdb;

		$counts = array( 'all' => 0, 'waiting' => 0, 'reviewing' => 0, 'answered' => 0, 'closed' => 0 );

		// A LEFT JOIN, because a ticket whose status meta was never written is
		// still a ticket and still belongs in the total.
		$sql = "SELECT COALESCE( m.meta_value, '' ) AS ticket_status, COUNT(*) AS total
			FROM {$wpdb->posts} p
			LEFT JOIN {$wpdb->postmeta} m ON m.post_id = p.ID AND m.meta_key = '_jarchi_ticket_status'
			WHERE p.post_type = %s
			  AND p.post_status IN ( 'publish', 'private', 'draft' )";

		$args = array( self::POST_TYPE );

		if ( $customer_id ) {
			$sql   .= ' AND p.post_author = %d';
			$args[] = $customer_id;
		}

		$sql .= ' GROUP BY ticket_status';

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- prepared above.
		$rows = (array) $wpdb->get_results( $wpdb->prepare( $sql, $args ) );

		foreach ( $rows as $row ) {
			$total = (int) ( $row->total ?? 0 );
			$state = $this->canonical_status( (string) ( $row->ticket_status ?? '' ) );

			$counts['all'] += $total;

			if ( isset( $counts[ $state ] ) ) {
				$counts[ $state ] += $total;
			}
		}

		return $counts;
	}

	public function rest_get_ticket( \WP_REST_Request $request ): \WP_REST_Response {
		$scope = sanitize_key( (string) $request->get_param( 'scope' ) );
		$customer_id = 'customer' === $scope ? $this->rest_customer_id( $request ) : 0;
		if ( 'customer' === $scope && ( ! $customer_id || ! $this->rest_ticket_owned_by_customer( absint( $request['id'] ), $customer_id ) ) ) {
			return new \WP_REST_Response( array( 'success' => false, 'error' => 'Ticket ownership mismatch' ), 403 );
		}
		$ticket = $this->rest_ticket_view( absint( $request['id'] ), true );
		if ( empty( $ticket ) ) return new \WP_REST_Response( array( 'success' => false, 'error' => 'Ticket not found' ), 404 );
		return new \WP_REST_Response( array( 'success' => true, 'ticket' => $ticket ), 200 );
	}

	public function rest_create_ticket( \WP_REST_Request $request ): \WP_REST_Response {
		$scope = sanitize_key( (string) $request->get_param( 'scope' ) );
		if ( 'customer' === $scope ) {
			$customer_id = $this->rest_customer_id( $request );
			if ( ! $customer_id ) return new \WP_REST_Response( array( 'success' => false, 'error' => 'Customer identity not resolved' ), 403 );
		} else {
			$customer_id = absint( $request->get_param( 'customer_id' ) );
		}
		$subject = sanitize_text_field( (string) $request->get_param( 'subject' ) );
		$body = wp_kses_post( (string) $request->get_param( 'body' ) );
		$result = $this->create_ticket_from_remote( array(
			'subject' => $subject,
			'body' => $body,
			'customer_id' => $customer_id,
			'customer_email' => sanitize_email( (string) $request->get_param( 'customer_email' ) ),
			'customer_phone' => sanitize_text_field( (string) $request->get_param( 'customer_phone' ) ),
			'priority' => (string) $request->get_param( 'priority' ),
			'department' => absint( $request->get_param( 'department' ) ),
			'category' => absint( $request->get_param( 'category' ) ),
			'sender_type' => sanitize_key( (string) $request->get_param( 'sender_type' ) ?: 'admin' ),
			'sender_name' => sanitize_text_field( (string) $request->get_param( 'sender_name' ) ),
		) );
		if ( is_wp_error( $result ) ) return new \WP_REST_Response( array( 'success' => false, 'error' => $result->get_error_message() ), 400 );
		return new \WP_REST_Response( array( 'success' => true, 'ticket' => $this->rest_ticket_view( (int) $result, true ) ), 201 );
	}

	public function create_local_automated_ticket( int $customer_id, string $subject, string $body, array $options = array() ): int|\WP_Error {
		$user = get_user_by( 'id', $customer_id );
		if ( ! $user ) { return new \WP_Error( 'customer_not_found', __( 'کاربر پیدا نشد.', 'wp-event-publisher' ) ); }
		$subject = sanitize_text_field( $subject );
		$body = wp_kses_post( $body );
		if ( '' === trim( $subject ) || '' === trim( wp_strip_all_tags( $body ) ) ) { return new \WP_Error( 'invalid_ticket', __( 'عنوان و متن تیکت الزامی است.', 'wp-event-publisher' ) ); }
		$priority = sanitize_key( (string) ( $options['priority'] ?? 'normal' ) );
		$priority = in_array( $priority, array( 'low', 'normal', 'high', 'urgent' ), true ) ? $priority : 'normal';
		$ticket_id = wp_insert_post( array( 'post_type' => self::POST_TYPE, 'post_status' => 'publish', 'post_title' => $subject, 'post_author' => $customer_id ), true );
		if ( is_wp_error( $ticket_id ) ) { return $ticket_id; }

		$allow_reply = ! empty( $options['allow_reply'] );

		update_post_meta( $ticket_id, '_jarchi_ticket_priority', $priority );

		/*
		 * An announcement nobody can answer is finished, so it is closed — not
		 * left "awaiting your reply" in a list the customer cannot act on. When
		 * replies ARE invited the thread is genuinely open and waiting on them.
		 */
		/*
		 * A message the site sent is a NEW ticket, not an answered one.
		 *
		 * Storing `answered` put a brand-new message straight into the
		 * "already dealt with" bucket, so the customer's list read as though a
		 * conversation had happened and the support queue never showed it.
		 * When the customer may reply it is genuinely open and waiting; when
		 * they may not there is nothing to wait for, so it is closed.
		 */
		update_post_meta( $ticket_id, '_jarchi_ticket_status', $allow_reply ? 'waiting' : 'closed' );
		update_post_meta( $ticket_id, self::META_ALLOW_REPLY, $allow_reply ? '1' : '0' );
		$this->mark_unread_for_user( $ticket_id );
		update_post_meta( $ticket_id, self::META_AUTOMATED, '1' );
		if ( ! empty( $options['automation_id'] ) ) { update_post_meta( $ticket_id, '_jarchi_ticket_automation_id', sanitize_key( (string) $options['automation_id'] ) ); }
		foreach ( array( 'department' => self::TAXONOMY, 'category' => self::CATEGORY ) as $key => $taxonomy ) {
			$term_id = absint( $options[ $key ] ?? 0 );
			if ( $term_id && term_exists( $term_id, $taxonomy ) ) { wp_set_post_terms( $ticket_id, array( $term_id ), $taxonomy ); }
		}
		$comment_id = wp_insert_comment( array( 'comment_post_ID' => $ticket_id, 'comment_author' => 'Jarchi', 'comment_author_email' => '', 'comment_content' => $body, 'comment_type' => self::COMMENT_TYPE, 'user_id' => 0, 'comment_approved' => 1 ) );
		if ( ! $comment_id ) { wp_delete_post( $ticket_id, true ); return new \WP_Error( 'message_failed', __( 'پیام تیکت ایجاد نشد.', 'wp-event-publisher' ) ); }
		add_comment_meta( $comment_id, '_jarchi_ticket_sender', 'admin', true );
		add_comment_meta( $comment_id, '_jarchi_ticket_automated', '1', true );

		/*
		 * Deliberately no `_jarchi_ticket_first_response_at`.
		 *
		 * That field measures how long a customer waited for an answer. Nobody
		 * waited here — the site started the conversation — so recording a
		 * response time of zero would quietly flatter every SLA report with
		 * work that was never done.
		 */
		update_post_meta( $ticket_id, '_jarchi_ticket_last_reply', current_time( 'mysql' ) );
		$this->safe_notify_created( (int) $ticket_id );
		$this->notify_user( (int) $ticket_id, $body );
		return (int) $ticket_id;
	}

	public function create_ticket_from_remote( array $data ): int|\WP_Error {
		$subject = sanitize_text_field( (string) ( $data['subject'] ?? '' ) );
		$body = wp_kses_post( (string) ( $data['body'] ?? '' ) );
		$customer_id = absint( $data['customer_id'] ?? 0 );
		if ( ! $customer_id && ! empty( $data['customer_email'] ) ) {
			$matched = get_user_by( 'email', sanitize_email( (string) $data['customer_email'] ) );
			$customer_id = $matched ? (int) $matched->ID : 0;
		}
		if ( ! $customer_id && ! empty( $data['customer_phone'] ) ) {
			$needle = preg_replace( '/[^0-9+]/', '', (string) $data['customer_phone'] );
			foreach ( array( 'billing_phone', 'phone', 'mobile', 'user_phone', 'mobile_number' ) as $phone_key ) {
				$users = get_users( array( 'meta_key' => $phone_key, 'meta_value' => $needle, 'number' => 1, 'fields' => 'ID' ) );
				if ( ! empty( $users ) ) { $customer_id = (int) $users[0]; break; }
			}
		}
		$priority = sanitize_key( (string) ( $data['priority'] ?? 'normal' ) );
		$priority = in_array( $priority, array( 'low', 'normal', 'high', 'urgent' ), true ) ? $priority : 'normal';
		$sender_type = sanitize_key( (string) ( $data['sender_type'] ?? 'admin' ) );
		$sender_type = in_array( $sender_type, array( 'admin', 'user', 'system' ), true ) ? $sender_type : 'admin';
		if ( '' === trim( $subject ) || '' === trim( wp_strip_all_tags( $body ) ) || ! $customer_id ) return new \WP_Error( 'invalid_ticket', __( 'subject, body and customer_id are required', 'wp-event-publisher' ) );
		$user = get_user_by( 'id', $customer_id );
		if ( ! $user ) return new \WP_Error( 'customer_not_found', __( 'Customer not found', 'wp-event-publisher' ) );
		$ticket_id = wp_insert_post( array( 'post_type' => self::POST_TYPE, 'post_status' => 'publish', 'post_title' => $subject, 'post_author' => $customer_id ), true );
		if ( is_wp_error( $ticket_id ) ) return $ticket_id;
		update_post_meta( $ticket_id, '_jarchi_ticket_priority', $priority );
		update_post_meta( $ticket_id, '_jarchi_ticket_status', $sender_type === 'admin' ? 'answered' : 'waiting' );
		update_post_meta( $ticket_id, $sender_type === 'admin' ? '_jarchi_ticket_user_unread' : '_jarchi_ticket_admin_unread', '1' );
		foreach ( array( 'department' => self::TAXONOMY, 'category' => self::CATEGORY ) as $key => $taxonomy ) {
			$term_id = absint( $data[ $key ] ?? 0 );
			if ( $term_id && term_exists( $term_id, $taxonomy ) ) wp_set_post_terms( $ticket_id, array( $term_id ), $taxonomy );
		}
		$custom = is_array($data['custom_fields'] ?? null) ? $data['custom_fields'] : array();
		if ($custom) update_post_meta($ticket_id, '_jarchi_ticket_custom_fields', array_map('sanitize_text_field', $custom));
		$message_id = $this->insert_remote_message( (int) $ticket_id, $body, $sender_type, sanitize_text_field( (string) ( $data['sender_name'] ?? '' ) ) );
		if ( ! $message_id ) return new \WP_Error( 'message_failed', __( 'ثبت پیام انجام نشد.', 'wp-event-publisher' ) );
		$this->send_backend_ticket_event( 'ticket.created', (int) $ticket_id, array( 'message' => wp_strip_all_tags( $body ), 'source' => 'remote', 'sender_type' => $sender_type ) );
		if ( $sender_type === 'admin' ) { $this->notify_user( (int) $ticket_id, $body ); $this->safe_notify_created( (int) $ticket_id ); }
		return (int) $ticket_id;
	}

	public function rest_ticket_action( \WP_REST_Request $request ): \WP_REST_Response {
		$id = absint( $request['id'] );
		$ticket = get_post( $id );
		if ( ! $ticket || self::POST_TYPE !== $ticket->post_type ) return new \WP_REST_Response( array( 'success' => false, 'error' => 'Ticket not found' ), 404 );
		$action = sanitize_key( (string) $request->get_param( 'action' ) );
		$scope = sanitize_key( (string) $request->get_param( 'scope' ) );
		$customer_id = 'customer' === $scope ? $this->rest_customer_id( $request ) : 0;
		if ( 'customer' === $scope && ( ! $customer_id || (int) $ticket->post_author !== $customer_id ) ) {
			return new \WP_REST_Response( array( 'success' => false, 'error' => 'Ticket ownership mismatch' ), 403 );
		}
		if ( 'mark-read' === str_replace( '_', '-', $action ) ) $action = 'mark_read';
		if ( 'customer' === $scope ) {
			if ( 'reply' === $action ) {
				$result = $this->reply_from_customer_remote( $id, (string) $request->get_param( 'body' ), $customer_id );
				if ( is_wp_error( $result ) ) return new \WP_REST_Response( array( 'success' => false, 'error' => $result->get_error_message() ), 400 );
			} elseif ( 'status' === $action ) {
				$status = sanitize_key( (string) $request->get_param( 'status' ) );
				if ( ! in_array( $status, array( 'waiting', 'closed' ), true ) ) return new \WP_REST_Response( array( 'success' => false, 'error' => 'Customer status is not allowed' ), 403 );
				update_post_meta( $id, '_jarchi_ticket_status', $status );
			} elseif ( 'mark_read' === $action ) {
				delete_post_meta( $id, '_jarchi_ticket_user_unread' );
			} else {
				return new \WP_REST_Response( array( 'success' => false, 'error' => 'Unsupported customer action' ), 403 );
			}
		} elseif ( 'reply' === $action ) {
			$body = (string) $request->get_param( 'body' );
			$result = $this->reply_from_remote( $id, $body, 'bot', (string) $request->get_param( 'agent_name' ) );
			if ( is_wp_error( $result ) ) return new \WP_REST_Response( array( 'success' => false, 'error' => $result->get_error_message() ), 400 );
		} elseif ( 'status' === $action ) {
			$result = $this->set_status_from_remote( $id, sanitize_key( (string) $request->get_param( 'status' ) ) );
			if ( is_wp_error( $result ) ) return new \WP_REST_Response( array( 'success' => false, 'error' => $result->get_error_message() ), 400 );
		} elseif ( 'assign' === $action ) {
			$this->assign_agent( $id, absint( $request->get_param( 'user_id' ) ) );
		} elseif ( 'mark_read' === $action ) {
			delete_post_meta( $id, '_jarchi_ticket_admin_unread' );
		} else {
			return new \WP_REST_Response( array( 'success' => false, 'error' => 'Unsupported action' ), 400 );
		}
		return new \WP_REST_Response( array( 'success' => true, 'ticket' => $this->rest_ticket_view( $id, true ) ), 200 );
	}

	public function rest_ticket_rating( \WP_REST_Request $request ): \WP_REST_Response {
		$id = absint( $request['id'] );
		$ticket = get_post( $id );
		if ( ! $ticket || self::POST_TYPE !== $ticket->post_type ) {
			return new \WP_REST_Response( array( 'success' => false, 'error' => 'Ticket not found' ), 404 );
		}
		$rating = absint( $request->get_param( 'rating' ) );
		if ( $rating < 1 || $rating > 5 ) {
			return new \WP_REST_Response( array( 'success' => false, 'error' => 'rating must be between 1 and 5' ), 400 );
		}
		$customer_id = absint( $request->get_param( 'customer_id' ) );
		if ( ! $customer_id && $request->get_param( 'customer_email' ) ) {
			$user = get_user_by( 'email', sanitize_email( (string) $request->get_param( 'customer_email' ) ) );
			$customer_id = $user ? (int) $user->ID : 0;
		}
		if ( ! $customer_id || (int) $ticket->post_author !== $customer_id ) {
			return new \WP_REST_Response( array( 'success' => false, 'error' => 'Ticket ownership mismatch' ), 403 );
		}
		update_post_meta( $id, '_jarchi_ticket_rating', $rating );
		update_post_meta( $id, '_jarchi_ticket_rating_comment', sanitize_textarea_field( (string) $request->get_param( 'comment' ) ) );
		return new \WP_REST_Response( array( 'success' => true, 'rating' => $rating ), 200 );
	}

	public function rest_agents( \WP_REST_Request $request ): \WP_REST_Response {
		$users = $this->support_agents();
		return new \WP_REST_Response( array( 'success' => true, 'agents' => array_map( fn( $u ) => array( 'id' => (int) $u->ID, 'name' => $u->display_name, 'username' => $u->user_login, 'email' => $u->user_email ), $users ) ), 200 );
	}

	public function rest_agent_action( \WP_REST_Request $request ): \WP_REST_Response {
		$user_id = absint( $request->get_param( 'user_id' ) );
		$action = sanitize_key( (string) $request->get_param( 'action' ) );
		$user = get_user_by( 'id', $user_id );
		if ( ! $user ) return new \WP_REST_Response( array( 'success' => false, 'error' => 'User not found' ), 404 );
		if ( 'add' === $action ) $user->add_role( 'jarchi_support_agent' );
		elseif ( 'remove' === $action ) $user->remove_role( 'jarchi_support_agent' );
		else return new \WP_REST_Response( array( 'success' => false, 'error' => 'Unsupported agent action' ), 400 );
		return $this->rest_agents( $request );
	}

	public function rest_canned_replies( \WP_REST_Request $request ): \WP_REST_Response {
		$items = array_map(
			static function ( $item ) {
				return array(
					'title' => sanitize_text_field( (string) ( $item['title'] ?? '' ) ),
					'body' => wp_strip_all_tags( (string) ( $item['body'] ?? '' ) ),
				);
			},
			$this->canned_replies()
		);
		return new \WP_REST_Response( array( 'success' => true, 'items' => $items ), 200 );
	}

	public function rest_customers( \WP_REST_Request $request ): \WP_REST_Response {
		$search = sanitize_text_field( (string) $request->get_param( 'search' ) );
		$args = array( 'number' => min( 100, max( 1, absint( $request->get_param( 'limit' ) ?: 50 ) ) ), 'orderby' => 'display_name', 'order' => 'ASC' );
		if ( $search !== '' ) $args['search'] = '*' . $search . '*';
		$users = get_users( $args );
		return new \WP_REST_Response( array( 'success' => true, 'customers' => array_map( function( $u ) { return array( 'id' => (int) $u->ID, 'name' => $u->display_name, 'username' => $u->user_login, 'email' => $u->user_email ); }, $users ) ), 200 );
	}

	public function rest_unread( \WP_REST_Request $request ): \WP_REST_Response {
		$scope = sanitize_key( (string) $request->get_param( 'scope' ) );
		$meta_key = 'customer' === $scope ? '_jarchi_ticket_user_unread' : '_jarchi_ticket_admin_unread';
		$args = array( 'post_type' => self::POST_TYPE, 'post_status' => array( 'publish', 'private', 'draft' ), 'posts_per_page' => 1, 'fields' => 'ids', 'no_found_rows' => false, 'meta_query' => array( array( 'key' => $meta_key, 'value' => '1' ) ) );
		if ( 'customer' === $scope ) {
			$customer_id = $this->rest_customer_id( $request );
			if ( ! $customer_id ) return new \WP_REST_Response( array( 'success' => false, 'error' => 'Customer identity not resolved' ), 403 );
			$args['author'] = $customer_id;
		}
		$q = new \WP_Query( $args );
		return new \WP_REST_Response( array( 'success' => true, 'unread' => (int) $q->found_posts, 'unread_for_support' => (int) $q->found_posts ), 200 );
	}

	public function rest_meta( \WP_REST_Request $request ): \WP_REST_Response {
		$departments = get_terms( array( 'taxonomy' => self::TAXONOMY, 'hide_empty' => false ) );
		$categories = get_terms( array( 'taxonomy' => self::CATEGORY, 'hide_empty' => false ) );
		return new \WP_REST_Response( array(
			'success' => true,
			'departments' => array_map( fn( $t ) => array( 'id' => (int) $t->term_id, 'name' => $t->name ), is_wp_error( $departments ) ? array() : $departments ),
			'categories' => array_map( fn( $t ) => array( 'id' => (int) $t->term_id, 'name' => $t->name ), is_wp_error( $categories ) ? array() : $categories ),
			'advanced' => $this->advanced_settings(),
		), 200 );
	}

	public function register_content_types(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels' => array(
					'name'          => __( 'تیکت‌ها', 'wp-event-publisher' ),
					'singular_name' => __( 'تیکت', 'wp-event-publisher' ),
				),
				'public'              => false,
				'show_ui'             => false,
				'show_in_menu'        => false,
				'show_in_rest'        => false,
				'supports'            => array( 'title', 'author' ),
				'capability_type'     => 'post',
				'map_meta_cap'        => true,
				'has_archive'         => false,
				'rewrite'             => false,
				'publicly_queryable'  => false,
			) 
		);

		register_taxonomy(
			self::TAXONOMY,
			self::POST_TYPE,
			array(
				'labels' => array(
					'name'          => __( 'دپارتمان‌ها', 'wp-event-publisher' ),
					'singular_name' => __( 'دپارتمان', 'wp-event-publisher' ),
				),
				'public'       => false,
				'show_ui'      => false,
				'show_in_rest' => false,
				'hierarchical' => true,
				'rewrite'      => false,
			)
		);

		register_taxonomy(
			self::CATEGORY,
			self::POST_TYPE,
			array(
				'labels' => array(
					'name'          => __( 'دسته‌بندی‌های تیکت', 'wp-event-publisher' ),
					'singular_name' => __( 'دسته‌بندی تیکت', 'wp-event-publisher' ),
				),
				'public'       => false,
				'show_ui'      => false,
				'show_in_rest' => false,
				'hierarchical' => true,
				'rewrite'      => false,
			)
		);

		$this->seed_default_terms();
		// Legacy tickets used private status while the CPT has no public UI.
		// Run this normalization only once after the upgrade; doing the same
		// private-post query on every frontend request would be unnecessary work.
		if ( ! get_option( '_jarchi_ticket_status_normalized_192', false ) ) {
			$this->normalize_legacy_ticket_statuses();
			update_option( '_jarchi_ticket_status_normalized_192', 1, false );
		}
		$this->maybe_create_page();
	}

	/**
	 * Creates a dedicated user-facing ticket page once, so the icon has a
	 * stable destination even when the site owner has not built an Elementor
	 * page yet. The page can still be edited with Elementor afterwards.
	 */
	private function maybe_create_page(): void {
		$page_id = absint( get_option( '_wpep_ticket_page_id', 0 ) );
		if ( $page_id && 'trash' !== get_post_status( $page_id ) ) {
			return;
		}

		$existing = get_page_by_path( 'jarchi-tickets' );
		if ( $existing instanceof \WP_Post ) {
			update_option( '_wpep_ticket_page_id', $existing->ID, false );
			return;
		}

		$new_id = wp_insert_post(
			array(
				'post_type'    => 'page',
				'post_status'  => 'publish',
				'post_title'   => __( 'تیکت‌های من', 'wp-event-publisher' ),
				'post_name'    => 'jarchi-tickets',
				'post_content' => '',
			),
			true
		);
		if ( ! is_wp_error( $new_id ) ) {
			update_option( '_wpep_ticket_page_id', (int) $new_id, false );
		}
	}

	public function ticket_page_url(): string {
		$page_id = absint( get_option( '_wpep_ticket_page_id', 0 ) );
		if ( $page_id && 'publish' === get_post_status( $page_id ) ) {
			return (string) get_permalink( $page_id );
		}
		return home_url( '/jarchi-tickets/' );
	}

	public function register_admin_menu(): void {
		// Admin screen registration is centralized in Admin::register_menu().
		// Kept as a no-op for backwards compatibility.
	}

	/**
	 * Backward-compatible no-op: the standalone Tickets top-level menu no longer exists.
	 */
	public function clean_native_menu(): void {
		// Native menu registration is centralized in Admin. Do not mutate $submenu.
	}

	public function render_admin(): void {
		// A support agent reaches this screen too — that is the point of the
		// role — but only ever sees their own departments. Administrators keep
		// the unrestricted view.
		if ( ! current_user_can( Admin::CAPABILITY ) && ! current_user_can( 'jarchi_support_tickets' ) ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}

		$viewer_scope = $this->viewer_department_scope();

		$ticket_id = isset( $_GET['ticket'] ) ? absint( $_GET['ticket'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$status    = isset( $_GET['status'] ) ? sanitize_key( wp_unslash( (string) $_GET['status'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$dept      = isset( $_GET['department'] ) ? absint( $_GET['department'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$category  = isset( $_GET['category'] ) ? absint( $_GET['category'] ) : 0;
		$search    = isset( $_GET['s'] ) ? sanitize_text_field( wp_unslash( (string) $_GET['s'] ) ) : '';
		if ( '' !== $search && ctype_digit( $search ) ) { $direct = get_post( absint( $search ) ); if ( $direct && self::POST_TYPE === $direct->post_type ) { wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE, 'ticket' => $direct->ID ), admin_url( 'admin.php' ) ) ); exit; } } // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		if ( $ticket_id > 0 && self::POST_TYPE === get_post_type( $ticket_id ) ) {
			$this->render_admin_ticket( $ticket_id );
			return;
		}

		$meta_query = array();
		if ( in_array( $status, array( 'waiting', 'reviewing', 'answered', 'closed', 'open', 'pending' ), true ) ) {
			$meta_query[] = array( 'key' => '_jarchi_ticket_status', 'value' => $status );
		}

		$args = array(
			'post_type'      => self::POST_TYPE,
			'post_status'    => array( 'publish', 'draft', 'pending' ),
			'posts_per_page' => 30,
			'paged'          => max( 1, isset( $_GET['paged'] ) ? absint( $_GET['paged'] ) : 1 ), // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			'orderby'        => 'modified',
			'order'          => 'DESC',
			'meta_query'     => $meta_query,
			's'              => $search,
		);

		$tax_query = array();

		/*
		 * The agent's departments are applied as a query constraint, not as a
		 * filter over the rendered list. A list filtered afterwards has still
		 * fetched the other departments' tickets, and the pager, the counts and
		 * any future export would all be computed from them.
		 *
		 * An agent with nothing assigned gets an impossible constraint rather
		 * than an unfiltered list: "not configured yet" must fail closed.
		 */
		if ( null !== $viewer_scope ) {
			$tax_query[] = array(
				'taxonomy' => self::TAXONOMY,
				'field'    => 'term_id',
				'terms'    => $viewer_scope ?: array( 0 ),
			);

			// A department in the query string may only narrow that further.
			if ( $dept > 0 && ! in_array( $dept, $viewer_scope, true ) ) {
				$dept = 0;
			}
		}

		if ( $dept > 0 ) {
			$tax_query[] = array(
				'taxonomy' => self::TAXONOMY,
				'field'    => 'term_id',
				'terms'    => $dept,
			);
		}
		if ( $category > 0 ) {
			$tax_query[] = array(
				'taxonomy' => self::CATEGORY,
				'field'    => 'term_id',
				'terms'    => $category,
			);
		}
		if ( $tax_query ) {
			$args['tax_query'] = count( $tax_query ) > 1 ? array_merge( array( 'relation' => 'AND' ), $tax_query ) : $tax_query;
		}

		$query = new \WP_Query( $args );
		$departments = get_terms( array( 'taxonomy' => self::TAXONOMY, 'hide_empty' => false ) );

		// The filter dropdown offers only what this viewer may actually pick.
		if ( null !== $viewer_scope ) {
			$departments = array_values(
				array_filter(
					(array) $departments,
					static fn( $term ) => in_array( (int) $term->term_id, $viewer_scope, true )
				)
			);
		}
		$categories  = get_terms( array( 'taxonomy' => self::CATEGORY, 'hide_empty' => false ) );
		$status_counts = $this->ticket_status_counts();
		$this->enqueue_admin_ticket_assets();

		include WPEP_PLUGIN_DIR . 'admin/views/tickets.php';
	}

	private function render_admin_ticket( int $ticket_id ): void {
		$ticket = get_post( $ticket_id );
		if ( ! $ticket || self::POST_TYPE !== $ticket->post_type ) {
			wp_safe_redirect( Admin::app_url( 'support' ) );
			exit;
		}

		if ( ! $this->viewer_can_see_ticket( $ticket_id ) ) {
			wp_die(
				esc_html__( 'این تیکت به دپارتمان‌های شما مربوط نیست.', 'wp-event-publisher' ),
				esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ),
				array( 'response' => 403 )
			);
		}

		$this->enqueue_admin_ticket_assets();
		$messages = $this->messages( $ticket_id );
		$user     = get_user_by( 'id', (int) $ticket->post_author );
		$status   = $this->status( $ticket_id );
		$priority = (string) get_post_meta( $ticket_id, '_jarchi_ticket_priority', true );
		$terms    = wp_get_post_terms( $ticket_id, self::TAXONOMY );
		$categories = wp_get_post_terms( $ticket_id, self::CATEGORY );

		// Opening the thread is the natural point to mark admin-unread as read.
		delete_post_meta( $ticket_id, '_jarchi_ticket_admin_unread' );

		include WPEP_PLUGIN_DIR . 'admin/views/ticket-single.php';
	}

	/**
	 * Creates the starter department and category once, and only once.
	 *
	 * This used to run inside register_content_types(), which fires on every
	 * `init` — so the moment an administrator deleted the last department or
	 * the last category, the next page load put it straight back. From the
	 * other side of the screen that is indistinguishable from a delete button
	 * that does not work, which is exactly how it was reported.
	 *
	 * The starter terms exist to give a fresh install something to select, so
	 * seeding them once is the whole of the intent. An option records that it
	 * happened, and an empty taxonomy afterwards is then a deliberate choice
	 * the plugin leaves alone.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	private function seed_default_terms(): void {
		if ( get_option( self::OPTION_TERMS_SEEDED, false ) ) {
			return;
		}

		if ( ! term_exists( 'پشتیبانی', self::TAXONOMY ) ) {
			wp_insert_term( 'پشتیبانی', self::TAXONOMY, array( 'slug' => 'support' ) );
		}

		if ( ! term_exists( 'عمومی', self::CATEGORY ) ) {
			wp_insert_term( 'عمومی', self::CATEGORY, array( 'slug' => 'general' ) );
		}

		update_option( self::OPTION_TERMS_SEEDED, '1', false );
	}

	/**
	 * Creates or deletes one taxonomy term for the support section.
	 *
	 * Departments and categories are the same operation on two taxonomies, so
	 * they share one guarded implementation rather than two that can drift.
	 *
	 * @since 1.9.0
	 *
	 * @param string $taxonomy Taxonomy to act on.
	 * @param string $prefix   POST key prefix, e.g. `jarchi_department`.
	 *
	 * @return string A message for the administrator, or an empty string.
	 */
	private function handle_term_actions( string $taxonomy, string $prefix ): string {
		if ( isset( $_POST[ $prefix . '_save' ] ) ) {
			check_admin_referer( self::NONCE );

			$name   = sanitize_text_field( wp_unslash( $_POST['name'] ?? '' ) );
			$parent = absint( $_POST['parent'] ?? 0 );

			if ( '' === $name ) {
				return __( 'نام را وارد کنید.', 'wp-event-publisher' );
			}

			$created = wp_insert_term( $name, $taxonomy, array( 'parent' => $parent ) );

			if ( is_wp_error( $created ) ) {
				return $created->get_error_message();
			}

			/* translators: %s: the name that was added. */
			return sprintf( __( '«%s» اضافه شد.', 'wp-event-publisher' ), $name );
		}

		if ( isset( $_POST[ $prefix . '_delete' ] ) ) {
			check_admin_referer( self::NONCE );

			$term_id = absint( $_POST['term_id'] ?? 0 );
			$term    = $term_id ? get_term( $term_id, $taxonomy ) : null;

			if ( ! $term || is_wp_error( $term ) ) {
				return __( 'این مورد پیدا نشد.', 'wp-event-publisher' );
			}

			$name    = (string) $term->name;
			$deleted = wp_delete_term( $term_id, $taxonomy );

			if ( is_wp_error( $deleted ) ) {
				return $deleted->get_error_message();
			}

			/* translators: %s: the name that was removed. */
			return sprintf( __( '«%s» حذف شد.', 'wp-event-publisher' ), $name );
		}

		return '';
	}

	/**
	 * The department ids one agent is responsible for.
	 *
	 * @since 1.9.0
	 *
	 * @param int $user_id Agent.
	 *
	 * @return int[] Department term ids.
	 */
	public function agent_departments( int $user_id ): array {
		$stored = get_user_meta( $user_id, self::META_AGENT_DEPARTMENTS, true );
		$ids    = array_map( 'absint', (array) ( is_array( $stored ) ? $stored : array() ) );

		// A department deleted since the assignment must stop counting, or the
		// agent is scoped to a term that no longer exists — which presents as
		// "this agent can see nothing" for a reason nobody can find.
		$ids = array_filter(
			$ids,
			static function ( int $id ): bool {
				$term = get_term( $id, self::TAXONOMY );

				return $term && ! is_wp_error( $term );
			}
		);

		return array_values( array_unique( $ids ) );
	}

	/**
	 * Replaces one agent's department assignment.
	 *
	 * @since 1.9.0
	 *
	 * @param int   $user_id     Agent.
	 * @param int[] $departments Department term ids.
	 *
	 * @return void
	 */
	public function set_agent_departments( int $user_id, array $departments ): void {
		$valid = array();

		foreach ( array_map( 'absint', $departments ) as $id ) {
			$term = $id ? get_term( $id, self::TAXONOMY ) : null;

			if ( $term && ! is_wp_error( $term ) ) {
				$valid[] = $id;
			}
		}

		update_user_meta( $user_id, self::META_AGENT_DEPARTMENTS, array_values( array_unique( $valid ) ) );
	}

	/**
	 * Agents grouped by the department they answer for.
	 *
	 * @since 1.9.0
	 *
	 * @return array<int,array<int,object>> Agents keyed by department id.
	 */
	public function agents_by_department(): array {
		$out = array();

		foreach ( $this->support_agents() as $agent ) {
			foreach ( $this->agent_departments( (int) $agent->ID ) as $department ) {
				$out[ $department ][] = $agent;
			}
		}

		return $out;
	}

	/**
	 * Whether the current user is a support agent and nothing more.
	 *
	 * An administrator who is also an agent keeps the full view; the point of
	 * the restriction is to scope agents, not to lock out admins.
	 *
	 * @since 1.9.0
	 *
	 * @return bool True when the viewer is a scoped agent.
	 */
	public function viewer_is_scoped_agent(): bool {
		if ( current_user_can( Admin::CAPABILITY ) ) {
			return false;
		}

		return current_user_can( 'jarchi_support_tickets' );
	}

	/**
	 * The departments the current viewer may see tickets from.
	 *
	 * @since 1.9.0
	 *
	 * @return int[]|null Department ids, or null when the viewer sees everything.
	 */
	public function viewer_department_scope(): ?array {
		if ( ! $this->viewer_is_scoped_agent() ) {
			return null;
		}

		return $this->agent_departments( get_current_user_id() );
	}

	/**
	 * Whether the current viewer may open one ticket.
	 *
	 * The list query already excludes other departments, but a scoped agent
	 * can still type a ticket id into the address bar. Filtering a list is
	 * presentation; this is the access control.
	 *
	 * @since 1.9.0
	 *
	 * @param int $ticket_id Ticket.
	 *
	 * @return bool True when the viewer may see it.
	 */
	public function viewer_can_see_ticket( int $ticket_id ): bool {
		$scope = $this->viewer_department_scope();

		if ( null === $scope ) {
			return true;
		}

		// Not configured must fail closed: the safest-looking state cannot be
		// the most permissive one.
		if ( empty( $scope ) ) {
			return false;
		}

		$terms = wp_get_object_terms( $ticket_id, self::TAXONOMY, array( 'fields' => 'ids' ) );

		if ( is_wp_error( $terms ) ) {
			return false;
		}

		return (bool) array_intersect( array_map( 'absint', (array) $terms ), $scope );
	}

	public function render_departments(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}
		$notice               = $this->handle_term_actions( self::TAXONOMY, 'jarchi_department' );
		$departments          = get_terms( array( 'taxonomy' => self::TAXONOMY, 'hide_empty' => false ) );
		$categories           = get_terms( array( 'taxonomy' => self::CATEGORY, 'hide_empty' => false ) );
		$agents_by_department = $this->agents_by_department();
		$this->enqueue_admin_ticket_assets();
		include WPEP_PLUGIN_DIR . 'admin/views/ticket-departments.php';
	}

	public function render_ui_settings(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}
		$settings = $this->ui_settings();
		if ( isset( $_POST['jarchi_ticket_ui_save'] ) ) {
			check_admin_referer( 'jarchi_ticket_ui_save' );
			$settings['primary'] = sanitize_hex_color( wp_unslash( $_POST['primary'] ?? '' ) ) ?: $settings['primary'];
			$settings['surface'] = sanitize_hex_color( wp_unslash( $_POST['surface'] ?? '' ) ) ?: $settings['surface'];
			$settings['background'] = sanitize_hex_color( wp_unslash( $_POST['background'] ?? '' ) ) ?: $settings['background'];
			$settings['text'] = sanitize_hex_color( wp_unslash( $_POST['text'] ?? '' ) ) ?: $settings['text'];
			$settings['muted'] = sanitize_hex_color( wp_unslash( $_POST['muted'] ?? '' ) ) ?: $settings['muted'];
			$settings['border'] = sanitize_hex_color( wp_unslash( $_POST['border'] ?? '' ) ) ?: $settings['border'];
			$settings['radius'] = max( 10, min( 28, absint( $_POST['radius'] ?? $settings['radius'] ) ) );
			$settings['shadow'] = ! empty( $_POST['shadow'] );
			update_option( self::UI_OPTION, $settings, false );
		}
		$this->enqueue_admin_ticket_assets();
		include WPEP_PLUGIN_DIR . 'admin/views/ticket-ui.php';
	}

	public function ui_settings(): array {
		$defaults = array(
			'primary' => '#E84F01',
			'surface' => '#FFFFFF',
			'background' => '#F6F7F9',
			'text' => '#171717',
			'muted' => '#68717C',
			'border' => '#E5E7EB',
			'radius' => 18,
			'shadow' => true,
		);
		$stored = get_option( self::UI_OPTION, array() );
		return wp_parse_args( is_array( $stored ) ? $stored : array(), $defaults );
	}

	private function enqueue_admin_ticket_assets(): void {
		wp_enqueue_style( 'wpep-admin' );
		$css = WPEP_PLUGIN_DIR . 'assets/css/tickets.css';
		if ( is_readable( $css ) ) {
			wp_enqueue_style( 'wpep-tickets', WPEP_PLUGIN_URL . 'assets/css/tickets.css', array( 'wpep-admin' ), WPEP_VERSION . '.' . filemtime( $css ) );
		}
	}



	public function advanced_settings(): array {
		$defaults = array(
			'auto_close_enabled' => false,
			'auto_close_hours' => 72,
			'allow_voice' => true,
			'max_files' => 6,
			'max_file_mb' => 12,
			'faq' => array(),
			'custom_fields' => array(),
			'priorities' => array(
				'low' => array('label'=>'کم','color'=>'#64748B'),
				'normal' => array('label'=>'عادی','color'=>'#2563EB'),
				'high' => array('label'=>'بالا','color'=>'#F59E0B'),
				'urgent' => array('label'=>'فوری','color'=>'#DC2626'),
			),
			'status_labels' => array('waiting'=>'در انتظار پاسخ','reviewing'=>'در حال بررسی','answered'=>'پاسخ داده شده','closed'=>'بسته شده'),
		);
		$value = get_option( '_jarchi_ticket_advanced_settings', array() );
		return wp_parse_args( is_array($value) ? $value : array(), $defaults );
	}

	public function render_advanced_settings(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		$settings = $this->advanced_settings();
		if ( isset($_POST['jarchi_ticket_advanced_save']) ) {
			check_admin_referer('jarchi_ticket_advanced_save');
			$settings['auto_close_enabled'] = ! empty($_POST['auto_close_enabled']);
			$settings['auto_close_hours'] = max(1, min(720, absint($_POST['auto_close_hours'] ?? 72)));
			$settings['allow_voice'] = ! empty($_POST['allow_voice']);
			$settings['max_files'] = max(1, min(12, absint($_POST['max_files'] ?? 6)));
			$settings['max_file_mb'] = max(1, min(50, absint($_POST['max_file_mb'] ?? 12)));
			$faq = array();
			$faqTitles = (array)($_POST['faq_title'] ?? array()); $faqBodies=(array)($_POST['faq_body'] ?? array());
			foreach($faqTitles as $i=>$title){ $title=sanitize_text_field(wp_unslash($title)); $body=wp_kses_post(wp_unslash($faqBodies[$i] ?? '')); if($title!==''&&trim(wp_strip_all_tags($body))!=='') $faq[]=array('title'=>$title,'body'=>$body); }
			$settings['faq']=$faq;
			$cf=array(); $keys=(array)($_POST['cf_key'] ?? array()); $labels=(array)($_POST['cf_label'] ?? array()); $types=(array)($_POST['cf_type'] ?? array()); $reqs=(array)($_POST['cf_required'] ?? array()); $cfopts=(array)($_POST['cf_options'] ?? array());
			foreach($keys as $i=>$key){ $key=sanitize_key($key); $label=sanitize_text_field(wp_unslash($labels[$i] ?? '')); $type=sanitize_key($types[$i] ?? 'text'); if($key && $label) $options = sanitize_textarea_field(wp_unslash($cfopts[$i] ?? '')); $cf[]=array('key'=>$key,'label'=>$label,'type'=>in_array($type,array('text','textarea','select'),true)?$type:'text','required'=>!empty($reqs[$i]),'options'=>array_values(array_filter(array_map('trim',preg_split('/\r?\n|,/', $options))))); }
			$settings['custom_fields']=$cf;
			foreach(array_keys($settings['priorities']) as $pk){ $settings['priorities'][$pk]['label']=sanitize_text_field(wp_unslash($_POST['priority_label'][$pk] ?? $settings['priorities'][$pk]['label'])); $settings['priorities'][$pk]['color']=sanitize_hex_color(wp_unslash($_POST['priority_color'][$pk] ?? $settings['priorities'][$pk]['color'])) ?: $settings['priorities'][$pk]['color']; }
			foreach(array_keys($settings['status_labels']) as $sk){ $settings['status_labels'][$sk]=sanitize_text_field(wp_unslash($_POST['status_label'][$sk] ?? $settings['status_labels'][$sk])); }
			update_option('_jarchi_ticket_advanced_settings',$settings,false);
		}
		$this->enqueue_admin_ticket_assets(); include WPEP_PLUGIN_DIR.'admin/views/ticket-advanced.php';
	}

	public function maybe_schedule_auto_close(): void {
		$s=$this->advanced_settings();
		if(!empty($s['auto_close_enabled']) && !wp_next_scheduled('jarchi_ticket_auto_close')) wp_schedule_event(time()+300,'hourly','jarchi_ticket_auto_close');
		if(empty($s['auto_close_enabled']) && ($ts=wp_next_scheduled('jarchi_ticket_auto_close'))) wp_unschedule_event($ts,'jarchi_ticket_auto_close');
	}

	public function run_auto_close(): void {
		$s=$this->advanced_settings(); if(empty($s['auto_close_enabled'])) return;
		$cutoff=current_time('timestamp')-(HOUR_IN_SECONDS*max(1,(int)$s['auto_close_hours']));
		$ids=get_posts(array('post_type'=>self::POST_TYPE,'post_status'=>array('publish','private','draft'),'posts_per_page'=>200,'fields'=>'ids','meta_query'=>array(array('key'=>'_jarchi_ticket_status','value'=>array('waiting','reviewing','open'),'compare'=>'IN')),'date_query'=>array(array('column'=>'post_modified','before'=>gmdate('Y-m-d H:i:s',$cutoff)))));
		foreach($ids as $id){ update_post_meta($id,'_jarchi_ticket_status','closed'); update_post_meta($id,'_jarchi_ticket_auto_closed','1'); }
	}

	public function render_sms_settings(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}

		$settings = wpep()->tickets_sms()->settings();
		$this->enqueue_admin_ticket_assets();
		include WPEP_PLUGIN_DIR . 'admin/views/ticket-sms.php';
	}

	public function ensure_support_role(): void {
		if ( ! get_role( 'jarchi_support_agent' ) ) {
			$role = add_role( 'jarchi_support_agent', __( 'پشتیبان جارچی', 'wp-event-publisher' ), array( 'read' => true ) );
			if ( $role ) { $role->add_cap( 'jarchi_support_tickets' ); }
		}
	}

	public function support_agents(): array {
		return get_users( array( 'role' => 'jarchi_support_agent', 'orderby' => 'display_name', 'order' => 'ASC' ) );
	}

	public function canned_replies(): array {
		$value = get_option( '_jarchi_ticket_canned_replies', array() );
		return is_array( $value ) ? array_values( array_filter( $value, 'is_array' ) ) : array();
	}

	public function render_categories(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) { wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) ); }
		$notice     = $this->handle_term_actions( self::CATEGORY, 'jarchi_category' );
		$categories = get_terms( array( 'taxonomy' => self::CATEGORY, 'hide_empty' => false ) );
		$this->enqueue_admin_ticket_assets();
		include WPEP_PLUGIN_DIR . 'admin/views/ticket-categories.php';
	}

	/**
	 * Whether the customer may reply to this thread.
	 *
	 * Announcements — an approval notice, an order confirmation — are one-way.
	 * Inviting a reply the support team is not expecting produces a message
	 * nobody is waiting for, which is worse than no reply box at all.
	 *
	 * Tickets the customer opened themselves are always answerable; the
	 * setting only governs threads the site started. A thread with no stored
	 * value predates the setting and stays answerable, so an upgrade never
	 * silently locks an existing conversation.
	 *
	 * @since 1.9.0
	 *
	 * @param int $ticket_id Ticket.
	 *
	 * @return bool True when a reply is allowed.
	 */
	public function replies_allowed( int $ticket_id ): bool {
		$stored = get_post_meta( $ticket_id, self::META_ALLOW_REPLY, true );

		if ( '' === $stored ) {
			return true;
		}

		return '1' === (string) $stored;
	}

	/**
	 * Whether this thread was started by the site rather than the customer.
	 *
	 * @since 1.9.0
	 *
	 * @param int $ticket_id Ticket.
	 *
	 * @return bool True when automated.
	 */
	public function is_automated( int $ticket_id ): bool {
		return '1' === (string) get_post_meta( $ticket_id, self::META_AUTOMATED, true );
	}

	public function canonical_status_public( string $status ): string { return $this->canonical_status( $status ); }

	public function set_status_from_remote( int $ticket_id, string $status ): string|\WP_Error {
		$ticket = get_post( $ticket_id );
		if ( ! $ticket || self::POST_TYPE !== $ticket->post_type ) { return new \WP_Error( 'invalid_ticket', __( 'تیکت پیدا نشد.', 'wp-event-publisher' ) ); }
		$allowed = array( 'waiting', 'reviewing', 'answered', 'closed' );
		if ( ! in_array( $status, $allowed, true ) ) { return new \WP_Error( 'invalid_status', __( 'وضعیت تیکت معتبر نیست.', 'wp-event-publisher' ) ); }
		update_post_meta( $ticket_id, '_jarchi_ticket_status', $status );
		update_post_meta( $ticket_id, '_jarchi_ticket_admin_unread', '1' );
		$this->send_backend_ticket_event( 'ticket.status_changed', $ticket_id, array( 'status' => $status, 'source' => 'bot' ) );
		return $status;
	}

	public function ticket_bot_settings(): array {
		$defaults = array( 'enabled' => true, 'platforms' => array( 'telegram', 'bale' ) );
		$value = get_option( '_jarchi_ticket_bot_settings', array() );
		$value = wp_parse_args( is_array( $value ) ? $value : array(), $defaults );
		$value['platforms'] = array_values( array_intersect( array( 'telegram', 'bale' ), array_map( 'sanitize_key', (array) $value['platforms'] ) ) );
		return $value;
	}

	public function render_bot_settings(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) { wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) ); }
		$settings = $this->ticket_bot_settings();
		include WPEP_PLUGIN_DIR . 'admin/views/ticket-bot.php';
	}

	public function handle_bot_settings(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) { wp_die( esc_html__( 'اجازه انجام این کار را ندارید.', 'wp-event-publisher' ) ); }
		check_admin_referer( self::NONCE );
		$platforms = array_map( 'sanitize_key', (array) ( $_POST['platforms'] ?? array() ) );
		$platforms = array_values( array_intersect( array( 'telegram', 'bale' ), $platforms ) );
		update_option( '_jarchi_ticket_bot_settings', array( 'enabled' => ! empty( $_POST['enabled'] ), 'platforms' => $platforms ), false );
		wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE_BOT, 'updated' => '1' ), admin_url( 'admin.php' ) ) );
		exit;
	}

	public function bot_source_allowed( string $source ): bool {
		$source = sanitize_key( $source );
		$settings = $this->ticket_bot_settings();
		return ! empty( $settings['enabled'] ) && in_array( $source, $settings['platforms'], true );
	}

	/**
	 * Moves legacy private tickets to the published status, in batches.
	 *
	 * This runs once after an upgrade, but "once" on a large site still meant
	 * loading every legacy ticket into memory and rewriting them all inside a
	 * single page load — the request most likely to time out is the first one
	 * after an update, which is also the one an administrator is watching.
	 * Two hundred at a time, rescheduled until the backlog is empty.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	private function normalize_legacy_ticket_statuses(): void {
		$ids = get_posts(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => 'private',
				'numberposts'    => 200,
				'fields'         => 'ids',
				'no_found_rows'  => true,
			)
		);

		foreach ( $ids as $id ) {
			wp_update_post( array( 'ID' => (int) $id, 'post_status' => 'publish' ) );
		}

		// A full batch means there may be more behind it.
		if ( count( $ids ) >= 200 && ! wp_next_scheduled( 'jarchi_ticket_normalize_legacy' ) ) {
			wp_schedule_single_event( time() + MINUTE_IN_SECONDS, 'jarchi_ticket_normalize_legacy' );
		}
	}

	/**
	 * Continues the legacy status migration on cron.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public function run_legacy_normalization(): void {
		$this->normalize_legacy_ticket_statuses();
	}

	public function render_agents(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) { wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) ); }

		$notice = '';

		if ( isset( $_POST['jarchi_add_agent'] ) ) {
			check_admin_referer( self::NONCE );
			$user = get_user_by( 'id', absint( $_POST['user_id'] ?? 0 ) );

			if ( $user ) {
				$user->add_role( 'jarchi_support_agent' );
				$this->set_agent_departments( (int) $user->ID, array_map( 'absint', (array) ( $_POST['departments'] ?? array() ) ) );
				/* translators: %s: agent name. */
				$notice = sprintf( __( '«%s» به پشتیبان‌ها اضافه شد.', 'wp-event-publisher' ), $user->display_name );
			}
		}

		if ( isset( $_POST['jarchi_remove_agent'] ) ) {
			check_admin_referer( self::NONCE );
			$user = get_user_by( 'id', absint( $_POST['user_id'] ?? 0 ) );

			if ( $user ) {
				$user->remove_role( 'jarchi_support_agent' );
				delete_user_meta( (int) $user->ID, self::META_AGENT_DEPARTMENTS );
				/* translators: %s: agent name. */
				$notice = sprintf( __( '«%s» از پشتیبان‌ها حذف شد.', 'wp-event-publisher' ), $user->display_name );
			}
		}

		if ( isset( $_POST['jarchi_agent_departments'] ) ) {
			check_admin_referer( self::NONCE );
			$user = get_user_by( 'id', absint( $_POST['user_id'] ?? 0 ) );

			if ( $user ) {
				$this->set_agent_departments( (int) $user->ID, array_map( 'absint', (array) ( $_POST['departments'] ?? array() ) ) );
				/* translators: %s: agent name. */
				$notice = sprintf( __( 'دپارتمان‌های «%s» ذخیره شد.', 'wp-event-publisher' ), $user->display_name );
			}
		}

		$agents      = $this->support_agents();
		$users       = get_users( array( 'number' => 100, 'orderby' => 'display_name', 'order' => 'ASC' ) );
		$departments = get_terms( array( 'taxonomy' => self::TAXONOMY, 'hide_empty' => false ) );
		$this->enqueue_admin_ticket_assets();
		include WPEP_PLUGIN_DIR . 'admin/views/ticket-agents.php';
	}

	public function render_canned_replies(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) { wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) ); }
		$items = $this->canned_replies();
		if ( isset( $_POST['jarchi_canned_save'] ) ) {
			check_admin_referer( self::NONCE );
			$title = sanitize_text_field( wp_unslash( $_POST['title'] ?? '' ) );
			$body = wp_kses_post( wp_unslash( $_POST['body'] ?? '' ) );
			if ( '' !== trim( $title ) && '' !== trim( wp_strip_all_tags( $body ) ) ) {
				$items[] = array( 'title' => $title, 'body' => $body );
				update_option( '_jarchi_ticket_canned_replies', array_values( $items ), false );
				if ( ! empty( $_POST['add_to_faq'] ) ) {
					$faq = $this->advanced_settings();
					$faq[] = array( 'title' => $title, 'body' => $body );
					$settings = $this->advanced_settings();
					$settings['faq'] = array_values( $faq );
					update_option( '_jarchi_ticket_advanced_settings', $settings, false );
				}
			}
		}
		if ( isset( $_POST['jarchi_canned_delete'] ) ) { check_admin_referer( self::NONCE ); $idx = absint( $_POST['index'] ?? -1 ); if ( isset( $items[ $idx ] ) ) { unset( $items[ $idx ] ); update_option( '_jarchi_ticket_canned_replies', array_values( $items ), false ); } }
		if ( isset( $_POST['jarchi_canned_add_faq'] ) ) {
			check_admin_referer( self::NONCE );
			$idx = absint( $_POST['index'] ?? -1 );
			if ( isset( $items[ $idx ] ) ) {
				$settings = $this->advanced_settings();
				$settings['faq'][] = array( 'title' => (string) ( $items[ $idx ]['title'] ?? '' ), 'body' => (string) ( $items[ $idx ]['body'] ?? '' ) );
				update_option( '_jarchi_ticket_advanced_settings', $settings, false );
			}
		}
		$items = $this->canned_replies();
		include WPEP_PLUGIN_DIR . 'admin/views/ticket-canned.php';
	}

	public function render_faq(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) { wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) ); }
		$settings = $this->advanced_settings();
		if ( isset( $_POST['jarchi_faq_save'] ) ) {
			check_admin_referer( 'jarchi_faq_save' );
			$settings['faq'] = array();
			$titles = (array) ( $_POST['faq_title'] ?? array() );
			$bodies = (array) ( $_POST['faq_body'] ?? array() );
			foreach ( $titles as $i => $title ) {
				$title = sanitize_text_field( wp_unslash( $title ) );
				$body = wp_kses_post( wp_unslash( $bodies[ $i ] ?? '' ) );
				if ( '' !== trim( $title ) && '' !== trim( wp_strip_all_tags( $body ) ) ) $settings['faq'][] = array( 'title' => $title, 'body' => $body );
			}
			update_option( '_jarchi_ticket_advanced_settings', $settings, false );
		}
		$this->enqueue_admin_ticket_assets();
		include WPEP_PLUGIN_DIR . 'admin/views/ticket-faq.php';
	}

	public function ajax_user_search(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_send_json_error( array( 'message' => __( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) ), 403 );
		}
		check_ajax_referer( self::AJAX_NONCE, 'nonce' );

		$term = isset( $_POST['q'] ) ? sanitize_text_field( wp_unslash( (string) $_POST['q'] ) ) : '';
		$term = trim( $term );
		if ( mb_strlen( $term ) < 2 ) {
			wp_send_json_success( array( 'users' => array() ) );
		}

		$limit = 20;
		$users = get_users( array(
			'search'         => '*' . $term . '*',
			'search_columns' => array( 'user_login', 'user_email', 'display_name' ),
			'number'         => $limit,
			'orderby'        => 'display_name',
			'order'          => 'ASC',
		) );

		// Also search common Iranian/mobile meta keys so phone-only searches work.
		$phone_keys = array( 'phone', 'mobile', 'billing_phone', '_billing_phone', 'user_phone', 'user_mobile' );
		$meta_clauses = array( 'relation' => 'OR' );
		foreach ( $phone_keys as $phone_key ) {
			$meta_clauses[] = array( 'key' => $phone_key, 'value' => $term, 'compare' => 'LIKE' );
		}
		$phone_users = get_users( array(
			'meta_query' => $meta_clauses,
			'number'    => $limit,
			'orderby'   => 'display_name',
			'order'     => 'ASC',
		) );

		$merged = array();
		foreach ( array_merge( $users, $phone_users ) as $user ) {
			if ( isset( $merged[ $user->ID ] ) ) { continue; }
			$phones = array();
			foreach ( $phone_keys as $phone_key ) {
				$value = get_user_meta( $user->ID, $phone_key, true );
				if ( '' !== trim( (string) $value ) ) { $phones[] = preg_replace( '/\s+/', ' ', (string) $value ); }
			}
			$merged[ $user->ID ] = array(
				'id'    => (int) $user->ID,
				'name'  => (string) $user->display_name,
				'email' => (string) $user->user_email,
				'phone' => isset( $phones[0] ) ? $phones[0] : '',
			);
			if ( count( $merged ) >= $limit ) { break; }
		}

		wp_send_json_success( array( 'users' => array_values( $merged ) ) );
	}

	public function render_admin_new_ticket(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) { wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) ); }
		$users = array();
		$departments = get_terms( array( 'taxonomy' => self::TAXONOMY, 'hide_empty' => false ) );
		$categories = get_terms( array( 'taxonomy' => self::CATEGORY, 'hide_empty' => false ) );
		$this->enqueue_admin_ticket_assets();
		include WPEP_PLUGIN_DIR . 'admin/views/ticket-new.php';
	}

	/**
	 * The one set of upload rules both attachment paths obey.
	 *
	 * There used to be two: the customer form read its limits from the
	 * advanced settings, the administrator's composer read none at all, and
	 * the note printed under the file input quoted a third pair of numbers
	 * that matched neither. Whichever of those a site owner tuned, at least
	 * one of the other two ignored it.
	 *
	 * @since 1.19.2
	 *
	 * @return array{max_files:int,max_bytes:int,mime:string[],extensions:string[]} Upload policy.
	 */
	public function attachment_policy(): array {
		$advanced = $this->advanced_settings();

		$mime = array( 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf' );

		if ( ! empty( $advanced['allow_voice'] ) ) {
			$mime = array_merge( $mime, array( 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm' ) );
		}

		// The configured number is a ceiling the site owner may lower, never a
		// way to raise the hard cap the code is written around.
		$max_files = min( self::MAX_ATTACHMENTS, max( 1, (int) $advanced['max_files'] ) );
		$max_mb    = min( 64, max( 1, (int) $advanced['max_file_mb'] ) );

		return array(
			'max_files'  => $max_files,
			'max_bytes'  => $max_mb * MB_IN_BYTES,
			'mime'       => array_values( array_unique( $mime ) ),
			'extensions' => array( 'jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'mp3', 'wav', 'ogg', 'oga', 'weba', 'webm' ),
		);
	}

	/**
	 * Checks one uploaded file against the policy, by its contents.
	 *
	 * The browser sends a Content-Type with every part of a multipart form and
	 * nothing verifies it, so `$_FILES[...]['type']` is a claim made by the
	 * uploader about their own file. Believing it is how a PHP file arrives
	 * announcing itself as image/png. What is trusted here instead is
	 * wp_check_filetype_and_ext(), which opens the temporary file and reads
	 * the real signature, and the extension allowlist — a file has to satisfy
	 * both, and the sniffed type is what gets handed on to WordPress.
	 *
	 * @since 1.19.2
	 *
	 * @param array<string,mixed> $file   One normalised $_FILES entry.
	 * @param array<string,mixed> $policy Result of attachment_policy().
	 *
	 * @return array{name:string,type:string}|\WP_Error Sanitised name and real type, or why not.
	 */
	private function validate_upload( array $file, array $policy ): array|\WP_Error {
		$error = (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE );

		if ( UPLOAD_ERR_OK !== $error ) {
			if ( UPLOAD_ERR_INI_SIZE === $error || UPLOAD_ERR_FORM_SIZE === $error ) {
				return new \WP_Error( 'upload_too_large', __( 'حجم فایل بیش از حد مجاز سرور است.', 'wp-event-publisher' ) );
			}

			return new \WP_Error( 'upload_failed', __( 'بارگذاری فایل کامل نشد.', 'wp-event-publisher' ) );
		}

		$tmp = (string) ( $file['tmp_name'] ?? '' );

		/*
		 * is_uploaded_file() is what separates a real upload from an arbitrary
		 * path the request managed to get into the array. Without it, a
		 * crafted request names a file already on disk and has the plugin copy
		 * it into the public media library.
		 */
		if ( '' === $tmp || ! is_uploaded_file( $tmp ) ) {
			return new \WP_Error( 'upload_invalid', __( 'فایل ارسال‌شده معتبر نیست.', 'wp-event-publisher' ) );
		}

		$size = (int) ( $file['size'] ?? 0 );

		if ( $size <= 0 ) {
			return new \WP_Error( 'upload_empty', __( 'فایل خالی است.', 'wp-event-publisher' ) );
		}

		if ( $size > (int) $policy['max_bytes'] ) {
			return new \WP_Error(
				'upload_too_large',
				sprintf(
					/* translators: %d: maximum file size in megabytes. */
					__( 'حجم هر فایل حداکثر %d مگابایت است.', 'wp-event-publisher' ),
					(int) round( $policy['max_bytes'] / MB_IN_BYTES )
				)
			);
		}

		$name = sanitize_file_name( (string) ( $file['name'] ?? '' ) );

		if ( '' === $name ) {
			return new \WP_Error( 'upload_invalid', __( 'نام فایل معتبر نیست.', 'wp-event-publisher' ) );
		}

		$checked = wp_check_filetype_and_ext( $tmp, $name );

		// When the contents disagree with the extension WordPress hands back a
		// corrected filename; using it means the file is stored as what it
		// actually is rather than as what it was labelled.
		if ( ! empty( $checked['proper_filename'] ) ) {
			$name    = sanitize_file_name( (string) $checked['proper_filename'] );
			$checked = wp_check_filetype_and_ext( $tmp, $name );
		}

		$type = (string) ( $checked['type'] ?? '' );
		$ext  = strtolower( (string) ( $checked['ext'] ?? '' ) );

		if ( '' === $type || '' === $ext ) {
			return new \WP_Error( 'upload_type', __( 'نوع این فایل پذیرفته نمی‌شود.', 'wp-event-publisher' ) );
		}

		// Both lists have to agree. The mime list is the policy; the extension
		// list is what stops a permitted type being stored under a name the
		// web server would hand to an interpreter.
		if ( ! in_array( $type, (array) $policy['mime'], true ) || ! in_array( $ext, (array) $policy['extensions'], true ) ) {
			return new \WP_Error( 'upload_type', __( 'نوع این فایل پذیرفته نمی‌شود.', 'wp-event-publisher' ) );
		}

		return array( 'name' => $name, 'type' => $type );
	}

	/**
	 * Moves uploaded files into the media library and returns their ids.
	 *
	 * WordPress's own upload handling is used rather than touching $_FILES
	 * directly, so the site's mime allowlist, upload directory rules and
	 * filename sanitising all still apply. Nothing here widens what a site
	 * accepts — validate_upload() narrows it first.
	 *
	 * @since 1.9.0
	 *
	 * @return array{ids:int[],errors:string[]} Attachment ids and failures.
	 */
	private function handle_uploads(): array {
		$ids    = array();
		$errors = array();

		if ( empty( $_FILES['attachments'] ) || ! is_array( $_FILES['attachments']['name'] ?? null ) ) {
			return array( 'ids' => $ids, 'errors' => $errors );
		}

		if ( ! current_user_can( 'upload_files' ) ) {
			return array( 'ids' => $ids, 'errors' => array( __( 'اجازه بارگذاری فایل ندارید.', 'wp-event-publisher' ) ) );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$policy = $this->attachment_policy();
		$files  = $_FILES['attachments'];
		$count  = count( (array) $files['name'] );

		for ( $i = 0; $i < $count; $i++ ) {
			if ( empty( $files['name'][ $i ] ) ) {
				continue;
			}

			if ( count( $ids ) >= (int) $policy['max_files'] ) {
				/* translators: %d: maximum number of attachments. */
				$errors[] = sprintf( __( 'حداکثر %d فایل پذیرفته می‌شود؛ بقیه نادیده گرفته شد.', 'wp-event-publisher' ), (int) $policy['max_files'] );
				break;
			}

			$entry = array(
				'name'     => $files['name'][ $i ],
				'type'     => $files['type'][ $i ],
				'tmp_name' => $files['tmp_name'][ $i ],
				'error'    => $files['error'][ $i ],
				'size'     => $files['size'][ $i ],
			);

			$checked = $this->validate_upload( $entry, $policy );

			if ( is_wp_error( $checked ) ) {
				$errors[] = $checked->get_error_message();
				continue;
			}

			// media_handle_upload() reads one entry, so the multi-file upload
			// is reshaped into the single-file form it expects — carrying the
			// sniffed type, not the one the browser supplied.
			$_FILES['jarchi_attachment'] = array(
				'name'     => $checked['name'],
				'type'     => $checked['type'],
				'tmp_name' => $entry['tmp_name'],
				'error'    => $entry['error'],
				'size'     => $entry['size'],
			);

			$attachment_id = media_handle_upload( 'jarchi_attachment', 0, array(), array( 'test_form' => false ) );

			if ( is_wp_error( $attachment_id ) ) {
				$errors[] = $attachment_id->get_error_message();
				continue;
			}

			$ids[] = (int) $attachment_id;
		}

		unset( $_FILES['jarchi_attachment'] );

		return array( 'ids' => $ids, 'errors' => $errors );
	}

	/**
	 * Queues one ticket per user and sends the first batch.
	 *
	 * A site with ten thousand users cannot be served inside the request that
	 * pressed the button: PHP's time limit would end it somewhere in the
	 * middle, leaving an arbitrary fraction messaged and no record of where it
	 * stopped. So the recipient list is stored, a first batch goes out now for
	 * immediate feedback, and cron drains the rest.
	 *
	 * @since 1.9.0
	 *
	 * @param array<string,mixed> $payload Ticket payload.
	 *
	 * @return int Recipients queued.
	 */
	private function start_broadcast( array $payload ): int {
		/*
		 * A cursor, not a list.
		 *
		 * This used to fetch every user id on the site and store the whole
		 * array in one option row, then splice twenty-five off the front and
		 * rewrite the row each batch. On ten thousand users that is a hundred
		 * thousand ids written and read four hundred times over — quadratic
		 * work to send a linear number of messages, and a single request that
		 * had to hold the entire user table in memory before the first ticket
		 * was created.
		 */
		$payload['broadcast'] = true;

		$total = $this->total_users();

		update_option(
			self::OPTION_BROADCAST,
			array(
				'payload'    => $payload,
				'cursor'     => 0,
				'total'      => $total,
				'sent'       => 0,
				'started_at' => current_time( 'mysql' ),
			),
			false
		);

		$this->run_broadcast_batch();

		return $total;
	}

	/**
	 * How many users the site has.
	 *
	 * One indexed count, so that a broadcast can show progress without
	 * enumerating the people it is counting.
	 *
	 * @since 1.19.2
	 *
	 * @return int User count.
	 */
	private function total_users(): int {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->users}" );
	}

	/**
	 * Sends the next batch of a running broadcast.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public function run_broadcast_batch(): void {
		$state = get_option( self::OPTION_BROADCAST, array() );

		if ( ! is_array( $state ) || ! isset( $state['cursor'] ) ) {
			delete_option( self::OPTION_BROADCAST );

			return;
		}

		$payload = (array) ( $state['payload'] ?? array() );
		$cursor  = max( 0, (int) $state['cursor'] );

		$batch = array_map(
			'absint',
			(array) get_users(
				array(
					'number'  => self::BROADCAST_BATCH,
					'offset'  => $cursor,
					'fields'  => 'ID',
					'orderby' => 'ID',
					'order'   => 'ASC',
				)
			)
		);

		if ( empty( $batch ) ) {
			delete_option( self::OPTION_BROADCAST );

			return;
		}

		/**
		 * Filters who receives a broadcast ticket.
		 *
		 * Runs once per batch rather than once over the whole site, so a
		 * filter that removes people still works and nothing has to hold every
		 * user id at once. A filter may narrow the batch; ids it adds that are
		 * not in the batch are still messaged, but the cursor moves by the
		 * batch it was given, so adding ids does not extend the run.
		 *
		 * @since 1.9.0
		 *
		 * @param int[]               $recipients User ids in this batch.
		 * @param array<string,mixed> $payload    Ticket payload.
		 */
		$recipients = (array) apply_filters( 'wpep_broadcast_recipients', $batch, $payload );

		foreach ( $recipients as $customer_id ) {
			$created = $this->create_admin_ticket( (int) $customer_id, $payload );

			if ( ! is_wp_error( $created ) ) {
				++$state['sent'];
			}
		}

		// Advanced by what was fetched, not by what was sent: a filter that
		// skipped somebody must not make the cursor stall on them for ever.
		$state['cursor'] = $cursor + count( $batch );

		update_option( self::OPTION_BROADCAST, $state, false );

		if ( ! wp_next_scheduled( 'jarchi_ticket_broadcast' ) ) {
			wp_schedule_single_event( time() + MINUTE_IN_SECONDS, 'jarchi_ticket_broadcast' );
		}
	}

	/**
	 * Progress of a running broadcast.
	 *
	 * @since 1.9.0
	 *
	 * @return array{running:bool,sent:int,total:int} Progress.
	 */
	public function broadcast_progress(): array {
		$state = get_option( self::OPTION_BROADCAST, array() );

		if ( ! is_array( $state ) || empty( $state['total'] ) ) {
			return array( 'running' => false, 'sent' => 0, 'total' => 0 );
		}

		return array(
			'running' => (int) ( $state['cursor'] ?? 0 ) < (int) $state['total'],
			'sent'    => (int) ( $state['sent'] ?? 0 ),
			'total'   => (int) $state['total'],
		);
	}

	/**
	 * The attachments stored on one ticket.
	 *
	 * @since 1.9.0
	 *
	 * @param int $ticket_id Ticket.
	 *
	 * @return array<int,array{id:int,url:string,name:string,is_image:bool}> Attachments.
	 */
	public function ticket_attachments( int $ticket_id ): array {
		$ids = (array) get_post_meta( $ticket_id, self::META_ATTACHMENTS, true );
		$out = array();

		foreach ( array_map( 'absint', $ids ) as $id ) {
			$url = $id ? wp_get_attachment_url( $id ) : '';

			if ( ! $url ) {
				continue;
			}

			$out[] = array(
				'id'       => $id,
				'url'      => (string) $url,
				'name'     => (string) get_the_title( $id ),
				'is_image' => (bool) wp_attachment_is_image( $id ),
			);
		}

		return $out;
	}

	/**
	 * Creates one admin-authored ticket for one customer.
	 *
	 * Split out of handle_admin_create() so that sending to one person and
	 * sending to everybody are the same operation run once or run repeatedly.
	 * Two implementations would let the broadcast drift away from the single
	 * send — different metadata, a forgotten notification.
	 *
	 * @since 1.9.0
	 *
	 * @param int                 $customer_id Recipient.
	 * @param array<string,mixed> $payload     Title, body, priority, terms, attachments.
	 *
	 * @return int|\WP_Error Ticket id.
	 */
	public function create_admin_ticket( int $customer_id, array $payload ): int|\WP_Error {
		$user = get_user_by( 'id', $customer_id );

		if ( ! $user ) {
			return new \WP_Error( 'customer_not_found', __( 'کاربر پیدا نشد.', 'wp-event-publisher' ) );
		}

		$title = sanitize_text_field( (string) ( $payload['title'] ?? '' ) );
		$body  = wp_kses_post( (string) ( $payload['body'] ?? '' ) );

		if ( '' === trim( $title ) || '' === trim( wp_strip_all_tags( $body ) ) ) {
			return new \WP_Error( 'invalid_ticket', __( 'عنوان و متن تیکت الزامی است.', 'wp-event-publisher' ) );
		}

		$priority = sanitize_key( (string) ( $payload['priority'] ?? 'normal' ) );
		$priority = in_array( $priority, array( 'low', 'normal', 'high', 'urgent' ), true ) ? $priority : 'normal';

		$allow_reply = ! empty( $payload['allow_reply'] );

		$ticket_id = wp_insert_post(
			array(
				'post_type'   => self::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => $title,
				'post_author' => $customer_id,
			),
			true
		);

		if ( is_wp_error( $ticket_id ) ) {
			return $ticket_id;
		}

		update_post_meta( $ticket_id, '_jarchi_ticket_priority', $priority );

		/*
		 * A message the site sent is not an answer to anything.
		 *
		 * This used to be stored as `answered`, which put a brand-new message
		 * into the "already dealt with" bucket the moment it was sent and made
		 * the customer's list read as though a conversation had happened. When
		 * the customer may reply it is genuinely open and waiting on them;
		 * when they may not, it is finished, so it is closed.
		 */
		/*
		 * A message the site sent is a NEW ticket, not an answered one.
		 *
		 * Storing `answered` put a brand-new message straight into the
		 * "already dealt with" bucket, so the customer's list read as though a
		 * conversation had happened and the support queue never showed it.
		 * When the customer may reply it is genuinely open and waiting; when
		 * they may not there is nothing to wait for, so it is closed.
		 */
		update_post_meta( $ticket_id, '_jarchi_ticket_status', $allow_reply ? 'waiting' : 'closed' );
		update_post_meta( $ticket_id, self::META_ALLOW_REPLY, $allow_reply ? '1' : '0' );
		$this->mark_unread_for_user( $ticket_id );

		if ( ! empty( $payload['broadcast'] ) ) {
			update_post_meta( $ticket_id, '_jarchi_ticket_broadcast', '1' );
		}

		foreach ( array( 'department' => self::TAXONOMY, 'category' => self::CATEGORY ) as $key => $taxonomy ) {
			$term_id = absint( $payload[ $key ] ?? 0 );

			if ( $term_id && term_exists( $term_id, $taxonomy ) ) {
				wp_set_post_terms( $ticket_id, array( $term_id ), $taxonomy );
			}
		}

		$attachments = array_map( 'absint', (array) ( $payload['attachments'] ?? array() ) );

		if ( $attachments ) {
			update_post_meta( $ticket_id, self::META_ATTACHMENTS, $attachments );
		}

		$author = wp_get_current_user();

		$comment_id = wp_insert_comment(
			array(
				'comment_post_ID'      => $ticket_id,
				'comment_author'       => $author->display_name,
				'comment_author_email' => $author->user_email,
				'comment_content'      => $body,
				'comment_type'         => self::COMMENT_TYPE,
				'user_id'              => get_current_user_id(),
				'comment_approved'     => 1,
			)
		);

		if ( ! $comment_id ) {
			wp_delete_post( $ticket_id, true );

			return new \WP_Error( 'message_failed', __( 'پیام تیکت ایجاد نشد.', 'wp-event-publisher' ) );
		}

		add_comment_meta( $comment_id, '_jarchi_ticket_sender', 'admin', true );

		if ( $attachments ) {
			add_comment_meta( $comment_id, self::META_ATTACHMENTS, $attachments, true );
		}

		// No first-response timestamp: nobody was kept waiting, so recording a
		// response time here would flatter the SLA report with unearned work.
		update_post_meta( $ticket_id, '_jarchi_ticket_last_reply', current_time( 'mysql' ) );

		$this->notify_user( (int) $ticket_id, $body );
		$this->safe_notify_created( (int) $ticket_id );

		return (int) $ticket_id;
	}

	public function handle_admin_create(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) { wp_die( esc_html__( 'اجازه انجام این کار را ندارید.', 'wp-event-publisher' ) ); }
		check_admin_referer( self::NONCE );

		$uploads = $this->handle_uploads();

		$payload = array(
			'title'       => sanitize_text_field( wp_unslash( $_POST['title'] ?? '' ) ),
			'body'        => wp_kses_post( wp_unslash( $_POST['message'] ?? '' ) ),
			'priority'    => sanitize_key( wp_unslash( $_POST['priority'] ?? 'normal' ) ),
			'department'  => absint( $_POST['department'] ?? 0 ),
			'category'    => absint( $_POST['category'] ?? 0 ),
			'allow_reply' => ! empty( $_POST['allow_reply'] ),
			'attachments' => $uploads['ids'],
		);

		if ( '' === trim( $payload['title'] ) || '' === trim( wp_strip_all_tags( $payload['body'] ) ) ) {
			wp_die( esc_html__( 'عنوان و متن تیکت الزامی است.', 'wp-event-publisher' ) );
		}

		if ( 'all' === sanitize_key( wp_unslash( $_POST['audience'] ?? 'single' ) ) ) {
			$this->start_broadcast( $payload );

			wp_safe_redirect( Admin::app_url( 'support', array( 'broadcast' => 'queued' ) ) );
			exit;
		}

		$ticket_id = $this->create_admin_ticket( absint( $_POST['customer_id'] ?? 0 ), $payload );

		if ( is_wp_error( $ticket_id ) ) {
			wp_die( esc_html( $ticket_id->get_error_message() ) );
		}

		wp_safe_redirect( Admin::app_url( 'support', array( 'ticket' => (int) $ticket_id ) ) );
		exit;
	}

	public function assign_agent( int $ticket_id, int $user_id ): void {
		if ( $user_id ) { $user = get_user_by( 'id', $user_id ); if ( ! $user || ! in_array( 'jarchi_support_agent', (array) $user->roles, true ) ) return; update_post_meta( $ticket_id, '_jarchi_ticket_agent', $user_id ); update_post_meta( $ticket_id, '_jarchi_ticket_status', 'reviewing' ); update_post_meta( $ticket_id, '_jarchi_ticket_admin_unread', '1' ); } else { delete_post_meta( $ticket_id, '_jarchi_ticket_agent' ); }
	}

	/**
	 * One agent's average rating.
	 *
	 * Aggregated in SQL, and cached for the length of one screen.
	 *
	 * The agents screen calls this once per agent, and the previous version
	 * fetched every ticket that agent had ever handled and then read each
	 * ticket's rating separately — so ten agents with a thousand tickets each
	 * meant ten thousand queries to draw ten small numbers.
	 *
	 * @since 1.9.0
	 *
	 * @param int $agent_id Agent.
	 *
	 * @return array{count:int,average:float} Rating summary.
	 */
	public function agent_rating_summary( int $agent_id ): array {
		global $wpdb;

		if ( $agent_id <= 0 ) {
			return array( 'count' => 0, 'average' => 0 );
		}

		$cache_key = 'wpep_agent_rating_' . $agent_id;
		$cached    = get_transient( $cache_key );

		if ( is_array( $cached ) ) {
			return $cached;
		}

		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT COUNT(*) AS rated, SUM( r.meta_value + 0 ) AS total
				 FROM {$wpdb->postmeta} a
				 INNER JOIN {$wpdb->postmeta} r ON r.post_id = a.post_id AND r.meta_key = %s
				 WHERE a.meta_key = %s
				   AND a.meta_value = %d
				   AND r.meta_value + 0 > 0",
				'_jarchi_ticket_rating',
				'_jarchi_ticket_agent',
				$agent_id
			)
		);

		$count = (int) ( $row->rated ?? 0 );
		$sum   = (float) ( $row->total ?? 0 );

		$summary = array(
			'count'   => $count,
			'average' => $count ? round( $sum / $count, 1 ) : 0,
		);

		set_transient( $cache_key, $summary, 5 * MINUTE_IN_SECONDS );

		return $summary;
	}

	public function handle_assign_agent(): void {
		// Reassignment is an administrator's decision: an agent moving a
		// ticket to somebody else's department would be moving it out of their
		// own sight, and out of the reach of the check that put it there.
		if ( ! current_user_can( Admin::CAPABILITY ) ) { wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) ); }
		check_admin_referer( self::NONCE );
		$ticket_id = absint( $_POST['ticket_id'] ?? 0 );
		if ( ! $this->can_manage_ticket( $ticket_id ) ) { wp_die( esc_html__( 'تیکت پیدا نشد.', 'wp-event-publisher' ) ); }
		$agent = absint( $_POST['agent'] ?? 0 ); $this->assign_agent( $ticket_id, $agent );
		wp_safe_redirect( wp_get_referer() ?: Admin::app_url( 'support' ) ); exit;
	}

	public function save_rating(): void {
		if ( ! is_user_logged_in() ) { wp_die( esc_html__( 'ابتدا وارد شوید.', 'wp-event-publisher' ) ); }
		check_admin_referer( self::NONCE ); $ticket_id = absint( $_POST['ticket_id'] ?? 0 ); $rating = absint( $_POST['rating'] ?? 0 ); $ticket = get_post( $ticket_id );
		if ( ! $ticket || self::POST_TYPE !== $ticket->post_type || (int) $ticket->post_author !== get_current_user_id() || $rating < 1 || $rating > 5 ) { wp_die( esc_html__( 'اطلاعات امتیاز نامعتبر است.', 'wp-event-publisher' ) ); }
		update_post_meta( $ticket_id, '_jarchi_ticket_rating', $rating ); update_post_meta( $ticket_id, '_jarchi_ticket_rating_comment', sanitize_textarea_field( wp_unslash( $_POST['rating_comment'] ?? '' ) ) );
		wp_safe_redirect( wp_get_referer() ?: $this->ticket_page_url() ); exit;
	}

	private function reply_from_customer_remote( int $ticket_id, string $body, int $customer_id ): \WP_Error|int {
		$ticket = get_post( $ticket_id );
		if ( ! $ticket || self::POST_TYPE !== $ticket->post_type || (int) $ticket->post_author !== $customer_id ) return new \WP_Error( 'invalid_ticket', __( 'تیکت پیدا نشد.', 'wp-event-publisher' ) );
		if ( '' === trim( wp_strip_all_tags( $body ) ) ) return new \WP_Error( 'empty_message', __( 'متن پاسخ خالی است.', 'wp-event-publisher' ) );
		$user = get_user_by( 'id', $customer_id );
		$comment_id = $this->insert_remote_message( $ticket_id, $body, 'user', $user ? $user->display_name : 'کاربر' );
		if ( ! $comment_id ) return new \WP_Error( 'reply_failed', __( 'ثبت پاسخ انجام نشد.', 'wp-event-publisher' ) );
		update_post_meta( $ticket_id, '_jarchi_ticket_status', 'waiting' );
		update_post_meta( $ticket_id, '_jarchi_ticket_admin_unread', '1' );
		$this->send_backend_ticket_event( 'ticket.user_replied', $ticket_id, array( 'message' => wp_strip_all_tags( $body ), 'source' => 'customer_api' ) );
		return (int) $comment_id;
	}

	public function reply_from_remote( int $ticket_id, string $body, string $source = 'bot', string $agent_name = '' ): \WP_Error|int {
		$ticket = get_post( $ticket_id ); if ( ! $ticket || self::POST_TYPE !== $ticket->post_type ) { return new \WP_Error( 'invalid_ticket', __( 'تیکت پیدا نشد.', 'wp-event-publisher' ) ); }
		if ( '' === trim( wp_strip_all_tags( $body ) ) ) { return new \WP_Error( 'empty_message', __( 'متن پاسخ خالی است.', 'wp-event-publisher' ) ); }
		$comment_id = wp_insert_comment( array( 'comment_post_ID' => $ticket_id, 'comment_author' => $agent_name ?: ( 'telegram' === $source ? 'پشتیبان تلگرام جارچی' : ( 'bale' === $source ? 'پشتیبان بله جارچی' : 'پشتیبان جارچی' ) ), 'comment_author_email' => '', 'comment_content' => wp_kses_post( $body ), 'comment_type' => self::COMMENT_TYPE, 'user_id' => 0, 'comment_approved' => 1 ) );
		if ( ! $comment_id ) { return new \WP_Error( 'reply_failed', __( 'ثبت پاسخ انجام نشد.', 'wp-event-publisher' ) ); }
		add_comment_meta( $comment_id, '_jarchi_ticket_sender', 'admin', true ); add_comment_meta( $comment_id, '_jarchi_ticket_remote_source', sanitize_key( $source ), true );
		update_post_meta( $ticket_id, '_jarchi_ticket_status', 'answered' ); $this->mark_unread_for_user( $ticket_id );
		$this->notify_user( $ticket_id, $body );
		$this->safe_notify_reply( $ticket_id, $body );
		if ( wpep()->tickets_sms()->enabled() ) {
			$sms_result = wpep()->tickets_sms()->send_admin_reply( $ticket_id, $body );
			if ( is_wp_error( $sms_result ) && class_exists( Logger::class ) ) { wpep()->logger()->event( 'ticket-sms', Logger::STATUS_FAILED, $sms_result->get_error_message(), array( 'ticket_id' => $ticket_id, 'source' => $source ) ); }
		}
		return (int) $comment_id;
	}

	private function user_mobile_value( ?\WP_User $user ): string {
		if ( ! $user ) { return ''; } foreach ( array( 'billing_phone', 'phone', 'mobile', 'user_phone', 'mobile_number' ) as $key ) { $value = get_user_meta( $user->ID, $key, true ); if ( is_scalar( $value ) && '' !== trim( (string) $value ) ) { return preg_replace( '/[^0-9+]/', '', (string) $value ); } } return '';
	}

	private function send_backend_ticket_event( string $type, int $ticket_id, array $extra = array() ): void {
		$ticket = get_post( $ticket_id ); if ( ! $ticket ) { return; }
		/*
		 * get_user_by() answers false for an account that has been deleted,
		 * and user_mobile_value() takes ?WP_User — so a reply to a ticket
		 * whose customer had since been removed ended the request with a
		 * TypeError, after the reply had already been saved. The ticket
		 * outlives the account; this code has to as well.
		 */
		$user = get_user_by( 'id', (int) $ticket->post_author ) ?: null;
		$terms = wp_get_post_terms( $ticket_id, self::TAXONOMY );
		$categories = wp_get_post_terms( $ticket_id, self::CATEGORY );
		$payload = array( 'event_type' => $type, 'ticket' => array( 'id' => $ticket_id, 'number' => $ticket_id, 'subject' => $ticket->post_title, 'status' => $this->canonical_status( $this->status( $ticket_id ) ), 'priority' => (string) get_post_meta( $ticket_id, '_jarchi_ticket_priority', true ), 'department' => ! empty( $terms ) && ! is_wp_error( $terms ) ? (string) $terms[0]->name : '', 'category' => ! empty( $categories ) && ! is_wp_error( $categories ) ? (string) $categories[0]->name : '', 'url' => add_query_arg( 'jarchi_ticket', $ticket_id, $this->ticket_page_url() ) ), 'customer' => array( 'id' => $user ? (int) $user->ID : 0, 'name' => $user ? $user->display_name : '', 'email' => $user ? $user->user_email : '', 'phone' => $this->user_mobile_value( $user ) ) );
		if ( $extra ) { $payload['data'] = $extra; }
		if ( ! wpep()->settings()->get( 'webhooks_enabled' ) || '' === (string) wpep()->settings()->endpoint() ) {
			return;
		}
		try {
			$result = wpep()->webhook()->dispatch( $payload, $ticket_id );
			if ( empty( $result['success'] ) && class_exists( Logger::class ) ) {
				wpep()->logger()->event( 'ticket-webhook', Logger::STATUS_FAILED, (string) ( $result['message'] ?? '' ), array( 'ticket_id' => $ticket_id, 'event_type' => $type ) );
			}
		} catch ( \Throwable $e ) {
			if ( class_exists( Logger::class ) ) {
				wpep()->logger()->event( 'ticket-webhook', Logger::STATUS_FAILED, $e->getMessage(), array( 'ticket_id' => $ticket_id, 'event_type' => $type ) );
			}
		}
	}

	/** Notifications are optional enhancements and must never abort a ticket operation. */
	private function safe_notify_created( int $ticket_id ): void {
		try {
			$notifications = wpep()->ticket_notifications();
			if ( is_object( $notifications ) && method_exists( $notifications, 'notify_ticket_created' ) ) {
				$notifications->notify_ticket_created( $ticket_id );
			}
		} catch ( \Throwable $e ) {
			$this->log_side_effect_failure( 'notify-created', $ticket_id, $e );
		}
	}

	private function safe_notify_reply( int $ticket_id, string $body = '' ): void {
		try {
			$notifications = wpep()->ticket_notifications();
			if ( is_object( $notifications ) && method_exists( $notifications, 'notify_ticket_reply' ) ) {
				$notifications->notify_ticket_reply( $ticket_id, $body );
			}
		} catch ( \Throwable $e ) {
			$this->log_side_effect_failure( 'notify-reply', $ticket_id, $e );
		}
	}

	public function handle_sms_save(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه انجام این کار را ندارید.', 'wp-event-publisher' ) );
		}
		check_admin_referer( self::NONCE );

		$settings = array(
			'enabled'       => ! empty( $_POST['enabled'] ),
			'provider'      => sanitize_key( wp_unslash( $_POST['provider'] ?? 'sms_ir' ) ),
			'api_key'       => sanitize_text_field( wp_unslash( $_POST['api_key'] ?? '' ) ),
			'username'      => sanitize_text_field( wp_unslash( $_POST['username'] ?? '' ) ),
			'password'      => sanitize_text_field( wp_unslash( $_POST['password'] ?? '' ) ),
			'pattern_id'    => sanitize_text_field( wp_unslash( $_POST['pattern_id'] ?? '' ) ),
			'endpoint'      => esc_url_raw( wp_unslash( $_POST['endpoint'] ?? '' ) ),
			'sender'        => sanitize_text_field( wp_unslash( $_POST['sender'] ?? '' ) ),
			'param_title'   => sanitize_text_field( wp_unslash( $_POST['param_title'] ?? 'TICKET_TITLE' ) ),
			'param_link'    => sanitize_text_field( wp_unslash( $_POST['param_link'] ?? 'TICKET_LINK' ) ),
			'param_id'      => sanitize_text_field( wp_unslash( $_POST['param_id'] ?? 'TICKET_ID' ) ),
			'param_token_2' => sanitize_text_field( wp_unslash( $_POST['param_token_2'] ?? 'TICKET_ID' ) ),
			'param_token_3' => sanitize_text_field( wp_unslash( $_POST['param_token_3'] ?? 'TICKET_LINK' ) ),
		);

		wpep()->tickets_sms()->save_settings( $settings );

		wp_safe_redirect(
			add_query_arg(
				array(
					'page'    => self::PAGE_SMS,
					'updated' => '1',
				),
				admin_url( 'admin.php' )
			)
		);
		exit;
	}

	public function handle_submit(): void {
		if ( ! is_user_logged_in() ) {
			wp_die( esc_html__( 'برای ثبت تیکت باید وارد حساب کاربری شوید.', 'wp-event-publisher' ) );
		}
		check_admin_referer( self::NONCE );

		$title = sanitize_text_field( wp_unslash( $_POST['title'] ?? '' ) );
		$body  = wp_kses_post( wp_unslash( $_POST['message'] ?? '' ) );
		$dept  = absint( $_POST['department'] ?? 0 );
		$category = absint( $_POST['category'] ?? 0 );
		$priority = sanitize_key( wp_unslash( (string) ( $_POST['priority'] ?? 'normal' ) ) );
		$priority = in_array( $priority, array( 'low', 'normal', 'high', 'urgent' ), true ) ? $priority : 'normal';

		if ( '' === $title || '' === trim( wp_strip_all_tags( $body ) ) ) {
			wp_safe_redirect( wp_get_referer() ?: home_url( '/' ) );
			exit;
		}

		$ticket_id = wp_insert_post(
			array(
				'post_type'   => self::POST_TYPE,
				'post_status' => 'publish',
				'post_title'  => $title,
				'post_author' => get_current_user_id(),
			),
			true
		);

		if ( is_wp_error( $ticket_id ) ) {
			wp_die( esc_html( $ticket_id->get_error_message() ) );
		}

		update_post_meta( $ticket_id, '_jarchi_ticket_status', 'waiting' );
		update_post_meta( $ticket_id, '_jarchi_ticket_priority', $priority );
		update_post_meta( $ticket_id, '_jarchi_ticket_admin_unread', '1' );
		if ( $dept && term_exists( $dept, self::TAXONOMY ) ) {
			wp_set_post_terms( $ticket_id, array( $dept ), self::TAXONOMY );
		}
		if ( $category && term_exists( $category, self::CATEGORY ) ) {
			wp_set_post_terms( $ticket_id, array( $category ), self::CATEGORY );
		}
		$settings = $this->advanced_settings(); $field_values = array();
		foreach ((array)$settings['custom_fields'] as $field) { $key = sanitize_key($field['key'] ?? ''); if(!$key) continue; $value = wp_unslash($_POST['custom_field_'.$key] ?? ''); $value = 'textarea' === ($field['type'] ?? '') ? sanitize_textarea_field($value) : sanitize_text_field($value); if(!empty($field['required']) && ''===$value){ wp_delete_post($ticket_id,true); wp_safe_redirect(wp_get_referer()?:home_url('/')); exit; } $field_values[$key]=$value; }
		if($field_values) update_post_meta($ticket_id,'_jarchi_ticket_custom_fields',$field_values);

		$message = $this->insert_message( $ticket_id, $body, get_current_user_id(), 'user', 'waiting' );

		/*
		 * A ticket with no message is not a ticket.
		 *
		 * The result used to be discarded, so a comment insert that failed —
		 * a full disk, a plugin vetoing the comment, a database hiccup — left
		 * an empty record in the customer's list and the support queue with
		 * nothing in it and no way to say anything. Roll the whole thing back
		 * and tell the customer their message did not go through.
		 */
		if ( is_wp_error( $message ) || ! $message ) {
			wp_delete_post( $ticket_id, true );

			wp_safe_redirect(
				add_query_arg( 'jarchi_ticket_error', 'not_saved', wp_get_referer() ?: home_url( '/' ) )
			);
			exit;
		}

		$this->notify_support( (int) $ticket_id, $body, true );
		$this->send_backend_ticket_event( 'ticket.created', (int) $ticket_id, array( 'message' => wp_strip_all_tags( $body ) ) );

		$redirect = add_query_arg( 'jarchi_ticket', $ticket_id, wp_get_referer() ?: home_url( '/' ) );
		wp_safe_redirect( $redirect );
		exit;
	}

	public function handle_reply(): void {
		if ( ! is_user_logged_in() ) {
			wp_die( esc_html__( 'برای پاسخ باید وارد حساب کاربری شوید.', 'wp-event-publisher' ) );
		}
		check_admin_referer( self::NONCE );

		$ticket_id = absint( $_POST['ticket_id'] ?? 0 );
		$ticket = get_post( $ticket_id );
		if ( ! $ticket || self::POST_TYPE !== $ticket->post_type ) {
			wp_safe_redirect( wp_get_referer() ?: home_url( '/' ) );
			exit;
		}

		/*
		 * Three people can reach this handler: an administrator, a support
		 * agent, and the customer whose ticket it is. The agent answers from
		 * the same screen and the same form as the administrator, so a
		 * capability-only test read them as a customer and refused the reply
		 * to their own department's ticket. can_manage_ticket() is what
		 * decides — and for an agent it is scoped, so answering somebody
		 * else's department is still refused.
		 */
		$is_admin = $this->can_manage_ticket( $ticket_id );
		if ( ! $is_admin && (int) $ticket->post_author !== get_current_user_id() ) {
			wp_die( esc_html__( 'اجازه پاسخ به این تیکت را ندارید.', 'wp-event-publisher' ) );
		}

		/*
		 * The reply box is hidden on a one-way thread, but hiding a control is
		 * presentation, not a rule: the form can still be replayed. Support
		 * staff are exempt — they may always continue a conversation they own.
		 */
		if ( ! $is_admin && ! $this->replies_allowed( $ticket_id ) ) {
			wp_die( esc_html__( 'این پیام یک اطلاعیه است و امکان پاسخ ندارد. اگر سؤالی دارید، لطفاً تیکت تازه‌ای باز کنید.', 'wp-event-publisher' ) );
		}

		if ( ! $is_admin && 'closed' === $this->status( $ticket_id ) ) {
			wp_die( esc_html__( 'این تیکت بسته شده است. لطفاً تیکت تازه‌ای باز کنید.', 'wp-event-publisher' ) );
		}

		$body = wp_kses_post( wp_unslash( $_POST['message'] ?? '' ) );
		if ( '' === trim( wp_strip_all_tags( $body ) ) && empty( $_FILES['attachments']['name'][0] ?? '' ) ) {
			wp_safe_redirect( wp_get_referer() ?: home_url( '/' ) );
			exit;
		}

		$this->insert_message( $ticket_id, $body, get_current_user_id(), $is_admin ? 'admin' : 'user', $is_admin ? 'answered' : 'waiting' );
		update_post_meta( $ticket_id, '_jarchi_ticket_status', $is_admin ? 'answered' : 'waiting' );
		$this->send_backend_ticket_event( $is_admin ? 'ticket.admin_replied' : 'ticket.user_replied', $ticket_id, array( 'message' => wp_strip_all_tags( $body ), 'source' => $is_admin ? 'site' : 'web' ) );
		if ( $is_admin ) {
			$this->mark_unread_for_user( $ticket_id );
		} else {
			update_post_meta( $ticket_id, '_jarchi_ticket_admin_unread', '1' );
		}

		if ( $is_admin ) {
			$this->notify_user( $ticket_id, $body );
			$this->safe_notify_reply( $ticket_id, $body );
			// Email is immediate and independent; SMS is optional and isolated so
			// an SMS provider failure never blocks the ticket reply itself.
			if ( ! empty( $_POST['send_sms'] ) ) {
				$sms_result = wpep()->tickets_sms()->send_admin_reply( $ticket_id, $body );
				if ( is_wp_error( $sms_result ) && class_exists( Logger::class ) ) {
					wpep()->logger()->event( 'ticket-sms', Logger::STATUS_FAILED, $sms_result->get_error_message(), array( 'ticket_id' => $ticket_id ) );
				}
			}
		} else {
			// The customer answered. Somebody on the support side has to be
			// told, or the reply sits in a dashboard nobody has open.
			$this->notify_support( $ticket_id, $body, false );
		}

		wp_safe_redirect( wp_get_referer() ?: home_url( '/' ) );
		exit;
	}

	/**
	 * Whether the current user may act on one ticket from the support side.
	 *
	 * Capability alone is not authorization here. A staff action names its
	 * ticket in a form field, so the id is whatever the request said it was:
	 * without checking that it is a ticket at all, a mistyped or forged id
	 * writes Jarchi's meta onto an unrelated post and fires a webhook
	 * describing it as a ticket. And an agent scoped to one department must
	 * not be able to act on another's simply because the list screen was not
	 * the thing that stopped them.
	 *
	 * @since 1.19.2
	 *
	 * @param int $ticket_id Ticket.
	 *
	 * @return bool True when the action may proceed.
	 */
	private function can_manage_ticket( int $ticket_id ): bool {
		if ( ! current_user_can( Admin::CAPABILITY ) && ! current_user_can( 'jarchi_support_tickets' ) ) {
			return false;
		}

		$ticket = $ticket_id ? get_post( $ticket_id ) : null;

		if ( ! $ticket || self::POST_TYPE !== $ticket->post_type ) {
			return false;
		}

		return $this->viewer_can_see_ticket( $ticket_id );
	}

	public function handle_status(): void {
		check_admin_referer( self::NONCE );
		$ticket_id = absint( $_POST['ticket_id'] ?? 0 );

		if ( ! $this->can_manage_ticket( $ticket_id ) ) {
			wp_die( esc_html__( 'اجازه تغییر وضعیت را ندارید.', 'wp-event-publisher' ) );
		}

		$status = sanitize_key( wp_unslash( (string) ( $_POST['status'] ?? '' ) ) );
		if ( in_array( $status, array( 'waiting', 'reviewing', 'answered', 'closed', 'open', 'pending' ), true ) ) {
			$status = $this->canonical_status( $status );
			update_post_meta( $ticket_id, '_jarchi_ticket_status', $status );
			$this->send_backend_ticket_event( 'ticket.status_changed', $ticket_id, array( 'status' => $status ) );
		}
		wp_safe_redirect( wp_get_referer() ?: Admin::app_url( 'support' ) );
		exit;
	}

	public function handle_department(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه انجام این کار را ندارید.', 'wp-event-publisher' ) );
		}
		check_admin_referer( self::NONCE );
		$name = sanitize_text_field( wp_unslash( $_POST['name'] ?? '' ) );
		$parent = absint( $_POST['parent'] ?? 0 );
		if ( '' !== $name ) {
			wp_insert_term( $name, self::TAXONOMY, array( 'parent' => $parent ) );
		}
		wp_safe_redirect( Admin::app_url( 'ticket-departments' ) );
		exit;
	}

	private function insert_remote_message( int $ticket_id, string $body, string $sender_type, string $author_name = '' ): int {
		$comment_id = wp_insert_comment( array(
			'comment_post_ID' => $ticket_id,
			'comment_author' => $author_name ?: ( 'admin' === $sender_type ? 'Jarchi Support' : 'Jarchi User' ),
			'comment_author_email' => '',
			'comment_content' => $body,
			'comment_type' => self::COMMENT_TYPE,
			'user_id' => 0,
			'comment_approved' => 1,
		) );
		if ( $comment_id ) { add_comment_meta( $comment_id, '_jarchi_ticket_sender', $sender_type, true ); update_post_meta( $ticket_id, '_jarchi_ticket_last_reply', current_time( 'mysql' ) ); clean_post_cache( $ticket_id ); }
		return (int) $comment_id;
	}

	private function insert_message( int $ticket_id, string $body, int $user_id, string $sender_type, string $status ): int {
		$comment_id = wp_insert_comment(
			array(
				'comment_post_ID'  => $ticket_id,
				'comment_author'   => wp_get_current_user()->display_name,
				'comment_author_email' => wp_get_current_user()->user_email,
				'comment_content'  => $body,
				'comment_type'     => self::COMMENT_TYPE,
				'user_id'          => $user_id,
				'comment_approved' => 1,
			)
		);

		if ( $comment_id ) {
			add_comment_meta( $comment_id, '_jarchi_ticket_sender', $sender_type, true );
			$attachments = $this->store_attachments();
			if ( ! empty( $attachments ) ) {
				add_comment_meta( $comment_id, '_jarchi_ticket_attachments', $attachments, true );
			}
			update_post_meta( $ticket_id, '_jarchi_ticket_last_reply', current_time( 'mysql' ) );
			update_post_meta( $ticket_id, '_jarchi_ticket_status', $status );
			clean_post_cache( $ticket_id );
		}

		return (int) $comment_id;
	}

	private function store_attachments(): array {
		if ( empty( $_FILES['attachments']['name'] ) || ! is_array( $_FILES['attachments']['name'] ) ) {
			return array();
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$policy = $this->attachment_policy();
		$files  = $_FILES['attachments'];
		$ids    = array();
		$count  = count( (array) $files['name'] );

		for ( $i = 0; $i < $count; $i++ ) {
			if ( empty( $files['name'][ $i ] ) ) {
				continue;
			}

			// Counted on what was accepted, not on the loop index: rejecting
			// the first three files must not consume three of the five slots.
			if ( count( $ids ) >= (int) $policy['max_files'] ) {
				break;
			}

			$entry = array(
				'name'     => $files['name'][ $i ],
				'type'     => $files['type'][ $i ],
				'tmp_name' => $files['tmp_name'][ $i ],
				'error'    => $files['error'][ $i ],
				'size'     => $files['size'][ $i ],
			);

			$checked = $this->validate_upload( $entry, $policy );

			if ( is_wp_error( $checked ) ) {
				continue;
			}

			$_FILES['wpep_ticket_attachment'] = array(
				'name'     => $checked['name'],
				'type'     => $checked['type'],
				'tmp_name' => $entry['tmp_name'],
				'error'    => $entry['error'],
				'size'     => $entry['size'],
			);
			$id = media_handle_upload( 'wpep_ticket_attachment', 0, array(), array( 'test_form' => false ) );
			if ( ! is_wp_error( $id ) ) {
				$ids[] = (int) $id;
			}
			unset( $_FILES['wpep_ticket_attachment'] );
		}

		return $ids;
	}

	/**
	 * Notifies the customer, and never lets that failure reach the caller.
	 *
	 * Notification is an optional side effect of a ticket that has already
	 * been saved. Email, SMS, web push, Telegram and Bale all reach outside
	 * this site, and any of them can be misconfigured, rate-limited or simply
	 * down. Letting one of those throw past this point produced the worst
	 * possible outcome: the ticket was written to the database and the
	 * administrator saw a critical-error page, with no way to tell that the
	 * ticket had in fact been created.
	 *
	 * The failure is logged with its origin so it stays diagnosable.
	 *
	 * @since 1.17.7
	 *
	 * @param int    $ticket_id Ticket identifier.
	 * @param string $body      Message body.
	 *
	 * @return void
	 */
	private function notify_user( int $ticket_id, string $body ): void {
		try {
			$this->notify_user_now( $ticket_id, $body );
		} catch ( \Throwable $e ) {
			$this->log_side_effect_failure( 'notify-user', $ticket_id, $e );
		}
	}

	/**
	 * Records an optional integration failure without interrupting the request.
	 *
	 * @since 1.17.7
	 *
	 * @param string     $stage     What was being attempted.
	 * @param int        $ticket_id Ticket identifier.
	 * @param \Throwable $e         The failure.
	 *
	 * @return void
	 */
	private function log_side_effect_failure( string $stage, int $ticket_id, \Throwable $e ): void {
		if ( ! class_exists( Logger::class ) ) {
			return;
		}

		try {
			wpep()->logger()->event(
				'ticket-notification',
				Logger::STATUS_FAILED,
				sprintf( '%s: %s', $stage, $e->getMessage() ),
				array(
					'ticket_id' => $ticket_id,
					'stage'     => $stage,
					'file'      => $e->getFile(),
					'line'      => $e->getLine(),
				)
			);
		} catch ( \Throwable $ignored ) {
			// Logging is itself optional; a broken log table must not be the
			// reason a ticket save reports failure.
			unset( $ignored );
		}
	}

	/**
	 * Performs the actual customer notification.
	 *
	 * @param int    $ticket_id Ticket identifier.
	 * @param string $body      Message body.
	 *
	 * @return void
	 */
	private function notify_user_now( int $ticket_id, string $body ): void {
		$ticket = get_post( $ticket_id );
		if ( ! $ticket ) {
			return;
		}
		$user = get_user_by( 'id', (int) $ticket->post_author );
		if ( ! $user || empty( $user->user_email ) ) {
			return;
		}

		$link = add_query_arg( array( 'jarchi_ticket' => $ticket_id ), $this->ticket_page_url() );

		/*
		 * A message the site started is not a reply.
		 *
		 * Every one of these used to be titled "your ticket has been answered",
		 * so an order confirmation arrived claiming to answer a question the
		 * customer never asked. The wording now follows what actually happened,
		 * and a one-way announcement does not invite a reply it will refuse.
		 */
		$started_here = $this->is_automated( $ticket_id ) || 1 === count( $this->messages( $ticket_id ) );
		$answerable   = $this->replies_allowed( $ticket_id );

		if ( $started_here ) {
			/* translators: %s: ticket subject. */
			$subject = sprintf( __( 'پیام جدید از پشتیبانی: %s', 'wp-event-publisher' ), $ticket->post_title );

			$closing = $answerable
				? __( 'برای پاسخ دادن وارد حساب کاربری خود شوید:', 'wp-event-publisher' )
				: __( 'این پیام صرفاً جهت اطلاع است و نیازی به پاسخ ندارد. برای مشاهده:', 'wp-event-publisher' );
		} else {
			/* translators: %s: ticket subject. */
			$subject = sprintf( __( 'پاسخ جدید برای تیکت شما: %s', 'wp-event-publisher' ), $ticket->post_title );
			$closing = __( 'برای مشاهده و ادامه گفتگو وارد حساب کاربری خود شوید:', 'wp-event-publisher' );
		}

		$message = sprintf(
			"%1\$s\n\n%2\$s\n\n%3\$s\n%4\$s",
			sprintf(
				/* translators: %s: customer name. */
				__( 'سلام %s', 'wp-event-publisher' ),
				$user->display_name
			),
			wp_strip_all_tags( $body ),
			$closing,
			$link
		);

		wp_mail( $user->user_email, $subject, $message, array( 'Content-Type: text/plain; charset=UTF-8' ) );
	}

	/**
	 * Email addresses that should hear about new customer activity.
	 *
	 * The department's own agents first, so a ticket for the finance team does
	 * not page the whole company; the site administrator when nothing else
	 * applies, because an unanswered ticket nobody was told about is the worst
	 * outcome available.
	 *
	 * @since 1.9.0
	 *
	 * @param int $ticket_id Ticket.
	 *
	 * @return string[] Email addresses.
	 */
	private function support_notification_targets( int $ticket_id ): array {
		$emails = array();

		$departments = array_map( 'intval', (array) wp_get_object_terms( $ticket_id, self::TAXONOMY, array( 'fields' => 'ids' ) ) );

		foreach ( $this->support_agents() as $agent ) {
			$own = $this->agent_departments( (int) $agent->ID );

			// An agent with no departments is not yet configured, so they are
			// not silently made the recipient for everything.
			if ( ! $own || ! $departments || array_intersect( $own, $departments ) ) {
				if ( ! empty( $agent->user_email ) && $own ) {
					$emails[] = (string) $agent->user_email;
				}
			}
		}

		if ( empty( $emails ) ) {
			$fallback = (string) get_option( 'admin_email', '' );

			if ( '' !== $fallback ) {
				$emails[] = $fallback;
			}
		}

		/**
		 * Filters who is emailed about new customer ticket activity.
		 *
		 * @since 1.9.0
		 *
		 * @param string[] $emails    Recipients.
		 * @param int      $ticket_id Ticket.
		 */
		return array_values( array_unique( (array) apply_filters( 'wpep_ticket_support_recipients', $emails, $ticket_id ) ) );
	}

	/**
	 * Tells the support side that a customer needs them.
	 *
	 * The ticket was flagged unread for the admin screen, but nothing left the
	 * site — so unless somebody happened to open the dashboard, a customer
	 * could wait indefinitely on a ticket nobody knew existed.
	 *
	 * @since 1.9.0
	 *
	 * @param int    $ticket_id Ticket.
	 * @param string $body      What the customer wrote.
	 * @param bool   $is_new    New ticket rather than a reply.
	 *
	 * @return void
	 */
	private function notify_support( int $ticket_id, string $body, bool $is_new ): void {
		try {
			$ticket = get_post( $ticket_id );

			if ( ! $ticket ) {
				return;
			}

			$targets = $this->support_notification_targets( $ticket_id );

			if ( empty( $targets ) ) {
				return;
			}

			$author = get_user_by( 'id', (int) $ticket->post_author );

			$subject = $is_new
				/* translators: %s: ticket subject. */
				? sprintf( __( 'تیکت جدید: %s', 'wp-event-publisher' ), $ticket->post_title )
				/* translators: %s: ticket subject. */
				: sprintf( __( 'پاسخ کاربر روی تیکت: %s', 'wp-event-publisher' ), $ticket->post_title );

			$message = sprintf(
				"%1\$s\n\n%2\$s\n\n%3\$s\n%4\$s",
				sprintf(
					/* translators: 1: customer name, 2: ticket id. */
					__( 'از طرف %1$s — تیکت #%2$s', 'wp-event-publisher' ),
					$author ? (string) $author->display_name : __( 'کاربر', 'wp-event-publisher' ),
					(string) $ticket_id
				),
				wp_strip_all_tags( $body ),
				__( 'برای پاسخ دادن:', 'wp-event-publisher' ),
				Admin::app_url( 'support', array( 'ticket' => $ticket_id ) )
			);

			wp_mail( $targets, $subject, $message, array( 'Content-Type: text/plain; charset=UTF-8' ) );
		} catch ( \Throwable $e ) {
			// Support notification is a side effect: a mail server that is down
			// must not stop a customer from filing their ticket.
			$this->log_side_effect_failure( 'notify-support', $ticket_id, $e );
		}
	}

	public function messages( int $ticket_id ): array {
		return get_comments(
			array(
				'post_id' => $ticket_id,
				'type'    => self::COMMENT_TYPE,
				'orderby' => 'comment_date_gmt',
				'order'   => 'ASC',
				'number'  => 200,
			)
		);
	}

	/**
	 * Removes the media a ticket brought with it.
	 *
	 * Ticket uploads are ordinary attachments with no parent, so deleting the
	 * ticket left them in the library — a customer's identity document or
	 * invoice still sitting at a public URL long after the ticket that
	 * justified it was gone. After a cleanup run over thousands of automated
	 * tickets the residue was thousands of orphans nobody could match back to
	 * anything.
	 *
	 * Only ids this ticket or its own messages recorded are touched, and only
	 * if they are still attachments; an id that has been reused for something
	 * else is left alone.
	 *
	 * @since 1.19.2
	 *
	 * @param int $ticket_id Ticket being deleted.
	 *
	 * @return int Attachments removed.
	 */
	public function delete_ticket_attachments( $ticket_id ): int {
		$ticket_id = absint( $ticket_id );
		$ticket    = $ticket_id ? get_post( $ticket_id ) : null;

		if ( ! $ticket || self::POST_TYPE !== $ticket->post_type ) {
			return 0;
		}

		$ids = array_map( 'absint', (array) get_post_meta( $ticket_id, self::META_ATTACHMENTS, true ) );

		foreach ( (array) get_comments( array( 'post_id' => $ticket_id, 'type' => self::COMMENT_TYPE ) ) as $comment ) {
			$ids = array_merge( $ids, $this->attachments( (int) $comment->comment_ID ) );
		}

		$removed = 0;

		foreach ( array_unique( array_filter( $ids ) ) as $id ) {
			if ( 'attachment' !== get_post_type( $id ) ) {
				continue;
			}

			if ( wp_delete_attachment( $id, true ) ) {
				++$removed;
			}
		}

		return $removed;
	}

	public function attachments( int $comment_id ): array {
		$ids = get_comment_meta( $comment_id, '_jarchi_ticket_attachments', true );
		return is_array( $ids ) ? array_map( 'absint', $ids ) : array();
	}

	public function status( int $ticket_id ): string {
		$status = (string) get_post_meta( $ticket_id, '_jarchi_ticket_status', true );
		return $this->canonical_status( $status );
	}

	public function canonical_status( string $status ): string {
		$map = array( 'open' => 'waiting', 'pending' => 'answered', 'waiting' => 'waiting', 'reviewing' => 'reviewing', 'answered' => 'answered', 'closed' => 'closed' );
		return $map[ $status ] ?? 'waiting';
	}

	public function status_label( string $status ): string {
		$status = $this->canonical_status( $status );
		$s=$this->advanced_settings(); $labels=(array)$s['status_labels']; return (string)($labels[$status]??$labels['waiting']);
	}

	/**
	 * The cache key holding one user's unread count.
	 *
	 * @since 1.9.0
	 *
	 * @param int $user_id User.
	 *
	 * @return string Key.
	 */
	private function unread_cache_key( int $user_id ): string {
		return 'wpep_unread_' . $user_id;
	}

	/**
	 * Forgets a cached unread count.
	 *
	 * Called from both sides of the flag, so the number can never be stale in
	 * the direction that matters: the badge disappearing late is the complaint,
	 * and it would be guaranteed by a cache nobody clears on read.
	 *
	 * @since 1.9.0
	 *
	 * @param int $user_id User.
	 *
	 * @return void
	 */
	public function flush_unread_cache( int $user_id ): void {
		delete_transient( $this->unread_cache_key( $user_id ) );
	}

	/**
	 * Marks a ticket unread for its owner.
	 *
	 * @since 1.9.0
	 *
	 * @param int $ticket_id Ticket.
	 *
	 * @return void
	 */
	public function mark_unread_for_user( int $ticket_id ): void {
		update_post_meta( $ticket_id, '_jarchi_ticket_user_unread', '1' );

		$owner = (int) get_post_field( 'post_author', $ticket_id );

		if ( $owner > 0 ) {
			$this->flush_unread_cache( $owner );
		}
	}

	/**
	 * Marks a ticket read for its owner.
	 *
	 * @since 1.9.0
	 *
	 * @param int $ticket_id Ticket.
	 *
	 * @return void
	 */
	public function mark_read_for_user( int $ticket_id ): void {
		delete_post_meta( $ticket_id, '_jarchi_ticket_user_unread' );

		$owner = (int) get_post_field( 'post_author', $ticket_id );

		if ( $owner > 0 ) {
			$this->flush_unread_cache( $owner );
		}
	}

	/**
	 * How many of this user's tickets carry an unread reply.
	 *
	 * Counted with one COUNT(*) rather than a WP_Query.
	 *
	 * The badge polls this every few seconds for every signed-in visitor, and
	 * the previous implementation ran a full post query with found-rows
	 * counting — it fetched and hydrated posts only to discard them and keep
	 * the total. At a few hundred concurrent users that is the most expensive
	 * query on the site, repeatedly, to render a number.
	 *
	 * @since 1.9.0
	 *
	 * @param int|null $user_id User, or the current one.
	 *
	 * @return int Count.
	 */
	public function unread_count( ?int $user_id = null ): int {
		global $wpdb;

		$user_id = $user_id ?: get_current_user_id();

		if ( ! $user_id ) {
			return 0;
		}

		$cached = get_transient( $this->unread_cache_key( $user_id ) );

		if ( false !== $cached ) {
			return (int) $cached;
		}

		$count = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$wpdb->posts} p
				 INNER JOIN {$wpdb->postmeta} m ON m.post_id = p.ID
				 WHERE p.post_type = %s
				   AND p.post_author = %d
				   AND p.post_status IN ( 'publish', 'private', 'draft' )
				   AND m.meta_key = %s
				   AND m.meta_value = '1'",
				self::POST_TYPE,
				$user_id,
				'_jarchi_ticket_user_unread'
			)
		);

		// Short enough that a reply shows up promptly, long enough that a
		// ten-second poll does not become a ten-second query.
		set_transient( $this->unread_cache_key( $user_id ), $count, 30 );

		return $count;
	}

	public function ajax_unread(): void {
		check_ajax_referer( self::AJAX_NONCE, 'nonce' );

		if ( ! is_user_logged_in() ) {
			wp_send_json_success( array( 'count' => 0 ) );
		}

		wp_send_json_success( array( 'count' => $this->unread_count() ) );
	}

	public function ajax_mark_read(): void {
		check_ajax_referer( self::AJAX_NONCE, 'nonce' );

		if ( ! is_user_logged_in() ) {
			wp_send_json_error( array( 'message' => __( 'ابتدا وارد شوید.', 'wp-event-publisher' ) ), 403 );
		}

		$ticket_id = absint( $_POST['ticket'] ?? 0 );
		$ticket    = get_post( $ticket_id );

		if ( ! $ticket || self::POST_TYPE !== $ticket->post_type || (int) $ticket->post_author !== get_current_user_id() ) {
			wp_send_json_error( array( 'message' => __( 'تیکت پیدا نشد.', 'wp-event-publisher' ) ), 404 );
		}

		$this->mark_read_for_user( $ticket_id );

		wp_send_json_success( array( 'count' => $this->unread_count() ) );
	}

	public function filter_ticket_page_content( string $content ): string {
		if ( is_admin() || ! is_singular( 'page' ) ) {
			return $content;
		}
		$page_id = absint( get_option( '_wpep_ticket_page_id', 0 ) );
		if ( ! $page_id || ! is_page( $page_id ) ) {
			return $content;
		}
		// Keep Elementor preview/editor requests free to render their own content.
		if ( defined( 'ELEMENTOR_VERSION' ) && isset( $_GET['elementor-preview'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return $content;
		}
		$trimmed = trim( wp_strip_all_tags( $content ) );
		if ( '' === $trimmed || '[jarchi_tickets]' === trim( $content ) ) {
			return $this->render_center();
		}
		return $content;
	}

	public function shortcode_center( array $overrides = array() ): string {
		return $this->render_center( $overrides );
	}

	/**
	 * Render the ticket center directly. This is the canonical renderer used by
	 * Elementor and the internal ticket page; the shortcode remains only as a
	 * backwards-compatible wrapper.
	 */
	public function render_center( array $overrides = array() ): string {
		if ( ! is_user_logged_in() ) {
			$login_title = isset( $overrides['login_title'] ) ? (string) $overrides['login_title'] : __( 'ورود به حساب کاربری', 'wp-event-publisher' );
			$login_desc  = isset( $overrides['login_description'] ) ? (string) $overrides['login_description'] : __( 'برای ارسال و پیگیری تیکت ابتدا وارد حساب کاربری شوید.', 'wp-event-publisher' );
			return '<div class="jarchi-ticket-center"><div class="jarchi-ticket-empty"><strong>' . esc_html( $login_title ) . '</strong><p>' . esc_html( $login_desc ) . '</p></div></div>';
		}
		$this->enqueue_front_assets();
		$selected = isset( $_GET['jarchi_ticket'] ) ? absint( $_GET['jarchi_ticket'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$ticket = $selected ? get_post( $selected ) : null;
		if ( $ticket && ( self::POST_TYPE !== $ticket->post_type || (int) $ticket->post_author !== get_current_user_id() ) ) {
			$ticket = null;
		}

		/*
		 * Marked read HERE, before anything is rendered.
		 *
		 * The thread used to clear the flag while building its own markup —
		 * which happens after the header has already printed the unread total.
		 * Opening a ticket therefore showed the old count on the very page that
		 * had just read it, and it stayed wrong until the next poll. That is
		 * precisely the "I have seen it and the badge is still there" report.
		 */
		if ( $ticket ) {
			$this->mark_read_for_user( (int) $ticket->ID );
		}

		$filter = isset( $_GET['ticket_status'] ) ? sanitize_key( wp_unslash( (string) $_GET['ticket_status'] ) ) : 'all'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$items = get_posts(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => array( 'private', 'publish', 'draft' ),
				'author'         => get_current_user_id(),
				'posts_per_page' => 50,
				'orderby'        => 'modified',
				'order'          => 'DESC',
			)
		);
		/*
		 * The counts are taken before the filter is applied.
		 *
		 * They used to be computed from $items after it had been narrowed, so
		 * selecting "پاسخ داده شده" left every other chip reading 0 and "همه"
		 * reading the answered count — the filter row stopped describing the
		 * tickets the moment it was used, which is the one moment it matters.
		 */
		$status_counts = array( 'all' => count( $items ), 'waiting' => 0, 'reviewing' => 0, 'answered' => 0, 'closed' => 0 );

		foreach ( $items as $filter_item ) {
			$filter_status = $this->canonical_status( $this->status( (int) $filter_item->ID ) );

			if ( isset( $status_counts[ $filter_status ] ) ) {
				++$status_counts[ $filter_status ];
			}
		}

		if ( 'all' !== $filter ) {
			$items = array_values( array_filter( $items, fn( $item ) => $this->canonical_status( $this->status( $item->ID ) ) === $filter ) );
		}
		$departments = get_terms( array( 'taxonomy' => self::TAXONOMY, 'hide_empty' => false ) );
		$categories  = get_terms( array( 'taxonomy' => self::CATEGORY, 'hide_empty' => false ) );

		$ui = wp_parse_args( $overrides, $this->ui_settings() );
		$max_width = isset( $overrides['max_width']['size'] ) ? (float) $overrides['max_width']['size'] . ( $overrides['max_width']['unit'] ?? 'px' ) : '1180px';
		$list_width = isset( $overrides['list_width']['size'] ) ? (float) $overrides['list_width']['size'] . ( $overrides['list_width']['unit'] ?? 'px' ) : '300px';
		$radius = isset( $overrides['radius']['size'] ) ? absint( $overrides['radius']['size'] ) . 'px' : absint( $ui['radius'] ) . 'px';
		$shadow = array_key_exists( 'shadow', $overrides ) ? ( $overrides['shadow'] ? '0 16px 38px rgba(17,24,39,.08)' : 'none' ) : ( ! empty( $ui['shadow'] ) ? '0 16px 38px rgba(17,24,39,.08)' : 'none' );
		$ui_style = sprintf( '--jt-primary:%1$s;--jt-primary-hi:%2$s;--jt-surface:%3$s;--jt-bg:%4$s;--jt-text:%5$s;--jt-muted:%6$s;--jt-border:%7$s;--jt-field-bg:%8$s;--jt-field-text:%9$s;--jt-button-text:%10$s;--jt-badge-bg:%11$s;--jt-badge-text:%12$s;--jt-radius:%13$s;--jt-shadow:%14$s;--jt-list-width:%15$s;max-width:%16$s;', esc_attr( $ui['primary'] ), esc_attr( $ui['primary_hi'] ?? '#FF8A1C' ), esc_attr( $ui['surface'] ), esc_attr( $ui['background'] ), esc_attr( $ui['text'] ), esc_attr( $ui['muted'] ), esc_attr( $ui['border'] ), esc_attr( $ui['field_bg'] ?? '#FFFFFF' ), esc_attr( $ui['field_text'] ?? $ui['text'] ), esc_attr( $ui['button_text'] ?? '#FFFFFF' ), esc_attr( $ui['badge_bg'] ?? '#D92D20' ), esc_attr( $ui['badge_text'] ?? '#FFFFFF' ), esc_attr( $radius ), esc_attr( $shadow ), esc_attr( $list_width ), esc_attr( $max_width ) );
		$out  = '<div id="jarchi-tickets" class="jarchi-ticket-center" dir="rtl" style="' . $ui_style . '">';
		$kicker = isset( $overrides['kicker'] ) ? (string) $overrides['kicker'] : __( 'پشتیبانی جارچی', 'wp-event-publisher' );
		$title = isset( $overrides['title'] ) ? (string) $overrides['title'] : __( 'تیکت‌های من', 'wp-event-publisher' );
		$description = isset( $overrides['description'] ) ? (string) $overrides['description'] : __( 'سریع پیام بده، تصویر بفرست و پاسخ را همینجا دریافت کن.', 'wp-event-publisher' );
		/*
		 * The count is rendered with its visibility already decided. It used to
		 * ship without the class that reveals it and wait for the first poll,
		 * so the page loaded with no badge and one appeared ten seconds later
		 * for no reason the reader could see.
		 */
		$wpep_unread = $this->unread_count();

		$out .= '<div class="jarchi-ticket-head">'
			. '<div class="jarchi-ticket-head__text">'
			. '<span class="jarchi-ticket-kicker">' . esc_html( $kicker ) . '</span>'
			. '<h2>' . esc_html( $title ) . '</h2>'
			. '<p>' . esc_html( $description ) . '</p>'
			. '</div>'
			. '<div class="jarchi-ticket-head-actions">'
			. '<button type="button" class="jarchi-ticket-notify-enable" data-jarchi-enable-notifications hidden>'
			. $this->icon( 'bell' )
			. '<span>' . esc_html__( 'فعال‌سازی اعلان', 'wp-event-publisher' ) . '</span>'
			. '</button>'
			// A link, not a label. "The number should bring me the tickets" —
			// so it goes to the list, and the list is the thing it counts.
			. '<a class="jarchi-ticket-unread' . ( $wpep_unread > 0 ? ' is-visible' : '' ) . '" data-jarchi-ticket-unread'
			. ' href="' . esc_url( $this->ticket_page_url() ) . '"'
			. ' aria-label="' . esc_attr__( 'پیام‌های خوانده‌نشده', 'wp-event-publisher' ) . '"'
			. ' title="' . esc_attr__( 'پیام‌های خوانده‌نشده', 'wp-event-publisher' ) . '">'
			. esc_html( $wpep_unread > 99 ? '99+' : (string) $wpep_unread )
			. '</a>'
			. '</div></div>';
		$filter_labels = array(
			'all'       => array( 'label' => 'همه', 'icon' => 'list', 'class' => 'is-all' ),
			'waiting'   => array( 'label' => 'در انتظار پاسخ', 'icon' => 'clock', 'class' => 'is-waiting' ),
			'reviewing' => array( 'label' => 'در حال بررسی', 'icon' => 'search', 'class' => 'is-reviewing' ),
			'answered'  => array( 'label' => 'پاسخ داده شده', 'icon' => 'check', 'class' => 'is-answered' ),
			'closed'    => array( 'label' => 'بسته شده', 'icon' => 'lock', 'class' => 'is-closed' ),
		);
		$out .= '<nav class="jarchi-ticket-filters" aria-label="' . esc_attr__( 'فیلتر تیکت‌ها', 'wp-event-publisher' ) . '">';
		foreach ( $filter_labels as $key => $data ) {
			$url = $this->ticket_page_url();
			if ( 'all' !== $key ) {
				$url = add_query_arg( 'ticket_status', $key, $url );
			}
			$out .= '<a class="jarchi-ticket-filter ' . esc_attr( $data['class'] ) . ( $filter === $key ? ' is-active' : '' ) . '" href="' . esc_url( $url ) . '" aria-current="' . ( $filter === $key ? 'page' : 'false' ) . '"><span class="jarchi-ticket-filter__icon">' . $this->icon( $data['icon'] ) . '</span><span class="jarchi-ticket-filter__label">' . esc_html( $data['label'] ) . '</span><span class="jarchi-ticket-filter__count">' . esc_html( (string) ( $status_counts[ $key ] ?? 0 ) ) . '</span></a>';
		}
		$out .= '</nav>';
		$out .= '<div class="jarchi-ticket-layout' . ( $ticket ? ' has-open-thread' : '' ) . '">';
		$out .= '<aside class="jarchi-ticket-list">';
		$new_button = isset( $overrides['new_button_text'] ) ? (string) $overrides['new_button_text'] : __( 'تیکت جدید', 'wp-event-publisher' );
		$out .= '<button type="button" class="jarchi-ticket-new" data-jarchi-ticket-new>' . $this->icon( 'plus' ) . '' . esc_html( $new_button ) . '</button>';
		if ( empty( $items ) ) {
			$empty_text = isset( $overrides['empty_list_text'] ) ? (string) $overrides['empty_list_text'] : __( 'هنوز تیکتی ثبت نکرده‌اید.', 'wp-event-publisher' );
			$out .= '<div class="jarchi-ticket-empty">' . esc_html( $empty_text ) . '</div>';
		} else {
			foreach ( $items as $item ) {
				$unread = (bool) get_post_meta( $item->ID, '_jarchi_ticket_user_unread', true );
				$out .= '<a class="jarchi-ticket-list-item' . ( $selected === $item->ID ? ' is-active' : '' ) . ( $unread ? ' has-unread' : '' ) . '" href="' . esc_url( add_query_arg( 'jarchi_ticket', $item->ID ) ) . '" data-ticket-id="' . esc_attr( (string) $item->ID ) . '">';
				$wpep_state = $this->canonical_status( $this->status( $item->ID ) );

				$out .= '<span class="jarchi-ticket-list-main">'
					. '<strong>' . esc_html( $item->post_title ) . '</strong>'
					. '<span class="jarchi-ticket-list-meta">'
					. '<span class="jarchi-ticket-chip jarchi-ticket-chip--' . esc_attr( $wpep_state ) . '">' . esc_html( $this->status_label( $wpep_state ) ) . '</span>'
					. '<time>' . esc_html( get_the_modified_date( '', $item ) ) . '</time>'
					. '</span>'
					. '</span>';
				if ( $unread ) {
					$out .= '<span class="jarchi-ticket-dot">1</span>';
				}
				$out .= '</a>';
			}
		}
		$out .= '</aside>';
		$out .= '<section class="jarchi-ticket-thread">';
		if ( $ticket ) {
			$out .= $this->front_thread_markup( $ticket, $overrides );
		} else {
			$out .= $this->front_new_ticket_markup( $departments, $categories, $overrides );
		}
		$out .= '</section></div></div>';
		$out .= $this->front_script();
		return $out;
	}

	private function front_new_ticket_markup( array $departments, array $categories, array $overrides = array() ): string {
		$form_title = isset( $overrides['form_icon_title'] ) ? (string) $overrides['form_icon_title'] : __( 'تیکت جدید', 'wp-event-publisher' );
		$form_description = isset( $overrides['form_description'] ) ? (string) $overrides['form_description'] : __( 'موضوع را کوتاه و واضح بنویس و در صورت نیاز عکس را هم ضمیمه کن.', 'wp-event-publisher' );
		$subject_label = isset( $overrides['subject_label'] ) ? (string) $overrides['subject_label'] : __( 'موضوع', 'wp-event-publisher' );
		$department_label = isset( $overrides['department_label'] ) ? (string) $overrides['department_label'] : __( 'دپارتمان', 'wp-event-publisher' );
		$priority_label = isset( $overrides['priority_label'] ) ? (string) $overrides['priority_label'] : __( 'اولویت', 'wp-event-publisher' );
		$message_label = isset( $overrides['message_label'] ) ? (string) $overrides['message_label'] : __( 'پیام', 'wp-event-publisher' );
		$submit_text = isset( $overrides['submit_text'] ) ? (string) $overrides['submit_text'] : __( 'ثبت تیکت', 'wp-event-publisher' );
		$upload_note = isset( $overrides['upload_note'] ) ? (string) $overrides['upload_note'] : __( 'حداکثر ۴ تصویر، هر تصویر تا ۸ مگابایت.', 'wp-event-publisher' );
		$out = '<div class="jarchi-ticket-form-card"><span class="jarchi-ticket-form-icon">' . $this->icon( 'support' ) . '</span><h3>' . esc_html( $form_title ) . '</h3><p>' . esc_html( $form_description ) . '</p>';
		$advanced=$this->advanced_settings(); if(!empty($advanced['faq'])){ $out.='<div class="jarchi-ticket-faq" data-jarchi-faq><div class="jarchi-ticket-faq__head">'.$this->icon('help').'<strong>قبل از ارسال تیکت</strong></div><input class="jarchi-ticket-faq__search" type="search" placeholder="جستجو بین سوالات متداول…" data-jarchi-faq-search>'; $out.='<div class="jarchi-ticket-faq__items">'; foreach($advanced['faq'] as $faq){ $title=(string)($faq['title']??''); $out.='<div class="jarchi-ticket-faq__item" data-jarchi-faq-item data-search="'.esc_attr(strtolower(wp_strip_all_tags($title))).'"><details><summary>'.esc_html($title).'</summary><div>'.wp_kses_post($faq['body']??'').'</div></details></div>'; } $out.='</div><div class="jarchi-ticket-faq__help">اگر پاسخ سوالتان را اینجا پیدا کردید، نیازی به ثبت تیکت جدید نیست.</div></div>'; }
		$out .= '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" enctype="multipart/form-data">';
		$out .= '<input type="hidden" name="action" value="wpep_ticket_submit" /><input type="hidden" name="_wpnonce" value="' . esc_attr( wp_create_nonce( self::NONCE ) ) . '" />';
		$out .= '<label>' . esc_html( $subject_label ) . '<input type="text" name="title" required maxlength="180" /></label>';
		$out .= '<div class="jarchi-ticket-row"><label>' . esc_html( $department_label ) . '<select name="department"><option value="0">' . esc_html__( 'انتخاب کنید', 'wp-event-publisher' ) . '</option>';
		foreach ( $departments as $department ) { $out .= '<option value="' . esc_attr( (string) $department->term_id ) . '">' . esc_html( $department->name ) . '</option>'; }
		$out .= '</select></label><label>' . esc_html__( 'دسته‌بندی', 'wp-event-publisher' ) . '<select name="category"><option value="0">' . esc_html__( 'انتخاب کنید', 'wp-event-publisher' ) . '</option>';
		foreach ( $categories as $category ) { $out .= '<option value="' . esc_attr( (string) $category->term_id ) . '">' . esc_html( $category->name ) . '</option>'; }
		$out .= '</select></label><label>' . esc_html( $priority_label ) . '<select name="priority"><option value="low">' . esc_html__( 'کم', 'wp-event-publisher' ) . '</option><option value="normal" selected>' . esc_html__( 'عادی', 'wp-event-publisher' ) . '</option><option value="high">' . esc_html__( 'بالا', 'wp-event-publisher' ) . '</option><option value="urgent">' . esc_html__( 'فوری', 'wp-event-publisher' ) . '</option></select></label></div>';
		foreach((array)$advanced['custom_fields'] as $field){ $key=sanitize_key($field['key']??''); $label=sanitize_text_field($field['label']??''); $type=$field['type']??'text'; if(!$key||!$label) continue; $required=!empty($field['required'])?' required':''; if('textarea'===$type){ $out.='<label>'.esc_html($label).'<textarea name="custom_field_'.esc_attr($key).'" rows="3"'.$required.'></textarea></label>'; } elseif('select'===$type){ $out.='<label>'.esc_html($label).'<select name="custom_field_'.esc_attr($key).'"'.$required.'><option value="">انتخاب کنید</option>'; foreach((array)($field['options']??array()) as $opt){ $out.='<option value="'.esc_attr($opt).'">'.esc_html($opt).'</option>'; } $out.='</select></label>'; } else { $out.='<label>'.esc_html($label).'<input type="text" name="custom_field_'.esc_attr($key).'"'.$required.' /></label>'; }}
		$out .= '<label>' . esc_html( $message_label ) . '<textarea name="message" rows="7" required></textarea></label>';
		// The accept list and the note both come from the policy the server
		// enforces, so what the form offers and what it will keep are the same
		// two numbers.
		$policy = $this->attachment_policy();
		$note   = sprintf(
			/* translators: 1: maximum number of files, 2: maximum size of each file in megabytes. */
			__( 'حداکثر %1$d فایل، هر فایل تا %2$d مگابایت.', 'wp-event-publisher' ),
			(int) $policy['max_files'],
			(int) round( $policy['max_bytes'] / MB_IN_BYTES )
		);
		$out .= '<div class="jarchi-ticket-upload"><input type="file" name="attachments[]" accept="' . esc_attr( implode( ',', (array) $policy['mime'] ) ) . '" multiple /><small>' . esc_html( $note ) . '</small></div>';
		$out .= '<button type="submit" class="jarchi-ticket-submit">' . $this->icon( 'send' ) . '' . esc_html__( 'ثبت تیکت', 'wp-event-publisher' ) . '</button></form></div>';
		return $out;
	}

	private function front_thread_markup( \WP_Post $ticket, array $overrides = array() ): string {
		// The unread flag is cleared by render_center() before the header is
		// built, so the count printed at the top of the page is already right.
		$messages = $this->messages( $ticket->ID );
		/*
		 * On a phone the list and the thread cannot both be on screen, so the
		 * thread is a page of its own and needs a way back. Without this the
		 * only route to the other tickets was the browser's back button, which
		 * is why the screen felt like a dead end on mobile.
		 */
		$out = '<a class="jarchi-ticket-back-link" href="' . esc_url( remove_query_arg( 'jarchi_ticket', $this->ticket_page_url() ) ) . '">'
			. '' . $this->icon( 'forward' ) . ''
			. esc_html__( 'همهٔ تیکت‌ها', 'wp-event-publisher' )
			. '</a>';

		$out .= '<div class="jarchi-ticket-thread-head">'
			. '<div class="jarchi-ticket-thread-head__main">'
			. '<h3>' . esc_html( $ticket->post_title ) . '</h3>'
			. '<span class="jarchi-ticket-kicker">#' . esc_html( (string) $ticket->ID ) . ' · ' . esc_html( get_the_modified_date( '', $ticket ) ) . '</span>'
			. '</div>'
			. '<span class="jarchi-ticket-status jarchi-ticket-status--' . esc_attr( $this->status( $ticket->ID ) ) . '">' . esc_html( $this->status_label( $this->status( $ticket->ID ) ) ) . '</span>'
			. '</div>';
		$cf=(array)get_post_meta($ticket->ID,'_jarchi_ticket_custom_fields',true); if($cf){ $out.='<div class="jarchi-ticket-custom-summary">'; foreach($cf as $k=>$v){ $out.='<span><b>'.esc_html($k).'</b> '.esc_html($v).'</span>'; } $out.='</div>'; }
		$out .= '<div class="jarchi-ticket-messages">';
		foreach ( $messages as $message ) {
			$sender = (string) get_comment_meta( $message->comment_ID, '_jarchi_ticket_sender', true );
			$out .= '<article class="jarchi-ticket-message ' . ( 'admin' === $sender ? 'is-admin' : 'is-user' ) . '"><div class="jarchi-ticket-message__meta"><strong>' . esc_html( get_comment_author( $message ) ) . '</strong><time>' . esc_html( get_comment_date( '', $message ) . ' ' . get_comment_time( '', $message ) ) . '</time></div><div class="jarchi-ticket-message__body">' . wpautop( wp_kses_post( $message->comment_content ) ) . '</div>';
			$attachments = $this->attachments( $message->comment_ID );
			if ( ! empty( $attachments ) ) {
				$out .= '<div class="jarchi-ticket-attachments">';
				foreach ( $attachments as $attachment_id ) {
					$url = wp_get_attachment_image_url( $attachment_id, 'medium' );
					$full = wp_get_attachment_url( $attachment_id );
					if ( $full ) { $mime=(string)get_post_mime_type($attachment_id); if ( str_starts_with($mime,'audio/') ) { $out .= '<audio controls preload="metadata" src="'.esc_url($full).'"></audio>'; } elseif ( 'application/pdf' === $mime ) { $out .= '<a class="jarchi-ticket-file-link" href="'.esc_url($full).'" target="_blank" rel="noopener">📎 '.esc_html( get_the_title($attachment_id) ?: basename($full) ).'</a>'; } elseif ( $url ) { $out .= '<a href="'.esc_url($full).'" target="_blank" rel="noopener"><img src="'.esc_url($url).'" alt="" loading="lazy" /></a>'; } }
				}
				$out .= '</div>';
			}
			$out .= '</article>';
		}
		$out .= '</div>';

		/*
		 * Three states, and the customer is told which one they are in.
		 *
		 * A one-way announcement used to show a reply box that led to a refusal
		 * on submit; a closed thread showed nothing at all, which reads as the
		 * page having failed to load. Saying so plainly, and pointing at the
		 * one thing they can still do, is the difference between a product and
		 * a dead end.
		 */
		$wpep_open       = 'closed' !== $this->status( $ticket->ID );
		$wpep_answerable = $this->replies_allowed( (int) $ticket->ID );

		if ( $wpep_open && $wpep_answerable ) {
			$out .= '<form class="jarchi-ticket-reply-form" method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" enctype="multipart/form-data"><input type="hidden" name="action" value="wpep_ticket_reply" /><input type="hidden" name="ticket_id" value="' . esc_attr( (string) $ticket->ID ) . '" /><input type="hidden" name="_wpnonce" value="' . esc_attr( wp_create_nonce( self::NONCE ) ) . '" /><textarea name="message" rows="4" placeholder="' . esc_attr( isset( $overrides['reply_placeholder'] ) ? (string) $overrides['reply_placeholder'] : __( 'پاسخ خود را بنویسید…', 'wp-event-publisher' ) ) . '"></textarea><div class="jarchi-ticket-reply-actions"><label class="jarchi-ticket-file">' . $this->icon( 'clip' ) . '<input type="file" name="attachments[]" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,audio/mpeg,audio/wav,audio/ogg,audio/webm" multiple /><span>' . esc_html( isset( $overrides['attach_text'] ) ? (string) $overrides['attach_text'] : __( 'افزودن تصویر', 'wp-event-publisher' ) ) . '</span></label><button type="submit" class="jarchi-ticket-submit">' . esc_html( isset( $overrides['reply_text'] ) ? (string) $overrides['reply_text'] : __( 'ارسال پاسخ', 'wp-event-publisher' ) ) . '</button></div></form>';
		} else {
			$wpep_note = ! $wpep_answerable
				? __( 'این پیام یک اطلاع‌رسانی است و نیازی به پاسخ ندارد.', 'wp-event-publisher' )
				: __( 'این گفتگو بسته شده است.', 'wp-event-publisher' );

			$out .= '<div class="jarchi-ticket-locked">'
				. '' . $this->icon( $wpep_answerable ? 'lock' : 'megaphone' ) . ''
				. '<p>' . esc_html( $wpep_note ) . '</p>'
				. '<button type="button" class="jarchi-ticket-submit" data-jarchi-ticket-new>' . esc_html__( 'تیکت جدید', 'wp-event-publisher' ) . '</button>'
				. '</div>';
		}
		if ( 'closed' === $this->status( $ticket->ID ) && get_post_meta( $ticket->ID, '_jarchi_ticket_agent', true ) ) {
			$current_rating = absint( get_post_meta( $ticket->ID, '_jarchi_ticket_rating', true ) );
			$out .= '<form class="jarchi-ticket-rating" method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"><input type="hidden" name="action" value="wpep_ticket_rating"><input type="hidden" name="ticket_id" value="' . esc_attr( (string) $ticket->ID ) . '"><input type="hidden" name="_wpnonce" value="' . esc_attr( wp_create_nonce( self::NONCE ) ) . '"><strong>امتیاز به پشتیبان</strong><div class="jarchi-ticket-stars">';
			for ( $i = 1; $i <= 5; $i++ ) { $out .= '<label><input type="radio" name="rating" value="' . $i . '" ' . checked( $current_rating, $i, false ) . '><span>★</span></label>'; }
			$out .= '</div><textarea name="rating_comment" rows="3" placeholder="نظر شما درباره پاسخ پشتیبان…"></textarea><button type="submit" class="jarchi-ticket-submit">ثبت امتیاز</button></form>';
		}
		return $out;
	}

	/**
	 * Accepts a colour in any form a page builder actually produces.
	 *
	 * Every Elementor colour control was being run through
	 * sanitize_hex_color(), which accepts `#RGB` and `#RRGGBB` and nothing
	 * else. Elementor's picker returns four other things routinely:
	 *
	 *   rgba(232, 79, 1, 0.6)        — whenever the alpha slider is touched
	 *   #E84F01AA                    — eight-digit hex, same reason
	 *   hsl(20 97% 46%)              — the picker's other tab
	 *   var(--e-global-color-primary) — what clicking a Global Colour returns,
	 *                                   which is the top row of the picker and
	 *                                   therefore the common case
	 *
	 * All four came back null, the override was dropped, and the default was
	 * used — so the customer changed a colour, saw no change, and reasonably
	 * concluded the plugin ignores Elementor. It did.
	 *
	 * This is a CSS value going into a declaration, so the danger is escaping
	 * that declaration. Rather than trying to spot every way of doing that,
	 * the value has to match one of the shapes above in full; anything else is
	 * refused. A semicolon or a brace cannot occur inside any of them.
	 *
	 * @since 1.19.3
	 *
	 * @param mixed $value Raw control value.
	 *
	 * @return string The colour, or '' when it is not one.
	 */
	public static function sanitize_css_color( $value ): string {
		if ( ! is_scalar( $value ) ) {
			return '';
		}

		$value = trim( (string) $value );

		if ( '' === $value || strlen( $value ) > 120 ) {
			return '';
		}

		$patterns = array(
			// #RGB, #RGBA, #RRGGBB, #RRGGBBAA.
			'/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i',
			// rgb()/rgba()/hsl()/hsla(), comma or space separated, with or
			// without a percentage, alpha as a number or a percentage.
			'/^(?:rgba?|hsla?)\(\s*[0-9a-z.%,\/\s+-]{3,80}\)$/i',
			// A custom property reference, with an optional fallback that must
			// itself be a plain colour word or hex.
			'/^var\(\s*--[a-z0-9_-]{1,60}\s*(?:,\s*(?:#[0-9a-f]{3,8}|[a-z]{3,20})\s*)?\)$/i',
			// Named colours, and the keywords a picker may emit for "none".
			'/^[a-z]{3,20}$/i',
		);

		foreach ( $patterns as $pattern ) {
			if ( preg_match( $pattern, $value ) ) {
				return $value;
			}
		}

		return '';
	}

	/**
	 * Whether one menu URL points at the ticket page.
	 *
	 * Compared on path alone. The menu may hold an absolute URL, a relative
	 * one, a link with a trailing slash or without, and on a multilingual site
	 * a different host entirely — matching the whole string would find none of
	 * them.
	 *
	 * @since 1.19.3
	 *
	 * @param string $url Menu item URL.
	 *
	 * @return bool True when it is the ticket page.
	 */
	private function url_is_ticket_page( string $url ): bool {
		if ( '' === $url || '#' === $url ) {
			return false;
		}

		$target = (string) wp_parse_url( $this->ticket_page_url(), PHP_URL_PATH );
		$given  = (string) wp_parse_url( $url, PHP_URL_PATH );

		if ( '' === $target || '' === $given ) {
			return false;
		}

		return untrailingslashit( $target ) === untrailingslashit( $given );
	}

	/**
	 * Gives the ticket page's menu link somewhere to hang a badge.
	 *
	 * The badge is positioned against the anchor, and an anchor in a theme's
	 * menu is `position: static` with no reason to be otherwise — so a class
	 * is added rather than assuming.
	 *
	 * @since 1.19.3
	 *
	 * @param array<string,string> $atts Anchor attributes.
	 * @param object               $item Menu item.
	 *
	 * @return array<string,string> Attributes.
	 */
	public function menu_link_attributes( $atts, $item = null ): array {
		$atts = (array) $atts;

		if ( ! is_user_logged_in() || ! is_object( $item ) || ! $this->url_is_ticket_page( (string) ( $item->url ?? '' ) ) ) {
			return $atts;
		}

		$atts['class'] = trim( (string) ( $atts['class'] ?? '' ) . ' jarchi-has-ticket-badge' );

		return $atts;
	}

	/**
	 * Appends the live unread badge to the ticket page's menu item.
	 *
	 * The customer asked for the number beside the icon in the phone menu.
	 * Rather than requiring a shortcode to be placed somewhere it may not fit,
	 * whichever menu item already links to the ticket page gets it — and the
	 * same `data-jarchi-ticket-badge` hook the polling script already paints,
	 * so the menu count and the page count are the same number from the same
	 * source, updated together.
	 *
	 * @since 1.19.3
	 *
	 * @param string $title Menu item title.
	 * @param object $item  Menu item.
	 *
	 * @return string Title.
	 */
	public function menu_item_title( $title, $item = null ): string {
		$title = (string) $title;

		if ( ! is_user_logged_in() || ! is_object( $item ) || ! $this->url_is_ticket_page( (string) ( $item->url ?? '' ) ) ) {
			return $title;
		}

		$this->enqueue_front_assets();

		$count = $this->unread_count();

		return $title . '<span class="jarchi-menu-ticket-badge' . ( $count > 0 ? ' is-visible' : '' ) . '"'
			. ' data-jarchi-ticket-badge' . ( $count > 0 ? '' : ' hidden' ) . '>'
			. esc_html( $count > 99 ? '99+' : (string) $count )
			. '</span>';
	}

	/**
	 * One inline SVG icon.
	 *
	 * Every icon on the customer-facing side used to be a Dashicon. Dashicons
	 * is wp-admin's icon font: WordPress does not load it on the front end
	 * unless a plugin asks, and this one never did. So `<span class="dashicons
	 * dashicons-clock">` rendered as an empty inline box on every phone and
	 * every desktop — the filter row showed a bare number with no label beside
	 * it, and the buttons had a gap where the glyph should be.
	 *
	 * Enqueueing the font would fix the symptom and cost every visitor a
	 * 60 KB download for six glyphs, on a stylesheet that optimiser plugins
	 * routinely strip from the front end because it is supposed to be an admin
	 * asset. Inline SVG has no stylesheet to lose, inherits currentColor, and
	 * scales without a font file.
	 *
	 * @since 1.19.3
	 *
	 * @param string $name Icon name.
	 *
	 * @return string SVG markup, or '' when the name is unknown.
	 */
	public function icon( string $name ): string {
		$paths = array(
			// Filters.
			'list'      => '<path d="M4 6h16M4 12h16M4 18h10"/>',
			'clock'     => '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
			'search'    => '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
			'check'     => '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.2 2.4 2.4 4.8-4.8"/>',
			'lock'      => '<rect x="5" y="10.5" width="14" height="9" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
			// Actions.
			'plus'      => '<path d="M12 5v14M5 12h14"/>',
			'bell'      => '<path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
			'send'      => '<path d="M20 4 3.5 10.5l6.4 2.6 2.6 6.4z"/><path d="m20 4-10.1 9.1"/>',
			'clip'      => '<path d="M18.5 11.5 12 18a4 4 0 0 1-5.7-5.7l7.2-7.2a2.7 2.7 0 0 1 3.8 3.8l-7.2 7.2a1.4 1.4 0 0 1-2-2l6.6-6.6"/>',
			'back'      => '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
			'forward'   => '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
			'help'      => '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.6A2.4 2.4 0 0 1 14.4 10c0 1.6-2.4 2-2.4 3.6"/><path d="M12 16.8h.01"/>',
			'support'   => '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/><path d="m6 6 3.6 3.6M18 6l-3.6 3.6M6 18l3.6-3.6M18 18l-3.6-3.6"/>',
			'megaphone' => '<path d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H7l6 4V6l-6 4H5.5A1.5 1.5 0 0 0 4 11.5z"/><path d="M17 9.5a4 4 0 0 1 0 5"/>',
			'chat'      => '<path d="M20 13.2A2.8 2.8 0 0 1 17.2 16H11l-3.7 2.4V16h-.5A2.8 2.8 0 0 1 4 13.2V6.8A2.8 2.8 0 0 1 6.8 4h10.4A2.8 2.8 0 0 1 20 6.8z"/>',
		);

		if ( ! isset( $paths[ $name ] ) ) {
			return '';
		}

		return '<svg class="jarchi-ticket-i jarchi-ticket-i--' . esc_attr( $name ) . '" viewBox="0 0 24 24" fill="none"'
			. ' stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'
			. ' aria-hidden="true" focusable="false">' . $paths[ $name ] . '</svg>';
	}

	public function enqueue_front_assets(): void {
		$css = WPEP_PLUGIN_DIR . 'assets/css/tickets.css';
		$js = WPEP_PLUGIN_DIR . 'assets/js/tickets.js';
		if ( is_readable( $css ) ) {
			wp_enqueue_style( 'wpep-tickets', WPEP_PLUGIN_URL . 'assets/css/tickets.css', array(), WPEP_VERSION . '.' . filemtime( $css ) );
		}
		if ( is_readable( $js ) ) {
			wp_enqueue_script( 'wpep-tickets', WPEP_PLUGIN_URL . 'assets/js/tickets.js', array(), WPEP_VERSION . '.' . filemtime( $js ), true );
			wp_localize_script( 'wpep-tickets', 'wpepTickets', array( 'ajaxUrl' => admin_url( 'admin-ajax.php' ), 'nonce' => wp_create_nonce( self::AJAX_NONCE ) ) );
		}
	}

	private function front_script(): string { return ''; }

	public function shortcode_icon(): string {
		return $this->render_icon();
	}

	public function render_icon(): string {
		$this->enqueue_front_assets();
		$count = is_user_logged_in() ? $this->unread_count() : 0;
		$url = $this->ticket_page_url();
		$svg = '<svg class="jarchi-ticket-icon__svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.8A2.8 2.8 0 0 1 6.8 4h10.4A2.8 2.8 0 0 1 20 6.8v7.4a2.8 2.8 0 0 1-2.8 2.8H11l-3.7 2.4v-2.4H6.8A2.8 2.8 0 0 1 4 14.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 9h8M8 12h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
		return '<a class="jarchi-ticket-icon" href="' . esc_url( $url ) . '#jarchi-tickets" data-jarchi-ticket-icon aria-label="' . esc_attr__( 'تیکت‌های من', 'wp-event-publisher' ) . '">' . $svg . '<span class="jarchi-ticket-icon__badge' . ( $count ? ' is-visible' : '' ) . '" data-jarchi-ticket-badge>' . esc_html( (string) min( 99, $count ) ) . '</span></a>';
	}

	public function register_elementor_widgets( $widgets_manager ): void {
		if ( ! class_exists( '\Elementor\Widget_Base' ) || ! is_object( $widgets_manager ) || ! method_exists( $widgets_manager, 'register' ) ) {
			return;
		}
		$ticket_css = WPEP_PLUGIN_DIR . 'assets/css/tickets.css';
		if ( is_readable( $ticket_css ) ) { wp_register_style( 'wpep-tickets', WPEP_PLUGIN_URL . 'assets/css/tickets.css', array(), WPEP_VERSION . '.' . filemtime( $ticket_css ) ); }
		$widgets_manager->register( new TicketIconElementorWidget() );
		if ( class_exists( '\WPEventPublisher\TicketCenterElementorWidget' ) ) {
			$widgets_manager->register( new TicketCenterElementorWidget() );
		}
	}
}
