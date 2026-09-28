<?php
/**
 * Turns a recorded path back into something an administrator can open.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Finds the page behind a path, and the right way to edit it.
 *
 * The analytics side records paths — `/product/lipstick`, `/checkout` — because
 * that is what a browser reports. A work list has to close the last gap: which
 * WordPress object is that, and which button opens the editor that will
 * actually change it.
 *
 * Getting the editor right matters more than it sounds. Sending someone to the
 * block editor for a page built in Elementor shows them a "this page was built
 * with Elementor" placeholder and nothing they can edit; sending them to
 * Elementor for a WooCommerce product template edits the wrong thing entirely.
 * So the builder is detected per page rather than assumed, and where the page
 * cannot be identified at all the link is simply the front-end URL — an honest
 * "here is where it happens" instead of a button that goes somewhere wrong.
 *
 * Nothing here writes. It reads post meta and returns URLs.
 *
 * @since 4.11.0
 */
class BAP_Page_Resolver {

	/**
	 * Resolved pages for this request, keyed by path.
	 *
	 * A work list asks about the same handful of paths repeatedly, and
	 * `url_to_postid()` runs a query each time.
	 *
	 * @var array<string,array>
	 */
	private static $cache = array();

	/**
	 * Forgets everything resolved so far.
	 *
	 * A web request lasts a second and the cache is a plain win. A cron run or a
	 * WP-CLI process lasts as long as it likes, and there the same cache would
	 * keep serving a page's old title, or keep calling a page unresolvable after
	 * it was published. Anything long-lived should call this between passes.
	 *
	 * @return void
	 */
	public static function flush_cache() {
		self::$cache = array();
	}

	/**
	 * Describes the page a recorded path belongs to.
	 *
	 * @param string $path Recorded path, e.g. `/product/lipstick`.
	 * @return array{post_id:int,title:string,builder:string,builder_label:string,edit_url:string,view_url:string}
	 */
	public static function resolve( $path ) {
		$path = (string) $path;

		if ( isset( self::$cache[ $path ] ) ) {
			return self::$cache[ $path ];
		}

		$view_url = home_url( '/' === substr( $path, 0, 1 ) ? $path : '/' . $path );

		$resolved = array(
			'post_id'       => 0,
			'title'         => '',
			'builder'       => 'unknown',
			'builder_label' => __( 'صفحه ناشناخته', 'bahoosh-analytics-pro' ),
			'edit_url'      => '',
			'view_url'      => $view_url,
		);

		$post_id = self::post_id_for( $path );

		if ( $post_id > 0 ) {
			$resolved['post_id'] = $post_id;
			$resolved['title']   = (string) get_the_title( $post_id );

			$builder = self::builder_for( $post_id );

			$resolved['builder']       = $builder;
			$resolved['builder_label'] = self::builder_label( $builder );
			$resolved['edit_url']      = self::edit_url( $post_id, $builder );
		}

		self::$cache[ $path ] = $resolved;

		return $resolved;
	}

	/**
	 * The post behind a path.
	 *
	 * @param string $path Path.
	 * @return int 0 when nothing matches.
	 */
	private static function post_id_for( $path ) {
		$path = trim( (string) $path );

		if ( '' === $path || '/' === $path ) {
			// The front page is a setting, not a permalink, so `url_to_postid()`
			// does not find it.
			return (int) get_option( 'page_on_front', 0 );
		}

		// The rollup collapses numeric ids to `{id}` so one product does not
		// become a thousand buckets. That is right for counting and useless for
		// resolving, so such a path is reported as unresolvable rather than
		// guessed at.
		if ( false !== strpos( $path, '{id}' ) ) {
			return 0;
		}

		$post_id = (int) url_to_postid( home_url( $path ) );

		if ( $post_id > 0 ) {
			return $post_id;
		}

		// WooCommerce's cart, checkout and account pages are ordinary pages
		// stored as options, and their slugs are frequently translated — which
		// is exactly the case a Persian shop hits.
		foreach ( array( 'woocommerce_cart_page_id', 'woocommerce_checkout_page_id', 'woocommerce_myaccount_page_id', 'woocommerce_shop_page_id' ) as $option ) {
			$candidate = (int) get_option( $option, 0 );

			if ( $candidate < 1 ) {
				continue;
			}

			$permalink = wp_parse_url( (string) get_permalink( $candidate ), PHP_URL_PATH );

			if ( $permalink && untrailingslashit( $permalink ) === untrailingslashit( $path ) ) {
				return $candidate;
			}
		}

		return 0;
	}

	/**
	 * Which builder owns a page's layout.
	 *
	 * @param int $post_id Post id.
	 * @return string `elementor`, `block`, `classic` or `product`.
	 */
	private static function builder_for( $post_id ) {
		// Elementor stores its own edit mode on the post. Checking the meta
		// rather than only whether the plugin is active matters: a site can run
		// Elementor and still have pages the block editor owns.
		if ( 'builder' === get_post_meta( $post_id, '_elementor_edit_mode', true ) ) {
			return 'elementor';
		}

		if ( 'product' === get_post_type( $post_id ) ) {
			return 'product';
		}

		$content = (string) get_post_field( 'post_content', $post_id );

		if ( false !== strpos( $content, '<!-- wp:' ) ) {
			return 'block';
		}

		return 'classic';
	}

	/**
	 * A human name for a builder.
	 *
	 * @param string $builder Builder key.
	 * @return string
	 */
	public static function builder_label( $builder ) {
		$labels = array(
			'elementor' => __( 'ساخته‌شده با المنتور', 'bahoosh-analytics-pro' ),
			'block'     => __( 'ویرایشگر بلوکی وردپرس', 'bahoosh-analytics-pro' ),
			'classic'   => __( 'ویرایشگر کلاسیک', 'bahoosh-analytics-pro' ),
			'product'   => __( 'صفحه محصول ووکامرس', 'bahoosh-analytics-pro' ),
			'unknown'   => __( 'صفحه ناشناخته', 'bahoosh-analytics-pro' ),
		);

		return $labels[ $builder ] ?? $labels['unknown'];
	}

	/**
	 * The URL that opens the editor which can actually change this page.
	 *
	 * @param int    $post_id Post id.
	 * @param string $builder Builder key.
	 * @return string
	 */
	private static function edit_url( $post_id, $builder ) {
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			// No edit link for someone who cannot edit. A button that leads to
			// a permissions error is worse than no button.
			return '';
		}

		if ( 'elementor' === $builder ) {
			return admin_url( 'post.php?post=' . $post_id . '&action=elementor' );
		}

		return (string) get_edit_post_link( $post_id, 'raw' );
	}

	/**
	 * Whether Elementor is present at all, for the screen's explanatory copy.
	 *
	 * @return bool
	 */
	public static function elementor_active() {
		return defined( 'ELEMENTOR_VERSION' ) || did_action( 'elementor/loaded' );
	}
}
