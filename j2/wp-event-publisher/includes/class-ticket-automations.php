<?php
/**
 * Automatic ticket rules.
 *
 * A rule is one sentence: when EVENT happens, and CONDITION holds, send the
 * customer this ticket. Everything in this file exists to keep that sentence
 * true, and to keep it from ever running away.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Event-driven support tickets.
 *
 * WHY THE GUARDS BELOW EXIST
 * --------------------------
 * A ticket is a post. Creating one therefore fires `transition_post_status`,
 * which is the very hook the "advert published" rule listens on — so without a
 * guard the rule's own output re-triggers it, and the loop only stops when PHP
 * runs out of time. In production that sent one customer hundreds of tickets
 * and killed the request that was trying to publish their advert.
 *
 * Three independent guards close that off, because one is a single point of
 * failure for a bug whose symptom is unbounded:
 *
 *   1. Post types the plugin owns never trigger anything (a ticket is not an
 *      advert, so it can never look like one).
 *   2. A rule only fires for the post type it was configured for.
 *   3. A re-entrancy flag plus a per-request ceiling, so even an unforeseen
 *      path cannot recurse or flood.
 *
 * @since 1.9.0
 */
final class TicketAutomations {

	public const OPTION = 'wpep_ticket_automations';
	public const PAGE   = 'wp-event-publisher-ticket-automations';
	private const NONCE = 'wpep_ticket_automation';

	/**
	 * The most tickets automations may create while serving one request.
	 *
	 * A backstop, not a business rule. Normal operation creates one or two; a
	 * number this size can only be reached by a defect, and stopping at twenty
	 * turns "the customer got 500 tickets and their advert never saved" into a
	 * logged anomaly nobody notices.
	 *
	 * @var int
	 */
	private const MAX_PER_REQUEST = 20;

	/**
	 * True while a ticket is being created, so nothing re-enters.
	 *
	 * @var bool
	 */
	private static bool $creating = false;

	/**
	 * Tickets created by automations during this request.
	 *
	 * @var int
	 */
	private static int $created = 0;

	/**
	 * Registers the hooks.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public function register(): void {
		add_action( 'admin_post_wpep_ticket_automation_save', array( $this, 'save' ) );
		add_action( 'admin_post_wpep_ticket_automation_delete', array( $this, 'delete' ) );
		add_action( 'admin_post_wpep_ticket_automation_run', array( $this, 'run_manual' ) );
		add_action( 'admin_post_wpep_ticket_automation_preset', array( $this, 'apply_preset' ) );
		add_action( 'admin_post_wpep_ticket_automation_toggle', array( $this, 'toggle' ) );
		add_action( 'admin_post_wpep_ticket_automation_dry_run', array( $this, 'handle_dry_run' ) );

		add_action( 'user_register', array( $this, 'on_user_register' ), 20 );
		add_action( 'wp_login', array( $this, 'on_first_login' ), 20, 2 );
		add_action( 'transition_post_status', array( $this, 'on_post_status' ), 20, 3 );
		add_action( 'wp_insert_comment', array( $this, 'on_comment_inserted' ), 20, 2 );
		add_action( 'jarchi_automation_event', array( $this, 'on_custom_event' ), 20, 3 );

		// WooCommerce. Both hooks are no-ops when WooCommerce is absent.
		add_action( 'woocommerce_checkout_order_processed', array( $this, 'on_order_created' ), 20 );
		add_action( 'woocommerce_order_status_changed', array( $this, 'on_order_status_changed' ), 20, 4 );
		add_action( 'woocommerce_order_status_completed', array( $this, 'on_order_completed' ), 20 );

		add_action( 'jarchi_ticket_automation_scan', array( $this, 'scan_scheduled_rules' ) );
		add_action( 'jarchi_fire_automation_delayed', array( $this, 'fire_delayed' ), 10, 3 );
		add_action( 'init', array( $this, 'schedule' ) );

		register_deactivation_hook( WPEP_PLUGIN_FILE, array( $this, 'unschedule' ) );
	}

	/**
	 * Post types that must never trigger an automation.
	 *
	 * The plugin's own records are the dangerous ones: a ticket is created by
	 * publishing a post, so if tickets could trigger rules the first ticket
	 * would create the second. Revisions and attachments are excluded because
	 * they are bookkeeping, not something a customer did.
	 *
	 * @since 1.9.0
	 *
	 * @return string[] Post type names.
	 */
	public static function ignored_post_types(): array {
		return (array) apply_filters(
			'wpep_automation_ignored_post_types',
			array(
				Tickets::POST_TYPE,
				Announcements::POST_TYPE,
				'attachment',
				'revision',
				'nav_menu_item',
				'customize_changeset',
				'oembed_cache',
				'user_request',
				'wp_block',
				'wp_template',
				'wp_global_styles',
				'shop_order',
				'shop_order_placehold',
				'scheduled-action',
			)
		);
	}

	/**
	 * The events a rule can react to.
	 *
	 * `scope` is the important field. `actor` means the event names the one
	 * person it concerns, and the ticket goes to them alone — which is what an
	 * administrator expects from "when a customer orders something". `scan`
	 * means there is no such person, so the hourly pass examines everybody;
	 * only two events work that way and both say so in their description.
	 *
	 * @since 1.9.0
	 *
	 * @return array<string,array{label:string,hint:string,scope:string,needs:string[]}> Triggers.
	 */
	public function triggers(): array {
		return array(
			'user_register'        => array(
				'label' => __( 'ثبت‌نام کاربر', 'wp-event-publisher' ),
				'hint'  => __( 'همان لحظه که حساب تازه ساخته می‌شود. تیکت فقط برای همان کاربر می‌رود.', 'wp-event-publisher' ),
				'scope' => 'actor',
				'needs' => array(),
			),
			'first_login'          => array(
				'label' => __( 'اولین ورود کاربر', 'wp-event-publisher' ),
				'hint'  => __( 'اولین باری که کاربر وارد حسابش می‌شود. فقط برای همان کاربر.', 'wp-event-publisher' ),
				'scope' => 'actor',
				'needs' => array(),
			),
			'post_published'       => array(
				'label' => __( 'انتشار (تأیید) آگهی', 'wp-event-publisher' ),
				'hint'  => __( 'وقتی محتوایی از نوع انتخاب‌شده منتشر می‌شود. تیکت فقط برای نویسندهٔ همان آگهی می‌رود.', 'wp-event-publisher' ),
				'scope' => 'actor',
				'needs' => array( 'post_type' ),
			),
			'post_unpublished'     => array(
				'label' => __( 'رد یا برگشت آگهی', 'wp-event-publisher' ),
				'hint'  => __( 'وقتی آگهیِ منتشرشده یا در انتظار بررسی، به پیش‌نویس یا زباله‌دان برمی‌گردد. آگهی تازه‌ساخته‌شده حساب نمی‌شود.', 'wp-event-publisher' ),
				'scope' => 'actor',
				'needs' => array( 'post_type' ),
			),
			'order_created'        => array(
				'label' => __( 'ثبت سفارش', 'wp-event-publisher' ),
				'hint'  => __( 'به‌محض ثبت سفارش در ووکامرس، همراه با مشخصات سفارش. فقط برای خریدار.', 'wp-event-publisher' ),
				'scope' => 'actor',
				'needs' => array(),
			),
			'order_status_changed' => array(
				'label' => __( 'تغییر وضعیت سفارش', 'wp-event-publisher' ),
				'hint'  => __( 'هر بار وضعیت سفارش عوض شود (در حال انجام، ارسال‌شده، لغو…). فقط برای خریدار.', 'wp-event-publisher' ),
				'scope' => 'actor',
				'needs' => array( 'order_status' ),
			),
			'order_completed'      => array(
				'label' => __( 'تکمیل سفارش', 'wp-event-publisher' ),
				'hint'  => __( 'وقتی سفارش به وضعیت «تکمیل‌شده» می‌رسد. فقط برای خریدار.', 'wp-event-publisher' ),
				'scope' => 'actor',
				'needs' => array(),
			),
			'comment_reply'        => array(
				'label' => __( 'پاسخ به دیدگاه کاربر', 'wp-event-publisher' ),
				'hint'  => __( 'وقتی کسی به دیدگاه کاربر پاسخ می‌دهد. تیکت برای صاحب دیدگاه می‌رود، نه پاسخ‌دهنده.', 'wp-event-publisher' ),
				'scope' => 'actor',
				'needs' => array(),
			),
			'custom_hook'          => array(
				'label' => __( 'رویداد دلخواه سایت', 'wp-event-publisher' ),
				'hint'  => __( 'برای کارهایی مثل «نردبان آگهی» که وردپرس رویدادی برایشان ندارد. سایت شما نام رویداد و شناسهٔ کاربر را اعلام می‌کند.', 'wp-event-publisher' ),
				'scope' => 'actor',
				'needs' => array( 'hook_slug' ),
			),
			'profile_completed'    => array(
				'label' => __( 'تکمیل شدن پروفایل', 'wp-event-publisher' ),
				'hint'  => __( 'وردپرس برای این کار رویدادی ندارد، پس هر ساعت بررسی می‌شود. هر کاربر فقط یک بار پیام می‌گیرد.', 'wp-event-publisher' ),
				'scope' => 'scan',
				'needs' => array(),
			),
			'scheduled'            => array(
				'label' => __( 'بررسی دوره‌ای همهٔ کاربران', 'wp-event-publisher' ),
				'hint'  => __( 'هر ساعت همهٔ کاربران بررسی می‌شوند و هر کس شرط را داشت تیکت می‌گیرد. حتماً یک شرط بگذارید، وگرنه برای همه ارسال می‌شود.', 'wp-event-publisher' ),
				'scope' => 'scan',
				'needs' => array(),
			),
		);
	}

	/**
	 * The conditions a rule may carry, and what kind of value each needs.
	 *
	 * `value` drives the form: the screen renders a role dropdown for `role`
	 * and a number box for `number`, instead of the single unlabelled text box
	 * that used to sit next to every condition and left the administrator
	 * guessing what to type into it.
	 *
	 * @since 1.9.0
	 *
	 * @return array<string,array{label:string,value:string,hint:string,summary:string}> Conditions.
	 */
	public function conditions(): array {
		return array(
			'none'               => array(
				'label'   => __( 'بدون شرط — برای همه', 'wp-event-publisher' ),
				'value'   => 'none',
				'hint'    => '',
				'summary' => __( 'برای همه', 'wp-event-publisher' ),
			),
			'role'               => array(
				'label'   => __( 'فقط اگر نقش کاربر این باشد', 'wp-event-publisher' ),
				'value'   => 'role',
				'hint'    => __( 'مثلاً فقط مشتری‌ها یا فقط فروشنده‌ها.', 'wp-event-publisher' ),
				/* translators: %s: role name. */
				'summary' => __( 'فقط برای کاربران با نقش «%s»', 'wp-event-publisher' ),
			),
			'profile_incomplete' => array(
				'label'   => __( 'فقط اگر پروفایل ناقص باشد', 'wp-event-publisher' ),
				'value'   => 'none',
				'hint'    => __( 'نام، نام خانوادگی یا شمارهٔ تماس خالی باشد.', 'wp-event-publisher' ),
				'summary' => __( 'فقط برای کسانی که پروفایلشان ناقص است', 'wp-event-publisher' ),
			),
			'profile_complete'   => array(
				'label'   => __( 'فقط اگر پروفایل کامل باشد', 'wp-event-publisher' ),
				'value'   => 'none',
				'hint'    => __( 'نام، نام خانوادگی و شمارهٔ تماس هر سه پر باشند.', 'wp-event-publisher' ),
				'summary' => __( 'فقط برای کسانی که پروفایلشان کامل است', 'wp-event-publisher' ),
			),
			'email_domain'       => array(
				'label'   => __( 'فقط اگر ایمیل کاربر با این دامنه باشد', 'wp-event-publisher' ),
				'value'   => 'text',
				'hint'    => __( 'مثلاً gmail.com', 'wp-event-publisher' ),
				/* translators: %s: email domain. */
				'summary' => __( 'فقط برای ایمیل‌های %s', 'wp-event-publisher' ),
			),
			'order_total_gte'    => array(
				'label'   => __( 'فقط اگر مبلغ سفارش از این بیشتر باشد', 'wp-event-publisher' ),
				'value'   => 'number',
				'hint'    => __( 'به تومان. فقط برای رویدادهای مربوط به سفارش معنی دارد.', 'wp-event-publisher' ),
				/* translators: %s: amount. */
				'summary' => __( 'فقط برای سفارش‌های بالای %s', 'wp-event-publisher' ),
			),
			'user_meta'          => array(
				'label'   => __( 'فقط اگر این فیلد کاربر برابر این مقدار باشد', 'wp-event-publisher' ),
				'value'   => 'meta',
				'hint'    => __( 'برای کاربران حرفه‌ای: نام فیلد و مقدار مورد انتظار.', 'wp-event-publisher' ),
				/* translators: 1: meta key, 2: expected value. */
				'summary' => __( 'فقط اگر %1$s برابر %2$s باشد', 'wp-event-publisher' ),
			),
		);
	}

	/**
	 * The priorities a rule may set.
	 *
	 * @since 1.9.0
	 *
	 * @return array<string,string> Label by key.
	 */
	public function priorities(): array {
		return array(
			'low'    => __( 'کم', 'wp-event-publisher' ),
			'normal' => __( 'عادی', 'wp-event-publisher' ),
			'high'   => __( 'مهم', 'wp-event-publisher' ),
			'urgent' => __( 'فوری', 'wp-event-publisher' ),
		);
	}

	/**
	 * The placeholders a message may use, with a description of each.
	 *
	 * @since 1.9.0
	 *
	 * @return array<string,string> Description by token.
	 */
	public function tokens(): array {
		return array(
			'{first_name}'    => __( 'نام کوچک کاربر (اگر خالی باشد، نام نمایشی)', 'wp-event-publisher' ),
			'{display_name}'  => __( 'نام نمایشی کاربر', 'wp-event-publisher' ),
			'{site_name}'     => __( 'نام سایت شما', 'wp-event-publisher' ),
			'{post_title}'    => __( 'عنوان آگهی مربوط به رویداد', 'wp-event-publisher' ),
			'{post_url}'      => __( 'نشانی آگهی', 'wp-event-publisher' ),
			'{reject_reason}' => __( 'دلیل رد آگهی، اگر ثبت شده باشد', 'wp-event-publisher' ),
			'{order_id}'      => __( 'شمارهٔ سفارش', 'wp-event-publisher' ),
			'{order_total}'   => __( 'مبلغ سفارش', 'wp-event-publisher' ),
			'{order_items}'   => __( 'فهرست کالاهای سفارش', 'wp-event-publisher' ),
			'{order_status}'  => __( 'وضعیت فعلی سفارش', 'wp-event-publisher' ),
			'{login_url}'     => __( 'نشانی صفحهٔ ورود', 'wp-event-publisher' ),
		);
	}

	/**
	 * Ready-made rules the administrator can adopt with one click.
	 *
	 * Offered, never installed: an empty screen stays empty until somebody
	 * picks one, and a preset is adopted switched OFF so that clicking to read
	 * what it says cannot start messaging customers.
	 *
	 * Nothing here names a particular site. `{site_name}` resolves to whatever
	 * WordPress reports as the title, so one preset reads correctly everywhere.
	 *
	 * @since 1.9.0
	 *
	 * @return array<int,array<string,mixed>> Presets.
	 */
	public function presets(): array {
		return array(
			array(
				'slug'     => 'welcome',
				'name'     => __( 'خوش‌آمدگویی پس از ثبت‌نام', 'wp-event-publisher' ),
				'trigger'  => 'user_register',
				'subject'  => __( 'خوش آمدید به {site_name} 🌱', 'wp-event-publisher' ),
				'body'     => __( 'سلام {first_name} عزیز، به {site_name} خوش آمدید. برای استفادهٔ بهتر از امکانات سایت، پیشنهاد می‌کنیم اطلاعات پروفایل خود را تکمیل کنید.', 'wp-event-publisher' ),
				'priority' => 'normal',
			),
			array(
				'slug'      => 'profile-incomplete',
				'name'      => __( 'یادآوری پروفایل ناقص', 'wp-event-publisher' ),
				'trigger'   => 'scheduled',
				'condition' => 'profile_incomplete',
				'subject'   => __( 'پروفایل خود را تکمیل کنید', 'wp-event-publisher' ),
				'body'      => __( '{first_name} عزیز، بخشی از اطلاعات پروفایل شما هنوز تکمیل نشده است. تکمیل پروفایل باعث افزایش اعتبار حساب و اعتماد بیشتر کاربران می‌شود.', 'wp-event-publisher' ),
				'priority'  => 'normal',
			),
			array(
				'slug'     => 'profile-completed',
				'name'     => __( 'تشکر پس از تکمیل پروفایل', 'wp-event-publisher' ),
				'trigger'  => 'profile_completed',
				'subject'  => __( 'پروفایل شما تکمیل شد ✅', 'wp-event-publisher' ),
				'body'     => __( 'اطلاعات پروفایل شما با موفقیت تکمیل شد. اکنون می‌توانید از امکانات {site_name} برای ثبت آگهی و ایجاد ارتباطات تجاری استفاده کنید.', 'wp-event-publisher' ),
				'priority' => 'normal',
			),
			array(
				'slug'     => 'post-approved',
				'name'     => __( 'تأیید آگهی', 'wp-event-publisher' ),
				'trigger'  => 'post_published',
				'subject'  => __( 'آگهی شما منتشر شد ✅', 'wp-event-publisher' ),
				'body'     => __( 'آگهی «{post_title}» تأیید و منتشر شد. از این لحظه کاربران می‌توانند آگهی شما را مشاهده کنند.', 'wp-event-publisher' ),
				'priority' => 'high',
			),
			array(
				'slug'     => 'post-rejected',
				'name'     => __( 'رد آگهی', 'wp-event-publisher' ),
				'trigger'  => 'post_unpublished',
				'subject'  => __( 'آگهی شما تأیید نشد', 'wp-event-publisher' ),
				'body'     => __( 'آگهی «{post_title}» در بررسی تأیید نشد. لطفاً دلیل اعلام‌شده را بررسی کرده و در صورت نیاز آگهی را اصلاح و مجدداً ثبت کنید. {reject_reason}', 'wp-event-publisher' ),
				'priority' => 'high',
			),
			array(
				'slug'     => 'comment-reply',
				'name'     => __( 'پاسخ روی دیدگاه', 'wp-event-publisher' ),
				'trigger'  => 'comment_reply',
				'subject'  => __( 'پاسخ جدید برای آگهی شما 💬', 'wp-event-publisher' ),
				'body'     => __( 'یک پاسخ جدید برای دیدگاه شما در آگهی «{post_title}» ثبت شده است. برای مشاهدهٔ پاسخ وارد صفحهٔ آگهی شوید.', 'wp-event-publisher' ),
				'priority' => 'normal',
			),
			array(
				'slug'      => 'post-bumped',
				'name'      => __( 'نردبان آگهی', 'wp-event-publisher' ),
				'trigger'   => 'custom_hook',
				'hook_slug' => 'post_bumped',
				'subject'   => __( 'آگهی شما نردبان شد 🚀', 'wp-event-publisher' ),
				'body'      => __( 'آگهی «{post_title}» با موفقیت نردبان شد و برای دیده‌شدن بیشتر به جایگاه بالاتری منتقل شد.', 'wp-event-publisher' ),
				'priority'  => 'normal',
			),
			array(
				'slug'     => 'order-created',
				'name'     => __( 'ثبت سفارش با مشخصات', 'wp-event-publisher' ),
				'trigger'  => 'order_created',
				'subject'  => __( 'سفارش شما ثبت شد — شمارهٔ {order_id}', 'wp-event-publisher' ),
				'body'     => __( "{first_name} عزیز، سفارش شما با مشخصات زیر ثبت شد:\n\nشمارهٔ سفارش: {order_id}\nمبلغ: {order_total}\nوضعیت: {order_status}\n\nاقلام سفارش:\n{order_items}\n\nهر تغییری در وضعیت سفارش از همین‌جا به اطلاع شما می‌رسد.", 'wp-event-publisher' ),
				'priority' => 'high',
			),
			array(
				'slug'     => 'order-status',
				'name'     => __( 'تغییر وضعیت سفارش', 'wp-event-publisher' ),
				'trigger'  => 'order_status_changed',
				'subject'  => __( 'وضعیت سفارش {order_id} تغییر کرد', 'wp-event-publisher' ),
				'body'     => __( "{first_name} عزیز، وضعیت سفارش شمارهٔ {order_id} به «{order_status}» تغییر کرد.\n\nمبلغ سفارش: {order_total}", 'wp-event-publisher' ),
				'priority' => 'normal',
			),
		);
	}

	/**
	 * The saved rules.
	 *
	 * @since 1.9.0
	 *
	 * @return array<int,array<string,mixed>> Rules.
	 */
	public function rules(): array {
		$value = get_option( self::OPTION, array() );

		return is_array( $value ) ? array_values( array_filter( $value, 'is_array' ) ) : array();
	}

	/**
	 * No rules ship enabled.
	 *
	 * @since 1.9.0
	 *
	 * @return array<int,array<string,mixed>> Always empty.
	 */
	public function defaults(): array {
		return array();
	}

	/**
	 * Clears the scheduled scan.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public function unschedule(): void {
		wp_clear_scheduled_hook( 'jarchi_ticket_automation_scan' );
		wp_clear_scheduled_hook( 'jarchi_fire_automation_delayed' );
	}

	/**
	 * Schedules the hourly scan, but only when a rule actually needs it.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public function schedule(): void {
		// Cheapest question first: this runs on `init`, i.e. on every request
		// including every AJAX call and REST hit. Asking cron before reading
		// and unserialising the rules option keeps the common case to one
		// already-cached lookup.
		if ( wp_next_scheduled( 'jarchi_ticket_automation_scan' ) ) {
			return;
		}

		// And no cron at all on a site with no rule that needs it. An empty
		// hourly job is not free: it wakes PHP, loads the plugin and walks the
		// rules to discover there is nothing to do.
		if ( ! $this->has_scheduled_rule() ) {
			return;
		}

		wp_schedule_event( time() + 300, 'hourly', 'jarchi_ticket_automation_scan' );
	}

	/**
	 * Whether any enabled rule needs the hourly pass.
	 *
	 * @since 1.19.2
	 *
	 * @return bool True when the scan has work to do.
	 */
	private function has_scheduled_rule(): bool {
		foreach ( $this->rules() as $rule ) {
			if ( empty( $rule['enabled'] ) ) {
				continue;
			}

			if ( in_array( (string) ( $rule['trigger'] ?? '' ), array( 'scheduled', 'profile_completed' ), true ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Kept for compatibility; navigation lives in Admin::register_menu().
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public function register_admin_page(): void {}

	/* =====================================================================
	 * Saving.
	 * ================================================================== */

	/**
	 * Normalises one submitted rule.
	 *
	 * @since 1.9.0
	 *
	 * @param array<string,mixed> $input Raw values.
	 *
	 * @return array<string,mixed> Clean rule.
	 */
	private function sanitize_rule( array $input ): array {
		$triggers   = $this->triggers();
		$conditions = $this->conditions();

		$trigger = sanitize_key( (string) ( $input['trigger'] ?? '' ) );
		$trigger = isset( $triggers[ $trigger ] ) ? $trigger : 'user_register';

		$condition = sanitize_key( (string) ( $input['condition'] ?? 'none' ) );
		$condition = isset( $conditions[ $condition ] ) ? $condition : 'none';

		$priority = sanitize_key( (string) ( $input['priority'] ?? 'normal' ) );
		$priority = array_key_exists( $priority, $this->priorities() ) ? $priority : 'normal';

		return array(
			'id'              => sanitize_key( (string) ( $input['id'] ?? '' ) ) ?: 'rule_' . wp_generate_uuid4(),
			'name'            => sanitize_text_field( (string) ( $input['name'] ?? '' ) ),
			'enabled'         => ! empty( $input['enabled'] ),
			'trigger'         => $trigger,
			'condition'       => $condition,
			'condition_value' => sanitize_text_field( (string) ( $input['condition_value'] ?? '' ) ),
			'condition_key'   => sanitize_key( (string) ( $input['condition_key'] ?? '' ) ),
			'subject'         => sanitize_text_field( (string) ( $input['subject'] ?? '' ) ),
			'body'            => wp_kses_post( (string) ( $input['body'] ?? '' ) ),
			'department'      => absint( $input['department'] ?? 0 ),
			'category'        => absint( $input['category'] ?? 0 ),
			'priority'        => $priority,
			'once_per_user'   => ! empty( $input['once_per_user'] ),
			'allow_reply'     => ! empty( $input['allow_reply'] ),
			'delay_minutes'   => max( 0, min( 10080, absint( $input['delay_minutes'] ?? 0 ) ) ),
			'post_type'       => sanitize_key( (string) ( $input['post_type'] ?? 'post' ) ) ?: 'post',
			'order_status'    => sanitize_key( (string) ( $input['order_status'] ?? '' ) ),
			'hook_slug'       => sanitize_key( (string) ( $input['hook_slug'] ?? '' ) ),
			'from_preset'     => sanitize_key( (string) ( $input['from_preset'] ?? '' ) ),
		);
	}

	/**
	 * Saves a rule from the screen.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public function save(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}

		check_admin_referer( self::NONCE );

		// phpcs:disable WordPress.Security.NonceVerification.Missing -- checked above.
		$rule  = $this->sanitize_rule( array_map( 'wp_unslash', (array) $_POST ) );
		$rules = $this->rules();
		// phpcs:enable

		if ( '' === trim( $rule['subject'] ) || '' === trim( wp_strip_all_tags( $rule['body'] ) ) ) {
			wp_safe_redirect( add_query_arg( array( 'automation' => 'incomplete' ), Admin::app_url( 'ticket-automations' ) ) );
			exit;
		}

		$found = false;

		foreach ( $rules as $key => $existing ) {
			if ( (string) ( $existing['id'] ?? '' ) === $rule['id'] ) {
				$rules[ $key ] = $rule;
				$found         = true;
				break;
			}
		}

		if ( ! $found ) {
			$rules[] = $rule;
		}

		update_option( self::OPTION, array_values( $rules ), false );

		wp_safe_redirect( add_query_arg( array( 'automation' => 'saved' ), Admin::app_url( 'ticket-automations' ) ) );
		exit;
	}

	/**
	 * Deletes a rule.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public function delete(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}

		check_admin_referer( self::NONCE );

		$id    = sanitize_key( (string) ( $_POST['rule_id'] ?? '' ) );
		$rules = array_values( array_filter( $this->rules(), static fn( $rule ) => (string) ( $rule['id'] ?? '' ) !== $id ) );

		update_option( self::OPTION, $rules, false );

		wp_safe_redirect( add_query_arg( array( 'automation' => 'deleted' ), Admin::app_url( 'ticket-automations' ) ) );
		exit;
	}

	/**
	 * Adopts a preset as an editable rule, switched off.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public function apply_preset(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}

		check_admin_referer( self::NONCE );

		$slug  = sanitize_key( (string) ( $_POST['preset'] ?? '' ) );
		$found = null;

		foreach ( $this->presets() as $preset ) {
			if ( $preset['slug'] === $slug ) {
				$found = $preset;
				break;
			}
		}

		if ( ! $found ) {
			wp_safe_redirect( Admin::app_url( 'ticket-automations' ) );
			exit;
		}

		$rules   = $this->rules();
		$rules[] = $this->sanitize_rule(
			array(
				'name'          => $found['name'],
				'enabled'       => false,
				'trigger'       => $found['trigger'],
				'condition'     => $found['condition'] ?? 'none',
				'subject'       => $found['subject'],
				'body'          => $found['body'],
				'priority'      => $found['priority'],
				// Repeating events are safe to repeat; per-user milestones are not.
				'once_per_user' => in_array( $found['trigger'], array( 'user_register', 'first_login', 'profile_completed', 'scheduled' ), true ),
				'allow_reply'   => false,
				'hook_slug'     => $found['hook_slug'] ?? '',
				'from_preset'   => $slug,
			)
		);

		update_option( self::OPTION, $rules, false );

		wp_safe_redirect( add_query_arg( array( 'automation' => 'added' ), Admin::app_url( 'ticket-automations' ) ) );
		exit;
	}

	/**
	 * Switches one rule on or off.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public function toggle(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}

		check_admin_referer( self::NONCE );

		$id    = sanitize_key( (string) ( $_POST['rule_id'] ?? '' ) );
		$rules = $this->rules();

		foreach ( $rules as $key => $rule ) {
			if ( (string) ( $rule['id'] ?? '' ) === $id ) {
				$rules[ $key ]['enabled'] = empty( $rule['enabled'] );
				break;
			}
		}

		update_option( self::OPTION, $rules, false );

		wp_safe_redirect( Admin::app_url( 'ticket-automations' ) );
		exit;
	}

	/**
	 * Fires one rule by hand, against one named user.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public function run_manual(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}

		check_admin_referer( self::NONCE );

		$id      = sanitize_key( (string) ( $_POST['rule_id'] ?? '' ) );
		$user_id = absint( $_POST['user_id'] ?? 0 );

		/*
		 * A manual run targets exactly one named user.
		 *
		 * There is deliberately no "run this for everybody" button. The only
		 * way to reach every user is to switch the rule on and let the
		 * scheduled pass walk them in batches, where the ledger, the lock and
		 * the per-request ceiling all apply. A button that sends to the whole
		 * site in one click is how the original incident happened, and it is
		 * not worth re-adding for the convenience.
		 */
		if ( $user_id <= 0 ) {
			wp_safe_redirect( add_query_arg( 'automation', 'no_user', Admin::app_url( 'ticket-automations' ) ) );
			exit;
		}

		foreach ( $this->rules() as $rule ) {
			if ( $id === (string) ( $rule['id'] ?? '' ) ) {
				// The claim still applies: pressing the button twice must not
				// send twice. What a manual run adds is a distinct object id,
				// so the administrator can deliberately re-send by choosing a
				// different user, not by repeating themselves.
				$rule_id = sanitize_key( (string) $rule['id'] );
				$scope   = 'manual';
				$object  = (string) $user_id . ':' . gmdate( 'Y-m-d-H' );

				if ( ! AutomationLedger::reserve( $rule_id, $user_id, $scope, $object ) ) {
					wp_safe_redirect( add_query_arg( 'automation', 'already_ran', Admin::app_url( 'ticket-automations' ) ) );
					exit;
				}

				$ticket_id = $this->create_ticket( $rule, $user_id, array() );

				if ( $ticket_id > 0 ) {
					AutomationLedger::confirm( $rule_id, $user_id, $scope, $object, $ticket_id );
				} else {
					AutomationLedger::release( $rule_id, $user_id, $scope, $object );
				}

				break;
			}
		}

		wp_safe_redirect( add_query_arg( array( 'automation' => 'ran' ), Admin::app_url( 'ticket-automations' ) ) );
		exit;
	}

	/* =====================================================================
	 * Event listeners. Each names the one user it concerns.
	 * ================================================================== */

	/**
	 * A new account was created.
	 *
	 * @since 1.9.0
	 *
	 * @param int $user_id New user.
	 *
	 * @return void
	 */
	public function on_user_register( $user_id ): void {
		$this->dispatch( 'user_register', (int) $user_id, array() );
	}

	/**
	 * The first time a user logs in.
	 *
	 * @since 1.9.0
	 *
	 * @param string   $user_login Login name.
	 * @param \WP_User $user       The user.
	 *
	 * @return void
	 */
	public function on_first_login( $user_login, $user = null ): void {
		if ( ! is_object( $user ) || empty( $user->ID ) ) {
			return;
		}

		if ( get_user_meta( (int) $user->ID, '_jarchi_first_login_seen', true ) ) {
			return;
		}

		update_user_meta( (int) $user->ID, '_jarchi_first_login_seen', time() );

		$this->dispatch( 'first_login', (int) $user->ID, array() );
	}

	/**
	 * A post changed status.
	 *
	 * @since 1.9.0
	 *
	 * @param string   $new_status New status.
	 * @param string   $old_status Previous status.
	 * @param \WP_Post $post       The post.
	 *
	 * @return void
	 */
	public function on_post_status( $new_status, $old_status, $post ): void {
		if ( ! $post instanceof \WP_Post || $new_status === $old_status ) {
			return;
		}

		/*
		 * GUARD 1. The plugin's own records can never be the subject of a rule.
		 *
		 * Creating a ticket is a wp_insert_post(), which fires this very hook.
		 * Without this line the "advert published" rule reacts to the ticket it
		 * just produced, produces another, and does not stop.
		 */
		if ( in_array( $post->post_type, self::ignored_post_types(), true ) ) {
			return;
		}

		if ( wp_is_post_revision( $post->ID ) || wp_is_post_autosave( $post->ID ) ) {
			return;
		}

		$author = (int) $post->post_author;

		if ( $author <= 0 ) {
			return;
		}

		$context = array(
			'post_id'       => (int) $post->ID,
			'post_type'     => (string) $post->post_type,
			'post_title'    => (string) $post->post_title,
			'reject_reason' => (string) get_post_meta( (int) $post->ID, '_jarchi_reject_reason', true ),
		);

		/*
		 * Only a real transition INTO publish counts.
		 *
		 * The hook fires on every save of a published post with `publish` on
		 * both sides, and it fires again when a trashed post is restored. An
		 * allowlist of the states something is genuinely published FROM keeps
		 * "your advert is live" to the moment it actually went live, instead
		 * of every time an editor fixes a typo.
		 */
		$publishable_from = (array) apply_filters(
			'wpep_automation_publish_from_statuses',
			array( 'draft', 'auto-draft', 'pending', 'future', 'new', 'inherit' )
		);

		if ( 'publish' === $new_status ) {
			if ( in_array( $old_status, $publishable_from, true ) ) {
				$this->dispatch( 'post_published', $author, $context );
			}

			return;
		}

		// Sent back from review is a rejection. A brand new draft is not: it was
		// never under review, and telling somebody their advert was refused the
		// moment they start writing it would be worse than saying nothing.
		if ( in_array( $old_status, array( 'publish', 'pending' ), true ) && in_array( $new_status, array( 'draft', 'trash', 'pending' ), true ) ) {
			$this->dispatch( 'post_unpublished', $author, $context );
		}
	}

	/**
	 * Somebody replied to a comment.
	 *
	 * @since 1.9.0
	 *
	 * @param int    $comment_id New comment.
	 * @param object $comment    The comment.
	 *
	 * @return void
	 */
	public function on_comment_inserted( $comment_id, $comment = null ): void {
		$comment = is_object( $comment ) ? $comment : get_comment( (int) $comment_id );

		if ( ! is_object( $comment ) || empty( $comment->comment_parent ) ) {
			return;
		}

		// Ticket messages are comments too. Replying inside a ticket must not
		// raise a ticket about the ticket.
		if ( Tickets::COMMENT_TYPE === (string) ( $comment->comment_type ?? '' ) ) {
			return;
		}

		$parent = get_comment( (int) $comment->comment_parent );

		if ( ! is_object( $parent ) ) {
			return;
		}

		$recipient = (int) ( $parent->user_id ?? 0 );

		// Never about your own reply to yourself.
		if ( $recipient <= 0 || $recipient === (int) ( $comment->user_id ?? 0 ) ) {
			return;
		}

		$post_id = (int) ( $comment->comment_post_ID ?? 0 );

		if ( in_array( (string) get_post_type( $post_id ), self::ignored_post_types(), true ) ) {
			return;
		}

		$this->dispatch(
			'comment_reply',
			$recipient,
			array(
				'post_id'    => $post_id,
				'post_title' => (string) get_the_title( $post_id ),
				'comment_id' => (int) $comment_id,
			)
		);
	}

	/**
	 * A site-defined event.
	 *
	 * Things like "an advert was bumped" are not WordPress concepts, so the
	 * plugin cannot detect them without guessing at another plugin's data. The
	 * site announces them instead:
	 *
	 *     do_action( 'jarchi_automation_event', 'post_bumped', $user_id, $context );
	 *
	 * That is a real integration point, rather than a control that appears to
	 * work and never fires.
	 *
	 * @since 1.9.0
	 *
	 * @param string $slug    Event name.
	 * @param int    $user_id Recipient.
	 * @param array  $context Extra tokens.
	 *
	 * @return void
	 */
	public function on_custom_event( $slug, $user_id = 0, $context = array() ): void {
		$slug    = sanitize_key( (string) $slug );
		$user_id = (int) $user_id;

		if ( '' === $slug || $user_id <= 0 ) {
			return;
		}

		$this->dispatch( 'custom_hook', $user_id, (array) $context, $slug );
	}

	/* =====================================================================
	 * WooCommerce.
	 * ================================================================== */

	/**
	 * Builds the token context for one order.
	 *
	 * @since 1.9.0
	 *
	 * @param int $order_id Order id.
	 *
	 * @return array<string,mixed>|null Context, or null when unavailable.
	 */
	private function order_context( int $order_id ): ?array {
		if ( ! function_exists( 'wc_get_order' ) ) {
			return null;
		}

		$order = wc_get_order( $order_id );

		if ( ! $order ) {
			return null;
		}

		$customer_id = (int) $order->get_user_id();

		if ( $customer_id <= 0 ) {
			return null;
		}

		$lines = array();

		foreach ( $order->get_items() as $item ) {
			$lines[] = sprintf( '• %s × %d', (string) $item->get_name(), (int) $item->get_quantity() );
		}

		$status = (string) $order->get_status();

		return array(
			'user_id'      => $customer_id,
			'order_id'     => (string) $order->get_order_number(),
			'order_total'  => function_exists( 'wc_price' ) ? wp_strip_all_tags( (string) wc_price( $order->get_total() ) ) : (string) $order->get_total(),
			'order_items'  => implode( "\n", $lines ),
			'order_status' => function_exists( 'wc_get_order_status_name' ) ? (string) wc_get_order_status_name( $status ) : $status,
			'order_status_key' => $status,
			'order_total_raw'  => (float) $order->get_total(),
		);
	}

	/**
	 * An order was placed.
	 *
	 * @since 1.9.0
	 *
	 * @param int $order_id Order id.
	 *
	 * @return void
	 */
	public function on_order_created( $order_id ): void {
		$context = $this->order_context( (int) $order_id );

		if ( null === $context ) {
			return;
		}

		$this->dispatch( 'order_created', (int) $context['user_id'], $context );
	}

	/**
	 * An order changed status.
	 *
	 * @since 1.9.0
	 *
	 * @param int    $order_id Order id.
	 * @param string $from     Previous status.
	 * @param string $to       New status.
	 * @param mixed  $order    Order object.
	 *
	 * @return void
	 */
	public function on_order_status_changed( $order_id, $from = '', $to = '', $order = null ): void {
		$context = $this->order_context( (int) $order_id );

		if ( null === $context ) {
			return;
		}

		$context['order_status_old'] = (string) $from;
		$context['order_status_key'] = (string) $to ?: $context['order_status_key'];

		$this->dispatch( 'order_status_changed', (int) $context['user_id'], $context );
	}

	/**
	 * An order completed.
	 *
	 * @since 1.9.0
	 *
	 * @param int $order_id Order id.
	 *
	 * @return void
	 */
	public function on_order_completed( $order_id ): void {
		$context = $this->order_context( (int) $order_id );

		if ( null === $context ) {
			return;
		}

		$this->dispatch( 'order_completed', (int) $context['user_id'], $context );
	}

	/* =====================================================================
	 * The scheduled pass.
	 * ================================================================== */

	/**
	 * The hourly pass, for the two events that have no moment of their own.
	 *
	 * Everything else is driven by something a person did, and goes to that
	 * person. Only these two examine the whole user list, and both say so on
	 * the screen.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	/**
	 * The lock key for the scheduled pass.
	 *
	 * @var string
	 */
	private const SCAN_LOCK = '_jarchi_automation_scan_lock';

	/**
	 * How long a scan may hold the lock before it is treated as abandoned.
	 *
	 * A batch of twenty-five users takes seconds. Ten minutes is far beyond
	 * any legitimate run, and short enough that a PHP crash does not stop the
	 * automation for the rest of the day.
	 *
	 * @var int
	 */
	private const SCAN_LOCK_TTL = 600;

	/**
	 * Users examined per cron run, per rule.
	 *
	 * @var int
	 */
	private const SCAN_BATCH = 25;

	/**
	 * Takes the scan lock, if it is free.
	 *
	 * Cron can overlap: WordPress fires it on ordinary page requests, so two
	 * visitors arriving together can start two scans. Without a lock both walk
	 * the same users at the same time.
	 *
	 * The ledger would still stop duplicate tickets, but the work would be
	 * done twice and the cursor would jump — so this is about the server, not
	 * about correctness of output.
	 *
	 * @since 1.19.2
	 *
	 * @return bool True when this process holds the lock.
	 */
	private function acquire_scan_lock(): bool {
		$existing = get_option( self::SCAN_LOCK, array() );

		if ( is_array( $existing ) && ! empty( $existing['expires'] ) ) {
			if ( (int) $existing['expires'] > time() ) {
				return false;
			}

			// Expired: the holder died. Log it, because a lock that keeps
			// expiring means runs are timing out and somebody should know.
			$this->log_skip( 'automation_lock_expired', (string) ( $existing['owner'] ?? '' ), 0, 'scan', '' );
		}

		$token = wp_generate_uuid4();

		update_option(
			self::SCAN_LOCK,
			array(
				'owner'   => $token,
				'started' => time(),
				'expires' => time() + self::SCAN_LOCK_TTL,
			),
			false
		);

		/*
		 * Read back what was actually stored. Two processes that both saw the
		 * lock free will both have written; only the one whose token survived
		 * may proceed. This is a narrow window rather than a true mutex —
		 * WordPress options offer no compare-and-swap — but combined with the
		 * ledger, the worst case is wasted work rather than duplicate tickets.
		 */
		$stored = get_option( self::SCAN_LOCK, array() );

		return is_array( $stored ) && $token === (string) ( $stored['owner'] ?? '' );
	}

	/**
	 * Gives the scan lock back.
	 *
	 * @since 1.19.2
	 *
	 * @return void
	 */
	private function release_scan_lock(): void {
		delete_option( self::SCAN_LOCK );
	}

	/**
	 * The cursor option for one rule.
	 *
	 * @since 1.19.2
	 *
	 * @param string $rule_id Rule.
	 *
	 * @return string Option name.
	 */
	private function cursor_key( string $rule_id ): string {
		return '_jarchi_automation_cursor_' . sanitize_key( $rule_id );
	}

	/**
	 * The hourly pass, for the two events that have no moment of their own.
	 *
	 * Walks users in batches from a saved cursor rather than loading five
	 * hundred every run. On a site with fifty thousand users the old version
	 * examined the same first five hundred for ever — so the rule never
	 * reached anybody else — while still paying to load them each time.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public function scan_scheduled_rules(): void {
		$rules = array_values(
			array_filter(
				$this->rules(),
				static fn( $rule ) => ! empty( $rule['enabled'] ) && in_array( (string) ( $rule['trigger'] ?? '' ), array( 'scheduled', 'profile_completed' ), true )
			)
		);

		if ( empty( $rules ) ) {
			return;
		}

		if ( ! $this->acquire_scan_lock() ) {
			$this->log_skip( 'automation_locked', '', 0, 'scan', '' );

			return;
		}

		try {
			foreach ( $rules as $rule ) {
				$this->scan_rule_batch( $rule );

				// The per-request ceiling applies across rules, not per rule:
				// once it is reached nothing more should be attempted.
				if ( self::$created >= self::MAX_PER_REQUEST ) {
					break;
				}
			}
		} finally {
			// Always, even on a fatal path — a lock left behind would stop
			// every future run.
			$this->release_scan_lock();
		}
	}

	/**
	 * Examines the next batch of users for one rule.
	 *
	 * @since 1.19.2
	 *
	 * @param array<string,mixed> $rule The rule.
	 *
	 * @return void
	 */
	private function scan_rule_batch( array $rule ): void {
		$rule_id = sanitize_key( (string) ( $rule['id'] ?? '' ) );

		if ( '' === $rule_id ) {
			return;
		}

		$cursor = max( 0, (int) get_option( $this->cursor_key( $rule_id ), 0 ) );

		/**
		 * Filters how many users one scheduled batch examines.
		 *
		 * @since 1.19.2
		 *
		 * @param int                 $size Batch size.
		 * @param array<string,mixed> $rule The rule.
		 */
		$size = max( 1, (int) apply_filters( 'wpep_automation_batch_size', self::SCAN_BATCH, $rule ) );

		/*
		 * A cursor, not a fixed window.
		 *
		 * The previous version asked for the first five hundred users every
		 * run, so on a larger site the same five hundred were examined for
		 * ever and nobody past them was ever reached — while still paying to
		 * load them each time. Ordering by id and resuming from the offset
		 * walks the whole list, twenty-five at a time, and finishes.
		 */
		$users = array_map(
			'intval',
			(array) get_users(
				array(
					'number'  => $size,
					'offset'  => $cursor,
					'fields'  => 'ID',
					'orderby' => 'ID',
					'order'   => 'ASC',
				)
			)
		);

		if ( empty( $users ) ) {
			// The end of the list. Start again from the top next hour.
			delete_option( $this->cursor_key( $rule_id ) );

			return;
		}

		foreach ( $users as $user_id ) {
			if ( self::$created >= self::MAX_PER_REQUEST ) {
				break;
			}

			if ( 'profile_completed' === (string) $rule['trigger'] ) {
				if ( $this->profile_incomplete( $user_id ) ) {
					continue;
				}
			} elseif ( ! $this->condition_matches( $rule, $user_id, array() ) ) {
				continue;
			}

			$this->fire_rule( $rule, $user_id, array() );
		}

		update_option( $this->cursor_key( $rule_id ), $cursor + count( $users ), false );
	}

	/* =====================================================================
	 * Dispatch and firing.
	 * ================================================================== */

	/**
	 * Runs every rule listening for one event, for one user.
	 *
	 * @since 1.9.0
	 *
	 * @param string              $trigger   Trigger name.
	 * @param int                 $user_id   The one person this concerns.
	 * @param array<string,mixed> $context   Token values.
	 * @param string              $hook_slug For custom events, the site's name for it.
	 *
	 * @return void
	 */
	private function dispatch( string $trigger, int $user_id, array $context, string $hook_slug = '' ): void {
		/*
		 * GUARD 3a. Never re-enter.
		 *
		 * Creating a ticket touches posts, comments and meta, any of which some
		 * other plugin may hook. If that path leads back here, this returns
		 * instead of nesting.
		 */
		if ( self::$creating ) {
			return;
		}

		if ( $user_id <= 0 ) {
			return;
		}

		/*
		 * A cleanup in progress is deleting tickets in batches. Creating new
		 * ones underneath it means racing something that is actively emptying
		 * the table, and the administrator watching the count go down would
		 * see it go back up.
		 */
		if ( TicketCleanup::automation_paused() ) {
			return;
		}

		foreach ( $this->rules() as $rule ) {
			if ( empty( $rule['enabled'] ) || (string) ( $rule['trigger'] ?? '' ) !== $trigger ) {
				continue;
			}

			if ( ! $this->rule_matches_context( $rule, $context, $hook_slug ) ) {
				continue;
			}

			if ( ! $this->condition_matches( $rule, $user_id, $context ) ) {
				continue;
			}

			$this->fire_rule( $rule, $user_id, $context );
		}
	}

	/**
	 * Whether a rule applies to the thing the event happened to.
	 *
	 * GUARD 2. A rule configured for adverts must not fire for pages, media, or
	 * anything else — and this is the check whose absence turned the ticket the
	 * rule had just produced into a second advert-published event.
	 *
	 * @since 1.9.0
	 *
	 * @param array<string,mixed> $rule      The rule.
	 * @param array<string,mixed> $context   Event context.
	 * @param string              $hook_slug Custom event name.
	 *
	 * @return bool True when the rule applies.
	 */
	private function rule_matches_context( array $rule, array $context, string $hook_slug ): bool {
		$trigger = (string) ( $rule['trigger'] ?? '' );

		if ( in_array( $trigger, array( 'post_published', 'post_unpublished' ), true ) ) {
			$wanted = sanitize_key( (string) ( $rule['post_type'] ?? '' ) );
			$actual = sanitize_key( (string) ( $context['post_type'] ?? '' ) );

			if ( '' === $wanted || $wanted !== $actual ) {
				return false;
			}
		}

		if ( 'custom_hook' === $trigger ) {
			if ( sanitize_key( (string) ( $rule['hook_slug'] ?? '' ) ) !== $hook_slug ) {
				return false;
			}
		}

		// A status rule may name one status; empty means every change.
		if ( 'order_status_changed' === $trigger ) {
			$wanted = sanitize_key( (string) ( $rule['order_status'] ?? '' ) );

			if ( '' !== $wanted && $wanted !== sanitize_key( (string) ( $context['order_status_key'] ?? '' ) ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Whether the rule's condition holds for this user.
	 *
	 * @since 1.9.0
	 *
	 * @param array<string,mixed> $rule    The rule.
	 * @param int                 $user_id The user.
	 * @param array<string,mixed> $context Event context.
	 *
	 * @return bool True when the condition holds.
	 */
	private function condition_matches( array $rule, int $user_id, array $context ): bool {
		$condition = (string) ( $rule['condition'] ?? 'none' );
		$value     = (string) ( $rule['condition_value'] ?? '' );
		$user      = get_user_by( 'id', $user_id );

		if ( ! $user ) {
			return false;
		}

		switch ( $condition ) {
			case 'role':
				return '' !== $value && in_array( $value, (array) $user->roles, true );

			case 'email_domain':
				$domain = strtolower( ltrim( trim( $value ), '@' ) );

				return '' !== $domain && str_ends_with( strtolower( (string) $user->user_email ), '@' . $domain );

			case 'profile_incomplete':
				return $this->profile_incomplete( $user_id );

			case 'profile_complete':
				return ! $this->profile_incomplete( $user_id );

			case 'user_meta':
				$key = sanitize_key( (string) ( $rule['condition_key'] ?? '' ) );

				return '' !== $key && (string) get_user_meta( $user_id, $key, true ) === $value;

			case 'order_total_gte':
				return isset( $context['order_total_raw'] ) && (float) $context['order_total_raw'] >= (float) $value;

			case 'none':
			default:
				return true;
		}
	}

	/**
	 * Whether the user's profile is missing a basic field.
	 *
	 * @since 1.9.0
	 *
	 * @param int $user_id The user.
	 *
	 * @return bool True when something is missing.
	 */
	private function profile_incomplete( int $user_id ): bool {
		$user = get_user_by( 'id', $user_id );

		if ( ! $user ) {
			return false;
		}

		foreach ( array( 'first_name', 'last_name', 'phone' ) as $field ) {
			if ( '' === trim( (string) get_user_meta( $user_id, $field, true ) ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Applies once-per-user and the delay, then creates the ticket.
	 *
	 * @since 1.9.0
	 *
	 * @param array<string,mixed> $rule    The rule.
	 * @param int                 $user_id Recipient.
	 * @param array<string,mixed> $context Token values.
	 *
	 * @return void
	 */
	/**
	 * The object one event happened to.
	 *
	 * This is what makes "once" mean the right thing. An order rule keyed on
	 * the rule and customer alone would send one confirmation per customer for
	 * ever, silently swallowing their second order; a publish rule keyed that
	 * way would announce a seller's first advert and none of the rest.
	 *
	 * @since 1.19.2
	 *
	 * @param array<string,mixed> $rule    The rule.
	 * @param array<string,mixed> $context Event context.
	 *
	 * @return string Stable object identifier, or an empty string.
	 */
	private function event_object_id( array $rule, array $context ): string {
		foreach ( array( 'order_id', 'post_id', 'comment_id', 'event_id' ) as $key ) {
			if ( ! empty( $context[ $key ] ) ) {
				return (string) $context[ $key ];
			}
		}

		/*
		 * A custom event with nothing to key on still needs a stable id, or
		 * the site firing it twice would produce two tickets. The hook slug
		 * plus the day is deterministic and repeatable within a run, without
		 * silencing a legitimate event next week.
		 */
		if ( 'custom_hook' === (string) ( $rule['trigger'] ?? '' ) ) {
			return sanitize_key( (string) ( $rule['hook_slug'] ?? '' ) ) . ':' . gmdate( 'Y-m-d' );
		}

		return '';
	}

	/**
	 * The event type recorded in the ledger.
	 *
	 * The unit of deduplication is the event, and what counts as one event
	 * depends on whether the trigger has an object. Publishing an advert or
	 * placing an order does: the ledger keys on that object, so the same
	 * advert can never produce a second ticket and the next advert is a
	 * different event. Registering, completing a profile, or being swept up
	 * by the periodic scan does not: there is nothing to key on, so the key
	 * collapses to the user and the rule, and the message is sent once ever —
	 * which is what stops a scan that revisits every user every hour from
	 * messaging them every hour.
	 *
	 * `once_per_user` marks the second kind. It does not override the first:
	 * "only tell them once" cannot sensibly mean "tell them about their first
	 * advert and silently drop every advert after it".
	 *
	 * @since 1.19.2
	 *
	 * @param array<string,mixed> $rule The rule.
	 *
	 * @return string Event type.
	 */
	private function event_scope( array $rule ): string {
		return ! empty( $rule['once_per_user'] )
			? 'once'
			: sanitize_key( (string) ( $rule['trigger'] ?? 'event' ) );
	}

	/**
	 * Claims an event and creates its ticket, or does nothing.
	 *
	 * The claim is a single atomic database operation, not a read followed by
	 * a write. Two requests arriving together — WooCommerce firing overlapping
	 * status hooks, cron overlapping a page load, a double-clicked publish —
	 * used to both pass the get_user_meta() check and both create. That is how
	 * one customer accumulated hundreds of copies of one message.
	 *
	 * @since 1.9.0
	 *
	 * @param array<string,mixed> $rule    The rule.
	 * @param int                 $user_id Recipient.
	 * @param array<string,mixed> $context Token values.
	 *
	 * @return void
	 */
	private function fire_rule( array $rule, int $user_id, array $context ): void {
		$rule_id = sanitize_key( (string) ( $rule['id'] ?? '' ) );

		if ( '' === $rule_id || $user_id <= 0 ) {
			return;
		}

		$scope = $this->event_scope( $rule );

		// Always the object, when the event has one. Blanking it for
		// once_per_user rules made every advert after the first collapse onto
		// the first advert's key and disappear.
		$object_id = $this->event_object_id( $rule, $context );

		// Exactly one caller gets true. Everyone else stops here.
		if ( ! AutomationLedger::reserve( $rule_id, $user_id, $scope, $object_id ) ) {
			$this->log_skip( 'duplicate_event_skipped', $rule_id, $user_id, $scope, $object_id );

			return;
		}

		$delay = absint( $rule['delay_minutes'] ?? 0 );

		if ( $delay > 0 ) {
			/*
			 * The reservation is already held, so scheduling is safe: a second
			 * event for the same key never reaches this line and therefore
			 * cannot queue a second job. The ledger is the deduplication for
			 * delayed work too, not a separate mechanism that could disagree
			 * with it.
			 */
			wp_schedule_single_event(
				time() + ( $delay * MINUTE_IN_SECONDS ),
				'jarchi_fire_automation_delayed',
				array( $rule, $user_id, $context )
			);

			return;
		}

		$ticket_id = $this->create_ticket( $rule, $user_id, $context );

		if ( $ticket_id > 0 ) {
			AutomationLedger::confirm( $rule_id, $user_id, $scope, $object_id, $ticket_id );

			return;
		}

		// The ticket was not created, so the event has not been handled. Give
		// the claim back rather than swallowing the message for ever.
		AutomationLedger::release( $rule_id, $user_id, $scope, $object_id );
	}

	/**
	 * Records why an automation declined to act.
	 *
	 * @since 1.19.2
	 *
	 * @param string $reason     Machine-readable reason.
	 * @param string $rule_id    Rule.
	 * @param int    $user_id    Recipient.
	 * @param string $event_type Event type.
	 * @param string $object_id  Event object.
	 *
	 * @return void
	 */
	private function log_skip( string $reason, string $rule_id, int $user_id, string $event_type, string $object_id ): void {
		if ( ! class_exists( Logger::class ) ) {
			return;
		}

		try {
			wpep()->logger()->event(
				'ticket-automation',
				Logger::STATUS_SKIPPED,
				$reason,
				array(
					'rule_id'    => $rule_id,
					'user_id'    => $user_id,
					'event_type' => $event_type,
					'object_id'  => $object_id,
				)
			);
		} catch ( \Throwable $ignored ) {
			unset( $ignored );
		}
	}

	/**
	 * Runs a delayed rule.
	 *
	 * @since 1.9.0
	 *
	 * @param array $rule    The rule.
	 * @param int   $user_id Recipient.
	 * @param array $context Token values.
	 *
	 * @return void
	 */
	public function fire_delayed( $rule, $user_id = 0, $context = array() ): void {
		if ( ! is_array( $rule ) ) {
			return;
		}

		$rule_id = sanitize_key( (string) ( $rule['id'] ?? '' ) );
		$user_id = (int) $user_id;

		if ( '' === $rule_id || $user_id <= 0 ) {
			return;
		}

		/*
		 * The claim was made when the job was queued, so this must not claim
		 * again — it would find its own reservation and refuse. What it does
		 * check is that the rule still exists and is still switched on: a
		 * delay of a week is long enough for an administrator to change their
		 * mind, and honouring a rule they have since turned off would be a
		 * message they explicitly stopped asking for.
		 */
		$live = null;

		foreach ( $this->rules() as $candidate ) {
			if ( sanitize_key( (string) ( $candidate['id'] ?? '' ) ) === $rule_id ) {
				$live = $candidate;
				break;
			}
		}

		// Derived exactly as fire_rule() derived it, or this releases a key
		// nobody holds and leaves the real reservation stuck for ever.
		$scope     = $this->event_scope( $rule );
		$object_id = $this->event_object_id( $rule, (array) $context );

		if ( ! $live || empty( $live['enabled'] ) ) {
			$this->log_skip( 'rule_disabled_before_delivery', $rule_id, $user_id, $scope, $object_id );
			AutomationLedger::release( $rule_id, $user_id, $scope, $object_id );

			return;
		}

		$ticket_id = $this->create_ticket( $live, $user_id, (array) $context );

		if ( $ticket_id > 0 ) {
			AutomationLedger::confirm( $rule_id, $user_id, $scope, $object_id, $ticket_id );

			return;
		}

		AutomationLedger::release( $rule_id, $user_id, $scope, $object_id );
	}

	/**
	 * Replaces the placeholders in one string.
	 *
	 * @since 1.9.0
	 *
	 * @param string              $text    Template.
	 * @param int                 $user_id Recipient.
	 * @param array<string,mixed> $context Token values.
	 *
	 * @return string Rendered text.
	 */
	private function render_tokens( string $text, int $user_id, array $context ): string {
		$user = get_user_by( 'id', $user_id );

		if ( ! $user ) {
			return $text;
		}

		$first = (string) get_user_meta( $user_id, 'first_name', true );

		$replace = array(
			// Falls back to the display name: a greeting with a hole where the
			// name should be reads worse than one using the name we do have.
			'{first_name}'    => '' !== trim( $first ) ? $first : (string) $user->display_name,
			'{display_name}'  => (string) $user->display_name,
			'{username}'      => (string) $user->user_login,
			'{site_name}'     => (string) get_bloginfo( 'name' ),
			'{login_url}'     => (string) wp_login_url(),
			'{profile_url}'   => (string) get_edit_user_link( $user_id ),
			'{post_title}'    => (string) ( $context['post_title'] ?? '' ),
			'{post_url}'      => ! empty( $context['post_id'] ) ? (string) get_permalink( (int) $context['post_id'] ) : '',
			'{reject_reason}' => (string) ( $context['reject_reason'] ?? '' ),
			'{order_id}'      => (string) ( $context['order_id'] ?? '' ),
			'{order_total}'   => (string) ( $context['order_total'] ?? '' ),
			'{order_items}'   => (string) ( $context['order_items'] ?? '' ),
			'{order_status}'  => (string) ( $context['order_status'] ?? '' ),
		);

		return strtr( $text, $replace );
	}

	/**
	 * Creates the ticket.
	 *
	 * @since 1.9.0
	 *
	 * @param array<string,mixed> $rule    The rule.
	 * @param int                 $user_id Recipient.
	 * @param array<string,mixed> $context Token values.
	 *
	 * @return void
	 */
	private function create_ticket( array $rule, int $user_id, array $context ): int {
		if ( $user_id <= 0 || ! get_user_by( 'id', $user_id ) ) {
			return 0;
		}

		/*
		 * GUARD 3b. A ceiling on one request.
		 *
		 * Normal operation creates one ticket, occasionally two. Reaching
		 * twenty means something is wrong, and the useful behaviour then is to
		 * stop and say so — not to keep going until the customer has hundreds
		 * of tickets and the request that started it has timed out.
		 */
		if ( self::$created >= self::MAX_PER_REQUEST ) {
			$this->log_anomaly( $rule, $user_id );

			return 0;
		}

		if ( self::$creating ) {
			return 0;
		}

		self::$creating = true;
		++self::$created;

		$ticket_id = 0;

		try {
			$subject = $this->render_tokens( (string) ( $rule['subject'] ?? '' ), $user_id, $context );
			$body    = $this->render_tokens( (string) ( $rule['body'] ?? '' ), $user_id, $context );

			$result = wpep()->tickets()->create_local_automated_ticket(
				$user_id,
				$subject,
				$body,
				array(
					'department'    => absint( $rule['department'] ?? 0 ),
					'category'      => absint( $rule['category'] ?? 0 ),
					'priority'      => (string) ( $rule['priority'] ?? 'normal' ),
					'automation_id' => (string) ( $rule['id'] ?? '' ),
					'allow_reply'   => ! empty( $rule['allow_reply'] ),
				)
			);

			if ( is_wp_error( $result ) ) {
				if ( class_exists( Logger::class ) ) {
					wpep()->logger()->event(
						'ticket-automation',
						Logger::STATUS_FAILED,
						$result->get_error_message(),
						array( 'rule_id' => (string) ( $rule['id'] ?? '' ), 'user_id' => $user_id )
					);
				}
			} else {
				$ticket_id = (int) $result;
			}
		} catch ( \Throwable $e ) {
			// One broken rule must not take down the request that triggered it
			// — publishing an advert has to succeed even if its notification
			// cannot be built.
			if ( class_exists( Logger::class ) ) {
				try {
					wpep()->logger()->event(
						'ticket-automation',
						Logger::STATUS_FAILED,
						$e->getMessage(),
						array( 'rule_id' => (string) ( $rule['id'] ?? '' ), 'user_id' => $user_id )
					);
				} catch ( \Throwable $ignored ) {
					unset( $ignored );
				}
			}
		} finally {
			self::$creating = false;
		}

		return $ticket_id;
	}

	/**
	 * Records that the per-request ceiling was hit.
	 *
	 * @since 1.9.0
	 *
	 * @param array<string,mixed> $rule    The rule that was refused.
	 * @param int                 $user_id Intended recipient.
	 *
	 * @return void
	 */
	private function log_anomaly( array $rule, int $user_id ): void {
		if ( ! empty( $GLOBALS['wpep_automation_capped'] ) ) {
			return;
		}

		$GLOBALS['wpep_automation_capped'] = true;

		if ( ! class_exists( Logger::class ) ) {
			return;
		}

		try {
			wpep()->logger()->event(
				'ticket-automation',
				Logger::STATUS_FAILED,
				sprintf(
					/* translators: %d: the ceiling. */
					__( 'در یک درخواست بیش از %d تیکت خودکار ساخته شد؛ ادامه متوقف شد. احتمالاً یکی از قانون‌ها خودش را دوباره فعال می‌کند.', 'wp-event-publisher' ),
					self::MAX_PER_REQUEST
				),
				array( 'rule_id' => (string) ( $rule['id'] ?? '' ), 'user_id' => $user_id )
			);
		} catch ( \Throwable $ignored ) {
			unset( $ignored );
		}
	}

	/**
	 * How many tickets automations have created during this request.
	 *
	 * Exposed so the tests can assert the ceiling holds.
	 *
	 * @since 1.9.0
	 *
	 * @return int Count.
	 */
	public static function created_this_request(): int {
		return self::$created;
	}

	/**
	 * Resets the per-request counters.
	 *
	 * Each web request is a fresh PHP process, so this exists for the tests
	 * and for long-running CLI passes.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public static function reset_request_state(): void {
		self::$created  = 0;
		self::$creating = false;

		unset( $GLOBALS['wpep_automation_capped'] );
	}

	/**
	 * A one-line plain-language description of a rule.
	 *
	 * @since 1.9.0
	 *
	 * @param array<string,mixed> $rule The rule.
	 *
	 * @return string Sentence.
	 */
	public function describe( array $rule ): string {
		$triggers   = $this->triggers();
		$conditions = $this->conditions();

		$trigger   = (string) ( $rule['trigger'] ?? '' );
		$condition = (string) ( $rule['condition'] ?? 'none' );

		$event = (string) ( $triggers[ $trigger ]['label'] ?? $trigger );
		$who   = (string) ( $conditions[ $condition ]['summary'] ?? '' );

		if ( 'role' === $condition || 'email_domain' === $condition || 'order_total_gte' === $condition ) {
			$who = sprintf( $who, (string) ( $rule['condition_value'] ?? '' ) );
		} elseif ( 'user_meta' === $condition ) {
			$who = sprintf( $who, (string) ( $rule['condition_key'] ?? '' ), (string) ( $rule['condition_value'] ?? '' ) );
		}

		return sprintf(
			/* translators: 1: event name, 2: audience, 3: ticket subject. */
			__( 'وقتی «%1$s» رخ دهد، %2$s تیکتی با عنوان «%3$s» ساخته می‌شود.', 'wp-event-publisher' ),
			$event,
			$who,
			(string) ( $rule['subject'] ?? '' )
		);
	}

	/**
	 * Reports what a rule WOULD do, without doing any of it.
	 *
	 * This exists because the cost of being wrong about an automation is not
	 * an error message — it is hundreds of messages sent to real customers
	 * that cannot be recalled. Being able to look first turns a rule from
	 * something you deploy and hope about into something you check.
	 *
	 * Nothing here writes: it asks `seen()` rather than `reserve()`, because
	 * reserving would consume the very events it is reporting on.
	 *
	 * @since 1.19.2
	 *
	 * @param array<string,mixed> $rule    The rule.
	 * @param int                 $limit   How many users to examine.
	 * @param int                 $only_user Restrict to one user, or 0.
	 *
	 * @return array<string,mixed> Report.
	 */
	public function dry_run( array $rule, int $limit = 200, int $only_user = 0 ): array {
		$report = array(
			'examined'   => 0,
			'matched'    => 0,
			'would_send' => 0,
			'already'    => 0,
			'skipped'    => 0,
			'reasons'    => array(),
			'sample'     => array(),
			'scan'       => false,
		);

		$rule_id = sanitize_key( (string) ( $rule['id'] ?? '' ) );

		if ( '' === $rule_id ) {
			return $report;
		}

		$trigger = (string) ( $rule['trigger'] ?? '' );
		$scope   = (string) ( $this->triggers()[ $trigger ]['scope'] ?? 'actor' );

		$report['scan'] = 'scan' === $scope;

		if ( $only_user > 0 ) {
			$users = array( $only_user );
		} elseif ( 'scan' === $scope ) {
			$users = array_map( 'intval', (array) get_users( array( 'number' => $limit, 'fields' => 'ID', 'orderby' => 'ID', 'order' => 'ASC' ) ) );
		} else {
			/*
			 * An event-driven rule has no audience until its event happens, so
			 * there is nothing to count. Saying so is more useful than
			 * reporting zero, which reads like the rule is broken.
			 */
			$report['reasons'][] = __( 'این قانون با یک رویداد اجرا می‌شود، پس تا وقتی آن رویداد رخ ندهد گیرنده‌ای ندارد. برای آزمایش، یک کاربر مشخص را انتخاب کنید.', 'wp-event-publisher' );

			return $report;
		}

		$event_scope = $this->event_scope( $rule );

		foreach ( $users as $user_id ) {
			++$report['examined'];

			$user = get_user_by( 'id', (int) $user_id );

			if ( ! $user ) {
				++$report['skipped'];
				continue;
			}

			if ( 'profile_completed' === $trigger ) {
				if ( $this->profile_incomplete( (int) $user_id ) ) {
					++$report['skipped'];
					continue;
				}
			} elseif ( ! $this->condition_matches( $rule, (int) $user_id, array() ) ) {
				++$report['skipped'];
				continue;
			}

			++$report['matched'];

			// Read-only: this asks whether the event has been handled, and
			// deliberately does not claim it.
			if ( AutomationLedger::seen( $rule_id, (int) $user_id, $event_scope, '' ) ) {
				++$report['already'];
				continue;
			}

			++$report['would_send'];

			if ( count( $report['sample'] ) < 5 ) {
				$report['sample'][] = (string) $user->display_name;
			}
		}

		return $report;
	}

	/**
	 * Runs a dry run from the screen.
	 *
	 * @since 1.19.2
	 *
	 * @return void
	 */
	public function handle_dry_run(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}

		check_admin_referer( self::NONCE );

		$id        = sanitize_key( (string) ( $_POST['rule_id'] ?? '' ) );
		$only_user = absint( $_POST['user_id'] ?? 0 );

		foreach ( $this->rules() as $rule ) {
			if ( $id !== (string) ( $rule['id'] ?? '' ) ) {
				continue;
			}

			set_transient(
				'wpep_dry_run_' . get_current_user_id(),
				array( 'rule' => $rule['name'] ?? '', 'report' => $this->dry_run( $rule, 200, $only_user ) ),
				5 * MINUTE_IN_SECONDS
			);

			break;
		}

		wp_safe_redirect( add_query_arg( 'automation', 'tested', Admin::app_url( 'ticket-automations' ) ) );
		exit;
	}

	/**
	 * Renders the screen.
	 *
	 * @since 1.9.0
	 *
	 * @return void
	 */
	public function render(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}

		$automations = $this;
		$rules       = $this->rules();
		$triggers    = $this->triggers();
		$conditions  = $this->conditions();
		$priorities  = $this->priorities();
		$presets     = $this->presets();
		$tokens      = $this->tokens();

		$departments = get_terms( array( 'taxonomy' => Tickets::TAXONOMY, 'hide_empty' => false ) );
		$categories  = get_terms( array( 'taxonomy' => Tickets::CATEGORY, 'hide_empty' => false ) );
		$departments = is_wp_error( $departments ) ? array() : $departments;
		$categories  = is_wp_error( $categories ) ? array() : $categories;

		$post_types = get_post_types( array( 'public' => true ), 'objects' );

		unset( $post_types[ Tickets::POST_TYPE ], $post_types[ Announcements::POST_TYPE ], $post_types['attachment'] );

		$roles = function_exists( 'wp_roles' ) ? wp_roles()->get_names() : array();

		$order_statuses = function_exists( 'wc_get_order_statuses' ) ? (array) wc_get_order_statuses() : array();

		$adopted = array();

		foreach ( $rules as $rule ) {
			if ( ! empty( $rule['from_preset'] ) ) {
				$adopted[] = (string) $rule['from_preset'];
			}
		}

		// The result of the last dry run, if one was just requested.
		$dry_run = get_transient( 'wpep_dry_run_' . get_current_user_id() );
		$dry_run = is_array( $dry_run ) ? $dry_run : null;

		if ( $dry_run ) {
			delete_transient( 'wpep_dry_run_' . get_current_user_id() );
		}

		$nonce_action = self::NONCE;

		include WPEP_PLUGIN_DIR . 'admin/views/ticket-automations.php';
	}
}
