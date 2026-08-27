<?php
/**
 * Announcement front end: shortcode, notification icon, Elementor widget.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

use WP_Post;

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Renders announcements on the front end.
 *
 * Three entry points — a shortcode, a notification icon, and an Elementor
 * widget — all of which render through {@see self::markup()}. That is the
 * point: the audience and expiry rules live in one query and the escaping
 * lives in one renderer, so a new entry point cannot accidentally ship an
 * unescaped or unfiltered variant.
 *
 * Elementor is optional. Nothing here loads unless Elementor has actually
 * registered its widget manager, so a site without it keeps working with no
 * notices and no fatal.
 *
 * @since 1.6.0
 */
class AnnouncementsFrontend {

	/**
	 * Announcement query layer.
	 *
	 * @var Announcements
	 */
	private Announcements $announcements;

	/**
	 * Whether the inline stylesheet has already been printed.
	 *
	 * @var bool
	 */
	private bool $printed_styles = false;

	/**
	 * Constructor.
	 *
	 * @since 1.6.0
	 *
	 * @param Announcements $announcements Announcement query layer.
	 */
	public function __construct( Announcements $announcements ) {
		$this->announcements = $announcements;
	}

	/**
	 * Registers the shortcodes and the Elementor hook.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	public function register(): void {
		add_shortcode( 'jarchi_announcements', array( $this, 'shortcode' ) );
		add_shortcode( 'jarchi_announcement_icon', array( $this, 'icon_shortcode' ) );

		// Only fires when Elementor is present; on a site without it this hook
		// simply never runs.
		add_action( 'elementor/widgets/register', array( $this, 'register_elementor_widget' ) );
	}

	/**
	 * Renders the `[jarchi_announcements]` shortcode.
	 *
	 * @since 1.6.0
	 *
	 * @param array<string,mixed>|string $atts Shortcode attributes.
	 *
	 * @return string Markup.
	 */
	public function shortcode( $atts = array() ): string {
		$atts = shortcode_atts(
			array(
				'count' => 5,
				'icon'  => 'yes',
				'date'  => 'yes',
				'badge' => 'yes',
				'style' => 'list',
				'title' => 'yes',
			),
			is_array( $atts ) ? $atts : array(),
			'jarchi_announcements'
		);

		return $this->markup(
			(int) $atts['count'],
			array(
				'icon'  => $this->truthy( $atts['icon'] ),
				'date'  => $this->truthy( $atts['date'] ),
				'badge' => $this->truthy( $atts['badge'] ),
				'style'   => 'cards' === $atts['style'] ? 'cards' : 'list',
				'heading' => $this->truthy( $atts['title'] ),
			)
		);
	}

	/**
	 * Renders the `[jarchi_announcement_icon]` shortcode.
	 *
	 * @since 1.6.0
	 *
	 * @param array<string,mixed>|string $atts Shortcode attributes.
	 *
	 * @return string Markup.
	 */
	public function icon_shortcode( $atts = array() ): string {
		$atts = shortcode_atts(
			array( 'count' => 5 ),
			is_array( $atts ) ? $atts : array(),
			'jarchi_announcement_icon'
		);

		$items = $this->announcements->active( (int) $atts['count'] );
		$total = count( $items );
		$ticket_unread = function_exists( 'wpep' ) ? wpep()->tickets()->unread_count() : 0;
		$total_badge = $total + $ticket_unread;

		$out  = $this->styles();
		$out .= '<div class="jarchi-bell" data-jarchi-bell>';
		$out .= '<button type="button" class="jarchi-bell__button" aria-expanded="false" aria-haspopup="true" aria-label="'
			. esc_attr__( 'اطلاعیه‌ها', 'wp-event-publisher' ) . '">';
		$out .= '<span class="dashicons dashicons-megaphone" aria-hidden="true"></span>';

		if ( $total_badge > 0 ) {
			$out .= '<span class="jarchi-bell__count' . ( $ticket_unread > 0 ? ' has-ticket-alert' : '' ) . '" data-jarchi-ticket-badge aria-hidden="true">' . esc_html( (string) min( 99, $total_badge ) ) . '</span>';
			$out .= '<span class="jarchi-bell__dot has-announcement-alert" aria-label="' . esc_attr__( 'اطلاعیه جدید', 'wp-event-publisher' ) . '"></span>';
		}

		$out .= '</button>';
		$out .= '<div class="jarchi-bell__panel" hidden>';
		if ( $ticket_unread > 0 ) {
			$out .= '<a class="jarchi-bell__ticket-link" href="' . esc_url( wpep()->tickets()->ticket_page_url() ) . '"><span class="dashicons dashicons-sos"></span>' . esc_html__( 'پاسخ جدید برای تیکت شما', 'wp-event-publisher' ) . '</a>';
		}
		$out .= $this->list_markup( $items, array( 'icon' => true, 'date' => true, 'badge' => false, 'style' => 'list' ) );
		$out .= '</div></div>';

		$out .= $this->bell_script();

		// The announcement icon also carries ticket reply notifications. Load
		// the polling script on pages where only the announcement icon is used.
		if ( function_exists( 'wpep' ) && is_user_logged_in() ) {
			$ticket_js = WPEP_PLUGIN_DIR . 'assets/js/tickets.js';
			if ( is_readable( $ticket_js ) ) {
				wp_enqueue_script( 'wpep-tickets', WPEP_PLUGIN_URL . 'assets/js/tickets.js', array(), WPEP_VERSION . '.' . filemtime( $ticket_js ), true );
				wp_localize_script( 'wpep-tickets', 'wpepTickets', array( 'ajaxUrl' => admin_url( 'admin-ajax.php' ), 'nonce' => wp_create_nonce( Tickets::AJAX_NONCE ) ) );
			}
		}

		return $out;
	}

	/**
	 * Builds the announcement markup.
	 *
	 * @since 1.6.0
	 *
	 * @param int                 $count   How many to show.
	 * @param array<string,mixed> $options Display options.
	 *
	 * @return string Markup.
	 */
	public function markup( int $count, array $options = array() ): string {
		$items = $this->announcements->active( $count );

		return $this->styles() . $this->list_markup( $items, $options );
	}

	/**
	 * Renders one placement's markup.
	 *
	 * Every placement wraps the *same* card list the announcements page uses.
	 * That is deliberate: a popup and a header bar differ in where they sit
	 * and how they are dismissed, not in what an announcement looks like, so
	 * the card markup and its escaping exist once.
	 *
	 * @since 1.7.0
	 *
	 * @param string              $placement Placement identifier.
	 * @param \WP_Post[]          $items     Announcements to show.
	 * @param array<string,mixed> $options   Placement options.
	 *
	 * @return string Markup.
	 */
	public function placement_markup( string $placement, array $items, array $options = array() ): string {
		if ( empty( $items ) ) {
			return '';
		}

		$inner = $this->list_markup(
			$items,
			array(
				'icon'  => true,
				'date'  => 'page' === $placement,
				'badge' => true,
				'style' => 'list',
				// Only the dedicated page carries a page heading.
				'heading' => 'page' === $placement,
			)
		);

		$out = $this->styles();

		switch ( $placement ) {
			case 'popup':
				$out .= $this->wrap_popup( $inner, $options );
				break;

			case 'header':
			case 'footer_bar':
				$out .= $this->wrap_bar( $inner, $placement, $options );
				break;

			case 'floating':
				$out .= $this->wrap_floating( $inner, $options );
				break;

			default:
				$out .= '<div class="jarchi-placement jarchi-placement--' . esc_attr( $placement ) . '">' . $inner . '</div>';
		}

		return $out . $this->placement_script();
	}

	/**
	 * Wraps content in the popup shell.
	 *
	 * @since 1.7.0
	 *
	 * @param string              $inner   Card markup.
	 * @param array<string,mixed> $options Placement options.
	 *
	 * @return string Markup.
	 */
	private function wrap_popup( string $inner, array $options ): string {
		$out = sprintf(
			'<div class="jarchi-modal" data-jarchi-modal data-delay="%1$d" data-frequency="%2$s" data-outside="%3$s" data-esc="%4$s" data-key="%5$s" hidden>',
			(int) ( $options['delay'] ?? 0 ) * 1000,
			esc_attr( (string) ( $options['frequency'] ?? 'session' ) ),
			! empty( $options['close_outside'] ) ? '1' : '0',
			! empty( $options['close_esc'] ) ? '1' : '0',
			esc_attr( 'jarchi_popup_' . md5( $inner ) )
		);

		if ( ! empty( $options['overlay'] ) ) {
			$out .= '<div class="jarchi-modal__overlay" data-jarchi-close></div>';
		}

		$out .= sprintf(
			'<div class="jarchi-modal__box jarchi-modal__box--%1$s" role="dialog" aria-modal="true" aria-label="%2$s" style="max-width:%3$dpx">',
			esc_attr( (string) ( $options['position'] ?? 'center' ) ),
			esc_attr__( 'اطلاعیه', 'wp-event-publisher' ),
			(int) ( $options['width'] ?? 480 )
		);

		if ( ! empty( $options['close_button'] ) ) {
			$out .= '<button type="button" class="jarchi-modal__close" data-jarchi-close aria-label="'
				. esc_attr__( 'بستن', 'wp-event-publisher' ) . '">&times;</button>';
		}

		return $out . $inner . '</div></div>';
	}

	/**
	 * Wraps content in a full-width bar.
	 *
	 * @since 1.7.0
	 *
	 * @param string              $inner     Card markup.
	 * @param string              $placement Placement identifier.
	 * @param array<string,mixed> $options   Placement options.
	 *
	 * @return string Markup.
	 */
	private function wrap_bar( string $inner, string $placement, array $options ): string {
		$classes = 'jarchi-bar jarchi-bar--' . ( 'header' === $placement ? 'top' : 'bottom' );

		if ( ! empty( $options['sticky'] ) ) {
			$classes .= ' is-sticky';
		}

		$out = '<div class="' . esc_attr( $classes ) . '" data-jarchi-bar data-key="' . esc_attr( 'jarchi_bar_' . md5( $inner ) ) . '">';
		$out .= '<div class="jarchi-bar__inner">' . $inner . '</div>';

		if ( ! empty( $options['dismissible'] ) ) {
			$out .= '<button type="button" class="jarchi-bar__close" data-jarchi-close aria-label="'
				. esc_attr__( 'بستن', 'wp-event-publisher' ) . '">&times;</button>';
		}

		return $out . '</div>';
	}

	/**
	 * Wraps content in the floating panel.
	 *
	 * @since 1.7.0
	 *
	 * @param string              $inner   Card markup.
	 * @param array<string,mixed> $options Placement options.
	 *
	 * @return string Markup.
	 */
	private function wrap_floating( string $inner, array $options ): string {
		$side = 'start' === ( $options['side'] ?? 'end' ) ? 'start' : 'end';

		$out  = '<div class="jarchi-float jarchi-float--' . esc_attr( $side ) . '" data-jarchi-float>';
		$out .= '<button type="button" class="jarchi-float__button" aria-expanded="false" aria-label="'
			. esc_attr__( 'اطلاعیه‌ها', 'wp-event-publisher' ) . '">';
		$out .= '<span class="dashicons dashicons-megaphone" aria-hidden="true"></span></button>';
		$out .= '<div class="jarchi-float__panel" hidden>' . $inner . '</div>';

		return $out . '</div>';
	}

	/**
	 * The behaviour script for popups, bars and the floating panel.
	 *
	 * Printed at most once per request. Deliberately dependency-free: adding
	 * a library to the front end of every page for three dismiss buttons
	 * would be a poor trade.
	 *
	 * @since 1.7.0
	 *
	 * @return string Script block, or an empty string after the first call.
	 */
	private function placement_script(): string {
		static $printed = false;

		if ( $printed ) {
			return '';
		}

		$printed = true;

		return '<script>(function(){'
			. 'function seen(k){try{return localStorage.getItem(k)||sessionStorage.getItem(k);}catch(e){return null;}}'
			. 'function mark(k,f){try{(f==="always"?sessionStorage:localStorage).setItem(k,"1");}catch(e){}}'
			. 'function close(el){var k=el.getAttribute("data-key");var f=el.getAttribute("data-frequency")||"session";'
			. 'el.hidden=true;el.style.display="none";if(k&&f!=="always"){mark(k,f);}}'
			. 'document.addEventListener("DOMContentLoaded",function(){'
			// Popups: honour the delay and the "show once" frequency.
			. 'document.querySelectorAll("[data-jarchi-modal]").forEach(function(m){'
			. 'var k=m.getAttribute("data-key");var f=m.getAttribute("data-frequency")||"session";'
			. 'if(f!=="always"&&k&&seen(k)){m.remove();return;}'
			. 'setTimeout(function(){m.hidden=false;},parseInt(m.getAttribute("data-delay"),10)||0);'
			. 'if(m.getAttribute("data-esc")==="1"){document.addEventListener("keydown",function(e){'
			. 'if(e.key==="Escape"&&!m.hidden){close(m);}});}'
			. 'm.addEventListener("click",function(e){'
			. 'var out=m.getAttribute("data-outside")==="1"&&e.target.hasAttribute("data-jarchi-close");'
			. 'if(e.target.closest("[data-jarchi-close]")&&(out||!e.target.classList.contains("jarchi-modal__overlay"))){close(m);}});'
			. '});'
			// Bars: dismissible and remembered.
			. 'document.querySelectorAll("[data-jarchi-bar]").forEach(function(b){'
			. 'var k=b.getAttribute("data-key");if(k&&seen(k)){b.remove();return;}'
			. 'b.addEventListener("click",function(e){if(e.target.closest("[data-jarchi-close]")){close(b);}});'
			. '});'
			// Floating panel: open and close.
			. 'document.querySelectorAll("[data-jarchi-float]").forEach(function(f){'
			. 'var btn=f.querySelector(".jarchi-float__button"),p=f.querySelector(".jarchi-float__panel");'
			. 'if(!btn||!p){return;}'
			. 'btn.addEventListener("click",function(){var o=!p.hidden;p.hidden=o;btn.setAttribute("aria-expanded",String(!o));});'
			. 'document.addEventListener("click",function(e){if(!f.contains(e.target)){p.hidden=true;btn.setAttribute("aria-expanded","false");}});'
			. '});'
			. '});})();</script>';
	}

	/**
	 * Renders a list of announcements.
	 *
	 * Every value is escaped at the point of output. The body goes through
	 * wp_kses_post() in {@see Announcements::view()} rather than esc_html(),
	 * because an announcement is authored content and is allowed formatting —
	 * but only the formatting wp_kses_post permits, so a script tag pasted
	 * into the editor by a lower-privileged author does not survive.
	 *
	 * @since 1.6.0
	 *
	 * @param WP_Post[]           $items   Announcements.
	 * @param array<string,mixed> $options Display options.
	 *
	 * @return string Markup.
	 */
	private function list_markup( array $items, array $options ): string {
		$show_icon  = ! empty( $options['icon'] );
		$show_date  = ! empty( $options['date'] );
		$show_badge = ! empty( $options['badge'] );
		$style      = 'cards' === ( $options['style'] ?? 'list' ) ? 'cards' : 'list';
		$heading    = ! empty( $options['heading'] );

		$out = '<div class="jarchi-board jarchi-board--' . esc_attr( $style ) . '" dir="rtl">';

		// The page header is what makes this a Jarchi page rather than a bare
		// list dropped into a theme. It is optional, because the same renderer
		// serves the icon panel, where a page title would be absurd.
		if ( $heading ) {
			$out .= '<header class="jarchi-board__head">';
			$out .= '<h2 class="jarchi-board__title">' . esc_html__( 'اطلاعیه‌ها', 'wp-event-publisher' ) . '</h2>';
			$out .= '<p class="jarchi-board__sub">' . esc_html__( 'آخرین خبرها و اطلاعیه‌ها', 'wp-event-publisher' ) . '</p>';
			$out .= '</header>';
		}

		if ( empty( $items ) ) {
			$out .= '<div class="jarchi-board__empty">';
			$out .= '<span class="jarchi-board__empty-icon dashicons dashicons-megaphone" aria-hidden="true"></span>';
			$out .= '<p>' . esc_html__( 'در حال حاضر اطلاعیه‌ای وجود ندارد.', 'wp-event-publisher' ) . '</p>';
			$out .= '</div></div>';

			return $out;
		}

		$out .= '<ul class="jarchi-board__list">';

		foreach ( $items as $post ) {
			$out .= $this->card_markup( $this->announcements->view( $post ), $show_icon, $show_date, $show_badge );
		}

		$out .= '</ul></div>';

		return $out;
	}

	/**
	 * Renders one announcement card.
	 *
	 * Split out of {@see self::list_markup()} so the admin preview draws the
	 * same component visitors see. A preview built from its own markup is a
	 * second implementation, and the two drift the moment either is touched.
	 *
	 * @since 1.7.1
	 *
	 * @param array<string,mixed> $view       Announcement view data.
	 * @param bool                $show_icon  Whether to render the icon.
	 * @param bool                $show_date  Whether to render the date row.
	 * @param bool                $show_badge Whether to render the badge.
	 *
	 * @return string Card markup.
	 */
	private function card_markup( array $view, bool $show_icon, bool $show_date, bool $show_badge ): string {
		$view = wp_parse_args(
			$view,
			array(
				'title'      => '',
				'content'    => '',
				'icon'       => '',
				'image'      => '',
				'link'       => '',
				'badge'      => '',
				'badge_kind' => '',
				'date'       => '',
				'datetime'   => '',
			)
		);

		$out = '<li class="jarchi-card">';

			// The image leads when there is one; otherwise the icon does. Both
			// occupying the same slot is what keeps a mixed list even.
			if ( '' !== $view['image'] ) {
				$out .= '<div class="jarchi-card__media">';
				$out .= '<img src="' . esc_url( $view['image'] ) . '" alt="" loading="lazy" />';
				$out .= '</div>';
			} elseif ( $show_icon && '' !== $view['icon'] ) {
				$out .= '<div class="jarchi-card__icon" aria-hidden="true">';
				$out .= '<span class="dashicons dashicons-' . esc_attr( $view['icon'] ) . '"></span>';
				$out .= '</div>';
			}

			$out .= '<div class="jarchi-card__body">';
			$out .= '<h3 class="jarchi-card__title">';

			if ( '' !== $view['link'] ) {
				$out .= '<a href="' . esc_url( $view['link'] ) . '" rel="nofollow noopener">' . esc_html( $view['title'] ) . '</a>';
			} else {
				$out .= esc_html( $view['title'] );
			}

			$out .= '</h3>';

			// A badge states its meaning in words as well as colour, so the
			// state survives for a reader who cannot distinguish the hue.
			if ( $show_badge && '' !== $view['badge'] ) {
				$out .= '<span class="jarchi-card__badge jarchi-card__badge--' . esc_attr( $view['badge_kind'] ) . '">'
					. esc_html( $view['badge'] ) . '</span>';
			}

			if ( '' !== $view['content'] ) {
				$out .= '<div class="jarchi-card__text">' . $view['content'] . '</div>';
			}

			if ( $show_date ) {
				$out .= '<footer class="jarchi-card__meta">';
				$out .= '<span class="dashicons dashicons-calendar-alt" aria-hidden="true"></span> ';
				$out .= '<time datetime="' . esc_attr( $view['datetime'] ) . '">' . esc_html( $view['date'] ) . '</time>';

				if ( '' !== $view['link'] ) {
					$out .= '<a class="jarchi-card__more" href="' . esc_url( $view['link'] ) . '" rel="nofollow noopener">'
						. esc_html__( 'مشاهده', 'wp-event-publisher' ) . '</a>';
				}

				$out .= '</footer>';
			}

		$out .= '</div></li>';

		return $out;
	}

	/**
	 * Renders a preview card from unsaved builder input.
	 *
	 * Goes through {@see self::card_markup()}, so the preview is the real
	 * component rather than a mock-up of it.
	 *
	 * @since 1.7.1
	 *
	 * @param array<string,mixed> $draft Draft values from the builder.
	 *
	 * @return string Preview markup.
	 */
	public function preview( array $draft ): string {
		$title = (string) ( $draft['title'] ?? '' );

		$view = array(
			'title'    => '' !== trim( $title ) ? $title : __( 'اطلاعیه بدون عنوان', 'wp-event-publisher' ),
			'content'  => wp_kses_post( (string) ( $draft['content'] ?? '' ) ),
			'icon'     => (string) ( $draft['icon'] ?? '' ),
			'image'    => (string) ( $draft['image_url'] ?? '' ),
			'link'     => (string) ( $draft['link'] ?? '' ),
			'date'     => date_i18n( (string) get_option( 'date_format', 'Y-m-d' ) ),
			'datetime' => current_time( 'c' ),
		);

		$placement = (string) ( $draft['placement'] ?? 'page' );

		$out = '<div class="jarchi-board jarchi-board--cards jarchi-preview__board" dir="rtl">';
		$out .= '<ul class="jarchi-board__list">';
		$out .= $this->card_markup( $view, true, true, false );
		$out .= '</ul></div>';

		/**
		 * Filters the builder's preview markup.
		 *
		 * @since 1.7.1
		 *
		 * @param string              $out       Preview markup.
		 * @param array<string,mixed> $draft     Draft values.
		 * @param string              $placement Selected placement.
		 */
		return (string) apply_filters( 'wpep_announcement_preview', $out, $draft, $placement );
	}

	/**
	 * Prints the inline stylesheet once per request.
	 *
	 * Inline and tiny rather than an enqueued file, because these blocks can
	 * appear anywhere — including inside a widget rendered after wp_head — and
	 * a stylesheet enqueued too late would simply not load. It is emitted at
	 * most once however many blocks are on the page.
	 *
	 * @since 1.6.0
	 *
	 * @return string Style block, or an empty string after the first call.
	 */
	private function styles(): string {
		if ( $this->printed_styles ) {
			return '';
		}

		$this->printed_styles = true;

		// Deliberately inline and token-driven, matching the admin palette so
		// the page reads as part of the same product. It has to be inline
		// because these blocks can be rendered after wp_head — inside a widget,
		// inside an Elementor element — where a late enqueue simply would not
		// load. Emitted at most once per request however many blocks appear.
		//
		// Every colour is a fallback-able custom property, so a theme (or an
		// Elementor colour control) can override any of them without this
		// stylesheet needing to know.
		return '<style>'
			. '.jarchi-board{'
			. '--jb-accent:#E84F01;--jb-accent-soft:#fff2e8;'
			. '--jb-surface:#fff;--jb-surface-2:#f7f8fa;--jb-border:#d4d8dd;'
			. '--jb-text:#16181b;--jb-text-2:#4a5058;--jb-muted:#656c75;'
			. '--jb-ok:#1a7f3c;--jb-ok-soft:#e8f6ed;--jb-warn:#8a5a00;--jb-warn-soft:#fdf3e2;'
			. '--jb-radius:14px;--jb-gap:14px;'
			. 'font-family:Vazirmatn,Tahoma,Arial,sans-serif;color:var(--jb-text);'
			. 'max-width:760px;margin-inline:auto;line-height:1.8;text-align:start}'
			. '@media(prefers-color-scheme:dark){.jarchi-board{'
			. '--jb-accent:#FF8A1C;--jb-accent-soft:#33210f;'
			. '--jb-surface:#1a1d21;--jb-surface-2:#22262b;--jb-border:#3a4047;'
			. '--jb-text:#eef0f3;--jb-text-2:#bdc3cb;--jb-muted:#949ba4;'
			. '--jb-ok:#5ed68a;--jb-ok-soft:#16301f;--jb-warn:#f0b64a;--jb-warn-soft:#322614}}'
			. '.jarchi-board__head{margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid var(--jb-accent)}'
			. '.jarchi-board__title{margin:0;font-size:1.6rem;font-weight:800;color:var(--jb-text)}'
			. '.jarchi-board__sub{margin:.3rem 0 0;font-size:.92rem;color:var(--jb-muted)}'
			. '.jarchi-board__list{list-style:none;margin:0;padding:0;display:grid;gap:var(--jb-gap)}'
			. '.jarchi-card{display:flex;gap:14px;align-items:flex-start;padding:16px;'
			. 'background:var(--jb-surface);border:1px solid var(--jb-border);border-radius:var(--jb-radius);'
			. 'box-shadow:0 1px 2px rgba(0,0,0,.05);transition:box-shadow .18s ease,transform .18s ease}'
			. '.jarchi-card:hover{box-shadow:0 6px 20px rgba(0,0,0,.09)}'
			. '.jarchi-board--cards .jarchi-card{flex-direction:column}'
			. '.jarchi-board--cards .jarchi-card__media{width:100%}'
			. '.jarchi-card__icon{flex:0 0 auto;display:grid;place-items:center;width:44px;height:44px;'
			. 'border-radius:12px;background:var(--jb-accent-soft);color:var(--jb-accent)}'
			. '.jarchi-card__icon .dashicons{width:24px;height:24px;font-size:24px}'
			. '.jarchi-card__media{flex:0 0 96px;border-radius:10px;overflow:hidden;background:var(--jb-surface-2)}'
			. '.jarchi-card__media img{display:block;width:100%;height:auto}'
			. '.jarchi-card__body{min-width:0;flex:1}'
			. '.jarchi-card__title{margin:0 0 .3rem;font-size:1.05rem;font-weight:700;line-height:1.6;color:var(--jb-text)}'
			. '.jarchi-card__title a{color:inherit;text-decoration:none}'
			. '.jarchi-card__title a:hover{color:var(--jb-accent);text-decoration:underline}'
			. '.jarchi-card__text{font-size:.94rem;color:var(--jb-text-2)}'
			. '.jarchi-card__text>*:first-child{margin-top:0}.jarchi-card__text>*:last-child{margin-bottom:0}'
			. '.jarchi-card__meta{display:flex;align-items:center;gap:.4rem;margin-top:.6rem;'
			. 'font-size:.82rem;color:var(--jb-muted)}'
			. '.jarchi-card__meta .dashicons{width:15px;height:15px;font-size:15px}'
			. '.jarchi-card__more{margin-inline-start:auto;color:var(--jb-accent);text-decoration:none;font-weight:700}'
			. '.jarchi-card__more:hover{text-decoration:underline}'
			. '.jarchi-card__badge{display:inline-block;font-size:.7rem;font-weight:800;padding:.12rem .5rem;'
			. 'border-radius:999px;margin-inline-start:.4rem;vertical-align:middle}'
			. '.jarchi-card__badge--important{background:var(--jb-accent-soft);color:var(--jb-accent)}'
			. '.jarchi-card__badge--active{background:var(--jb-ok-soft);color:var(--jb-ok)}'
			. '.jarchi-card__badge--expired{background:var(--jb-warn-soft);color:var(--jb-warn)}'
			. '.jarchi-board__empty{text-align:center;padding:2.5rem 1rem;color:var(--jb-muted);'
			. 'border:1px dashed var(--jb-border);border-radius:var(--jb-radius);background:var(--jb-surface-2)}'
			. '.jarchi-board__empty-icon{width:34px;height:34px;font-size:34px;opacity:.5;display:block;margin:0 auto .5rem}'
			. '@media(max-width:600px){.jarchi-card{flex-direction:column}.jarchi-card__media{flex-basis:auto;width:100%}}'
			// The bell panel, which reuses the same tokens.
			. '.jarchi-bell{position:relative;display:inline-block}'
			. '.jarchi-bell__button{background:none;border:0;cursor:pointer;position:relative;padding:.35rem;color:inherit;line-height:1}'
			. '.jarchi-bell__button:focus-visible{outline:2px solid #E84F01;outline-offset:2px}'
			. '.jarchi-bell__count{position:absolute;top:-3px;inset-inline-end:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#E84F01;color:#fff;box-sizing:border-box;'
			. 'border-radius:999px;font-size:.65rem;min-width:1.1em;padding:0 .25em;text-align:center}'
			. '.jarchi-bell__dot{position:absolute;top:-2px;inset-inline-end:-2px;width:9px;height:9px;border-radius:50%;background:#E84F01;box-shadow:0 0 0 3px currentColor;opacity:.95}.jarchi-bell__count.has-ticket-alert{background:#D92D20}.jarchi-bell__panel{position:absolute;inset-inline-end:0;top:100%;z-index:999;width:min(23rem,86vw);'
			. 'max-height:60vh;overflow:auto;padding:.75rem;background:#fff;border:1px solid #d4d8dd;'
			. 'border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.18)}'
			. '.jarchi-bell__panel .jarchi-board{max-width:none}'
			. '@media(prefers-color-scheme:dark){.jarchi-bell__panel{background:#1a1d21;border-color:#3a4047}}'
			. '.jarchi-bell__ticket-link{display:flex;align-items:center;gap:.4rem;margin-bottom:.6rem;padding:.6rem .7rem;border-radius:10px;background:#fff3e8;color:#E84F01;text-decoration:none;font-weight:800;font-size:.78rem}'
			. '.jarchi-bell__ticket-link:hover{background:#ffe9d8;color:#C94300}'
			. '@media(prefers-color-scheme:dark){.jarchi-bell__ticket-link{background:#2a211b;color:#FF8A1C}}'
			. '</style>';
	}

	/**
	 * Returns the small script that opens and closes the icon panel.
	 *
	 * @since 1.6.0
	 *
	 * @return string Script block.
	 */
	private function bell_script(): string {
		static $printed = false;

		if ( $printed ) {
			return '';
		}

		$printed = true;

		return '<script>(function(){document.addEventListener("click",function(e){'
			. 'var bells=document.querySelectorAll("[data-jarchi-bell]");'
			. 'bells.forEach(function(b){var btn=b.querySelector(".jarchi-bell__button"),p=b.querySelector(".jarchi-bell__panel");'
			. 'if(!btn||!p){return;}'
			. 'if(btn.contains(e.target)){var open=!p.hidden;p.hidden=open;btn.setAttribute("aria-expanded",String(!open));}'
			. 'else if(!p.contains(e.target)){p.hidden=true;btn.setAttribute("aria-expanded","false");}});'
			. '});})();</script>';
	}

	/**
	 * Registers the Elementor widget.
	 *
	 * Called only from Elementor's own hook, and still guarded: the widget
	 * class extends an Elementor base class, so it can only be declared once
	 * that class exists.
	 *
	 * @since 1.6.0
	 *
	 * @param mixed $widgets_manager Elementor widget manager.
	 *
	 * @return void
	 */
	public function register_elementor_widget( $widgets_manager ): void {
		if ( ! class_exists( '\Elementor\Widget_Base' ) || ! is_object( $widgets_manager ) || ! method_exists( $widgets_manager, 'register' ) ) {
			return;
		}

		require_once WPEP_PLUGIN_DIR . 'includes/class-announcements-elementor-widget.php';

		if ( ! class_exists( '\WPEventPublisher\AnnouncementsElementorWidget' ) ) {
			return;
		}

		$widgets_manager->register( new AnnouncementsElementorWidget() );
	}

	/**
	 * Interprets a shortcode boolean attribute.
	 *
	 * @since 1.6.0
	 *
	 * @param mixed $value Raw attribute.
	 *
	 * @return bool Whether it reads as true.
	 */
	private function truthy( mixed $value ): bool {
		return in_array( strtolower( (string) $value ), array( 'yes', 'true', '1', 'on' ), true );
	}
}
