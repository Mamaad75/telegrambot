<?php
/**
 * A work list for fixing what the data says is broken.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Turns friction into a checklist, and deliberately stops there.
 *
 * The plugin can already say that shoppers rage-click on the cart page, that a
 * script throws on checkout, and that a product is viewed sixty times and
 * carted four. What it could not do is close the last gap: none of that told an
 * administrator *which page to open* or *what to change there*, so the numbers
 * stayed numbers.
 *
 * This class produces tasks. Each one names the problem with the figure behind
 * it, resolves the page to whichever editor actually owns its layout — Elementor
 * for an Elementor page, the block editor for a block page — and says what to
 * change. An administrator ticks it off when it is done.
 *
 * **It applies nothing.** That is the design, not a limitation waiting to be
 * lifted. Changing a price is one bounded number with a cap and a one-click
 * revert; changing a page's layout is not, and an automated edit to a checkout
 * template that a shop only notices through falling orders would be a far worse
 * failure than any this plugin currently risks. So the model's reading of the
 * data reaches a human, and the human decides.
 *
 * The task ids are stable: the same problem on the same page produces the same
 * id every run, so ticking something off survives the next analysis and a
 * problem that comes back reopens rather than duplicating.
 *
 * @since 4.11.0
 */
class BAP_UX_Tasks {

	const OPTION_STATE = 'bap_ux_task_state';

	/**
	 * Most tasks kept in the list.
	 *
	 * A checklist nobody can finish is a checklist nobody starts.
	 *
	 * @var int
	 */
	const MAX_TASKS = 25;

	/**
	 * Sessions on a page before its friction is worth a task.
	 *
	 * Two rage clicks is somebody's trackpad. Ten is a pattern.
	 *
	 * @var int
	 */
	const MIN_SIGNAL = 10;

	/**
	 * Builds the current list.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array{tasks:array,counts:array,notes:array}
	 */
	public static function build( $from, $to ) {
		$from = BAP_Reports::sanitize_date( $from );
		$to   = BAP_Reports::sanitize_date( $to );

		// Each run resolves pages afresh. Within one run the cache saves repeated
		// lookups of the same path; across runs — a cron pass, WP-CLI — it would
		// only serve stale titles and links for pages edited in between.
		BAP_Page_Resolver::flush_cache();

		$tasks = array_merge(
			self::friction_tasks( $from, $to ),
			self::funnel_tasks( $from, $to ),
			self::product_tasks( $from, $to ),
			self::search_tasks( $from, $to )
		);

		// Worst first, measured in people affected rather than percentage: the
		// deepest step always has the worst rate on the smallest sample.
		usort( $tasks, static fn( $a, $b ) => $b['affected'] <=> $a['affected'] );

		$tasks = array_slice( $tasks, 0, self::MAX_TASKS );
		$state = self::state();

		$counts = array( 'open' => 0, 'done' => 0, 'dismissed' => 0 );

		foreach ( $tasks as $index => $task ) {
			$status = $state[ $task['id'] ]['status'] ?? 'open';

			$tasks[ $index ]['status']    = $status;
			$tasks[ $index ]['decided_at'] = $state[ $task['id'] ]['at'] ?? '';
			$tasks[ $index ]['page']      = BAP_Page_Resolver::resolve( $task['page_path'] );

			$counts[ $status ] = ( $counts[ $status ] ?? 0 ) + 1;
		}

		return array(
			'tasks'  => array_values( $tasks ),
			'counts' => $counts,
			'notes'  => self::notes( $tasks ),
		);
	}

	/**
	 * Tasks from recorded friction: rage clicks, dead clicks, script errors.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array
	 */
	private static function friction_tasks( $from, $to ) {
		$report = BAP_Local_Reports::explorer( $from, $to );
		$tasks  = array();

		$signals = array(
			'js_error'   => array(
				'severity' => 'critical',
				'title'    => __( 'خطای فنی در صفحه %s را برطرف کنید', 'bahoosh-analytics-pro' ),
				'what'     => __( 'جاوااسکریپت این صفحه خطا می‌دهد و می‌تواند دکمه‌ها را از کار بیندازد. کنسول مرورگر را روی همین صفحه باز کنید و خطا را ببینید؛ معمولاً یک افزونه یا اسکریپت شخص ثالث است.', 'bahoosh-analytics-pro' ),
			),
			'dead_click' => array(
				'severity' => 'high',
				'title'    => __( 'در صفحه %s روی چیزی کلیک می‌کنند که دکمه نیست', 'bahoosh-analytics-pro' ),
				'what'     => __( 'عنصری در این صفحه شبیه دکمه دیده می‌شود ولی کاری نمی‌کند. یا واقعاً قابل کلیکش کنید، یا ظاهرش را طوری تغییر دهید که دکمه به نظر نرسد.', 'bahoosh-analytics-pro' ),
			),
			'rage_click' => array(
				'severity' => 'high',
				'title'    => __( 'در صفحه %s کاربران کلافه می‌شوند', 'bahoosh-analytics-pro' ),
				'what'     => __( 'کاربر پشت سر هم روی چیزی کلیک کرده و پاسخی نگرفته. معمولاً دکمه‌ای است که کند است یا خطا می‌دهد. اگر کلاریتی متصل است، ضبط همین صفحه را ببینید.', 'bahoosh-analytics-pro' ),
			),
		);

		foreach ( $report['pages'] as $page ) {
			foreach ( $signals as $type => $spec ) {
				$count = (int) ( $page['by_type'][ $type ] ?? 0 );

				if ( $count < self::MIN_SIGNAL ) {
					continue;
				}

				$tasks[] = self::task(
					$type,
					$page['page_path'],
					$spec['severity'],
					sprintf( $spec['title'], $page['page_path'] ),
					$spec['what'],
					sprintf(
						/* translators: 1: signal count, 2: visitor count. */
						__( '%1$s بار، از %2$s بازدیدکننده', 'bahoosh-analytics-pro' ),
						number_format_i18n( $count ),
						number_format_i18n( (int) $page['visitors'] )
					),
					$count
				);
			}
		}

		return $tasks;
	}

	/**
	 * Tasks from the step where the purchase funnel leaks most.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array
	 */
	private static function funnel_tasks( $from, $to ) {
		$steps  = BAP_Local_Reports::funnel( $from, $to )['steps'];
		$worst  = null;
		$lost   = 0;

		foreach ( $steps as $index => $step ) {
			// `view_item` is excluded on purpose: browsing without buying is
			// what a shop is for, and the drop there is not a defect.
			if ( 0 === $index || null === $step['drop_pc'] ) {
				continue;
			}

			$next      = $steps[ $index + 1 ]['count'] ?? 0;
			$people    = max( 0, (int) $step['count'] - (int) $next );

			if ( $people > $lost ) {
				$lost  = $people;
				$worst = $step;
			}
		}

		if ( ! $worst || $lost < self::MIN_SIGNAL ) {
			return array();
		}

		$page = self::page_for_step( $worst['step'], $from, $to );

		return array(
			self::task(
				'funnel_' . $worst['step'],
				$page,
				$worst['drop_pc'] >= 50 ? 'critical' : 'high',
				sprintf(
					/* translators: %s: funnel step label. */
					__( 'بیشترین ریزش خرید در مرحله «%s» است', 'bahoosh-analytics-pro' ),
					$worst['label']
				),
				BAP_Local_Reports::abandon_advice( $worst['step'] ),
				sprintf(
					/* translators: 1: people lost, 2: drop percentage. */
					__( '%1$s نفر (%2$s درصد) اینجا رها کرده‌اند', 'bahoosh-analytics-pro' ),
					number_format_i18n( $lost ),
					number_format_i18n( (float) $worst['drop_pc'], 1 )
				),
				$lost
			),
		);
	}

	/**
	 * Tasks for individual products that lose their buyers.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array
	 */
	private static function product_tasks( $from, $to ) {
		$products = BAP_Local_Reports::product_funnel( $from, $to )['products'];
		$tasks    = array();

		foreach ( array_slice( $products, 0, 5 ) as $product ) {
			if ( $product['lost_people'] < self::MIN_SIGNAL || '' === $product['lost_at'] ) {
				continue;
			}

			// Only the product-page problem is a page-editing task. Losing
			// people at checkout is a checkout problem, and it is already
			// covered by the funnel task above.
			if ( 'view_item' !== $product['lost_at'] ) {
				continue;
			}

			$tasks[] = self::task(
				'product_' . md5( $product['name'] ),
				self::product_path( $product['name'] ),
				'medium',
				sprintf(
					/* translators: %s: product name. */
					__( 'صفحه محصول «%s» بازدید می‌گیرد ولی فروش نه', 'bahoosh-analytics-pro' ),
					$product['name']
				),
				$product['advice'],
				sprintf(
					/* translators: 1: views, 2: add-to-cart count. */
					__( '%1$s بازدید، تنها %2$s بار در سبد', 'bahoosh-analytics-pro' ),
					number_format_i18n( (int) $product['view_item'] ),
					number_format_i18n( (int) $product['add_to_cart'] )
				),
				(int) $product['lost_people']
			);
		}

		return $tasks;
	}

	/**
	 * Tasks for searches that find nothing.
	 *
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return array
	 */
	private static function search_tasks( $from, $to ) {
		$searches = BAP_Local_Reports::explorer( $from, $to )['searches'];
		$barren   = array();

		foreach ( $searches as $search ) {
			if ( empty( $search['no_click'] ) || (int) $search['count'] < 3 ) {
				continue;
			}

			$barren[] = $search;
		}

		if ( ! $barren ) {
			return array();
		}

		$terms = array_slice( wp_list_pluck( $barren, 'term' ), 0, 6 );
		$total = array_sum( wp_list_pluck( $barren, 'count' ) );

		return array(
			self::task(
				'search_barren',
				'/',
				'medium',
				__( 'کاربران دنبال چیزی می‌گردند که پیدا نمی‌کنند', 'bahoosh-analytics-pro' ),
				sprintf(
					/* translators: %s: comma-separated search terms. */
					__( 'این عبارت‌ها جست‌وجو شده‌اند و هیچ‌کس روی نتیجه‌ای کلیک نکرده: %s. یا این محصول‌ها را ندارید، یا نامشان با چیزی که مشتری می‌نویسد فرق دارد. افزودن محصول یا هم‌معنی کردن نام‌ها هر دو جواب می‌دهد.', 'bahoosh-analytics-pro' ),
					implode( '، ', $terms )
				),
				sprintf(
					/* translators: 1: total searches, 2: number of terms. */
					__( '%1$s جست‌وجو روی %2$s عبارت، بدون هیچ کلیکی', 'bahoosh-analytics-pro' ),
					number_format_i18n( $total ),
					number_format_i18n( count( $barren ) )
				),
				(int) $total
			),
		);
	}

	/**
	 * The page where a funnel step most often happens.
	 *
	 * @param string $step Step slug.
	 * @param string $from Y-m-d.
	 * @param string $to   Y-m-d.
	 * @return string
	 */
	private static function page_for_step( $step, $from, $to ) {
		$pages = BAP_Rollup::top_pages_for_step( $step, $from, $to, 1 );

		return $pages ? (string) $pages[0]['page_path'] : '/';
	}

	/**
	 * The path of a product, by name.
	 *
	 * @param string $name Product name.
	 * @return string
	 */
	private static function product_path( $name ) {
		if ( ! BAP_Commerce_Facts::available() ) {
			return '/';
		}

		$products = wc_get_products(
			array(
				'limit'  => 1,
				'status' => 'publish',
				'search' => $name,
			)
		);

		foreach ( (array) $products as $product ) {
			if ( ! is_object( $product ) || ! method_exists( $product, 'get_permalink' ) ) {
				continue;
			}

			$path = wp_parse_url( (string) $product->get_permalink(), PHP_URL_PATH );

			if ( $path ) {
				return (string) $path;
			}
		}

		return '/';
	}

	/**
	 * Builds one task with a stable id.
	 *
	 * @param string $kind      Task kind.
	 * @param string $path      Page path.
	 * @param string $severity  critical|high|medium.
	 * @param string $title     Headline.
	 * @param string $what      What to change.
	 * @param string $evidence  The figure behind it.
	 * @param int    $affected  People affected, used for ordering.
	 * @return array
	 */
	private static function task( $kind, $path, $severity, $title, $what, $evidence, $affected ) {
		return array(
			// Stable across runs: the same problem on the same page keeps its
			// id, so ticking it off survives the next analysis, and a problem
			// that returns reopens rather than appearing twice.
			'id'        => 'ux_' . substr( md5( $kind . '|' . $path ), 0, 20 ),
			'kind'      => (string) $kind,
			'page_path' => (string) $path,
			'severity'  => (string) $severity,
			'title'     => (string) $title,
			'what'      => (string) $what,
			'evidence'  => (string) $evidence,
			'affected'  => (int) $affected,
		);
	}

	/**
	 * Warnings about what the list cannot see.
	 *
	 * @param array $tasks Built tasks.
	 * @return array
	 */
	private static function notes( array $tasks ) {
		$notes = array();
		$off   = array();

		foreach ( array(
			'track_js_errors'   => __( 'خطای فنی', 'bahoosh-analytics-pro' ),
			'track_dead_clicks' => __( 'کلیک بی‌اثر', 'bahoosh-analytics-pro' ),
			'track_rage_clicks' => __( 'کلیک از سر کلافگی', 'bahoosh-analytics-pro' ),
		) as $setting => $label ) {
			if ( ! BAP_Settings::get( $setting ) ) {
				$off[] = $label;
			}
		}

		if ( $off ) {
			$notes[] = sprintf(
				/* translators: %s: comma-separated list of tracking options. */
				__( 'این موارد در تنظیمات خاموش‌اند، بنابراین مشکلی از این نوع پیدا نمی‌شود: %s', 'bahoosh-analytics-pro' ),
				implode( '، ', $off )
			);
		}

		if ( ! $tasks ) {
			$notes[] = __( 'در این بازه مشکلی که به حد نصاب برسد پیدا نشد. یعنی یا همه‌چیز خوب است، یا هنوز داده کافی جمع نشده.', 'bahoosh-analytics-pro' );
		}

		return $notes;
	}

	/**
	 * Records a decision on one task.
	 *
	 * @param string $id     Task id.
	 * @param string $status open|done|dismissed.
	 * @return bool
	 */
	public static function decide( $id, $status ) {
		$id = sanitize_key( $id );

		if ( '' === $id || ! in_array( $status, array( 'open', 'done', 'dismissed' ), true ) ) {
			return false;
		}

		$state = self::state();

		if ( 'open' === $status ) {
			unset( $state[ $id ] );
		} else {
			$state[ $id ] = array(
				'status'  => $status,
				'at'      => gmdate( 'c' ),
				'user_id' => get_current_user_id(),
			);
		}

		// Bounded: a site that has been running for years should not carry a
		// decision for every task it ever saw.
		if ( count( $state ) > 500 ) {
			$state = array_slice( $state, -500, null, true );
		}

		update_option( self::OPTION_STATE, $state, false );

		return true;
	}

	/**
	 * Stored decisions.
	 *
	 * @return array
	 */
	private static function state() {
		$state = get_option( self::OPTION_STATE, array() );

		return is_array( $state ) ? $state : array();
	}
}
