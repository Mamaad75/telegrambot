<?php
/**
 * Jarchi application shell: sidebar, top bar, content wrapper.
 *
 * Included by {@see WPEventPublisher\AdminShell::open()}, which supplies the
 * variables.
 *
 * The markup here is balanced: it opens no wrapper it does not close. It is
 * printed on `in_admin_header`, which lands inside #wpcontent just before
 * WordPress opens #wpbody, and there is no matching hook further down the
 * page — `admin_footer` fires after #wpcontent and #wpwrap have already been
 * closed — so wrapping the page content in markup would produce mis-nested
 * HTML. The stylesheet lays the sidebar, top bar and #wpbody out as a grid on
 * #wpcontent instead, which needs no wrapper at all.
 *
 * @package WPEventPublisher
 *
 * @var array<int,array<string,mixed>>       $items     Navigation tree.
 * @var string                               $current   Current screen id.
 * @var string                               $theme     light|dark.
 * @var bool                                 $collapsed Sidebar collapsed.
 * @var \WPEventPublisher\AdminShell         $shell     Shell instance.
 * @var string                               $section   publishing|support.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$wpep_logo  = WPEP_PLUGIN_URL . 'assets/jarchi-logo-new.svg';
$wpep_title = '';

// The shell asks the shell object which section this is rather than keeping a
// second, shorter list of support screens of its own. The old local list named
// six of the seventeen, so eleven support screens rendered the publishing
// breadcrumb and the publishing call to action.
$wpep_is_ticket_context = 'support' === ( $section ?? $shell->section() );

/** Recursively find the active label. */
$wpep_find_title = static function ( array $nodes ) use ( &$wpep_find_title, $current ): string {
	foreach ( $nodes as $node ) {
		if ( (string) ( $node['id'] ?? '' ) === $current ) {
			return (string) ( $node['label'] ?? '' );
		}
		$children = (array) ( $node['children'] ?? array() );
		if ( $children ) {
			$found = $wpep_find_title( $children );
			if ( '' !== $found ) {
				return $found;
			}
		}
	}
	return '';
};

$wpep_title = $wpep_find_title( $items );
$wpep_section_label = $shell->section_label();

/** Render branded platform SVGs and fall back to WordPress Dashicons for generic entries. */
$wpep_icon = static function ( string $icon ): void {
    if ( 'brand-telegram' === $icon ) {
        echo '<svg class="jarchi-brand-icon jarchi-brand-icon--telegram" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 3.4 2.8 10.65c-.86.34-.83 1.58.04 1.86l4.77 1.52 1.83 5.68c.27.84 1.3 1.11 1.91.5l2.66-2.67 4.94 3.63c.72.53 1.74.12 1.9-.76l2.75-15.24c.17-.94-.73-1.61-1.59-1.27ZM18.48 6.5l-7.17 6.45-.26 3.11-.99-3.1-4.34-1.38 12.76-4.92Z"/></svg>';
        return;
    }
    if ( 'brand-whatsapp' === $icon ) {
        echo '<svg class="jarchi-brand-icon jarchi-brand-icon--whatsapp" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.05a9.85 9.85 0 0 0-8.48 14.86L2.1 21.85l5.08-1.33A9.84 9.84 0 1 0 12 2.05Zm0 17.93a8.06 8.06 0 0 1-4.1-1.12l-.29-.17-3.02.79.8-2.94-.18-.3A8.07 8.07 0 1 1 12 19.98Zm4.45-5.98c-.24-.12-1.41-.69-1.63-.77-.22-.08-.38-.12-.54.12-.16.24-.62.77-.76.93-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.92-1.19-.71-.63-1.19-1.4-1.33-1.64-.14-.24-.01-.37.1-.49.1-.1.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.41-.54-.42h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.59 4.12 3.63.58.25 1.03.39 1.38.5.58.18 1.1.15 1.52.09.46-.07 1.41-.58 1.61-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z"/></svg>';
        return;
    }
    if ( 'brand-bale' === $icon ) {
        // Bale's recognizable leaf/chat mark, kept local so the admin never depends on a CDN.
        echo '<svg class="jarchi-brand-icon jarchi-brand-icon--bale" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.25a9.75 9.75 0 0 0-8.86 13.8L2.5 21.5l5.45-1.47A9.75 9.75 0 1 0 12 2.25Zm0 2.1a7.66 7.66 0 0 1 6.62 11.51l-.3.5.68 2.54-2.56-.69-.5.3A7.66 7.66 0 1 1 12 4.35Zm-4.2 7.52c1.18-2.06 2.96-3.34 5.31-3.79l.74-.14-.18.73c-.42 1.73-.2 2.78.73 3.59.67.58 1.6.84 2.95.8l.82-.02-.36.74c-.86 1.77-2.5 2.77-4.48 2.77-2.84 0-5.42-1.84-5.53-4.68v-.2Z"/></svg>';
        return;
    }
    echo '<span class="dashicons dashicons-' . esc_attr( $icon ) . '" aria-hidden="true"></span>';
};

/** Recursively render the sidebar tree. */
// $wpep_icon MUST be captured. A closure sees only what it imports, so
// leaving it out made every icon call `null(...)` — "Value of type null is
// not callable" — which is a fatal, and it fired on the first navigation
// item, i.e. on every single Jarchi screen. That is the white "critical
// error" page: the top bar had already been printed, then the sidebar died.
$wpep_render_nav = static function ( array $nodes, int $depth = 0 ) use ( &$wpep_render_nav, $wpep_icon, $shell, $current ): void {
	foreach ( $nodes as $node ) :
		$children = (array) ( $node['children'] ?? array() );
		$active = $shell->is_active( (array) $node, $current );
		$label  = (string) ( $node['label'] ?? '' );
		$url    = (string) ( $node['url'] ?? '#' );
		?>
		<?php if ( empty( $children ) ) : ?>
			<a
				class="jarchi-nav__item<?php echo $active ? ' is-active' : ''; ?><?php echo $depth > 0 ? ' is-leaf' : ''; ?>"
				href="<?php echo esc_url( $url ); ?>"
				data-label="<?php echo esc_attr( $label ); ?>"
				title="<?php echo esc_attr( $label ); ?>"
				<?php echo $active ? 'aria-current="page"' : ''; ?>
			>
				<?php if ( ! empty( $node['icon'] ) ) : ?>
					<?php $wpep_icon( (string) $node['icon'] ); ?>
				<?php endif; ?>
				<span class="jarchi-nav__label"><?php echo esc_html( $label ); ?></span>
				<?php if ( $depth > 1 ) : ?><span class="jarchi-nav__leaf-dot" aria-hidden="true"></span><?php endif; ?>
			</a>
		<?php else : ?>
			<div class="jarchi-nav__group<?php echo $active ? ' is-open is-parent-active' : ''; ?><?php echo $depth > 0 ? ' is-subgroup' : ''; ?>">
				<button
					type="button"
					class="jarchi-nav__item jarchi-nav__toggle<?php echo $active ? ' is-parent-active' : ''; ?>"
					aria-expanded="<?php echo $active ? 'true' : 'false'; ?>"
					data-label="<?php echo esc_attr( $label ); ?>"
					title="<?php echo esc_attr( $label ); ?>"
					data-jarchi-nav-toggle
				>
					<?php if ( ! empty( $node['icon'] ) ) : ?>
						<?php $wpep_icon( (string) $node['icon'] ); ?>
					<?php endif; ?>
					<span class="jarchi-nav__label"><?php echo esc_html( $label ); ?></span>
					<span class="jarchi-nav__chevron dashicons dashicons-arrow-down-alt2" aria-hidden="true"></span>
				</button>
				<?php
				/*
				 * The children live inside ONE inner element on purpose.
				 *
				 * The collapse is done with the grid technique — the outer box
				 * animates grid-template-rows from 0fr to 1fr while its child
				 * carries overflow:hidden — and that technique sizes only the
				 * rows the template declares. With the items placed directly in
				 * the grid there was a single 0fr row and then one implicit,
				 * auto-sized row per remaining item, so pressing the toggle
				 * collapsed the first entry and left every other one at full
				 * height. That is precisely how it looked: a toggle that did
				 * nothing. A single wrapper means a single row, so the whole
				 * group opens and closes together.
				 */
				?>
				<div class="jarchi-nav__children">
					<div class="jarchi-nav__children-inner">
						<?php $wpep_render_nav( $children, $depth + 1 ); ?>
					</div>
				</div>
			</div>
		<?php endif; ?>
		<?php
	endforeach;
};

?>
<div class="jarchi-app" data-theme="<?php echo esc_attr( $theme ); ?>">


	<aside class="jarchi-nav" aria-label="<?php esc_attr_e( 'منوی جارچی', 'wp-event-publisher' ); ?>">
		<div class="jarchi-nav__brand">
			<img src="<?php echo esc_url( $wpep_logo ); ?>" alt="" width="28" height="28" />
			<span class="jarchi-nav__brand-name"><?php echo esc_html( $wpep_section_label ); ?></span>

			<button
				type="button"
				class="jarchi-nav__collapse"
				data-jarchi-nav-collapse
				aria-expanded="<?php echo $collapsed ? 'false' : 'true'; ?>"
				aria-controls="jarchi-nav-list"
				title="<?php echo esc_attr( $collapsed ? __( 'باز کردن منو', 'wp-event-publisher' ) : __( 'جمع کردن منو', 'wp-event-publisher' ) ); ?>"
				aria-label="<?php echo esc_attr( $collapsed ? __( 'باز کردن منو', 'wp-event-publisher' ) : __( 'جمع کردن منو', 'wp-event-publisher' ) ); ?>"
			>
				<span class="dashicons dashicons-menu-alt" aria-hidden="true"></span>
			</button>

		</div>

		<nav class="jarchi-nav__list" id="jarchi-nav-list">
			<?php $wpep_render_nav( $items ); ?>
		</nav><div class="jarchi-shell__credit">توسعه یافته توسط ممد از تیم بایمر</div>
	</aside>

	<header class="jarchi-topbar">
		<div class="jarchi-topbar__title">
				<span class="jarchi-topbar__crumb"><?php echo esc_html( $wpep_section_label ); ?></span>
			<?php if ( '' !== $wpep_title ) : ?>
					<span class="jarchi-topbar__sep" aria-hidden="true">/</span>
					<strong><?php echo esc_html( $wpep_title ); ?></strong>
			<?php endif; ?>
			</div>

		<div class="jarchi-topbar__actions">
			<?php
				$wpep_themes = array(
					'light' => array( __( 'حالت روشن', 'wp-event-publisher' ) ),
					'dark'  => array( __( 'حالت تیره', 'wp-event-publisher' ) ),
				);
				?>
			<div class="jarchi-theme-switch" role="group" aria-label="<?php esc_attr_e( 'حالت نمایش', 'wp-event-publisher' ); ?>">
				<?php foreach ( $wpep_themes as $wpep_key => $wpep_meta ) : ?>
					<button
							type="button"
							class="jarchi-theme-switch__button<?php echo $theme === $wpep_key ? ' is-active' : ''; ?>"
							data-jarchi-theme="<?php echo esc_attr( $wpep_key ); ?>"
							aria-pressed="<?php echo $theme === $wpep_key ? 'true' : 'false'; ?>"
							title="<?php echo esc_attr( $wpep_meta[0] ); ?>"
						>
							<?php if ( 'light' === $wpep_key ) : ?>
								<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>
							<?php else : ?>
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.3 8.3 0 0 1 8.8 4 8.3 8.3 0 1 0 20 15.2Z"></path></svg>
							<?php endif; ?>
							<span class="screen-reader-text"><?php echo esc_html( $wpep_meta[0] ); ?></span>
					</button>
				<?php endforeach; ?>
			</div>

			<?php if ( $wpep_is_ticket_context ) : ?>
				<a class="jarchi-topbar__cta" href="<?php echo esc_url( WPEventPublisher\Admin::app_url( 'support' ) ); ?>">
					<span class="dashicons dashicons-sos" aria-hidden="true"></span>
					<?php esc_html_e( 'مدیریت تیکت‌ها', 'wp-event-publisher' ); ?>
				</a>
			<?php else : ?>
				<a class="jarchi-topbar__cta" href="<?php echo esc_url( WPEventPublisher\AnnouncementBuilder::url() ); ?>">
					<span class="dashicons dashicons-plus-alt2" aria-hidden="true"></span>
					<?php esc_html_e( 'اطلاعیه تازه', 'wp-event-publisher' ); ?>
				</a>
			<?php endif; ?>
			</div>
	</header>
</div>
