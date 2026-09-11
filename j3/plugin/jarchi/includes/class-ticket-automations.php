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
	public const TEMPLATE_PAGE = 'jarchi-ticket-templates';
	public const TEMPLATE_CAPABILITY = 'jarchi_edit_ticket_templates';
	private const NONCE = 'wpep_ticket_automation';
	private const TEMPLATE_NONCE = 'wpep_ticket_template_editor';
	public const POST_TYPE_CUSTOM_PUBLIC = 'custom_public';

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

	/** Users whose registration request is still being assembled. */
	private static array $registering_profile_users = array();

	/** Profile completeness captured immediately before a watched meta change. */
	private static array $profile_before_change = array();

	/** Public posts whose bump-related meta changed during this request. */
	private static array $dirty_bump_posts = array();

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
		add_action( 'admin_post_wpep_ticket_automation_standard_pack', array( $this, 'enable_standard_pack' ) );
		add_action( 'admin_post_wpep_ticket_template_update', array( $this, 'save_template_text' ) );
		add_action( 'admin_menu', array( $this, 'register_template_editor_menu' ), 99 );

		add_action( 'user_register', array( $this, 'on_user_register' ), 20 );
		add_action( 'wp_login', array( $this, 'on_first_login' ), 20, 2 );
		add_action( 'transition_post_status', array( $this, 'on_post_status' ), 20, 3 );
		add_action( 'wp_after_insert_post', array( $this, 'on_after_insert_post' ), 30, 4 );

		/*
		 * The site's moderation screen announces its decisions explicitly.
		 * Those are better signals than a status transition — a transition
		 * says the advert moved to draft, an action says a moderator refused
		 * it — and the rejection one carries the reason as an argument, so it
		 * is right even if the meta were written after the redirect.
		 *
		 * Both paths are keyed identically in the ledger, so listening to the
		 * transition and the action cannot produce two tickets. The action
		 * names are filterable for sites whose moderation code differs.
		 */
		foreach ( (array) apply_filters( 'jarchi_moderation_approved_actions', array( 'iex_ad_approved', 'jarchi_advert_approved' ) ) as $wpep_hook ) {
			add_action( (string) $wpep_hook, array( $this, 'on_moderation_approved' ), 10, 1 );
		}

		foreach ( (array) apply_filters( 'jarchi_moderation_rejected_actions', array( 'iex_ad_rejected', 'jarchi_advert_rejected' ) ) as $wpep_hook ) {
			add_action( (string) $wpep_hook, array( $this, 'on_moderation_rejected' ), 10, 3 );
		}
		add_action( 'init', array( $this, 'upgrade_legacy_ad_presets_1234' ), 3 );
		add_action( 'init', array( $this, 'upgrade_legacy_custom_presets_1238' ), 4 );
		add_action( 'init', array( $this, 'upgrade_preset_departments_1250' ), 30 );
		add_action( 'init', array( $this, 'bootstrap_standard_pack_1250' ), 31 );
		add_action( 'init', array( $this, 'repair_legacy_automation_departments_1260' ), 32 );
		add_action( 'init', array( $this, 'upgrade_standard_pack_1261' ), 33 );
		add_action( 'init', array( $this, 'upgrade_standard_pack_1261_expiration' ), 34 );
		add_action( 'init', array( $this, 'upgrade_standard_pack_1262_comments' ), 35 );
		add_action( 'init', array( $this, 'upgrade_standard_pack_1263_bump' ), 36 );
		add_action( 'init', array( $this, 'upgrade_automation_pack_1266' ), 37 );
		add_action( 'admin_init', array( $this, 'sync_designer_template_capability' ), 20 );
		add_action( 'wp_insert_comment', array( $this, 'on_comment_inserted' ), 20, 2 );
		add_action( 'transition_comment_status', array( $this, 'on_comment_status' ), 20, 3 );
		add_filter( 'comment_notification_recipients', array( $this, 'filter_comment_notification_recipients' ), 20, 2 );
		add_filter( 'add_user_metadata', array( $this, 'capture_profile_before_meta_change' ), 20, 5 );
		add_filter( 'update_user_metadata', array( $this, 'capture_profile_before_meta_change' ), 20, 5 );
		add_action( 'added_user_meta', array( $this, 'on_profile_meta_changed' ), 30, 4 );
		add_action( 'updated_user_meta', array( $this, 'on_profile_meta_changed' ), 30, 4 );
		add_action( 'added_post_meta', array( $this, 'on_bump_post_meta_changed' ), 40, 4 );
		add_action( 'updated_post_meta', array( $this, 'on_bump_post_meta_changed' ), 40, 4 );
		add_action( 'profile_update', array( $this, 'on_profile_updated' ), 30, 2 );
		add_action( 'shutdown', array( $this, 'finalize_deferred_state' ), 20 );
		add_action( 'wp_trash_post', array( $this, 'on_user_trash_post' ), 5, 2 );
		add_action( 'before_delete_post', array( $this, 'on_user_delete_post' ), 5, 2 );

		// PublishPress Future integration. These hooks are intentionally optional:
		// WordPress simply never calls them when PublishPress Future is absent.
		add_action( 'publishpressfuture_schedule_expiration', array( $this, 'on_future_expiration_scheduled' ), 30, 3 );
		add_action( 'publishpressfuture_unschedule_expiration', array( $this, 'on_future_expiration_unscheduled' ), 30, 1 );
		add_action( 'publishpressfuture_post_expired', array( $this, 'on_future_post_expired' ), 5, 3 );
		add_action( 'jarchi_bump_expiry_reminder', array( $this, 'on_bump_expiry_reminder' ), 10, 3 );

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
			'post_update_pending'  => array(
				'label' => __( 'بروزرسانی آگهی در انتظار بررسی', 'wp-event-publisher' ),
				'hint'  => __( 'وقتی یک آگهی منتشرشده بعد از ویرایش دوباره به وضعیت «در انتظار بررسی» می‌رود.', 'wp-event-publisher' ),
				'scope' => 'actor',
				'needs' => array( 'post_type' ),
			),
			'post_self_deleted'    => array(
				'label' => __( 'حذف آگهی توسط صاحب آگهی', 'wp-event-publisher' ),
				'hint'  => __( 'وقتی خودِ نویسنده آگهی، آگهی خود را حذف یا به زباله‌دان منتقل می‌کند.', 'wp-event-publisher' ),
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
			'post_expired'         => array(
				'label' => __( 'انقضای آگهی', 'wp-event-publisher' ),
				'hint'  => __( 'وقتی PublishPress Future عمل انقضا را اجرا می‌کند، برای صاحب همان آگهی تیکت می‌فرستد.', 'wp-event-publisher' ),
				'scope' => 'actor',
				'needs' => array( 'post_type' ),
			),
			'comment_on_post'      => array(
				'label' => __( 'نظر جدید روی آگهی کاربر', 'wp-event-publisher' ),
				'hint'  => __( 'وقتی یک دیدگاه اصلیِ تأییدشده روی آگهی ثبت می‌شود. تیکت برای صاحب همان آگهی می‌رود.', 'wp-event-publisher' ),
				'scope' => 'actor',
				'needs' => array( 'post_type' ),
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
				'hint'  => __( 'بعد از ویرایش و ذخیره اطلاعات پروفایل فوراً بررسی می‌شود. هر کاربر فقط یک بار پیام می‌گیرد و کاربران قدیمی به‌صورت گروهی اسکن نمی‌شوند.', 'wp-event-publisher' ),
				'scope' => 'actor',
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
			'{comment_author}' => __( 'نام ارسال‌کننده دیدگاه', 'wp-event-publisher' ),
			'{profile_fields}' => __( 'فهرست اطلاعات تکمیل‌شده پروفایل', 'wp-event-publisher' ),
			'{expiration_date}' => __( 'تاریخ انقضای آگهی', 'wp-event-publisher' ),
			'{bump_expiration_date}' => __( 'تاریخ پایان نردبان آگهی', 'wp-event-publisher' ),
			'{reject_reason}' => __( 'دلیل رد آگهی به همراه توضیح داور (مثلاً: دلیل: تصویر نامناسب — لطفاً عکس واضح‌تری بگذارید)', 'wp-event-publisher' ),
			'{reject_note}'   => __( 'فقط توضیح تکمیلی داور، بدون عنوان دلیل', 'wp-event-publisher' ),
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
				'department' => array( 'name' => __( 'حساب کاربری', 'wp-event-publisher' ), 'slug' => 'account-support' ),
				'name'     => __( 'خوش‌آمدگویی پس از ثبت‌نام', 'wp-event-publisher' ),
				'trigger'  => 'user_register',
				'subject'  => __( 'خوش آمدید به {site_name} 🌱', 'wp-event-publisher' ),
				'body'     => __( 'سلام {first_name} عزیز، به {site_name} خوش آمدید. برای استفادهٔ بهتر از امکانات سایت، پیشنهاد می‌کنیم اطلاعات پروفایل خود را تکمیل کنید.', 'wp-event-publisher' ),
				'priority' => 'normal',
			),
			array(
				'slug'      => 'profile-incomplete',
				'department' => array( 'name' => __( 'حساب کاربری', 'wp-event-publisher' ), 'slug' => 'account-support' ),
				'name'      => __( 'یادآوری پروفایل ناقص', 'wp-event-publisher' ),
				'trigger'   => 'user_register',
				'condition' => 'profile_incomplete',
				'subject'   => __( 'پروفایل خود را تکمیل کنید', 'wp-event-publisher' ),
				'body'      => __( '{first_name} عزیز، بخشی از اطلاعات پروفایل شما هنوز تکمیل نشده است. تکمیل پروفایل باعث افزایش اعتبار حساب و اعتماد بیشتر کاربران می‌شود.', 'wp-event-publisher' ),
				'priority'  => 'normal',
			),
			array(
				'slug'     => 'profile-completed',
				'department' => array( 'name' => __( 'حساب کاربری', 'wp-event-publisher' ), 'slug' => 'account-support' ),
				'name'     => __( 'تشکر پس از تکمیل پروفایل', 'wp-event-publisher' ),
				'trigger'  => 'profile_completed',
				'subject'  => __( 'پروفایل شما تکمیل شد ✅', 'wp-event-publisher' ),
				'body'     => __( "سلام {first_name} عزیز،\nاطلاعات پروفایل شما با موفقیت تکمیل شد ✅\n\nاطلاعات تکمیل‌شده:\n{profile_fields}\n\nاکنون می‌توانید از امکانات {site_name} برای ثبت آگهی و ایجاد ارتباطات تجاری استفاده کنید.", 'wp-event-publisher' ),
				'priority' => 'normal',
			),
			array(
				'slug'     => 'post-approved',
				'department' => array( 'name' => __( 'پشتیبانی آگهی‌ها', 'wp-event-publisher' ), 'slug' => 'ads-support' ),
				'name'     => __( 'تأیید آگهی', 'wp-event-publisher' ),
				'trigger'  => 'post_published',
				'post_type' => self::POST_TYPE_CUSTOM_PUBLIC,
				'subject'  => __( 'آگهی شما منتشر شد ✅', 'wp-event-publisher' ),
				'body'     => __( "سلام {first_name} عزیز،\nآگهی «{post_title}» بررسی شد و مورد تأیید قرار گرفت ✅\n\nاز همین حالا برای همهٔ کاربران {site_name} قابل مشاهده است:\n{post_url}\n\nبرای دیده‌شدن بیشتر می‌توانید آگهی را نردبان کنید.", 'wp-event-publisher' ),
				'priority' => 'high',
			),
			array(
				'slug'     => 'post-rejected',
				'department' => array( 'name' => __( 'پشتیبانی آگهی‌ها', 'wp-event-publisher' ), 'slug' => 'ads-support' ),
				'name'     => __( 'رد آگهی', 'wp-event-publisher' ),
				'trigger'  => 'post_unpublished',
				'post_type' => self::POST_TYPE_CUSTOM_PUBLIC,
				'subject'  => __( 'آگهی شما تأیید نشد ❌', 'wp-event-publisher' ),
				/*
				 * The reason is on its own line and the sentence before it does
				 * not promise one. The old copy said "please review the stated
				 * reason" and then printed an empty token, so every rejection
				 * pointed at something that was not there.
				 */
				'body'     => __( "سلام {first_name} عزیز،\nآگهی «{post_title}» در بررسی تأیید نشد.\n\n{reject_reason}\n\nپس از اصلاح موارد بالا می‌توانید آگهی را دوباره ثبت کنید. اگر سؤالی دارید، همین‌جا پاسخ دهید تا بررسی کنیم.", 'wp-event-publisher' ),
				'priority' => 'high',
			),
			array(
				'slug'      => 'post-update-pending',
				'department' => array( 'name' => __( 'پشتیبانی آگهی‌ها', 'wp-event-publisher' ), 'slug' => 'ads-support' ),
				'name'      => __( 'درخواست بروزرسانی آگهی در انتظار بررسی', 'wp-event-publisher' ),
				'trigger'   => 'post_update_pending',
				'post_type' => self::POST_TYPE_CUSTOM_PUBLIC,
				'subject'   => __( 'درخواست بروزرسانی آگهی در انتظار بررسی ⏳', 'wp-event-publisher' ),
				'body'      => __( "سلام {first_name} عزیز،\nدرخواست بروزرسانی آگهی «{post_title}» با موفقیت ثبت شد و در حال حاضر منتظر بررسی و تأیید تیم ایران اگزیم است.", 'wp-event-publisher' ),
				'priority'  => 'normal',
			),
			array(
				'slug'      => 'post-self-deleted',
				'department' => array( 'name' => __( 'پشتیبانی آگهی‌ها', 'wp-event-publisher' ), 'slug' => 'ads-support' ),
				'name'      => __( 'حذف آگهی توسط کاربر', 'wp-event-publisher' ),
				'trigger'   => 'post_self_deleted',
				'post_type' => self::POST_TYPE_CUSTOM_PUBLIC,
				'subject'   => __( 'آگهی شما حذف شد 🗑', 'wp-event-publisher' ),
				'body'      => __( "سلام {first_name} عزیز،\nآگهی «{post_title}» با درخواست شما از ایران اگزیم حذف شد.\nاز این پس این آگهی برای کاربران نمایش داده نمی‌شود. در صورت نیاز می‌توانید آگهی جدیدی ثبت کنید.", 'wp-event-publisher' ),
				'priority'  => 'normal',
			),
			array(
				'slug'      => 'post-expired',
				'department' => array( 'name' => __( 'پشتیبانی آگهی‌ها', 'wp-event-publisher' ), 'slug' => 'ads-support' ),
				'name'      => __( 'انقضای آگهی', 'wp-event-publisher' ),
				'trigger'   => 'post_expired',
				'post_type' => self::POST_TYPE_CUSTOM_PUBLIC,
				'subject'   => __( 'آگهی شما منقضی شد ⌛', 'wp-event-publisher' ),
				'body'      => __( "سلام {first_name} عزیز،\nاعتبار آگهی «{post_title}» به پایان رسید و آگهی منقضی شد.\nدر صورت نیاز می‌توانید آن را تمدید یا آگهی جدیدی ثبت کنید.", 'wp-event-publisher' ),
				'priority'  => 'normal',
			),
			array(
				'slug'      => 'comment-on-post',
				'department' => array( 'name' => __( 'پشتیبانی آگهی‌ها', 'wp-event-publisher' ), 'slug' => 'ads-support' ),
				'name'      => __( 'نظر جدید روی آگهی', 'wp-event-publisher' ),
				'trigger'   => 'comment_on_post',
				'post_type' => self::POST_TYPE_CUSTOM_PUBLIC,
				'subject'   => __( 'نظر جدید برای آگهی شما 💬', 'wp-event-publisher' ),
				'body'      => __( "سلام {first_name} عزیز،\nیک نظر جدید برای آگهی «{post_title}» ثبت شده است.\nبرای مشاهده متن نظر و پاسخ به کاربر، وارد صفحه آگهی شوید.\n\nارسال‌کننده نظر: {comment_author}\nمشاهده آگهی: {post_url}", 'wp-event-publisher' ),
				'priority'  => 'normal',
			),
			array(
				'slug'     => 'comment-reply',
				'department' => array( 'name' => __( 'پشتیبانی آگهی‌ها', 'wp-event-publisher' ), 'slug' => 'ads-support' ),
				'name'     => __( 'پاسخ روی دیدگاه', 'wp-event-publisher' ),
				'trigger'  => 'comment_reply',
				'subject'  => __( 'پاسخ جدید برای آگهی شما 💬', 'wp-event-publisher' ),
				'body'     => __( "سلام {first_name} عزیز،\nیک پاسخ جدید برای دیدگاه شما در آگهی «{post_title}» ثبت شده است.\nبرای مشاهده متن پاسخ و ادامه گفتگو، وارد صفحه آگهی شوید.\n\nارسال‌کننده پاسخ: {comment_author}\nمشاهده آگهی: {post_url}", 'wp-event-publisher' ),
				'priority' => 'normal',
			),
			array(
				'slug'      => 'post-bumped',
				'department' => array( 'name' => __( 'پشتیبانی آگهی‌ها', 'wp-event-publisher' ), 'slug' => 'ads-support' ),
				'name'      => __( 'نردبان آگهی', 'wp-event-publisher' ),
				'trigger'   => 'custom_hook',
				'hook_slug' => 'post_bumped',
				'subject'   => __( 'آگهی شما نردبان شد 🚀', 'wp-event-publisher' ),
				'body'      => __( 'آگهی «{post_title}» با موفقیت نردبان شد و برای دیده‌شدن بیشتر به جایگاه بالاتری منتقل شد.', 'wp-event-publisher' ),
				'priority'  => 'normal',
			),
			array(
				'slug'      => 'post-bump-expiring',
				'department' => array( 'name' => __( 'پشتیبانی آگهی‌ها', 'wp-event-publisher' ), 'slug' => 'ads-support' ),
				'name'      => __( 'دو روز مانده تا پایان نردبان آگهی', 'wp-event-publisher' ),
				'trigger'   => 'custom_hook',
				'hook_slug' => 'post_bump_expiring',
				'subject'   => __( '۲ روز تا پایان نردبان آگهی شما ⏳', 'wp-event-publisher' ),
				'body'      => __( "سلام {first_name} عزیز،\nتنها ۲ روز تا پایان نردبان آگهی «{post_title}» باقی مانده است.\nدر صورت نیاز می‌توانید دوباره آگهی را نردبان کنید تا جایگاه آن حفظ شود.\n\nتاریخ پایان نردبان: {bump_expiration_date}\nمشاهده آگهی: {post_url}", 'wp-event-publisher' ),
				'priority'  => 'normal',
			),
			array(
				'slug'     => 'order-created',
				'department' => array( 'name' => __( 'پیگیری سفارشات', 'wp-event-publisher' ), 'slug' => 'order-support' ),
				'name'     => __( 'ثبت سفارش با مشخصات', 'wp-event-publisher' ),
				'trigger'  => 'order_created',
				'subject'  => __( 'سفارش شما ثبت شد — شمارهٔ {order_id}', 'wp-event-publisher' ),
				'body'     => __( "{first_name} عزیز، سفارش شما با مشخصات زیر ثبت شد:\n\nشمارهٔ سفارش: {order_id}\nمبلغ: {order_total}\nوضعیت: {order_status}\n\nاقلام سفارش:\n{order_items}\n\nهر تغییری در وضعیت سفارش از همین‌جا به اطلاع شما می‌رسد.", 'wp-event-publisher' ),
				'priority' => 'high',
			),
			array(
				'slug'     => 'order-status',
				'department' => array( 'name' => __( 'پیگیری سفارشات', 'wp-event-publisher' ), 'slug' => 'order-support' ),
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
	 * Repairs the old ready-made advert presets.
	 *
	 * Before 1.23.4 applying "تأیید آگهی" did not submit a post_type at all;
	 * sanitize_rule() silently stored `post`, so JetEngine CPT adverts could
	 * never match even though the rule looked enabled in the UI. Only rules
	 * carrying the preset marker are migrated; a hand-written rule deliberately
	 * targeting normal blog posts stays untouched.
	 *
	 * @since 1.23.4
	 */
	public function upgrade_legacy_ad_presets_1234(): void {
		if ( get_option( '_jarchi_ticket_automation_1234_upgraded', false ) ) {
			return;
		}
		$rules = $this->rules();
		$changed = false;
		foreach ( $rules as $i => $rule ) {
			$preset = sanitize_key( (string) ( $rule['from_preset'] ?? '' ) );
			$type   = sanitize_key( (string) ( $rule['post_type'] ?? '' ) );
			if ( in_array( $preset, array( 'post-approved', 'post-rejected' ), true ) && ( '' === $type || 'post' === $type ) ) {
				$rules[ $i ]['post_type'] = self::POST_TYPE_CUSTOM_PUBLIC;
				$changed = true;
			}
		}
		if ( $changed ) {
			update_option( self::OPTION, array_values( $rules ), false );
		}
		update_option( '_jarchi_ticket_automation_1234_upgraded', '1', false );
	}

	/**
	 * Ensures a ready-made preset's support department exists.
	 *
	 * @since 1.25.0
	 */
	private function ensure_preset_department( array $preset ): int {
		$definition = isset( $preset['department'] ) && is_array( $preset['department'] ) ? $preset['department'] : array();
		$name = sanitize_text_field( (string) ( $definition['name'] ?? '' ) );
		$slug = sanitize_title( (string) ( $definition['slug'] ?? '' ) );
		if ( '' === $name ) { return 0; }

		$existing = $slug ? get_term_by( 'slug', $slug, Tickets::TAXONOMY ) : false;
		if ( ! $existing ) { $existing = get_term_by( 'name', $name, Tickets::TAXONOMY ); }
		if ( $existing instanceof \WP_Term ) { return (int) $existing->term_id; }

		$created = wp_insert_term( $name, Tickets::TAXONOMY, $slug ? array( 'slug' => $slug ) : array() );
		if ( is_wp_error( $created ) ) {
			$term_exists = (int) $created->get_error_data( 'term_exists' );
			return $term_exists > 0 ? $term_exists : 0;
		}
		return (int) ( $created['term_id'] ?? 0 );
	}

	/**
	 * Repairs adopted presets that have no department without overwriting a
	 * deliberate administrator choice.
	 *
	 * @since 1.25.0
	 */
	public function upgrade_preset_departments_1250(): void {
		if ( get_option( '_jarchi_ticket_preset_departments_1250', false ) ) { return; }
		$presets = array();
		foreach ( $this->presets() as $preset ) { $presets[ (string) ( $preset['slug'] ?? '' ) ] = $preset; }
		$rules = $this->rules();
		$changed = false;
		foreach ( $rules as $i => $rule ) {
			if ( absint( $rule['department'] ?? 0 ) > 0 ) { continue; }
			$slug = sanitize_key( (string) ( $rule['from_preset'] ?? '' ) );
			if ( '' === $slug || empty( $presets[ $slug ] ) ) { continue; }
			$department_id = $this->ensure_preset_department( $presets[ $slug ] );
			if ( $department_id > 0 ) { $rules[ $i ]['department'] = $department_id; $changed = true; }
		}
		if ( $changed ) { update_option( self::OPTION, array_values( $rules ), false ); }
		update_option( '_jarchi_ticket_preset_departments_1250', '1', false );
	}


	/**
	 * Repairs automated tickets that were created before preset departments
	 * were attached to the ticket itself.
	 *
	 * 1.25.0 repaired the RULE, but tickets already sitting in a customer's
	 * inbox still had no department term. Their sender therefore stayed a bare
	 * "جارچی" and the customer list showed "عمومی" forever. This migration
	 * repairs the records too: rule id first, then the known preset subject as a
	 * backwards-compatible fallback.
	 *
	 * @since 1.26.0
	 */
	public function repair_legacy_automation_departments_1260(): void {
		if ( get_option( '_jarchi_ticket_automation_departments_1260', false ) ) {
			return;
		}

		$rules       = $this->rules();
		$rules_by_id = array();
		foreach ( $rules as $rule ) {
			$id = sanitize_key( (string) ( $rule['id'] ?? '' ) );
			if ( '' !== $id ) { $rules_by_id[ $id ] = $rule; }
		}

		$presets = array();
		foreach ( $this->presets() as $preset ) {
			$slug = sanitize_key( (string) ( $preset['slug'] ?? '' ) );
			if ( '' !== $slug ) { $presets[ $slug ] = $preset; }
		}

		$ticket_ids = get_posts(
			array(
				'post_type'              => Tickets::POST_TYPE,
				'post_status'            => array( 'private', 'publish', 'draft' ),
				'posts_per_page'         => -1,
				'fields'                 => 'ids',
				'orderby'                => 'ID',
				'order'                  => 'ASC',
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
			)
		);

		foreach ( $ticket_ids as $ticket_id ) {
			$ticket_id = absint( $ticket_id );
			if ( $ticket_id <= 0 ) { continue; }

			$origin        = sanitize_key( (string) get_post_meta( $ticket_id, '_jarchi_ticket_origin', true ) );
			$automation_id = sanitize_key( (string) get_post_meta( $ticket_id, '_jarchi_ticket_automation_id', true ) );
			$sender_label  = trim( (string) get_post_meta( $ticket_id, '_jarchi_ticket_sender_label', true ) );
			$is_automated  = 'automation' === $origin
				|| '1' === (string) get_post_meta( $ticket_id, Tickets::META_AUTOMATED, true )
				|| '' !== $automation_id
				|| str_starts_with( $sender_label, 'جارچی' );

			$first = get_comments(
				array(
					'post_id' => $ticket_id,
					'type'    => Tickets::COMMENT_TYPE,
					'number'  => 1,
					'orderby' => 'comment_ID',
					'order'   => 'ASC',
				)
			);
			$first_comment = ! empty( $first ) ? $first[0] : null;
			if ( $first_comment && '1' === (string) get_comment_meta( (int) $first_comment->comment_ID, '_jarchi_ticket_automated', true ) ) {
				$is_automated = true;
			}

			$preset_slug   = '';
			$department_id = 0;
			if ( '' !== $automation_id && isset( $rules_by_id[ $automation_id ] ) ) {
				$rule          = $rules_by_id[ $automation_id ];
				$department_id = absint( $rule['department'] ?? 0 );
				$preset_slug   = sanitize_key( (string) ( $rule['from_preset'] ?? '' ) );
				$is_automated  = true;
			}

			/*
			 * Very old tickets can predate the automation id meta. Only inspect
			 * known Jarchi presets, and only for tickets that already carry an
			 * automation signal. Tokens in preset subjects are treated as a small
			 * wildcard (site name/order id/etc.).
			 */
			if ( $is_automated && '' === $preset_slug ) {
				$title = trim( (string) get_the_title( $ticket_id ) );
				foreach ( $presets as $slug => $preset ) {
					$pattern = preg_quote( trim( (string) ( $preset['subject'] ?? '' ) ), '/' );
					$pattern = preg_replace( '/\\\\\{[^}]+\\\\\}/u', '.+?', $pattern );
					if ( '' !== $pattern && preg_match( '/^' . $pattern . '$/u', $title ) ) {
						$preset_slug = $slug;
						break;
					}
				}
			}

			$terms = wp_get_post_terms( $ticket_id, Tickets::TAXONOMY );
			if ( $department_id <= 0 && ! is_wp_error( $terms ) && ! empty( $terms ) ) {
				$department_id = (int) $terms[0]->term_id;
			}
			if ( $department_id <= 0 && '' !== $preset_slug && isset( $presets[ $preset_slug ] ) ) {
				$department_id = $this->ensure_preset_department( $presets[ $preset_slug ] );
			}

			if ( ! $is_automated || $department_id <= 0 ) {
				continue;
			}

			if ( is_wp_error( $terms ) || empty( $terms ) || (int) $terms[0]->term_id !== $department_id ) {
				wp_set_post_terms( $ticket_id, array( $department_id ), Tickets::TAXONOMY, false );
			}
			$department = get_term( $department_id, Tickets::TAXONOMY );
			$sender     = $department instanceof \WP_Term
				? sprintf( __( 'جارچی — %s', 'wp-event-publisher' ), (string) $department->name )
				: __( 'جارچی', 'wp-event-publisher' );

			update_post_meta( $ticket_id, Tickets::META_AUTOMATED, '1' );
			update_post_meta( $ticket_id, '_jarchi_ticket_origin', 'automation' );
			update_post_meta( $ticket_id, '_jarchi_ticket_sender_label', $sender );

			if ( $first_comment ) {
				wp_update_comment(
					array(
						'comment_ID'     => (int) $first_comment->comment_ID,
						'comment_author' => $sender,
					)
				);
				update_comment_meta( (int) $first_comment->comment_ID, '_jarchi_ticket_sender', 'admin' );
				update_comment_meta( (int) $first_comment->comment_ID, '_jarchi_ticket_automated', '1' );
			}
		}

		update_option( '_jarchi_ticket_automation_departments_1260', '1', false );
	}

	/**
	 * Zero-config starter pack for new event-driven activity. Existing rules are
	 * never forced on; only missing safe presets are provisioned.
	 *
	 * @since 1.25.0
	 */
	public function bootstrap_standard_pack_1250(): void {
		if ( get_option( '_jarchi_ticket_standard_pack_1250', false ) ) { return; }
		$this->ensure_standard_pack_rules( false );
		update_option( '_jarchi_ticket_standard_pack_1250', '1', false );
	}

	/**
	 * Creates missing standard rules and optionally re-enables existing ones.
	 *
	 * @param bool $enable_existing Whether existing preset-derived rules should be enabled.
	 */
	private function ensure_standard_pack_rules( bool $enable_existing ): void {
		$wanted = array( 'welcome', 'profile-incomplete', 'profile-completed', 'post-approved', 'post-rejected', 'post-update-pending', 'post-self-deleted', 'post-expired', 'comment-on-post', 'comment-reply', 'post-bumped', 'post-bump-expiring' );
		$presets = array();
		foreach ( $this->presets() as $preset ) { $presets[ (string) $preset['slug'] ] = $preset; }
		$rules = $this->rules();

		foreach ( $wanted as $slug ) {
			if ( ! isset( $presets[ $slug ] ) ) { continue; }
			$preset = $presets[ $slug ];
			$department_id = $this->ensure_preset_department( $preset );
			$found = false;
			foreach ( $rules as $i => $rule ) {
				if ( $slug !== sanitize_key( (string) ( $rule['from_preset'] ?? '' ) ) ) { continue; }
				if ( $enable_existing ) { $rules[ $i ]['enabled'] = true; }
				if ( in_array( $slug, array( 'post-approved', 'post-rejected', 'post-update-pending', 'post-self-deleted', 'post-expired', 'comment-on-post' ), true ) ) { $rules[ $i ]['post_type'] = self::POST_TYPE_CUSTOM_PUBLIC; }
				if ( 'profile-incomplete' === $slug && 'scheduled' === (string) ( $rules[ $i ]['trigger'] ?? '' ) ) {
					$rules[ $i ]['trigger'] = 'user_register';
					$rules[ $i ]['once_per_user'] = true;
				}
				if ( 'profile-completed' === $slug ) { $rules[ $i ]['once_per_user'] = true; }
				if ( $department_id > 0 && absint( $rules[ $i ]['department'] ?? 0 ) <= 0 ) { $rules[ $i ]['department'] = $department_id; }
				if ( 'role' === (string) ( $rules[ $i ]['condition'] ?? '' ) && '' === trim( (string) ( $rules[ $i ]['condition_value'] ?? '' ) ) ) {
					$rules[ $i ]['condition'] = 'none';
					$rules[ $i ]['condition_value'] = '';
				}
				$found = true;
				break;
			}
			if ( $found ) { continue; }
			$rules[] = $this->sanitize_rule(
				array(
					'name'          => $preset['name'],
					'enabled'       => true,
					'trigger'       => $preset['trigger'],
					'condition'     => $preset['condition'] ?? 'none',
					'subject'       => $preset['subject'],
					'body'          => $preset['body'],
					'department'    => $department_id,
					'priority'      => $preset['priority'],
					'once_per_user' => in_array( $preset['trigger'], array( 'user_register', 'profile_completed' ), true ),
					'allow_reply'   => false,
					'post_type'     => $preset['post_type'] ?? 'post',
					'hook_slug'     => $preset['hook_slug'] ?? '',
					'from_preset'   => $slug,
				)
			);
		}
		update_option( self::OPTION, array_values( $rules ), false );
	}

	/**
	 * Makes the Iran-Exim standard automation pack usable without manual setup.
	 *
	 * Existing preset-derived rules are enabled, missing safe rules are added,
	 * and the old hourly profile-incomplete preset is converted to the much safer
	 * registration event so an upgrade cannot message an entire legacy user base.
	 *
	 * @since 1.26.1
	 */
	public function upgrade_standard_pack_1261(): void {
		if ( get_option( '_jarchi_ticket_standard_pack_1261', false ) ) { return; }
		$this->ensure_standard_pack_rules( true );
		update_option( '_jarchi_ticket_standard_pack_1261', '1', false );
	}


	/** Ensures expiry presets are adopted even on an early 1.26.1 build. */
	public function upgrade_standard_pack_1261_expiration(): void {
		if ( get_option( '_jarchi_ticket_standard_pack_1261_expiration', false ) ) { return; }
		$this->ensure_standard_pack_rules( true );
		update_option( '_jarchi_ticket_standard_pack_1261_expiration', '1', false );
	}


	/**
	 * Repairs the built-in comment automations introduced in 1.26.1/1.26.2.
	 *
	 * A previous package registered this updater on `init` but accidentally
	 * omitted the callback itself. WordPress therefore hit an invalid callback
	 * while loading wp-admin. Keep this migration small and idempotent so old
	 * installs recover on the first request after upgrading.
	 *
	 * @since 1.26.4
	 */
	public function upgrade_standard_pack_1262_comments(): void {
		if ( get_option( '_jarchi_ticket_standard_pack_1262_comments', false ) ) { return; }

		$this->ensure_standard_pack_rules( true );
		$rules   = $this->rules();
		$changed = false;
		$legacy_body = 'یک پاسخ جدید برای دیدگاه شما در آگهی «{post_title}» ثبت شده است. برای مشاهدهٔ پاسخ وارد صفحهٔ آگهی شوید.';
		$stock_body  = "سلام {first_name} عزیز،\nیک پاسخ جدید برای دیدگاه شما در آگهی «{post_title}» ثبت شده است.\nبرای مشاهده متن پاسخ و ادامه گفتگو، وارد صفحه آگهی شوید.\n\nارسال‌کننده پاسخ: {comment_author}\nمشاهده آگهی: {post_url}";

		foreach ( $rules as $i => $rule ) {
			$slug = sanitize_key( (string) ( $rule['from_preset'] ?? '' ) );

			if ( 'comment-on-post' === $slug ) {
				$rules[ $i ]['enabled']   = true;
				$rules[ $i ]['post_type'] = self::POST_TYPE_CUSTOM_PUBLIC;
				$changed = true;
			}

			if ( 'comment-reply' === $slug ) {
				$rules[ $i ]['enabled'] = true;
				$body = trim( (string) ( $rule['body'] ?? '' ) );
				if ( '' === $body || $legacy_body === $body ) {
					$rules[ $i ]['body'] = $stock_body;
				}
				$changed = true;
			}
		}

		if ( $changed ) {
			update_option( self::OPTION, array_values( $rules ), false );
		}
		update_option( '_jarchi_ticket_standard_pack_1262_comments', '1', false );
	}

	/**
	 * Makes ladder automations event-driven and zero-config where possible.
	 *
	 * 1.26.2 still omitted the actual `post-bumped` preset from the standard
	 * pack, so a correct site event could fire with no enabled rule listening.
	 * It also waited for a second custom event at the exact end of the ladder.
	 * From 1.26.3 the activation rule is enabled and the plugin schedules its
	 * own reminder for two days before the recorded ladder expiry.
	 *
	 * @since 1.26.3
	 */
	public function upgrade_standard_pack_1263_bump(): void {
		if ( get_option( '_jarchi_ticket_standard_pack_1263_bump', false ) ) { return; }

		$this->ensure_standard_pack_rules( true );
		$rules   = $this->rules();
		$changed = false;

		foreach ( $rules as $i => $rule ) {
			$slug = sanitize_key( (string) ( $rule['from_preset'] ?? '' ) );
			if ( 'post-bumped' === $slug ) {
				$rules[ $i ]['enabled']   = true;
				$rules[ $i ]['trigger']   = 'custom_hook';
				$rules[ $i ]['hook_slug'] = 'post_bumped';
				$changed = true;
			}
			if ( 'post-bump-expiring' === $slug ) {
				$rules[ $i ]['enabled']   = true;
				$rules[ $i ]['trigger']   = 'custom_hook';
				$rules[ $i ]['hook_slug'] = 'post_bump_expiring';
				$changed = true;
			}
			if ( 'post-bump-ended' === $slug && 'post_bump_ended' === sanitize_key( (string) ( $rule['hook_slug'] ?? '' ) ) ) {
				// The stock end-of-ladder message is replaced by the two-day warning.
				// A manually created custom rule is not touched.
				$rules[ $i ]['enabled'] = false;
				$changed = true;
			}
		}

		if ( $changed ) {
			update_option( self::OPTION, array_values( $rules ), false );
		}
		update_option( '_jarchi_ticket_standard_pack_1263_bump', '1', false );
	}


	/**
	 * 1.26.6 cleanup and behaviour migration.
	 *
	 * - removes the old seven-day advert-expiry rule and pending cron jobs;
	 * - removes the obsolete end-of-ladder preset in favour of the 48-hour warning;
	 * - forces the real bump-start and bump-expiring presets on;
	 * - removes the 1.26.5 role-picker option while retaining safe Designer copy access.
	 *
	 * @since 1.26.6
	 */
	public function upgrade_automation_pack_1266(): void {
		if ( get_option( '_jarchi_ticket_automation_pack_1266', false ) ) { return; }

		$this->ensure_standard_pack_rules( true );
		$rules = array();
		foreach ( $this->rules() as $rule ) {
			$slug    = sanitize_key( (string) ( $rule['from_preset'] ?? '' ) );
			$trigger = sanitize_key( (string) ( $rule['trigger'] ?? '' ) );
			$hook    = sanitize_key( (string) ( $rule['hook_slug'] ?? '' ) );

			// The seven-day advert-expiry automation is intentionally gone.
			if ( 'post_expiring_soon' === $trigger || 'post-expiring-soon' === $slug ) { continue; }
			// The old "ladder ended" stock notification is replaced by 48 hours remaining.
			if ( 'post-bump-ended' === $slug || 'post_bump_ended' === $hook ) { continue; }

			if ( 'post-bumped' === $slug ) {
				$rule['enabled']   = true;
				$rule['trigger']   = 'custom_hook';
				$rule['hook_slug'] = 'post_bumped';
			}
			if ( 'post-bump-expiring' === $slug ) {
				$rule['enabled']   = true;
				$rule['trigger']   = 'custom_hook';
				$rule['hook_slug'] = 'post_bump_expiring';
			}
			if ( 'profile-completed' === $slug ) {
				$rule['enabled']       = true;
				$rule['trigger']       = 'profile_completed';
				$rule['once_per_user'] = true;
			}
			$rules[] = $rule;
		}
		update_option( self::OPTION, array_values( $rules ), false );

		// Remove every old seven-day single event. Final expiry tracking remains.
		wp_clear_scheduled_hook( 'jarchi_post_expiry_reminder' );
		delete_option( 'wpep_ticket_template_editor_roles' );
		$this->sync_designer_template_capability();
		update_option( '_jarchi_ticket_automation_pack_1266', '1', false );
	}

	/**
	 * Repairs legacy custom-event presets whose event/condition fields were
	 * stored empty by older screens. Only known Jarchi presets are touched.
	 *
	 * @since 1.23.8
	 */
	public function upgrade_legacy_custom_presets_1238(): void {
		if ( get_option( '_jarchi_ticket_automation_1238_upgraded', false ) ) {
			return;
		}

		$known = array(
			'post-bumped'    => 'post_bumped',
			'post-bump-ended' => 'post_bump_ended',
		);
		$rules = $this->rules();
		$changed = false;

		foreach ( $rules as $i => $rule ) {
			$preset = sanitize_key( (string) ( $rule['from_preset'] ?? '' ) );
			if ( ! isset( $known[ $preset ] ) ) {
				continue;
			}

			if ( '' === sanitize_key( (string) ( $rule['hook_slug'] ?? '' ) ) ) {
				$rules[ $i ]['hook_slug'] = $known[ $preset ];
				$changed = true;
			}

			// An old preset could accidentally store the role condition with no
			// role value, making a visually enabled rule impossible to match.
			if ( 'role' === (string) ( $rule['condition'] ?? '' ) && '' === trim( (string) ( $rule['condition_value'] ?? '' ) ) ) {
				$rules[ $i ]['condition'] = 'none';
				$rules[ $i ]['condition_value'] = '';
				$changed = true;
			}
		}

		if ( $changed ) {
			update_option( self::OPTION, array_values( $rules ), false );
		}
		update_option( '_jarchi_ticket_automation_1238_upgraded', '1', false );
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
		wp_clear_scheduled_hook( 'jarchi_post_expiry_reminder' );
		wp_clear_scheduled_hook( 'jarchi_bump_expiry_reminder' );
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

			if ( 'scheduled' === (string) ( $rule['trigger'] ?? '' ) ) {
				return true;
			}
			if ( 'custom_hook' === (string) ( $rule['trigger'] ?? '' ) && 'post_bump_expiring' === sanitize_key( (string) ( $rule['hook_slug'] ?? '' ) ) ) {
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
	 * Safe template editing.
	 * ================================================================== */

	/**
	 * Keeps copy editing available to administrators and an actual Designer/طراح
	 * role without exposing a role-permission panel in Jarchi.
	 *
	 * @since 1.26.6
	 */
	public function sync_designer_template_capability(): void {
		if ( ! function_exists( 'wp_roles' ) ) { return; }
		$wp_roles = wp_roles();
		if ( ! $wp_roles ) { return; }

		foreach ( (array) $wp_roles->roles as $role_key => $role_data ) {
			$role = get_role( (string) $role_key );
			if ( ! $role ) { continue; }
			$name = (string) ( $role_data['name'] ?? '' );
			$haystack = strtolower( (string) $role_key . ' ' . $name );
			$designer = str_contains( $haystack, 'designer' ) || str_contains( $haystack, 'طراح' );
			if ( 'administrator' === (string) $role_key || $designer ) {
				$role->add_cap( self::TEMPLATE_CAPABILITY );
			} else {
				$role->remove_cap( self::TEMPLATE_CAPABILITY );
			}
		}
	}

	/** Whether the current user may change automatic-ticket title/body copy. */
	private function can_edit_templates(): bool {
		return current_user_can( Admin::CAPABILITY ) || current_user_can( self::TEMPLATE_CAPABILITY );
	}

	/**
	 * Designers get a compact copy-only screen. Administrators edit inline from
	 * the main automatic-ticket page through the per-rule popup.
	 */
	public function register_template_editor_menu(): void {
		if ( ! $this->can_edit_templates() || current_user_can( Admin::CAPABILITY ) ) { return; }
		add_menu_page(
			__( 'تیکت‌های خودکار جارچی', 'wp-event-publisher' ),
			__( 'تیکت‌های خودکار', 'wp-event-publisher' ),
			self::TEMPLATE_CAPABILITY,
			self::TEMPLATE_PAGE,
			array( $this, 'render_template_editor' ),
			'dashicons-edit-page',
			26
		);
	}

	/** URL to the restricted copy editor for Designer/طراح users. */
	public function template_editor_url(): string {
		return admin_url( 'admin.php?page=' . self::TEMPLATE_PAGE );
	}

	/** Every automatic ticket can have its copy edited; mechanics remain locked. */
	private function editable_template_rules(): array {
		return array_values( $this->rules() );
	}

	/** Saves only subject/body for one rule and preserves all mechanics. */
	public function save_template_text(): void {
		if ( ! $this->can_edit_templates() ) {
			wp_die( esc_html__( 'اجازه ویرایش متن تیکت‌های خودکار را ندارید.', 'wp-event-publisher' ) );
		}
		check_admin_referer( self::TEMPLATE_NONCE );
		$id      = sanitize_key( (string) ( $_POST['rule_id'] ?? '' ) );
		$subject = sanitize_text_field( wp_unslash( (string) ( $_POST['subject'] ?? '' ) ) );
		$body    = wp_kses_post( wp_unslash( (string) ( $_POST['body'] ?? '' ) ) );
		$admin_redirect = current_user_can( Admin::CAPABILITY ) ? Admin::app_url( 'ticket-automations' ) : $this->template_editor_url();

		if ( '' === $id || '' === trim( $subject ) || '' === trim( wp_strip_all_tags( $body ) ) ) {
			wp_safe_redirect( add_query_arg( current_user_can( Admin::CAPABILITY ) ? 'automation' : 'template', 'incomplete', $admin_redirect ) );
			exit;
		}

		$rules = $this->rules();
		$found = false;
		foreach ( $rules as $key => $rule ) {
			if ( $id !== sanitize_key( (string) ( $rule['id'] ?? '' ) ) ) { continue; }
			$rules[ $key ]['subject']            = $subject;
			$rules[ $key ]['body']               = $body;
			$rules[ $key ]['template_edited_by'] = get_current_user_id();
			$rules[ $key ]['template_edited_at'] = current_time( 'mysql' );
			$found = true;
			break;
		}
		if ( ! $found ) {
			wp_safe_redirect( add_query_arg( current_user_can( Admin::CAPABILITY ) ? 'automation' : 'template', 'not_found', $admin_redirect ) );
			exit;
		}
		update_option( self::OPTION, array_values( $rules ), false );
		wp_safe_redirect( add_query_arg( array( current_user_can( Admin::CAPABILITY ) ? 'automation' : 'template' => 'template_saved', 'rule' => $id ), $admin_redirect ) );
		exit;
	}

	/** Renders the Designer/طراح copy-only screen. */
	public function render_template_editor(): void {
		if ( ! $this->can_edit_templates() ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}
		$rules  = $this->editable_template_rules();
		$tokens = $this->tokens();
		$nonce_action = self::TEMPLATE_NONCE;
		include WPEP_PLUGIN_DIR . 'admin/views/ticket-template-editor.php';
	}

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

		$post_type = sanitize_key( (string) ( $input['post_type'] ?? 'post' ) );
		if ( self::POST_TYPE_CUSTOM_PUBLIC !== $post_type ) {
			$post_type = $post_type ?: 'post';
		}

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
			'post_type'       => $post_type,
			'order_status'    => sanitize_key( (string) ( $input['order_status'] ?? '' ) ),
			'hook_slug'       => sanitize_key( (string) ( $input['hook_slug'] ?? '' ) ),
			'from_preset'     => sanitize_key( (string) ( $input['from_preset'] ?? '' ) ),
			'template_edited_by' => absint( $input['template_edited_by'] ?? 0 ),
			'template_edited_at' => sanitize_text_field( (string) ( $input['template_edited_at'] ?? '' ) ),
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

		$preset_post_type = isset( $_POST['post_type'] )
			? sanitize_key( wp_unslash( (string) $_POST['post_type'] ) )
			: sanitize_key( (string) ( $found['post_type'] ?? 'post' ) );
		if ( '' === $preset_post_type ) {
			$preset_post_type = sanitize_key( (string) ( $found['post_type'] ?? 'post' ) ) ?: 'post';
		}

		$preset_department = $this->ensure_preset_department( $found );
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
				'department'    => $preset_department,
				// Repeating events are safe to repeat; per-user milestones are not.
				'once_per_user' => in_array( $found['trigger'], array( 'user_register', 'first_login', 'profile_completed', 'scheduled' ), true ),
				'allow_reply'   => false,
				'post_type'     => $preset_post_type,
				'hook_slug'     => $found['hook_slug'] ?? '',
				'from_preset'   => $slug,
			)
		);

		update_option( self::OPTION, $rules, false );

		wp_safe_redirect( add_query_arg( array( 'automation' => 'added' ), Admin::app_url( 'ticket-automations' ) ) );
		exit;
	}

	/**
	 * Installs/enables the safe event-driven starter pack in one click.
	 *
	 * Scheduled profile scans are deliberately excluded: enabling those on an
	 * existing production site can immediately message a large historic user
	 * base. The starter pack only reacts to new events after activation.
	 *
	 * @since 1.23.8
	 */
	public function enable_standard_pack(): void {
		if ( ! current_user_can( Admin::CAPABILITY ) ) {
			wp_die( esc_html__( 'اجازه دسترسی ندارید.', 'wp-event-publisher' ) );
		}
		check_admin_referer( self::NONCE );
		$this->ensure_standard_pack_rules( true );
		update_option( '_jarchi_ticket_standard_pack_1250', '1', false );
		wp_safe_redirect( add_query_arg( 'automation', 'standard_enabled', Admin::app_url( 'ticket-automations' ) ) );
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
		$user_id = (int) $user_id;
		if ( $user_id <= 0 ) { return; }

		// Registration plugins often add first name/phone immediately after
		// user_register. Those writes are still account creation, not a later
		// profile-completion action, so mark this request as initialization.
		self::$registering_profile_users[ $user_id ] = true;
		update_user_meta( $user_id, '_jarchi_profile_completion_state', 'initializing' );

		$this->dispatch( 'user_register', $user_id, array() );
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

		$context = $this->post_context( $post );

		/*
		 * Any real transition INTO `publish` is an approval/publication event.
		 * JetEngine, editorial plugins and custom moderation workflows commonly
		 * use their own intermediate statuses; the old hard-coded allow-list
		 * silently missed those transitions. Same-status saves are already
		 * rejected at the top of this method and the automation ledger prevents
		 * a restore/replay from producing a duplicate ticket for the same post.
		 */
		if ( 'publish' === $new_status ) {
			$this->dispatch( 'post_published', $author, $context );
			return;
		}

		// A published advert edited by its owner commonly returns to `pending`
		// while moderation checks the new version. That is not a rejection.
		if ( 'publish' === $old_status && 'pending' === $new_status ) {
			$this->dispatch( 'post_update_pending', $author, $context );
			return;
		}

		// User-initiated trashing is its own business event. The early trash hook
		// normally handles it; this fallback covers integrations that change status
		// directly while a logged-in owner is the actor.
		if ( 'trash' === $new_status && get_current_user_id() === $author ) {
			$this->dispatch( 'post_self_deleted', $author, $context );
			return;
		}

		// Sent back from review is a rejection. A brand new draft is not: it was
		// never under review, and telling somebody their advert was refused the
		// moment they start writing it would be worse than saying nothing.
		if ( in_array( $old_status, array( 'publish', 'pending' ), true ) && in_array( $new_status, array( 'draft', 'trash', 'private' ), true ) ) {
			$expiration_ts = (int) get_post_meta( (int) $post->ID, '_expiration-date', true );
			if ( $expiration_ts <= 0 ) { $expiration_ts = (int) get_post_meta( (int) $post->ID, '_jarchi_future_expiration_ts', true ); }

			/*
			 * A moderator who has just recorded a rejection has settled the
			 * question, so the expiry heuristic below does not get to
			 * overrule them. Without this, rejecting an advert whose expiry
			 * date had already passed sent "your advert expired" — which is
			 * both wrong and unanswerable, since the real reason was sitting
			 * in post meta at the time.
			 */
			$moderated = (string) get_post_meta( (int) $post->ID, '_iex_moderation_status', true );

			// Future changes status at (or just after) its due timestamp. Treat that
			// as expiry, not as a moderation rejection. Its official post_expired
			// hook may fire a moment later; the automation ledger de-duplicates it.
			if ( 'rejected' !== $moderated && $expiration_ts > 0 && time() >= ( $expiration_ts - 300 ) ) {
				$this->dispatch( 'post_expired', $author, $this->expiration_context( $post, $expiration_ts ) );
				return;
			}
			$this->dispatch( 'post_unpublished', $author, $context );
		}
	}


	/**
	 * Secondary publication detector for page-builders/moderation plugins.
	 *
	 * `transition_post_status` is the primary hook. `wp_after_insert_post` runs
	 * after WordPress has finished persisting the object and gives us the prior
	 * post, which catches integrations that finalize a custom status late in
	 * their save pipeline. The ledger makes the two detectors idempotent.
	 *
	 * @since 1.23.4
	 */
	/**
	 * Meta keys a rejection reason may have been written to.
	 *
	 * The plugin reads a reason; something else writes it. Which key that
	 * something else uses is not the plugin's decision, and the previous
	 * version only ever looked at `_jarchi_reject_reason` — a key nothing in
	 * this plugin or in any moderation workflow actually writes. So the token
	 * was always empty, and the rejection ticket asked the customer to read a
	 * reason it then did not state.
	 *
	 * The site's own moderation screen writes `_iex_rejection_reason` with an
	 * optional `_iex_rejection_note` beside it. Both are read here, and the
	 * list is filterable so a site using different keys needs no patch.
	 *
	 * @since 1.26.7
	 *
	 * @return array{reason:string[],note:string[]} Meta keys, most specific first.
	 */
	public static function rejection_meta_keys(): array {
		/**
		 * Filters where a rejection reason and its note are stored.
		 *
		 * @since 1.26.7
		 *
		 * @param array{reason:string[],note:string[]} $keys Meta keys.
		 */
		$keys = (array) apply_filters(
			'jarchi_rejection_meta_keys',
			array(
				'reason' => array( '_iex_rejection_reason', '_jarchi_reject_reason', '_rejection_reason' ),
				'note'   => array( '_iex_rejection_note', '_jarchi_reject_note', '_rejection_note' ),
			)
		);

		return array(
			'reason' => array_values( array_filter( array_map( 'strval', (array) ( $keys['reason'] ?? array() ) ) ) ),
			'note'   => array_values( array_filter( array_map( 'strval', (array) ( $keys['note'] ?? array() ) ) ) ),
		);
	}

	/**
	 * The first non-empty value among a set of meta keys.
	 *
	 * @since 1.26.7
	 *
	 * @param int      $post_id Post.
	 * @param string[] $keys    Meta keys in priority order.
	 *
	 * @return string Value, or ''.
	 */
	private function first_meta( int $post_id, array $keys ): string {
		foreach ( $keys as $key ) {
			$value = get_post_meta( $post_id, $key, true );

			if ( is_scalar( $value ) && '' !== trim( (string) $value ) ) {
				return trim( (string) $value );
			}
		}

		return '';
	}

	/**
	 * The rejection reason for one advert, reason and note combined.
	 *
	 * A moderator picks a reason from a list and may add a sentence of their
	 * own. Both belong in the ticket: the list entry says which rule was
	 * broken, and the note is the part that tells this particular person what
	 * to change.
	 *
	 * @since 1.26.7
	 *
	 * @param int $post_id Advert.
	 *
	 * @return string Human-readable reason, or ''.
	 */
	public function reject_reason_for( int $post_id ): string {
		$keys   = self::rejection_meta_keys();
		$reason = $this->first_meta( $post_id, $keys['reason'] );
		$note   = $this->first_meta( $post_id, $keys['note'] );

		if ( '' === $reason ) {
			$reason = $note;
			$note   = '';
		}

		if ( '' === $reason ) {
			$text = '';
		} elseif ( '' === $note ) {
			/* translators: %s: the rejection reason. */
			$text = sprintf( __( 'دلیل: %s', 'wp-event-publisher' ), $reason );
		} else {
			/* translators: 1: the rejection reason, 2: the moderator's note. */
			$text = sprintf( __( 'دلیل: %1$s — %2$s', 'wp-event-publisher' ), $reason, $note );
		}

		/**
		 * Filters the rejection reason shown to the advertiser.
		 *
		 * @since 1.26.7
		 *
		 * @param string $text    Composed reason.
		 * @param int    $post_id Advert.
		 * @param string $reason  Raw reason.
		 * @param string $note    Raw note.
		 */
		return (string) apply_filters( 'jarchi_reject_reason', $text, $post_id, $reason, $note );
	}

	/**
	 * The token values every advert event carries.
	 *
	 * Built in one place so the two detectors cannot drift apart — which they
	 * had, each reading the reason from its own copy of the same wrong key.
	 *
	 * @since 1.26.7
	 *
	 * @param \WP_Post $post Advert.
	 *
	 * @return array<string,mixed> Context.
	 */
	private function post_context( \WP_Post $post ): array {
		$keys = self::rejection_meta_keys();

		return array(
			'post_id'       => (int) $post->ID,
			'post_type'     => (string) $post->post_type,
			'post_title'    => (string) $post->post_title,
			'reject_reason' => $this->reject_reason_for( (int) $post->ID ),
			'reject_note'   => $this->first_meta( (int) $post->ID, $keys['note'] ),
		);
	}

	/**
	 * The site's moderation screen approved an advert.
	 *
	 * Listening to the explicit action as well as the status transition is
	 * deliberate. The transition is the general case and already works; this
	 * is the one signal that says "a human pressed approve" rather than being
	 * inferred from a status change that any plugin could also cause. The
	 * ledger keys both paths identically, so the pair produces one ticket.
	 *
	 * @since 1.26.7
	 *
	 * @param int $post_id Advert.
	 *
	 * @return void
	 */
	public function on_moderation_approved( $post_id ): void {
		$post = get_post( (int) $post_id );

		if ( ! $post instanceof \WP_Post || (int) $post->post_author <= 0 ) {
			return;
		}

		$this->dispatch( 'post_published', (int) $post->post_author, $this->post_context( $post ) );
	}

	/**
	 * The site's moderation screen rejected an advert.
	 *
	 * The reason and note arrive as arguments as well as in post meta. The
	 * arguments win: they are what the moderator just chose, and a filter or a
	 * later write cannot have changed them yet.
	 *
	 * @since 1.26.7
	 *
	 * @param int    $post_id Advert.
	 * @param string $reason  Chosen reason.
	 * @param string $note    Optional note.
	 *
	 * @return void
	 */
	public function on_moderation_rejected( $post_id, $reason = '', $note = '' ): void {
		$post = get_post( (int) $post_id );

		if ( ! $post instanceof \WP_Post || (int) $post->post_author <= 0 ) {
			return;
		}

		$context = $this->post_context( $post );

		$reason = sanitize_text_field( (string) $reason );
		$note   = sanitize_text_field( (string) $note );

		if ( '' !== $reason ) {
			$context['reject_reason'] = '' === $note
				/* translators: %s: the rejection reason. */
				? sprintf( __( 'دلیل: %s', 'wp-event-publisher' ), $reason )
				/* translators: 1: the rejection reason, 2: the moderator's note. */
				: sprintf( __( 'دلیل: %1$s — %2$s', 'wp-event-publisher' ), $reason, $note );

			$context['reject_note'] = $note;
		}

		$this->dispatch( 'post_unpublished', (int) $post->post_author, $context );
	}

	public function on_after_insert_post( $post_id, $post, $update, $post_before ): void {
		if ( ! $post instanceof \WP_Post || in_array( $post->post_type, self::ignored_post_types(), true ) ) {
			return;
		}
		if ( 'publish' !== (string) $post->post_status ) {
			return;
		}
		$before_status = $post_before instanceof \WP_Post ? (string) $post_before->post_status : '';
		if ( 'publish' === $before_status ) {
			return;
		}
		$author = (int) $post->post_author;
		if ( $author <= 0 ) {
			return;
		}
		$this->dispatch( 'post_published', $author, $this->post_context( $post ) );
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

		if ( ! is_object( $comment ) ) {
			return;
		}

		// Ticket messages are comments too. Replying inside a ticket must not
		// raise a ticket about the ticket.
		if ( Tickets::COMMENT_TYPE === (string) ( $comment->comment_type ?? '' ) ) {
			return;
		}

		// Moderated comments/replies are announced only after approval;
		// otherwise the recipient could get spam or trash that visitors never see.
		if ( '1' !== (string) ( $comment->comment_approved ?? '' ) ) {
			return;
		}

		if ( empty( $comment->comment_parent ) ) {
			$this->dispatch_comment_on_post( $comment );
			return;
		}

		$this->dispatch_comment_reply( $comment );
	}

	/** Announces a top-level approved comment to the advert owner. */
	private function dispatch_comment_on_post( object $comment ): void {
		$post_id = (int) ( $comment->comment_post_ID ?? 0 );
		$post    = $post_id ? get_post( $post_id ) : null;
		if ( ! $post instanceof \WP_Post || in_array( $post->post_type, self::ignored_post_types(), true ) ) {
			return;
		}
		$recipient = (int) $post->post_author;
		if ( $recipient <= 0 || $recipient === (int) ( $comment->user_id ?? 0 ) ) {
			return;
		}
		$this->dispatch(
			'comment_on_post',
			$recipient,
			array(
				'post_id'        => $post_id,
				'post_type'      => (string) $post->post_type,
				'post_title'     => (string) $post->post_title,
				'comment_id'     => (int) ( $comment->comment_ID ?? 0 ),
				'comment_author' => (string) ( $comment->comment_author ?? __( 'کاربر', 'wp-event-publisher' ) ),
			)
		);
	}

	/** Announces an approved reply to the relevant users. */
	private function dispatch_comment_reply( object $comment ): void {
		$comment_id = (int) ( $comment->comment_ID ?? 0 );
		$post_id    = (int) ( $comment->comment_post_ID ?? 0 );
		$post       = $post_id ? get_post( $post_id ) : null;
		$parent     = ! empty( $comment->comment_parent ) ? get_comment( (int) $comment->comment_parent ) : null;
		if ( ! $post instanceof \WP_Post || ! is_object( $parent ) || in_array( $post->post_type, self::ignored_post_types(), true ) ) {
			return;
		}

		$author_id   = (int) ( $comment->user_id ?? 0 );
		$recipients  = array();
		$parent_user = (int) ( $parent->user_id ?? 0 );
		$post_owner  = (int) $post->post_author;

		if ( $parent_user > 0 && $parent_user !== $author_id ) {
			$recipients[] = $parent_user;
		}
		if ( $post_owner > 0 && $post_owner !== $author_id ) {
			$recipients[] = $post_owner;
		}

		$recipients = array_values( array_unique( array_map( 'intval', $recipients ) ) );
		if ( empty( $recipients ) ) {
			return;
		}

		$context = array(
			'post_id'        => $post_id,
			'post_type'      => (string) $post->post_type,
			'post_title'     => (string) $post->post_title,
			'comment_id'     => $comment_id,
			'comment_author' => (string) ( $comment->comment_author ?? __( 'کاربر', 'wp-event-publisher' ) ),
		);

		foreach ( $recipients as $recipient ) {
			$this->dispatch( 'comment_reply', (int) $recipient, $context );
		}
	}

	/**
	 * Lets Jarchi own the advert-owner notification so WordPress core does not
	 * send a second e-mail for the same public advert comment.
	 *
	 * @param array<int,string> $emails     Current recipients.
	 * @param int               $comment_id Comment identifier.
	 *
	 * @return array<int,string>
	 */
	public function filter_comment_notification_recipients( $emails, $comment_id ): array {
		$emails  = array_values( array_filter( array_map( 'sanitize_email', (array) $emails ) ) );
		$comment = get_comment( (int) $comment_id );
		if ( ! is_object( $comment ) ) {
			return $emails;
		}
		$post_id = (int) ( $comment->comment_post_ID ?? 0 );
		$post    = $post_id ? get_post( $post_id ) : null;
		if ( ! $post instanceof \WP_Post ) {
			return $emails;
		}
		if ( in_array( $post->post_type, self::ignored_post_types(), true ) ) {
			return $emails;
		}
		$object = get_post_type_object( $post->post_type );
		if ( ! $object || empty( $object->public ) || ! empty( $object->_builtin ) ) {
			return $emails;
		}
		$author = get_user_by( 'id', (int) $post->post_author );
		if ( ! $author || empty( $author->user_email ) ) {
			return $emails;
		}
		$author_email = strtolower( sanitize_email( (string) $author->user_email ) );
		return array_values( array_filter( $emails, static function ( $email ) use ( $author_email ) {
			return strtolower( (string) $email ) !== $author_email;
		} ) );
	}

	/** Fires the comment automation when a previously moderated comment becomes approved. */
	public function on_comment_status( $new_status, $old_status, $comment ): void {
		if ( 'approved' !== (string) $new_status || 'approved' === (string) $old_status ) { return; }
		$comment = is_object( $comment ) ? $comment : get_comment( (int) $comment );
		if ( ! is_object( $comment ) || Tickets::COMMENT_TYPE === (string) ( $comment->comment_type ?? '' ) ) { return; }
		if ( empty( $comment->comment_parent ) ) {
			$this->dispatch_comment_on_post( $comment );
			return;
		}
		$this->dispatch_comment_reply( $comment );
	}

	/**
	 * Re-checks profile completion immediately after front-end profile plugins
	 * persist one of the fields Jarchi considers part of the basic profile.
	 */
	/**
	 * Captures the true state immediately before WordPress changes a watched
	 * profile field. This is what lets us detect incomplete -> complete rather
	 * than merely observing that the profile happens to be complete now.
	 */
	public function capture_profile_before_meta_change( $check, $user_id, $meta_key, $meta_value = null, $extra = null ) {
		unset( $meta_value, $extra );
		$user_id  = (int) $user_id;
		$meta_key = (string) $meta_key;
		if ( $user_id <= 0 || ! in_array( $meta_key, $this->profile_watch_keys(), true ) ) { return $check; }
		if ( isset( self::$registering_profile_users[ $user_id ] ) ) { return $check; }
		if ( ! array_key_exists( $user_id, self::$profile_before_change ) ) {
			self::$profile_before_change[ $user_id ] = $this->profile_incomplete( $user_id );
		}
		return $check;
	}

	/** Re-checks profile completion immediately after one watched field persists. */
	public function on_profile_meta_changed( $meta_id, $user_id, $meta_key, $meta_value = null ): void {
		unset( $meta_id, $meta_value );
		$user_id  = (int) $user_id;
		$meta_key = (string) $meta_key;
		if ( $user_id <= 0 || ! in_array( $meta_key, $this->profile_watch_keys(), true ) ) { return; }
		if ( isset( self::$registering_profile_users[ $user_id ] ) ) { return; }

		$before = self::$profile_before_change[ $user_id ] ?? null;
		unset( self::$profile_before_change[ $user_id ] );
		$after_incomplete = $this->profile_incomplete( $user_id );

		if ( null === $before ) {
			$stored = (string) get_user_meta( $user_id, '_jarchi_profile_completion_state', true );
			$before = 'incomplete' === $stored ? true : ( 'complete' === $stored ? false : null );
		}

		update_user_meta( $user_id, '_jarchi_profile_completion_state', $after_incomplete ? 'incomplete' : 'complete' );

		// Send only on a real transition. A profile already complete at account
		// creation or before this upgrade does not generate a fake completion.
		if ( true === $before && ! $after_incomplete ) {
			$this->dispatch( 'profile_completed', $user_id, array( 'profile_fields' => $this->profile_fields_text( $user_id ) ) );
		}
	}

	/** Fallback for profile plugins whose final save ends in wp_update_user(). */
	public function on_profile_updated( $user_id, $old_user_data = null ): void {
		unset( $old_user_data );
		$user_id = (int) $user_id;
		if ( $user_id <= 0 || isset( self::$registering_profile_users[ $user_id ] ) ) { return; }

		$current_incomplete = $this->profile_incomplete( $user_id );
		$stored = (string) get_user_meta( $user_id, '_jarchi_profile_completion_state', true );
		if ( '' === $stored || 'initializing' === $stored ) {
			update_user_meta( $user_id, '_jarchi_profile_completion_state', $current_incomplete ? 'incomplete' : 'complete' );
			return;
		}
		update_user_meta( $user_id, '_jarchi_profile_completion_state', $current_incomplete ? 'incomplete' : 'complete' );
		if ( 'incomplete' === $stored && ! $current_incomplete ) {
			$this->dispatch( 'profile_completed', $user_id, array( 'profile_fields' => $this->profile_fields_text( $user_id ) ) );
		}
	}

	/**
	 * Finishes deferred registration baselines and reconciles bump meta only
	 * after all plugins have finished writing their fields for this request.
	 */
	public function finalize_deferred_state(): void {
		foreach ( array_keys( self::$registering_profile_users ) as $user_id ) {
			$user_id = (int) $user_id;
			if ( $user_id > 0 ) {
				update_user_meta( $user_id, '_jarchi_profile_completion_state', $this->profile_incomplete( $user_id ) ? 'incomplete' : 'complete' );
			}
		}
		self::$registering_profile_users = array();

		foreach ( array_keys( self::$dirty_bump_posts ) as $post_id ) {
			$this->reconcile_bump_post_after_meta_change( (int) $post_id );
		}
		self::$dirty_bump_posts = array();
	}

	/** Captures a normal owner-initiated move to trash before status changes. */
	public function on_user_trash_post( $post_id, $previous_status = '' ): void {
		$post = get_post( (int) $post_id );
		if ( ! $post instanceof \WP_Post || in_array( $post->post_type, self::ignored_post_types(), true ) ) { return; }
		$author = (int) $post->post_author;
		if ( $author <= 0 || get_current_user_id() !== $author ) { return; }
		$this->dispatch( 'post_self_deleted', $author, array( 'post_id' => (int) $post->ID, 'post_type' => (string) $post->post_type, 'post_title' => (string) $post->post_title, 'previous_status' => (string) $previous_status ) );
	}

	/** Captures owner-initiated hard deletes used by some front-end listing tools. */
	public function on_user_delete_post( $post_id, $post = null ): void {
		$post = $post instanceof \WP_Post ? $post : get_post( (int) $post_id );
		if ( ! $post instanceof \WP_Post || 'trash' === (string) $post->post_status || in_array( $post->post_type, self::ignored_post_types(), true ) ) { return; }
		$author = (int) $post->post_author;
		if ( $author <= 0 ) { return; }

		if ( get_current_user_id() === $author ) {
			$this->dispatch( 'post_self_deleted', $author, array( 'post_id' => (int) $post->ID, 'post_type' => (string) $post->post_type, 'post_title' => (string) $post->post_title ) );
			return;
		}

		// PublishPress Future can be configured for a hard delete. Capture the
		// event before WordPress removes the post/meta, while cron has no author.
		$expiration_ts = (int) get_post_meta( (int) $post->ID, '_expiration-date', true );
		if ( $expiration_ts <= 0 ) { $expiration_ts = (int) get_post_meta( (int) $post->ID, '_jarchi_future_expiration_ts', true ); }
		if ( $expiration_ts > 0 && time() >= ( $expiration_ts - 300 ) ) {
			$this->dispatch( 'post_expired', $author, $this->expiration_context( $post, $expiration_ts ) );
		}
	}

	/**
	 * Mirrors a PublishPress Future schedule into a lightweight Jarchi reminder.
	 *
	 * PublishPress Future stores the canonical expiration. Jarchi only keeps the
	 * timestamp it observed so it can distinguish an automatic expiry from an administrator rejection.
	 */
	public function on_future_expiration_scheduled( $post_id, $timestamp, $options = array() ): void {
		unset( $options );
		$post_id   = (int) $post_id;
		$timestamp = (int) $timestamp;
		$post      = $post_id > 0 ? get_post( $post_id ) : null;
		if ( ! $post instanceof \WP_Post || $timestamp <= 0 || in_array( $post->post_type, self::ignored_post_types(), true ) ) { return; }

		// Keep only the canonical timestamp so final expiry can be distinguished
		// from a moderation rejection. The old seven-day warning was removed in
		// 1.26.6 and no new reminder is scheduled here.
		update_post_meta( $post_id, '_jarchi_future_expiration_ts', $timestamp );
	}

	/** Removes Jarchi's reminder when PublishPress Future removes its schedule. */
	public function on_future_expiration_unscheduled( $post_id ): void {
		$post_id = (int) $post_id;
		if ( $post_id <= 0 ) { return; }
		$timestamp = (int) get_post_meta( $post_id, '_jarchi_future_expiration_ts', true );
		if ( $timestamp > 0 ) { $this->unschedule_expiry_reminder( $post_id, $timestamp ); }
		delete_post_meta( $post_id, '_jarchi_future_expiration_ts' );
	}


	/** Sends the final expiry ticket from PublishPress Future's official expiry hook. */
	public function on_future_post_expired( $post_id, $expiration_log = null, $options = array() ): void {
		unset( $expiration_log, $options );
		$post_id = (int) $post_id;
		$post    = $post_id > 0 ? get_post( $post_id ) : null;
		if ( ! $post instanceof \WP_Post || in_array( $post->post_type, self::ignored_post_types(), true ) ) { return; }
		$timestamp = (int) get_post_meta( $post_id, '_expiration-date', true );
		if ( $timestamp <= 0 ) { $timestamp = (int) get_post_meta( $post_id, '_jarchi_future_expiration_ts', true ); }
		$author = (int) $post->post_author;
		if ( $author > 0 ) { $this->dispatch( 'post_expired', $author, $this->expiration_context( $post, $timestamp ) ); }
		if ( $timestamp > 0 ) { $this->unschedule_expiry_reminder( $post_id, $timestamp ); }
		delete_post_meta( $post_id, '_jarchi_future_expiration_ts' );
	}

	/** Context shared by reminder and expiry events. */
	private function expiration_context( \WP_Post $post, int $timestamp ): array {
		return array(
			'post_id'         => (int) $post->ID,
			'post_type'       => (string) $post->post_type,
			'post_title'      => (string) $post->post_title,
			'expiration_ts'   => $timestamp,
			'expiration_date' => $timestamp > 0 ? wp_date( (string) get_option( 'date_format' ), $timestamp ) : '',
		);
	}

	/** Cancels one exact Jarchi expiry reminder. */
	private function unschedule_expiry_reminder( int $post_id, int $timestamp ): void {
		$next = wp_next_scheduled( 'jarchi_post_expiry_reminder', array( $post_id, $timestamp ) );
		if ( $next ) { wp_unschedule_event( $next, 'jarchi_post_expiry_reminder', array( $post_id, $timestamp ) ); }
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
		$context = is_array( $context ) ? $context : array();

		if ( 'post_bumped' === $slug && $user_id <= 0 && ! empty( $context['post_id'] ) ) {
			$post = get_post( absint( $context['post_id'] ) );
			if ( $post instanceof \WP_Post ) { $user_id = (int) $post->post_author; }
		}

		if ( '' === $slug || $user_id <= 0 ) {
			return;
		}

		if ( 'post_bumped' === $slug ) {
			$context = $this->normalize_bump_context( $user_id, $context );
			$post_id = absint( $context['post_id'] ?? 0 );
			$expires = absint( $context['bump_expiration_ts'] ?? 0 );
			if ( $post_id > 0 && $expires <= 0 && empty( $context['bump_cycle_id'] ) ) {
				$now  = time();
				$last = absint( get_post_meta( $post_id, '_wpep_last_bump_event_at', true ) );
				// A few integrations emit the same completion hook twice. Collapse
				// those calls, but allow a later ladder purchase on the same advert.
				if ( $last > 0 && ( $now - $last ) < 5 ) { return; }
				update_post_meta( $post_id, '_wpep_last_bump_event_at', $now );
				$context['bump_cycle_id'] = (string) $now;
			}
			$this->dispatch( 'custom_hook', $user_id, $context, $slug );

			if ( $post_id > 0 && $expires > time() ) {
				$this->schedule_bump_expiry_reminder( $post_id, $user_id, $expires );
			}
			return;
		}

		$this->dispatch( 'custom_hook', $user_id, $context, $slug );
	}

	/**
	 * Watches every ladder/bump/boost-related post-meta write and defers the
	 * decision until shutdown. JetEngine and listing plugins commonly write the
	 * active flag, start time and expiry in separate updates; reacting to the
	 * first update used to create duplicate/missing cycles because the expiry
	 * did not exist yet.
	 *
	 * @since 1.26.6
	 */
	public function on_bump_post_meta_changed( $meta_id, $post_id, $meta_key, $meta_value = null ): void {
		unset( $meta_id, $meta_value );
		if ( self::$creating ) { return; }
		$post_id  = absint( $post_id );
		$meta_key = (string) $meta_key;
		if ( $post_id <= 0 || ! $this->is_bump_meta_key( $meta_key ) ) { return; }
		self::$dirty_bump_posts[ $post_id ] = true;
	}

	/** Whether a post-meta key belongs to a ladder/bump/boost feature. */
	private function is_bump_meta_key( string $key ): bool {
		$key = strtolower( trim( $key ) );
		if ( '' === $key || 0 === strpos( $key, '_wpep_' ) ) { return false; }
		$known = (array) apply_filters(
			'wpep_bump_meta_keys',
			array(
				'_jarchi_bump_expires_at', 'jarchi_bump_expires_at', '_bump_expires_at', 'bump_expires_at',
				'_bump_expiration', 'bump_expiration', '_bump_expiry', 'bump_expiry', '_bump_until', 'bump_until',
				'_boost_expires_at', 'boost_expires_at', '_boost_expiration', 'boost_expiration', '_boost_expiry', 'boost_expiry', '_boost_until', 'boost_until',
				'_ladder_expires_at', 'ladder_expires_at', '_ladder_expiration', 'ladder_expiration', '_ladder_expiry', 'ladder_expiry', '_ladder_until', 'ladder_until',
				'_nardeban_expires_at', 'nardeban_expires_at', '_nardeban_expiry', 'nardeban_expiry', '_nardeban_until', 'nardeban_until',
				'_listing_boost_until', 'listing_boost_until', '_listing_bump_until', 'listing_bump_until',
				'bump', '_bump', 'boost', '_boost', 'ladder', '_ladder', 'nardeban', '_nardeban', 'is_bumped', 'is_boosted', 'is_laddered',
				'featured', '_featured', 'is_featured', '_is_featured', 'featured_listing', '_featured_listing', 'listing_featured', 'promoted', 'is_promoted', 'promotion', '_promotion', 'listing_promotion', 'promo_expiry', 'promotion_expiry',
			)
		);
		$known = array_map( static fn( $candidate ) => strtolower( trim( (string) $candidate ) ), $known );
		if ( in_array( $key, $known, true ) ) { return true; }
		if ( preg_match( '/(?:bump|boost|ladder|nardeb(?:a|aa)n|نردبان|promot(?:e|ed|ion))/iu', $key ) ) { return true; }
		// Some listing products call their paid elevation "featured". Only treat
		// it as ladder data when the key itself also describes timing/activation,
		// so WordPress' ordinary featured-image metadata is never involved.
		return (bool) preg_match( '/featured.*(?:expir|until|end|start|date|time|duration|active)|(?:expir|until|end|start|duration).*featured/iu', $key );
	}

	/** Whether one post-meta key looks specifically like a ladder expiry. */
	private function is_bump_expiry_meta_key( string $key ): bool {
		$key = strtolower( trim( $key ) );
		if ( ! $this->is_bump_meta_key( $key ) ) { return false; }
		$known = (array) apply_filters(
			'wpep_bump_expiry_meta_keys',
			array(
				'_jarchi_bump_expires_at', 'jarchi_bump_expires_at', '_bump_expires_at', 'bump_expires_at',
				'_bump_expiration', 'bump_expiration', '_bump_expiry', 'bump_expiry', '_bump_until', 'bump_until',
				'_boost_expires_at', 'boost_expires_at', '_boost_expiration', 'boost_expiration', '_boost_expiry', 'boost_expiry', '_boost_until', 'boost_until',
				'_ladder_expires_at', 'ladder_expires_at', '_ladder_expiration', 'ladder_expiration', '_ladder_expiry', 'ladder_expiry', '_ladder_until', 'ladder_until',
				'_nardeban_expires_at', 'nardeban_expires_at', '_nardeban_expiry', 'nardeban_expiry', '_nardeban_until', 'nardeban_until',
				'_listing_boost_until', 'listing_boost_until', '_listing_bump_until', 'listing_bump_until',
			)
		);
		$known = array_map( static fn( $candidate ) => strtolower( trim( (string) $candidate ) ), $known );
		if ( in_array( $key, $known, true ) ) { return true; }
		return (bool) preg_match( '/(?:expir|expiry|expires|until|end|finish|deadline|انقضا|پایان)/iu', $key );
	}

	/** Stable snapshot of all ladder-related meta for cycle dedupe. */
	private function bump_meta_snapshot( int $post_id ): array {
		$all = get_post_meta( $post_id );
		$out = array();
		foreach ( $all as $key => $values ) {
			if ( ! $this->is_bump_meta_key( (string) $key ) ) { continue; }
			$out[ (string) $key ] = array_map( static fn( $value ) => maybe_unserialize( $value ), (array) $values );
		}
		ksort( $out );
		return $out;
	}

	/** Whether the current ladder meta describes an active cycle. */
	private function bump_meta_indicates_active( array $snapshot, int $expires ): bool {
		if ( $expires > time() ) { return true; }
		foreach ( $snapshot as $key => $values ) {
			foreach ( (array) $values as $value ) {
				$value = maybe_unserialize( $value );
				if ( is_array( $value ) || is_object( $value ) ) {
					$text = strtolower( wp_json_encode( $value ) ?: '' );
				} else {
					$text = strtolower( trim( (string) $value ) );
				}
				if ( in_array( $text, array( '1', 'true', 'yes', 'on', 'active', 'enabled', 'فعال' ), true ) ) { return true; }
				$ts = $this->parse_bump_timestamp( $value );
				if ( $ts > time() ) { return true; }
			}
		}
		return false;
	}

	/** Reconciles one fully-persisted ladder cycle after all meta writes finish. */
	private function reconcile_bump_post_after_meta_change( int $post_id ): void {
		$post = get_post( $post_id );
		if ( ! $post instanceof \WP_Post || in_array( $post->post_type, self::ignored_post_types(), true ) ) { return; }
		$object = get_post_type_object( $post->post_type );
		if ( ! $object || empty( $object->public ) || ! empty( $object->_builtin ) ) { return; }
		$user_id = (int) $post->post_author;
		if ( $user_id <= 0 ) { return; }

		$snapshot = $this->bump_meta_snapshot( $post_id );
		if ( empty( $snapshot ) ) { return; }
		$expires = $this->resolve_bump_expiry_ts( $post_id, array() );
		if ( ! $this->bump_meta_indicates_active( $snapshot, $expires ) ) { return; }

		$fingerprint = hash( 'sha256', wp_json_encode( array( $post_id, $expires, $snapshot ) ) ?: (string) $post_id );
		$previous    = (string) get_post_meta( $post_id, '_wpep_bump_cycle_fingerprint', true );

		if ( $expires > time() ) {
			$this->schedule_bump_expiry_reminder( $post_id, $user_id, $expires );
		}
		if ( hash_equals( (string) $previous, (string) $fingerprint ) ) { return; }

		update_post_meta( $post_id, '_wpep_bump_cycle_fingerprint', $fingerprint );
		$context = array(
			'post_id'       => $post_id,
			'post_type'     => (string) $post->post_type,
			'post_title'    => (string) $post->post_title,
			'bump_cycle_id' => substr( $fingerprint, 0, 24 ),
		);
		if ( $expires > 0 ) {
			$context['bump_expiration_ts']   = $expires;
			$context['bump_expiration_date'] = wp_date( (string) get_option( 'date_format' ), $expires );
		}
		$this->on_custom_event( 'post_bumped', $user_id, $context );
	}

	/** Converts the common timestamp/date shapes used by listing plugins. */
	private function parse_bump_timestamp( $value ): int {
		$value = maybe_unserialize( $value );
		if ( is_array( $value ) ) {
			foreach ( array( 'timestamp', 'expires_at', 'expiry', 'expiration', 'until', 'end', 'date', 'value' ) as $key ) {
				if ( array_key_exists( $key, $value ) ) {
					$parsed = $this->parse_bump_timestamp( $value[ $key ] );
					if ( $parsed > 0 ) { return $parsed; }
				}
			}
			return 0;
		}
		if ( is_object( $value ) ) { return $this->parse_bump_timestamp( (array) $value ); }

		$text = trim( (string) $value );
		if ( '' === $text ) { return 0; }
		$text = strtr( $text, array( '۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9','٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9' ) );

		if ( is_numeric( $text ) ) {
			$number = (int) round( (float) $text );
			if ( $number > 20000000000 ) { $number = (int) floor( $number / 1000 ); }
			if ( preg_match( '/^20\d{6}$/', $text ) ) {
				$date = \DateTimeImmutable::createFromFormat( '!Ymd', $text, wp_timezone() );
				if ( $date instanceof \DateTimeImmutable ) { return $date->setTime( 23, 59, 59 )->getTimestamp(); }
			}
			if ( $number > 946684800 ) { return $number; }
		}

		foreach ( array( 'Y-m-d H:i:s', 'Y-m-d H:i', 'Y-m-d', 'Y/m/d H:i:s', 'Y/m/d H:i', 'Y/m/d' ) as $format ) {
			$date = \DateTimeImmutable::createFromFormat( '!' . $format, $text, wp_timezone() );
			if ( $date instanceof \DateTimeImmutable ) {
				if ( in_array( $format, array( 'Y-m-d', 'Y/m/d' ), true ) ) { $date = $date->setTime( 23, 59, 59 ); }
				return $date->getTimestamp();
			}
		}

		$parsed = strtotime( $text );
		return false === $parsed ? 0 : (int) $parsed;
	}

	/** Resolves a ladder expiry from event context or the actual post meta. */
	private function resolve_bump_expiry_ts( int $post_id, array $context ): int {
		foreach ( array( 'bump_expiration_ts', 'bump_expires_at', 'bump_expiry', 'bump_until', 'boost_expires_at', 'boost_expiry', 'ladder_expires_at', 'ladder_expiry', 'nardeban_expiry', 'expiration_ts', 'expires_at', 'expiry', 'end_ts', 'ends_at' ) as $key ) {
			if ( array_key_exists( $key, $context ) ) {
				$timestamp = $this->parse_bump_timestamp( $context[ $key ] );
				if ( $timestamp > 0 ) { return $timestamp; }
			}
		}
		if ( $post_id <= 0 ) { return 0; }

		$all = get_post_meta( $post_id );
		// First pass: explicit expiry/until/end fields are authoritative.
		foreach ( $all as $key => $values ) {
			if ( ! $this->is_bump_expiry_meta_key( (string) $key ) ) { continue; }
			foreach ( (array) $values as $value ) {
				$timestamp = $this->parse_bump_timestamp( $value );
				if ( $timestamp > 0 ) { return $timestamp; }
			}
		}

		// Second pass: some JetEngine setups use a generic ladder field whose
		// value itself is the future timestamp, without "expiry" in the key.
		foreach ( $all as $key => $values ) {
			if ( ! $this->is_bump_meta_key( (string) $key ) ) { continue; }
			foreach ( (array) $values as $value ) {
				$timestamp = $this->parse_bump_timestamp( $value );
				if ( $timestamp > time() ) { return $timestamp; }
			}
		}

		// Final fallback: start timestamp + a bump-specific duration field.
		$start = 0;
		$duration = 0;
		foreach ( $all as $key => $values ) {
			$key_l = strtolower( (string) $key );
			if ( ! $this->is_bump_meta_key( $key_l ) ) { continue; }
			foreach ( (array) $values as $value ) {
				if ( preg_match( '/(?:start|started|begin|created|شروع)/iu', $key_l ) ) {
					$start = max( $start, $this->parse_bump_timestamp( $value ) );
				}
				if ( preg_match( '/(?:duration|days?|hours?|مدت|روز|ساعت)/iu', $key_l ) && is_numeric( $value ) ) {
					$n = max( 0, (float) $value );
					if ( str_contains( $key_l, 'hour' ) || str_contains( $key_l, 'ساعت' ) ) {
						$duration = max( $duration, (int) round( $n * HOUR_IN_SECONDS ) );
					} elseif ( str_contains( $key_l, 'day' ) || str_contains( $key_l, 'روز' ) || str_contains( $key_l, 'duration' ) || str_contains( $key_l, 'مدت' ) ) {
						$duration = max( $duration, (int) round( $n * DAY_IN_SECONDS ) );
					}
				}
			}
		}
		if ( $start > 0 && $duration > 0 ) { return $start + $duration; }
		return 0;
	}

	/** Completes post/title/date values for a ladder event. */
	private function normalize_bump_context( int $user_id, array $context ): array {
		$post_id = absint( $context['post_id'] ?? 0 );
		$post    = $post_id > 0 ? get_post( $post_id ) : null;
		if ( $post instanceof \WP_Post ) {
			$context['post_type']  = (string) ( $context['post_type'] ?? $post->post_type );
			$context['post_title'] = (string) ( $context['post_title'] ?? $post->post_title );
			if ( $user_id <= 0 ) { $user_id = (int) $post->post_author; }
		}

		$expires = $this->resolve_bump_expiry_ts( $post_id, $context );
		if ( $expires > 0 ) {
			$context['bump_expiration_ts']   = $expires;
			$context['bump_expiration_date'] = wp_date( (string) get_option( 'date_format' ), $expires );
		}
		return $context;
	}

	/** Schedules the two-day ladder-expiry ticket and replaces stale cycles. */
	private function schedule_bump_expiry_reminder( int $post_id, int $user_id, int $expires ): void {
		if ( $post_id <= 0 || $user_id <= 0 || $expires <= time() ) { return; }

		$stored = absint( get_post_meta( $post_id, '_wpep_bump_reminder_expiry', true ) );
		if ( $stored > 0 && $stored !== $expires ) {
			$old = wp_next_scheduled( 'jarchi_bump_expiry_reminder', array( $post_id, $user_id, $stored ) );
			if ( $old ) { wp_unschedule_event( $old, 'jarchi_bump_expiry_reminder', array( $post_id, $user_id, $stored ) ); }
		}

		update_post_meta( $post_id, '_wpep_bump_reminder_expiry', $expires );
		$run_at = $expires - ( 2 * DAY_IN_SECONDS );

		if ( $run_at <= time() ) {
			$this->on_bump_expiry_reminder( $post_id, $user_id, $expires );
			return;
		}

		if ( ! wp_next_scheduled( 'jarchi_bump_expiry_reminder', array( $post_id, $user_id, $expires ) ) ) {
			wp_schedule_single_event( $run_at, 'jarchi_bump_expiry_reminder', array( $post_id, $user_id, $expires ) );
		}
	}

	/** Fires exactly one reminder for the active ladder cycle, two days early. */
	public function on_bump_expiry_reminder( $post_id, $user_id = 0, $expires = 0 ): void {
		$post_id = absint( $post_id );
		$user_id = absint( $user_id );
		$expires = absint( $expires );
		if ( $post_id <= 0 || $expires <= 0 || time() >= $expires ) { return; }

		$stored = absint( get_post_meta( $post_id, '_wpep_bump_reminder_expiry', true ) );
		if ( $stored > 0 && $stored !== $expires ) { return; }

		$post = get_post( $post_id );
		if ( ! $post instanceof \WP_Post ) { return; }
		if ( $user_id <= 0 ) { $user_id = (int) $post->post_author; }
		if ( $user_id <= 0 ) { return; }

		$this->dispatch(
			'custom_hook',
			$user_id,
			array(
				'post_id'              => $post_id,
				'post_type'            => (string) $post->post_type,
				'post_title'           => (string) $post->post_title,
				'bump_expiration_ts'   => $expires,
				'bump_expiration_date' => wp_date( (string) get_option( 'date_format' ), $expires ),
			),
			'post_bump_expiring'
		);
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
		$enabled = array_values( array_filter( $this->rules(), static fn( $rule ) => ! empty( $rule['enabled'] ) ) );
		$rules = array_values(
			array_filter(
				$enabled,
				static fn( $rule ) => in_array( (string) ( $rule['trigger'] ?? '' ), array( 'scheduled' ), true )
			)
		);
		$has_bump_reminder = ! empty( array_filter( $enabled, static fn( $rule ) => 'custom_hook' === (string) ( $rule['trigger'] ?? '' ) && 'post_bump_expiring' === sanitize_key( (string) ( $rule['hook_slug'] ?? '' ) ) ) );

		if ( empty( $rules ) && ! $has_bump_reminder ) {
			return;
		}

		if ( ! $this->acquire_scan_lock() ) {
			$this->log_skip( 'automation_locked', '', 0, 'scan', '' );

			return;
		}

		try {
			// Reconcile real ladder expiry meta every hour. This repairs a missing
			// single cron event and catches bump cycles that existed before Jarchi
			// observed their meta change. It never emits a bump-start ticket.
			if ( $has_bump_reminder ) { $this->scan_bump_reminders(); }

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
	 * Rebuilds ladder reminder schedules from actual post meta.
	 *
	 * This is deliberately reminder-only: installing Jarchi over an already
	 * active ladder must not tell the owner that they "just" bumped it. The
	 * hourly pass only guarantees the 48-hour warning remains scheduled.
	 */
	private function scan_bump_reminders(): void {
		global $wpdb;
		if ( ! isset( $wpdb->postmeta, $wpdb->posts ) ) { return; }

		$raw_patterns = array(
			'bump', 'boost', 'ladder', 'nardeban', 'nardeb', 'نردبان',
			'featured', 'promoted', 'promotion', 'featured_expir', 'featured_until', 'featured_end', 'featured_duration',
		);
		$patterns = array_map( static fn( $value ) => '%' . $wpdb->esc_like( $value ) . '%', $raw_patterns );
		$where = implode( ' OR ', array_fill( 0, count( $patterns ), 'pm.meta_key LIKE %s' ) );
		$sql = "SELECT DISTINCT pm.post_id FROM {$wpdb->postmeta} pm INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id WHERE p.post_status IN ('publish','pending') AND (" . $where . ') ORDER BY pm.post_id DESC LIMIT 400';
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- placeholders are generated above and values are passed to prepare().
		$post_ids = array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( $sql, ...$patterns ) ) );

		foreach ( $post_ids as $post_id ) {
			$post = get_post( $post_id );
			if ( ! $post instanceof \WP_Post || in_array( $post->post_type, self::ignored_post_types(), true ) ) { continue; }
			$object = get_post_type_object( $post->post_type );
			if ( ! $object || empty( $object->public ) || ! empty( $object->_builtin ) ) { continue; }
			$expires = $this->resolve_bump_expiry_ts( $post_id, array() );
			if ( $expires <= time() ) { continue; }
			$user_id = (int) $post->post_author;
			if ( $user_id > 0 ) { $this->schedule_bump_expiry_reminder( $post_id, $user_id, $expires ); }
			if ( self::$created >= self::MAX_PER_REQUEST ) { break; }
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

		$examined = 0;

		foreach ( $users as $user_id ) {
			if ( self::$created >= self::MAX_PER_REQUEST ) {
				break;
			}

			++$examined;

			if ( 'profile_completed' === (string) $rule['trigger'] ) {
				if ( $this->profile_incomplete( $user_id ) ) {
					continue;
				}
			} elseif ( ! $this->condition_matches( $rule, $user_id, array() ) ) {
				continue;
			}

			$this->fire_rule( $rule, $user_id, array() );
		}

		/*
		 * The cursor advances over the users this run actually looked at, not
		 * over the whole batch it fetched. The batch is twenty-five and the
		 * per-request ceiling is twenty, so a full batch always stopped five
		 * users short — and advancing by twenty-five anyway stepped over those
		 * five. They were picked up on the next pass over the user table, an
		 * hour or a day later, which looked like the message simply arriving
		 * late for a scattered few per cent of the site.
		 */
		update_option( $this->cursor_key( $rule_id ), $cursor + $examined, false );
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

		if ( in_array( $trigger, array( 'post_published', 'post_unpublished', 'post_update_pending', 'post_self_deleted', 'post_expired', 'comment_on_post' ), true ) ) {
			$wanted = sanitize_key( (string) ( $rule['post_type'] ?? '' ) );
			$actual = sanitize_key( (string) ( $context['post_type'] ?? '' ) );

			if ( self::POST_TYPE_CUSTOM_PUBLIC === $wanted ) {
				$object = get_post_type_object( $actual );
				if ( ! $object || empty( $object->public ) || ! empty( $object->_builtin ) || in_array( $actual, self::ignored_post_types(), true ) ) {
					return false;
				}
			} elseif ( '' === $wanted || $wanted !== $actual ) {
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
		if ( ! $user ) { return false; }

		if ( '' === trim( (string) get_user_meta( $user_id, 'first_name', true ) ) || '' === trim( (string) get_user_meta( $user_id, 'last_name', true ) ) ) {
			return true;
		}
		foreach ( array( 'phone', 'billing_phone', 'mobile', 'user_phone', 'mobile_number' ) as $phone_key ) {
			if ( '' !== trim( (string) get_user_meta( $user_id, $phone_key, true ) ) ) { return false; }
		}
		return true;
	}

	/** User-meta keys whose changes can complete the basic profile. */
	private function profile_watch_keys(): array {
		return (array) apply_filters( 'wpep_ticket_profile_watch_keys', array( 'first_name', 'last_name', 'phone', 'billing_phone', 'mobile', 'user_phone', 'mobile_number', 'company', 'company_name', 'job_title', 'city', 'country' ) );
	}

	/** Human-readable values included in the profile-completed ticket/email. */
	private function profile_fields_text( int $user_id ): string {
		$user = get_user_by( 'id', $user_id );
		if ( ! $user ) { return ''; }
		$labels = array(
			'first_name' => __( 'نام', 'wp-event-publisher' ),
			'last_name' => __( 'نام خانوادگی', 'wp-event-publisher' ),
			'phone' => __( 'شماره تماس', 'wp-event-publisher' ),
			'billing_phone' => __( 'شماره تماس', 'wp-event-publisher' ),
			'mobile' => __( 'شماره تماس', 'wp-event-publisher' ),
			'user_phone' => __( 'شماره تماس', 'wp-event-publisher' ),
			'mobile_number' => __( 'شماره تماس', 'wp-event-publisher' ),
			'company' => __( 'شرکت', 'wp-event-publisher' ),
			'company_name' => __( 'شرکت', 'wp-event-publisher' ),
			'job_title' => __( 'سمت', 'wp-event-publisher' ),
			'city' => __( 'شهر', 'wp-event-publisher' ),
			'country' => __( 'کشور', 'wp-event-publisher' ),
		);
		$rows = array(); $seen = array();
		foreach ( $this->profile_watch_keys() as $key ) {
			$key = (string) $key; $value = trim( (string) get_user_meta( $user_id, $key, true ) );
			if ( '' === $value ) { continue; }
			$label = (string) ( $labels[ $key ] ?? $key );
			if ( isset( $seen[ $label ] ) ) { continue; }
			$seen[ $label ] = true; $rows[] = $label . ': ' . wp_strip_all_tags( $value );
		}
		if ( ! empty( $user->user_email ) ) { $rows[] = __( 'ایمیل', 'wp-event-publisher' ) . ': ' . (string) $user->user_email; }
		return implode( "\n", $rows );
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
		$trigger = sanitize_key( (string) ( $rule['trigger'] ?? '' ) );
		if ( 'custom_hook' === $trigger && in_array( sanitize_key( (string) ( $rule['hook_slug'] ?? '' ) ), array( 'post_bumped', 'post_bump_expiring', 'post_bump_ended' ), true ) && ! empty( $context['post_id'] ) ) {
			$cycle = absint( $context['bump_expiration_ts'] ?? $context['expiration_ts'] ?? 0 );
			if ( $cycle > 0 ) { return (string) (int) $context['post_id'] . ':' . (string) $cycle; }
			$cycle_id = sanitize_key( (string) ( $context['bump_cycle_id'] ?? '' ) );
			if ( '' !== $cycle_id ) { return (string) (int) $context['post_id'] . ':' . $cycle_id; }
		}
		if ( in_array( $trigger, array( 'post_expired' ), true ) && ! empty( $context['post_id'] ) ) {
			// Include the timestamp so a renewed advert can legitimately receive a fresh final-expiry ticket.
			return (string) (int) $context['post_id'] . ':' . (string) (int) ( $context['expiration_ts'] ?? 0 );
		}
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
			'{comment_author}' => (string) ( $context['comment_author'] ?? '' ),
			'{profile_fields}' => (string) ( $context['profile_fields'] ?? $this->profile_fields_text( $user_id ) ),
			'{expiration_date}' => (string) ( $context['expiration_date'] ?? ( ! empty( $context['expiration_ts'] ) ? wp_date( (string) get_option( 'date_format' ), (int) $context['expiration_ts'] ) : '' ) ),
			'{bump_expiration_date}' => (string) ( $context['bump_expiration_date'] ?? ( ! empty( $context['bump_expiration_ts'] ) ? wp_date( (string) get_option( 'date_format' ), (int) $context['bump_expiration_ts'] ) : '' ) ),
			'{reject_reason}' => (string) ( $context['reject_reason'] ?? '' ),
			'{reject_note}'   => (string) ( $context['reject_note'] ?? '' ),
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

		if ( in_array( $trigger, array( 'post_published', 'post_unpublished' ), true ) ) {
			$type = sanitize_key( (string) ( $rule['post_type'] ?? '' ) );
			if ( self::POST_TYPE_CUSTOM_PUBLIC === $type ) {
				$event .= ' — ' . __( 'همه پست‌تایپ‌های سفارشی عمومی', 'wp-event-publisher' );
			} elseif ( $type ) {
				$obj = get_post_type_object( $type );
				$event .= ' — ' . ( $obj ? (string) $obj->labels->singular_name : $type );
			}
		}

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

		$nonce_action          = self::NONCE;
		$template_nonce_action = self::TEMPLATE_NONCE;

		include WPEP_PLUGIN_DIR . 'admin/views/ticket-automations.php';
	}
}
