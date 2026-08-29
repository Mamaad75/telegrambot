<?php
/**
 * Jarchi ticket regression test.
 *
 * Departments, categories, agents and their scoping; the admin composer; the
 * reply policy; and the unread badge — the last of which is checked in the
 * order a real page renders it, because the reported defect was an ordering
 * bug rather than a wrong count.
 *
 * @package WPEventPublisherAudit
 */

require __DIR__ . '/boot.php';

use WPEventPublisher\Admin;
use WPEventPublisher\Tickets;

do_action( 'admin_menu' );

$tickets = wpep()->tickets();

/**
 * Term names in one taxonomy.
 *
 * @param string $taxonomy Taxonomy.
 *
 * @return string[] Names.
 */
function wpep_term_names( string $taxonomy ): array {
	$out = array();

	foreach ( get_terms( array( 'taxonomy' => $taxonomy, 'hide_empty' => false ) ) as $term ) {
		$out[] = $term->name;
	}

	sort( $out );

	return $out;
}

/**
 * Runs one admin screen with a POST payload.
 *
 * @param string              $method Tickets method.
 * @param array<string,mixed> $post   Payload.
 *
 * @return string Rendered HTML.
 */
function wpep_screen( string $method, array $post = array() ): string {
	$_POST             = $post;
	$_POST['_wpnonce'] = 'valid';
	$_GET              = array();
	$_REQUEST          = $_POST;

	ob_start();

	try {
		wpep()->tickets()->{$method}();
	} catch ( \Throwable $e ) {
		ob_end_clean();

		return 'THREW: ' . $e->getMessage();
	}

	return (string) ob_get_clean();
}

/**
 * Tickets owned by one user.
 *
 * @param int $user_id Owner.
 *
 * @return array<int,\WP_Post> Tickets.
 */
function wpep_owned( int $user_id ): array {
	return array_values(
		array_filter(
			$GLOBALS['posts'],
			static fn( $p ) => Tickets::POST_TYPE === $p->post_type && (int) $p->post_author === $user_id
		)
	);
}

/* =====================================================================
 * 1. The store is real.
 * ================================================================== */

$probe = wp_insert_term( 'PROBE', Tickets::TAXONOMY );

check( 'wp_insert_term returns an id', is_array( $probe ) && ( $probe['term_id'] ?? 0 ) > 0 );
check( 'an inserted term is listed', in_array( 'PROBE', wpep_term_names( Tickets::TAXONOMY ), true ) );

wp_delete_term( (int) $probe['term_id'], Tickets::TAXONOMY );

check( 'a deleted term is gone', ! in_array( 'PROBE', wpep_term_names( Tickets::TAXONOMY ), true ) );

/* =====================================================================
 * 2. THE REPORTED DEFECT: deleting the last term must stick.
 *
 * The starter department and category were seeded from
 * register_content_types(), which runs on every `init`. Deleting the last one
 * therefore succeeded and was undone by the very next page load — which from
 * the administrator's side is a delete button that does nothing.
 * ================================================================== */

wpep_screen( 'render_departments', array( 'jarchi_department_save' => '1', 'name' => 'فنی' ) );
wpep_screen( 'render_departments', array( 'jarchi_department_save' => '1', 'name' => 'فروش' ) );

$departments = wpep_term_names( Tickets::TAXONOMY );

check( 'a department can be created', in_array( 'فنی', $departments, true ) && in_array( 'فروش', $departments, true ), implode( ', ', $departments ) );

$sales = term_exists( 'فروش', Tickets::TAXONOMY );

wpep_screen( 'render_departments', array( 'jarchi_department_delete' => '1', 'term_id' => (string) $sales['term_id'] ) );

check( 'a department can be deleted', ! in_array( 'فروش', wpep_term_names( Tickets::TAXONOMY ), true ), implode( ', ', wpep_term_names( Tickets::TAXONOMY ) ) );
check( 'the department screen offers a delete control', str_contains( wpep_screen( 'render_departments' ), 'jarchi_department_delete' ) );

foreach ( array( Tickets::TAXONOMY => 'jarchi_department', Tickets::CATEGORY => 'jarchi_category' ) as $wpep_tax => $wpep_prefix ) {
	$screen = Tickets::TAXONOMY === $wpep_tax ? 'render_departments' : 'render_categories';

	foreach ( get_terms( array( 'taxonomy' => $wpep_tax, 'hide_empty' => false ) ) as $term ) {
		wpep_screen( $screen, array( $wpep_prefix . '_delete' => '1', 'term_id' => (string) $term->term_id ) );
	}

	check( "every {$wpep_tax} term can be deleted", array() === wpep_term_names( $wpep_tax ), implode( ', ', wpep_term_names( $wpep_tax ) ) );

	// The next request. This is the step that used to put the term back.
	do_action( 'init' );

	check( "a deleted {$wpep_tax} term stays deleted on the next request", array() === wpep_term_names( $wpep_tax ), implode( ', ', wpep_term_names( $wpep_tax ) ) );
}

wpep_screen( 'render_departments', array( 'jarchi_department_save' => '1', 'name' => 'فنی' ) );
wpep_screen( 'render_departments', array( 'jarchi_department_save' => '1', 'name' => 'فروش' ) );
wpep_screen( 'render_categories', array( 'jarchi_category_save' => '1', 'name' => 'عمومی' ) );

check( 'the category screen offers a delete control', str_contains( wpep_screen( 'render_categories' ), 'jarchi_category_delete' ) );

/* =====================================================================
 * 3. Agents, and the departments they answer for.
 * ================================================================== */

$tech  = term_exists( 'فنی', Tickets::TAXONOMY );
$sales = term_exists( 'فروش', Tickets::TAXONOMY );

$GLOBALS['users_store']['50'] = new WP_User_Stub( 50, 'agent-tech' );

wpep_screen( 'render_agents', array( 'jarchi_add_agent' => '1', 'user_id' => '50', 'departments' => array( (string) $tech['term_id'] ) ) );

check( 'a user can be made an agent', in_array( 'jarchi_support_agent', (array) $GLOBALS['users_store']['50']->roles, true ) );
check( 'and bound to a department', array( (int) $tech['term_id'] ) === $tickets->agent_departments( 50 ), implode( ',', $tickets->agent_departments( 50 ) ) );

wpep_screen( 'render_agents', array( 'jarchi_agent_departments' => '1', 'user_id' => '50', 'departments' => array( (string) $sales['term_id'] ) ) );

check( 'reassignment replaces rather than accumulates', array( (int) $sales['term_id'] ) === $tickets->agent_departments( 50 ), implode( ',', $tickets->agent_departments( 50 ) ) );

// An id that is not a department must never reach the database.
wpep_screen( 'render_agents', array( 'jarchi_agent_departments' => '1', 'user_id' => '50', 'departments' => array( '999999', (string) $tech['term_id'] ) ) );

$raw = (array) get_user_meta( 50, Tickets::META_AGENT_DEPARTMENTS, true );

check( 'a non-existent department is never written', array( (int) $tech['term_id'] ) === array_map( 'intval', $raw ), implode( ',', $raw ) );

// And one deleted afterwards drops out on read.
$temp = wp_insert_term( 'موقت', Tickets::TAXONOMY );
$tickets->set_agent_departments( 50, array( (int) $tech['term_id'], (int) $temp['term_id'] ) );
wp_delete_term( (int) $temp['term_id'], Tickets::TAXONOMY );

check( 'a deleted department drops out of the assignment', array( (int) $tech['term_id'] ) === $tickets->agent_departments( 50 ), implode( ',', $tickets->agent_departments( 50 ) ) );

/* --- Scoping. ----------------------------------------------------------- */

$GLOBALS['posts'][8501] = new WP_Post( array( 'ID' => 8501, 'post_type' => Tickets::POST_TYPE, 'post_title' => 'تیکت فنی' ) );
$GLOBALS['posts'][8502] = new WP_Post( array( 'ID' => 8502, 'post_type' => Tickets::POST_TYPE, 'post_title' => 'تیکت فروش' ) );

wp_set_object_terms( 8501, array( (int) $tech['term_id'] ), Tickets::TAXONOMY );
wp_set_object_terms( 8502, array( (int) $sales['term_id'] ), Tickets::TAXONOMY );

/**
 * Runs a callback as a scoped support agent.
 *
 * @param int      $user_id Agent.
 * @param callable $fn      Callback.
 *
 * @return mixed Result.
 */
function wpep_as_agent( int $user_id, callable $fn ) {
	$GLOBALS['user_can']           = false;
	$GLOBALS['current_user_id']    = $user_id;
	$GLOBALS['user_caps_override'] = array( 'jarchi_support_tickets' => true );

	try {
		return $fn();
	} finally {
		unset( $GLOBALS['user_can'], $GLOBALS['user_caps_override'], $GLOBALS['current_user_id'] );
	}
}

$tickets->set_agent_departments( 50, array( (int) $tech['term_id'] ) );

check( 'an agent may open a ticket in their department', wpep_as_agent( 50, static fn() => wpep()->tickets()->viewer_can_see_ticket( 8501 ) ) );
check( 'and may not open one in another', ! wpep_as_agent( 50, static fn() => wpep()->tickets()->viewer_can_see_ticket( 8502 ) ) );

$tickets->set_agent_departments( 50, array() );

check( 'an agent with no departments sees nothing, not everything', ! wpep_as_agent( 50, static fn() => wpep()->tickets()->viewer_can_see_ticket( 8501 ) ) );

check( 'an administrator is never scoped', null === $tickets->viewer_department_scope() );
check( 'and sees every ticket', $tickets->viewer_can_see_ticket( 8501 ) && $tickets->viewer_can_see_ticket( 8502 ) );

// The restriction must be a query constraint, not a display filter.
$source = (string) file_get_contents( $GLOBALS['wpep_root'] . 'includes/class-tickets.php' );

preg_match( '/public function render_admin\(\): void \{.*?\n\t\}/s', $source, $m );

check( 'the list applies the scope to the query', str_contains( $m[0] ?? '', '$viewer_scope' ) && str_contains( $m[0] ?? '', 'tax_query' ) );

preg_match( '/private function render_admin_ticket\( int \$ticket_id \): void \{.*?\n\t\}/s', $source, $m );

check( 'the single-ticket screen re-checks access', str_contains( $m[0] ?? '', 'viewer_can_see_ticket' ) );

/* --- Staff actions, not just staff screens. ----------------------------- */

/**
 * Runs an admin_post handler and reports how it ended.
 *
 * @param string              $method Tickets method.
 * @param array<string,mixed> $post   Payload.
 *
 * @return string 'redirect', or the wp_die message.
 */
function wpep_action( string $method, array $post ): string {
	$_POST             = $post;
	$_POST['_wpnonce'] = 'valid';
	$_REQUEST          = $_POST;

	ob_start();

	try {
		wpep()->tickets()->{$method}();
	} catch ( \Throwable $e ) {
		ob_end_clean();

		// The harness ends a redirect by throwing, so "it redirected" and "it
		// refused" both arrive here and only the message tells them apart.
		return str_starts_with( $e->getMessage(), 'redirect:' ) ? 'redirect' : $e->getMessage();
	}

	ob_end_clean();

	return 'redirect';
}

$tickets->set_agent_departments( 50, array( (int) $tech['term_id'] ) );

/*
 * A staff action names its ticket in a form field, so the id is whatever the
 * request said. Screens were checked; the handlers behind them were not, and
 * an id pointing at an ordinary post had Jarchi's status meta written onto it.
 */
$GLOBALS['posts'][8599] = new WP_Post( array( 'ID' => 8599, 'post_type' => 'page', 'post_title' => 'یک برگه' ) );

$wpep_status_page = wpep_action( 'handle_status', array( 'ticket_id' => '8599', 'status' => 'closed' ) );

check(
	'changing the status of something that is not a ticket is refused',
	'redirect' !== $wpep_status_page && '' === (string) get_post_meta( 8599, '_jarchi_ticket_status', true ),
	$wpep_status_page . ' / meta=' . (string) get_post_meta( 8599, '_jarchi_ticket_status', true )
);

check(
	'an administrator may still change a real ticket',
	'redirect' === wpep_action( 'handle_status', array( 'ticket_id' => '8501', 'status' => 'closed' ) )
	&& 'closed' === $tickets->status( 8501 )
);

// A scoped agent reaching past their departments, via the handler rather than
// the screen.
$wpep_agent_other = wpep_as_agent( 50, static fn() => wpep_action( 'handle_status', array( 'ticket_id' => '8502', 'status' => 'closed' ) ) );

check(
	'an agent may not change a ticket outside their departments',
	'redirect' !== $wpep_agent_other && 'closed' !== $tickets->status( 8502 ),
	$wpep_agent_other . ' / ' . $tickets->status( 8502 )
);

$wpep_agent_own = wpep_as_agent( 50, static fn() => wpep_action( 'handle_status', array( 'ticket_id' => '8501', 'status' => 'answered' ) ) );

check(
	'and may change one inside them',
	'redirect' === $wpep_agent_own && 'answered' === $tickets->status( 8501 ),
	$wpep_agent_own . ' / ' . $tickets->status( 8501 )
);

// Assignment stays an administrator's decision either way.
$wpep_agent_assign = wpep_as_agent( 50, static fn() => wpep_action( 'handle_assign_agent', array( 'ticket_id' => '8501', 'agent' => '50' ) ) );

check( 'an agent may not reassign tickets', 'redirect' !== $wpep_agent_assign, $wpep_agent_assign );

check(
	'assigning against a non-ticket id is refused',
	'redirect' !== wpep_action( 'handle_assign_agent', array( 'ticket_id' => '8599', 'agent' => '50' ) )
	&& '' === (string) get_post_meta( 8599, '_jarchi_ticket_agent', true )
);

// And the reply the agent is there to write. The owner is a user of its own:
// giving these fixtures to a customer the composer tests inspect would put an
// attachment-free ticket at the front of that customer's list.
$GLOBALS['users_store']['80'] = new WP_User_Stub( 80, 'scoped-customer' );
$GLOBALS['posts'][8501]->post_author = 80;

$wpep_agent_reply = wpep_as_agent(
	50,
	static fn() => wpep_action( 'handle_reply', array( 'ticket_id' => '8501', 'message' => 'پاسخ پشتیبان' ) )
);

check( 'an agent may answer a ticket in their department', 'redirect' === $wpep_agent_reply, $wpep_agent_reply );

check(
	'and the answer is recorded as coming from support',
	'answered' === $tickets->status( 8501 ),
	$tickets->status( 8501 )
);

$GLOBALS['posts'][8502]->post_author = 80;

$wpep_agent_reply_other = wpep_as_agent(
	50,
	static fn() => wpep_action( 'handle_reply', array( 'ticket_id' => '8502', 'message' => 'نباید بنویسد' ) )
);

check( 'but not one in another department', 'redirect' !== $wpep_agent_reply_other, $wpep_agent_reply_other );

$GLOBALS['current_user_id'] = 1;

/* =====================================================================
 * 4. The composer: one recipient, everybody, attachments, reply policy.
 * ================================================================== */

/**
 * Runs the admin composer.
 *
 * @param array<string,mixed> $post  Payload.
 * @param array<string,mixed> $files The $_FILES payload.
 *
 * @return string Redirect target or failure.
 */
function wpep_compose( array $post, array $files = array() ): string {
	$_POST             = $post;
	$_POST['_wpnonce'] = 'valid';
	$_REQUEST          = $_POST;
	$_FILES            = $files;

	try {
		wpep()->tickets()->handle_admin_create();
	} catch ( \Throwable $e ) {
		$_FILES = array();

		return $e->getMessage();
	}

	$_FILES = array();

	return '';
}

$GLOBALS['users_store']['60'] = new WP_User_Stub( 60, 'customer-a' );
$GLOBALS['users_store']['61'] = new WP_User_Stub( 61, 'customer-b' );

wpep_compose(
	array( 'audience' => 'single', 'customer_id' => '60', 'title' => 'سلام', 'message' => 'متن', 'priority' => 'high' )
);

$made = wpep_owned( 60 );

check( 'a ticket is created for the chosen user', 1 === count( $made ), (string) count( $made ) );
check( 'nobody else receives it', 0 === count( wpep_owned( 61 ) ) );

$one = end( $made );

check( 'an admin ticket without replies is closed', 'closed' === $tickets->status( (int) $one->ID ), $tickets->status( (int) $one->ID ) );
check( 'and refuses replies', ! $tickets->replies_allowed( (int) $one->ID ) );
check( 'and records no first-response time', '' === (string) get_post_meta( (int) $one->ID, '_jarchi_ticket_first_response_at', true ) );

// With replies invited it is an open conversation instead.
wpep_compose(
	array( 'audience' => 'single', 'customer_id' => '61', 'title' => 'سؤال', 'message' => 'متن', 'allow_reply' => '1' )
);

$open = wpep_owned( 61 );
$open = end( $open );

check( 'an admin ticket that invites replies stays open', 'closed' !== $tickets->status( (int) $open->ID ), $tickets->status( (int) $open->ID ) );
check( 'and accepts replies', $tickets->replies_allowed( (int) $open->ID ) );

/* --- Attachments. ------------------------------------------------------- */

$wpep_upload_dir = sys_get_temp_dir() . '/wpep-uploads-' . getmypid();

if ( ! is_dir( $wpep_upload_dir ) ) { mkdir( $wpep_upload_dir, 0700, true ); }

/**
 * Writes a fixture with real contents and registers it as a genuine upload.
 *
 * The contents matter: the plugin reads the file's signature rather than the
 * name or the browser's Content-Type, so a fixture that is only a name would
 * test nothing.
 *
 * @param string $name  Filename as the browser sent it.
 * @param string $bytes File contents.
 * @param bool   $real  Whether to register it as a POSTed upload.
 *
 * @return string Path on disk.
 */
function wpep_fixture( string $name, string $bytes, bool $real = true ): string {
	global $wpep_upload_dir;

	$path = $wpep_upload_dir . '/' . md5( $name . $bytes ) . '-' . $name;

	file_put_contents( $path, $bytes );

	if ( $real ) { $GLOBALS['uploaded_files'][] = $path; }

	return $path;
}

$wpep_png = wpep_fixture( 'photo.png', "\x89PNG\r\n\x1a\n" . str_repeat( 'x', 200 ) );
$wpep_pdf = wpep_fixture( 'notes.pdf', '%PDF-1.4' . str_repeat( 'y', 200 ) );

$GLOBALS['users_store']['62'] = new WP_User_Stub( 62, 'customer-c' );

wpep_compose(
	array( 'audience' => 'single', 'customer_id' => '62', 'title' => 'با ضمیمه', 'message' => 'فایل پیوست است' ),
	array(
		'attachments' => array(
			'name'     => array( 'photo.png', 'notes.pdf' ),
			'type'     => array( 'image/png', 'application/pdf' ),
			'tmp_name' => array( $wpep_png, $wpep_pdf ),
			'error'    => array( 0, 0 ),
			'size'     => array( 208, 208 ),
		),
	)
);

$with_files  = wpep_owned( 62 );
// Not $attachments: at global scope that name is $GLOBALS['attachments'], the
// harness's media library, and assigning to it wiped every stored upload.
$wpep_stored = $with_files ? $tickets->ticket_attachments( (int) $with_files[0]->ID ) : array();

check( 'attachments are stored on the ticket', 2 === count( $wpep_stored ), (string) count( $wpep_stored ) );
check( 'an image is recognised as one', ( $wpep_stored[0]['is_image'] ?? false ) && ! ( $wpep_stored[1]['is_image'] ?? true ) );

$GLOBALS['users_store']['63'] = new WP_User_Stub( 63, 'customer-d' );

wpep_compose(
	array( 'audience' => 'single', 'customer_id' => '63', 'title' => 'فایل غیرمجاز', 'message' => 'تلاش' ),
	array(
		'attachments' => array(
			'name'     => array( 'payload.php' ),
			'type'     => array( 'application/x-php' ),
			'tmp_name' => array( wpep_fixture( 'payload.php', '<?php echo 1;' ) ),
			'error'    => array( 0 ),
			'size'     => array( 13 ),
		),
	)
);

$refused = wpep_owned( 63 );

check( 'a disallowed file type is not attached', $refused && array() === $tickets->ticket_attachments( (int) $refused[0]->ID ) );
check( 'and the ticket is still created', 1 === count( $refused ) );

/*
 * The interesting case is not the one that admits what it is. A script named
 * .png passes any check built on the filename, and passes any check built on
 * the browser's Content-Type because the uploader writes that too.
 */
$GLOBALS['users_store']['64'] = new WP_User_Stub( 64, 'customer-e' );

wpep_compose(
	array( 'audience' => 'single', 'customer_id' => '64', 'title' => 'اسکریپت با نام تصویر', 'message' => 'تلاش' ),
	array(
		'attachments' => array(
			'name'     => array( 'innocent.png' ),
			'type'     => array( 'image/png' ),
			'tmp_name' => array( wpep_fixture( 'innocent.png', '<?php system( $_GET["c"] );' ) ),
			'error'    => array( 0 ),
			'size'     => array( 27 ),
		),
	)
);

$wpep_disguised = wpep_owned( 64 );

check(
	'a script renamed to .png is refused on its contents',
	$wpep_disguised && array() === $tickets->ticket_attachments( (int) $wpep_disguised[0]->ID )
);

/* A path the request never uploaded must not be copyable into the library. */
$GLOBALS['users_store']['65'] = new WP_User_Stub( 65, 'customer-f' );

wpep_compose(
	array( 'audience' => 'single', 'customer_id' => '65', 'title' => 'مسیر جعلی', 'message' => 'تلاش' ),
	array(
		'attachments' => array(
			'name'     => array( 'stolen.png' ),
			'type'     => array( 'image/png' ),
			'tmp_name' => array( wpep_fixture( 'stolen.png', "\x89PNG\r\n\x1a\n" . str_repeat( 'z', 100 ), false ) ),
			'error'    => array( 0 ),
			'size'     => array( 108 ),
		),
	)
);

$wpep_stolen = wpep_owned( 65 );

check(
	'a path that was never uploaded is refused',
	$wpep_stolen && array() === $tickets->ticket_attachments( (int) $wpep_stolen[0]->ID )
);

/* Size is enforced by the server, not by whatever the form claimed. */
$GLOBALS['users_store']['66'] = new WP_User_Stub( 66, 'customer-g' );

$wpep_policy = $tickets->attachment_policy();

wpep_compose(
	array( 'audience' => 'single', 'customer_id' => '66', 'title' => 'فایل بزرگ', 'message' => 'تلاش' ),
	array(
		'attachments' => array(
			'name'     => array( 'huge.png' ),
			'type'     => array( 'image/png' ),
			'tmp_name' => array( wpep_fixture( 'huge.png', "\x89PNG\r\n\x1a\n" . str_repeat( 'q', 50 ) ) ),
			'error'    => array( 0 ),
			'size'     => array( (int) $wpep_policy['max_bytes'] + 1 ),
		),
	)
);

$wpep_big = wpep_owned( 66 );

check(
	'a file over the size limit is refused',
	$wpep_big && array() === $tickets->ticket_attachments( (int) $wpep_big[0]->ID )
);

/* The cap counts what was accepted, not how many times the loop ran. */
$GLOBALS['users_store']['67'] = new WP_User_Stub( 67, 'customer-h' );

$wpep_many = array( 'name' => array(), 'type' => array(), 'tmp_name' => array(), 'error' => array(), 'size' => array() );

for ( $wpep_i = 0; $wpep_i < (int) $wpep_policy['max_files'] + 3; $wpep_i++ ) {
	$wpep_many['name'][]     = 'many-' . $wpep_i . '.png';
	$wpep_many['type'][]     = 'image/png';
	$wpep_many['tmp_name'][] = wpep_fixture( 'many-' . $wpep_i . '.png', "\x89PNG\r\n\x1a\n" . str_repeat( (string) $wpep_i, 40 ) );
	$wpep_many['error'][]    = 0;
	$wpep_many['size'][]     = 48;
}

wpep_compose(
	array( 'audience' => 'single', 'customer_id' => '67', 'title' => 'فایل زیاد', 'message' => 'تلاش' ),
	array( 'attachments' => $wpep_many )
);

$wpep_capped = wpep_owned( 67 );

check(
	'no more than the policy allows is stored — ' . (int) $wpep_policy['max_files'],
	$wpep_capped && count( $tickets->ticket_attachments( (int) $wpep_capped[0]->ID ) ) === (int) $wpep_policy['max_files'],
	$wpep_capped ? (string) count( $tickets->ticket_attachments( (int) $wpep_capped[0]->ID ) ) : 'no ticket'
);

/* The form promises the same two numbers the server enforces. */
$wpep_form = $tickets->render_center();

check(
	'the upload note quotes the enforced limits',
	str_contains( $wpep_form, 'حداکثر ' . $wpep_policy['max_files'] . ' فایل' )
	&& str_contains( $wpep_form, 'تا ' . (int) round( $wpep_policy['max_bytes'] / MB_IN_BYTES ) . ' مگابایت' )
);

/* Deleting the ticket takes its uploads with it. */
$wpep_owner_ticket = (int) $with_files[0]->ID;
$wpep_before       = count( $tickets->ticket_attachments( $wpep_owner_ticket ) );

$tickets->delete_ticket_attachments( $wpep_owner_ticket );

check(
	'deleting a ticket removes its uploads — ' . $wpep_before . ' before',
	2 === $wpep_before && array() === $tickets->ticket_attachments( $wpep_owner_ticket )
);

/* --- Broadcast. --------------------------------------------------------- */

foreach ( range( 70, 114 ) as $wpep_id ) {
	$GLOBALS['users_store'][ (string) $wpep_id ] = new WP_User_Stub( $wpep_id, 'bulk-' . $wpep_id );
}

$audience = count( get_users( array( 'fields' => 'ID' ) ) );

wpep_compose( array( 'audience' => 'all', 'title' => 'اطلاعیه همگانی', 'message' => 'متن همگانی' ) );

$progress = $tickets->broadcast_progress();

check( 'a broadcast larger than a batch does not finish in the request', $progress['running'], sprintf( 'sent=%d total=%d', $progress['sent'], $progress['total'] ) );
check( 'the first batch is bounded', $progress['sent'] === Tickets::BROADCAST_BATCH, (string) $progress['sent'] );
check( 'every user is queued', $progress['total'] === $audience, sprintf( '%d vs %d', $progress['total'], $audience ) );
check( 'a continuation is booked on cron', false !== wp_next_scheduled( 'jarchi_ticket_broadcast' ) );

$guard = 0;

while ( false !== wp_next_scheduled( 'jarchi_ticket_broadcast' ) && $guard < 50 ) {
	wp_clear_scheduled_hook( 'jarchi_ticket_broadcast' );
	do_action( 'jarchi_ticket_broadcast' );
	++$guard;
}

check( 'the broadcast rebooks itself until done', $guard > 1, 'cron runs: ' . $guard );

// Counted from the tickets that exist, not the progress option — that option
// is deleted on completion, so reading it back would report zeros and call
// that success.
$missed = array();

foreach ( get_users( array( 'fields' => 'ID' ) ) as $wpep_recipient ) {
	$has = false;

	foreach ( wpep_owned( (int) $wpep_recipient ) as $wpep_ticket ) {
		if ( '1' === (string) get_post_meta( (int) $wpep_ticket->ID, '_jarchi_ticket_broadcast', true ) ) {
			$has = true;
			break;
		}
	}

	if ( ! $has ) {
		$missed[] = (int) $wpep_recipient;
	}
}

check( 'every recipient actually got one', empty( $missed ), 'missed: ' . implode( ', ', array_slice( $missed, 0, 8 ) ) );

/* =====================================================================
 * 5. The reply gate is a rule, not a hidden button.
 * ================================================================== */

$locked = wpep_owned( 60 );
$locked = (int) end( $locked )->ID;

$GLOBALS['current_user_id']    = 60;
$GLOBALS['user_can']           = false;
$GLOBALS['user_caps_override'] = array();

$_POST    = array( 'ticket_id' => (string) $locked, 'message' => 'می‌خواهم جواب بدهم', '_wpnonce' => 'valid' );
$_REQUEST = $_POST;

$refused_reply = '';

try {
	$tickets->handle_reply();
} catch ( \Throwable $e ) {
	$refused_reply = $e->getMessage();
}

check( 'replaying the form on a one-way thread is refused', str_contains( $refused_reply, 'اطلاعیه' ) || str_contains( $refused_reply, 'بسته' ), $refused_reply );

$before_messages = count( $tickets->messages( $locked ) );

check( 'and no message was stored', 1 === $before_messages, (string) $before_messages );

unset( $GLOBALS['current_user_id'], $GLOBALS['user_can'], $GLOBALS['user_caps_override'] );

/* =====================================================================
 * 6. The unread badge.
 *
 * The reported symptom was the badge surviving a read, and the cause was
 * ordering: the header printed the count before the thread cleared the flag.
 * ================================================================== */

$GLOBALS['users_store']['200'] = new WP_User_Stub( 200, 'reader' );

$ticket_id = (int) $tickets->create_local_automated_ticket( 200, 'یک اطلاعیه', 'متن اطلاعیه' );

$GLOBALS['current_user_id'] = 200;

check( 'a new ticket counts as unread', 1 === $tickets->unread_count( 200 ), (string) $tickets->unread_count( 200 ) );

// Render the centre the way a request does, with the ticket selected.
$_GET = array( 'jarchi_ticket' => (string) $ticket_id );

$html = $tickets->render_center();

check( 'opening the ticket clears the flag', '' === (string) get_post_meta( $ticket_id, '_jarchi_ticket_user_unread', true ) );
check( 'and the count on that same page is already zero', 0 === $tickets->unread_count( 200 ), (string) $tickets->unread_count( 200 ) );

// The number printed into the page must agree, which is the actual complaint.
preg_match( '/data-jarchi-ticket-unread[^>]*>(\d+)</', $html, $printed );

check( 'the number printed on the page is zero too', '0' === ( $printed[1] ?? '?' ), $printed[1] ?? 'not found' );

// A later reply brings it back.
$tickets->mark_unread_for_user( $ticket_id );

check( 'a new reply makes it unread again', 1 === $tickets->unread_count( 200 ), (string) $tickets->unread_count( 200 ) );

// The cached count must not outlive the change that invalidates it.
$tickets->mark_read_for_user( $ticket_id );

check( 'the cache does not keep a stale count', 0 === $tickets->unread_count( 200 ), (string) $tickets->unread_count( 200 ) );

unset( $GLOBALS['current_user_id'] );

/* --- The badge polls cheaply. ------------------------------------------- */

$before_queries = count( $GLOBALS['wpdb']->queries );

$tickets->unread_count( 200 );
$tickets->unread_count( 200 );
$tickets->unread_count( 200 );

check( 'repeated polls do not hit the database every time', count( $GLOBALS['wpdb']->queries ) - $before_queries <= 1, (string) ( count( $GLOBALS['wpdb']->queries ) - $before_queries ) );

$js = (string) file_get_contents( $GLOBALS['wpep_root'] . 'assets/js/tickets.js' );

check( 'the badge refreshes every ten seconds', str_contains( $js, 'ACTIVE_INTERVAL = 10000' ) );
check( 'and stops while the tab is hidden', str_contains( $js, 'document.hidden' ) );

/* =====================================================================
 * 7. The mobile layout exists at all.
 * ================================================================== */

$css = (string) file_get_contents( $GLOBALS['wpep_root'] . 'assets/css/tickets.css' );

check( 'the ticket centre has a mobile breakpoint', (bool) preg_match( '/@media\s*\(\s*max-width:\s*860px\s*\)/', $css ) );
check( 'the list steps aside for an open thread on a phone', str_contains( $css, '.jarchi-ticket-layout.has-open-thread .jarchi-ticket-list' ) );
check( 'and there is a way back to the list', str_contains( $css, '.jarchi-ticket-back-link' ) );

/* =====================================================================
 * 8. Notifications actually leave the site.
 * ================================================================== */

$GLOBALS['sent_mail'] = array();
$GLOBALS['users_store']['201'] = new WP_User_Stub( 201, 'mailed', 'mailed@example.test' );

$tickets->create_local_automated_ticket( 201, 'اطلاعیه', 'متن اطلاعیه' );

check( 'the customer is emailed about a new ticket', count( $GLOBALS['sent_mail'] ) >= 1, (string) count( $GLOBALS['sent_mail'] ) );

$mail = end( $GLOBALS['sent_mail'] );

check( 'the email goes to the customer', 'mailed@example.test' === $mail['to'] );
check( 'a site-initiated message is not called a reply', ! str_contains( (string) $mail['subject'], 'پاسخ جدید' ), (string) $mail['subject'] );
check( 'and a one-way message says no reply is needed', str_contains( (string) $mail['message'], 'نیازی به پاسخ ندارد' ), (string) $mail['message'] );

// Web push must not be fire-and-forget, or dead subscriptions are never pruned.
$push = (string) file_get_contents( $GLOBALS['wpep_root'] . 'includes/class-ticket-notifications.php' );

preg_match( '/private function send_push.*?\n\t\}/s', $push, $m );

check( 'push requests read their response code', ! str_contains( $m[0] ?? '', "'blocking' => false" ), 'blocking:false makes the 404/410 prune unreachable' );

// Support has to hear about customer activity.
check( 'the support side is notified of new tickets', str_contains( $source, 'notify_support' ) );

preg_match( '/public function handle_submit\(\): void \{.*?\n\t\}/s', $source, $m );

check( 'a customer-opened ticket notifies support', str_contains( $m[0] ?? '', 'notify_support' ) );

wpep_report( 'TICKET' );
