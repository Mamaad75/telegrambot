<?php
/**
 * Rule-based recommendations, derived without a model.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Produces recommendations from facts using explicit rules.
 *
 * Every rule here is a judgement someone could argue with, written down where it
 * can be argued with. That is the trade against a language model: this engine is
 * blunter and cannot phrase things well, but it is reproducible, it costs
 * nothing, it works offline, and it can never hallucinate a number — because it
 * only ever restates figures that {@see BAP_Analysis_Packet} computed.
 *
 * It exists for three reasons: the feature is usable and testable before any API
 * key is configured; it is the fallback when a model is unreachable; and it
 * gives the model's output something to be compared against.
 *
 * Every recommendation it emits cites real `fact_*` ids, exactly as a model's
 * must, so nothing downstream can tell the difference.
 *
 * @since 4.3.0
 */
class BAP_Local_Insights {

	/**
	 * Funnel steps that follow an expressed intent to buy.
	 *
	 * `view_item` is deliberately excluded: browsing without buying is what a
	 * shop is for, and counting it as abandonment turns normal behaviour into a
	 * false alarm at the top of every report.
	 *
	 * @var string[]
	 */
	const INTENT_STEPS = array( 'add_to_cart', 'view_cart', 'begin_checkout', 'add_payment_info' );

	/**
	 * Derives recommendations from a packet.
	 *
	 * @param array $packet Analysis packet.
	 * @return array Recommendations.
	 */
	public static function derive( array $packet ) {
		$facts = self::index( $packet );
		$run   = (string) ( $packet['run_id'] ?? 'run_local' );

		$items = array_merge(
			self::device_rule( $facts, $run ),
			self::funnel_rule( $facts, $run ),
			self::top_product_rule( $facts, $run ),
			self::affinity_rule( $facts, $run ),
			self::slow_product_rule( $facts, $run ),
			self::price_blocked_rule( $facts, $run ),
			self::price_position_rule( $facts, $run ),
			self::coupon_reliance_rule( $facts, $run ),
			self::friction_rule( $facts, $run )
		);

		// Low sample sizes have already lowered each item's confidence; anything
		// that lands under a coin flip is not worth an administrator's attention.
		$items = array_values(
			array_filter(
				$items,
				static function ( $item ) {
					return $item['confidence'] >= 50;
				}
			)
		);

		usort(
			$items,
			static function ( $a, $b ) {
				$rank = array( 'critical' => 0, 'high' => 1, 'medium' => 2, 'low' => 3 );
				return array( $rank[ $a['priority'] ], -$a['confidence'] ) <=> array( $rank[ $b['priority'] ], -$b['confidence'] );
			}
		);

		return $items;
	}

	/**
	 * Groups the packet's facts by kind.
	 *
	 * @param array $packet Packet.
	 * @return array<string,array> Facts by kind.
	 */
	private static function index( array $packet ) {
		$by_kind = array();

		foreach ( (array) ( $packet['facts'] ?? array() ) as $fact ) {
			if ( ! isset( $fact['kind'] ) ) {
				continue;
			}
			$by_kind[ (string) $fact['kind'] ][] = $fact;
		}

		return $by_kind;
	}

	/**
	 * Mobile versus desktop.
	 *
	 * The interesting case is not "which earns more" — it is when one device
	 * carries a large share of revenue at a materially worse average order
	 * value, because that is a fixable experience problem rather than a fact
	 * about the audience.
	 *
	 * @param array  $facts Facts by kind.
	 * @param string $run   Run id.
	 * @return array Recommendations.
	 */
	private static function device_rule( array $facts, $run ) {
		$devices = $facts['commerce.device_revenue'] ?? array();

		if ( count( $devices ) < 2 ) {
			return array();
		}

		usort(
			$devices,
			static function ( $a, $b ) {
				return $b['value']['revenue'] <=> $a['value']['revenue'];
			}
		);

		$leader   = $devices[0];
		$follower = $devices[1];
		$evidence = array( $leader['id'], $follower['id'] );
		$sample   = (int) $leader['sample_size'] + (int) $follower['sample_size'];

		$leader_name   = BAP_Analysis_Packet::device_label( $leader['dimensions']['device'] ?? '' );
		$follower_name = BAP_Analysis_Packet::device_label( $follower['dimensions']['device'] ?? '' );

		$items = array();

		$items[] = self::item(
			$run,
			'device_leader',
			sprintf(
				/* translators: 1: device, 2: revenue share. */
				__( '%1$d درصد از درآمد شما از %2$s می‌آید', 'bahoosh-analytics-pro' ),
				(int) round( $leader['value']['share_pc'] ),
				$leader_name
			),
			sprintf(
				/* translators: 1: leading device, 2: its order count, 3: its AOV, 4: other device, 5: its AOV. */
				__( 'در این بازه %2$d سفارش از %1$s ثبت شده با میانگین سبد %3$s، در برابر %5$s برای %4$s. بودجه بهینه‌سازی و تست را روی دستگاهی بگذارید که واقعاً درآمد می‌سازد، نه دستگاهی که فقط بازدید بیشتری دارد.', 'bahoosh-analytics-pro' ),
				$leader_name,
				(int) $leader['value']['orders'],
				self::money( $leader['value']['aov'], $leader['value']['currency'] ?? '' ),
				$follower_name,
				self::money( $follower['value']['aov'], $follower['value']['currency'] ?? '' )
			),
			'high',
			self::confidence( $sample, 60 ),
			$evidence
		);

		// A device that brings a third or more of revenue while converting each
		// order for materially less is the actionable case.
		$leader_aov   = (float) $leader['value']['aov'];
		$follower_aov = (float) $follower['value']['aov'];

		if ( $follower_aov > 0 && $leader_aov > 0 && $follower['value']['share_pc'] >= 25 ) {
			$gap = ( $leader_aov - $follower_aov ) / $leader_aov * 100;

			if ( $gap >= 20 ) {
				$items[] = self::item(
					$run,
					'device_gap',
					sprintf(
						/* translators: 1: weaker device, 2: percentage gap. */
						__( 'میانگین سبد خرید در %1$s حدود %2$d درصد کمتر است', 'bahoosh-analytics-pro' ),
						$follower_name,
						(int) round( $gap )
					),
					sprintf(
						/* translators: 1: weaker device, 2: share of revenue. */
						__( '%1$s سهم قابل توجهی از درآمد (%2$d درصد) دارد ولی هر سفارش آن کوچک‌تر است. این معمولاً نشانه مشکل تجربه کاربری است نه تفاوت مشتری: فرم تسویه‌حساب طولانی، دکمه‌های کوچک، یا کند بودن صفحه روی این دستگاه. صفحه تسویه‌حساب را روی همین دستگاه و با اینترنت واقعی تست کنید.', 'bahoosh-analytics-pro' ),
						$follower_name,
						(int) round( $follower['value']['share_pc'] )
					),
					'high',
					self::confidence( $sample, 55 ),
					$evidence
				);
			}
		}

		return $items;
	}

	/**
	 * Where the funnel loses people.
	 *
	 * @param array  $facts Facts by kind.
	 * @param string $run   Run id.
	 * @return array Recommendations.
	 */
	private static function funnel_rule( array $facts, $run ) {
		$steps = $facts['funnel.step'] ?? array();

		if ( ! $steps ) {
			return array();
		}

		// The worst leak, not every leak: a list of six drop-offs is a report,
		// one named step is a task.
		//
		// Ranked by how many people are actually lost, not by the percentage.
		// A funnel narrows by definition, so the deepest step always has both
		// the highest drop rate and the smallest sample — ranking by percentage
		// reliably picks the least significant leak and then discards it for
		// being low-confidence. Losing 180 shoppers at checkout matters more
		// than losing the last 20, and it is also the more fixable number.
		$worst      = null;
		$worst_loss = 0;

		foreach ( $steps as $step ) {
			$drop = $step['value']['drop_pc'] ?? null;
			if ( null === $drop ) {
				continue;
			}

			// Only steps that follow an expressed intent to buy. Most people who
			// look at a product never meant to purchase it, so a large drop from
			// browsing to the cart is ordinary retail behaviour — reporting it as
			// abandoned checkout would send a shop owner to fix a page that is
			// working. Abandonment starts once something is in the cart.
			if ( ! in_array( (string) $step['value']['step'], self::INTENT_STEPS, true ) ) {
				continue;
			}

			$lost = (int) $step['value']['reached'] - (int) $step['value']['continued'];

			if ( $lost > $worst_loss ) {
				$worst      = $step;
				$worst_loss = $lost;
			}
		}

		if ( null === $worst || $worst['value']['drop_pc'] < 30 ) {
			return array();
		}

		$step_key  = (string) $worst['value']['step'];
		$evidence  = array( $worst['id'] );
		$pages     = array();

		// Attach the pages where that step happens, so the advice names a URL.
		foreach ( $facts['funnel.exit_page'] ?? array() as $page ) {
			if ( ( $page['value']['step'] ?? '' ) === $step_key ) {
				$evidence[] = $page['id'];
				$pages[]    = (string) $page['value']['page_path'];
			}
		}

		$where = $pages
			? sprintf(
				/* translators: %s: comma-separated page paths. */
				__( ' بیشترین ریزش روی این صفحه‌ها دیده می‌شود: %s.', 'bahoosh-analytics-pro' ),
				implode( '، ', array_slice( $pages, 0, 3 ) )
			)
			: '';

		return array(
			self::item(
				$run,
				'funnel_leak_' . $step_key,
				sprintf(
					/* translators: 1: drop percentage, 2: step label. */
					__( '%1$d درصد از کاربران در مرحله «%2$s» خرید را رها می‌کنند', 'bahoosh-analytics-pro' ),
					(int) round( $worst['value']['drop_pc'] ),
					BAP_Analysis_Packet::step_label( $step_key )
				),
				sprintf(
					/* translators: 1: reached count, 2: step label, 3: continued count, 4: page hint, 5: likely causes. */
					__( '%1$d نفر به مرحله «%2$s» رسیدند و تنها %3$d نفر ادامه دادند.%4$s %5$s', 'bahoosh-analytics-pro' ),
					(int) $worst['value']['reached'],
					BAP_Analysis_Packet::step_label( $step_key ),
					(int) $worst['value']['continued'],
					$where,
					self::causes( $step_key )
				),
				$worst['value']['drop_pc'] >= 60 ? 'critical' : 'high',
				self::confidence( (int) $worst['sample_size'], 100 ),
				$evidence
			),
		);
	}

	/**
	 * What to do with the best seller.
	 *
	 * @param array  $facts Facts by kind.
	 * @param string $run   Run id.
	 * @return array Recommendations.
	 */
	private static function top_product_rule( array $facts, $run ) {
		$top = $facts['commerce.top_product'] ?? array();

		if ( ! $top ) {
			return array();
		}

		$best = $top[0];

		return array(
			self::item(
				$run,
				'top_product',
				sprintf(
					/* translators: %s: product name. */
					__( 'پرفروش‌ترین محصول شما: %s', 'bahoosh-analytics-pro' ),
					$best['value']['name']
				),
				sprintf(
					/* translators: 1: product, 2: order count, 3: revenue. */
					__( '«%1$s» در این بازه %2$d سفارش و %3$s درآمد داشته است. روی این محصول تخفیف ندهید — تقاضا از قبل وجود دارد و تخفیف فقط حاشیه سود را کم می‌کند. به‌جایش: موجودی را تضمین کنید، آن را در صفحه اصلی و بالای دسته‌بندی بگذارید، و از آن به‌عنوان لنگر برای فروش مکمل استفاده کنید. اگر می‌خواهید تخفیف بگذارید، آن را مشروط به خرید یک محصول دوم کنید تا سبد بزرگ‌تر شود نه ارزان‌تر.', 'bahoosh-analytics-pro' ),
					$best['value']['name'],
					(int) $best['value']['orders'],
					self::money( $best['value']['revenue'], $best['value']['currency'] ?? '' )
				),
				'medium',
				self::confidence( (int) $best['sample_size'], 20 ),
				array( $best['id'] )
			),
		);
	}

	/**
	 * Bundles, from co-purchase.
	 *
	 * @param array  $facts Facts by kind.
	 * @param string $run   Run id.
	 * @return array Recommendations.
	 */
	private static function affinity_rule( array $facts, $run ) {
		$pairs = $facts['commerce.product_affinity'] ?? array();

		if ( ! $pairs ) {
			return array();
		}

		$items = array();

		foreach ( array_slice( $pairs, 0, 2 ) as $pair ) {
			$lift = (float) $pair['value']['lift'];

			// Lift of 1 means the two simply happen to be popular and appear
			// together by chance. Above ~1.2 the pairing is genuinely stronger
			// than chance, which is the usual bar for an actionable basket rule.
			// A stricter cut sounds safer and is not: when one product is close
			// to ubiquitous its lift with anything stays modest, and the real
			// pairings get thrown away.
			if ( $lift < 1.2 ) {
				continue;
			}

			$items[] = self::item(
				$run,
				'bundle_' . $pair['value']['product_a'] . '_' . $pair['value']['product_b'],
				sprintf(
					/* translators: 1: first product, 2: second product. */
					__( '«%1$s» و «%2$s» را به‌صورت پکیج بفروشید', 'bahoosh-analytics-pro' ),
					$pair['value']['name_a'],
					$pair['value']['name_b']
				),
				sprintf(
					/* translators: 1: together count, 2: confidence percentage, 3: first product, 4: lift. */
					__( 'این دو محصول %1$d بار با هم خریداری شده‌اند و %2$d درصد از خریداران «%3$s» محصول دوم را هم برداشته‌اند — یعنی %4$s برابر بیشتر از چیزی که صرفاً محبوبیت هر کدام توضیح می‌دهد. یک پکیج با تخفیف کوچک (۵ تا ۱۰ درصد) بسازید یا در صفحه محصول اول، دومی را به‌عنوان پیشنهاد مکمل نشان دهید. این کار میانگین سبد را بالا می‌برد بدون اینکه قیمت تکی را پایین بیاورید.', 'bahoosh-analytics-pro' ),
					(int) $pair['value']['together'],
					(int) round( $pair['value']['confidence_pc'] ),
					$pair['value']['name_a'],
					number_format_i18n( $lift, 1 )
				),
				'high',
				self::confidence( (int) $pair['sample_size'], 15 ),
				array( $pair['id'] )
			);
		}

		return $items;
	}

	/**
	 * What to do with products that do not sell.
	 *
	 * @param array  $facts Facts by kind.
	 * @param string $run   Run id.
	 * @return array Recommendations.
	 */
	private static function slow_product_rule( array $facts, $run ) {
		$slow = $facts['commerce.slow_product'] ?? array();

		if ( ! $slow ) {
			return array();
		}

		$dead     = array();
		$evidence = array();

		foreach ( $slow as $product ) {
			if ( (int) $product['value']['orders'] < 1 ) {
				$dead[]     = (string) $product['value']['name'];
				$evidence[] = $product['id'];
			}
		}

		if ( ! $dead ) {
			return array();
		}

		$pairs      = $facts['commerce.product_affinity'] ?? array();
		$bundle_hint = $pairs
			? __( ' چون الگوی خرید مشترک در فروشگاه شما وجود دارد، بستن این محصول‌ها در پکیج با یک پرفروش معمولاً بهتر از تخفیف تکی جواب می‌دهد.', 'bahoosh-analytics-pro' )
			: '';

		return array(
			self::item(
				$run,
				'slow_products',
				sprintf(
					/* translators: %d: number of products with no sales. */
					__( '%d محصول در این بازه هیچ فروشی نداشته‌اند', 'bahoosh-analytics-pro' ),
					count( $dead )
				),
				sprintf(
					/* translators: 1: product names, 2: bundle hint. */
					__( 'این محصول‌ها هیچ سفارشی نداشته‌اند: %1$s. قبل از تخفیف، اول علت را پیدا کنید — معمولاً مشکل قیمت نیست: نبود عکس مناسب، توضیح کوتاه، نبود نظر مشتری، یا اینکه محصول در هیچ دسته‌بندی قابل دیدنی نیست. اگر بازدید صفحه محصول بالا بود ولی خرید نبود، مشکل صفحه است؛ اگر بازدید هم نبود، مشکل دیده‌شدن است و تخفیف آن را حل نمی‌کند.%2$s', 'bahoosh-analytics-pro' ),
					implode( '، ', array_slice( $dead, 0, 5 ) ),
					$bundle_hint
				),
				'medium',
				70,
				array_slice( $evidence, 0, 12 )
			),
		);
	}

	/**
	 * Products people look at and nobody buys.
	 *
	 * The only recommendation in this engine that asks for a price change as the
	 * *first* step rather than the last, and the reason is in the numbers: for
	 * every other slow product the honest advice is to fix the photograph, the
	 * description or the visibility first, because a discount on something
	 * nobody has seen cannot work. Here people have already seen it — in
	 * numbers — and still did not buy. Price is one of the few remaining
	 * explanations, and it is the only one that can be tested in a fortnight and
	 * undone with one click.
	 *
	 * @param array  $facts Facts by kind.
	 * @param string $run   Run id.
	 * @return array Recommendations.
	 */
	private static function price_blocked_rule( array $facts, $run ) {
		$blocked = $facts['commerce.price_blocked'] ?? array();

		if ( ! $blocked ) {
			return array();
		}

		$items = array();

		foreach ( array_slice( $blocked, 0, 2 ) as $fact ) {
			$value = $fact['value'];

			$items[] = self::item(
				$run,
				'price_test_' . $value['product_id'],
				sprintf(
					/* translators: %s: product name. */
					__( 'قیمت «%s» را آزمایش کنید — بازدید دارد، خرید ندارد', 'bahoosh-analytics-pro' ),
					$value['name']
				),
				sprintf(
					/* translators: 1: views, 2: add-to-cart count, 3: product name, 4: current price. */
					__( '%1$d نفر صفحه این محصول را دیده‌اند، %2$d نفر آن را در سبد گذاشته‌اند، و هیچ‌کس آن را نخریده است. یعنی مشکل دیده‌شدن نیست — محصول دیده شده و رد شده. قیمت فعلی %4$s است. یک آزمایش بگذارید: ۱۰ درصد تخفیف زمان‌دار برای دو هفته، بعد همین صفحه به شما می‌گوید فروش این محصول نسبت به بقیه فروشگاه چه تغییری کرده. اگر تغییری نکرد، قیمت گلوگاه نبوده و تخفیف را بردارید؛ اگر فروش رفت، حالا می‌دانید قیمت درست کجاست. این تنها پیشنهادی است که با یک کلیک قابل اجرا و با یک کلیک قابل بازگردانی است.', 'bahoosh-analytics-pro' ),
					(int) $value['views'],
					(int) $value['add_to_cart'],
					$value['name'],
					self::money( $value['price'], $value['currency'] ?? '' )
				),
				'high',
				self::confidence( (int) $fact['sample_size'], 60 ),
				array( $fact['id'] )
			);
		}

		return $items;
	}

	/**
	 * Products priced above their own shelf and not moving.
	 *
	 * @param array  $facts Facts by kind.
	 * @param string $run   Run id.
	 * @return array Recommendations.
	 */
	private static function price_position_rule( array $facts, $run ) {
		$rows = $facts['commerce.price_position'] ?? array();

		if ( ! $rows ) {
			return array();
		}

		$items = array();

		foreach ( array_slice( $rows, 0, 2 ) as $fact ) {
			$value = $fact['value'];

			$items[] = self::item(
				$run,
				'price_align_' . $value['product_id'],
				sprintf(
					/* translators: 1: product name, 2: category. */
					__( '«%1$s» گران‌تر از هم‌قفسه‌هایش در «%2$s» است', 'bahoosh-analytics-pro' ),
					$value['name'],
					$value['category']
				),
				sprintf(
					/* translators: 1: price, 2: peer median, 3: peer count, 4: category, 5: gap percent, 6: units sold, 7: peer median units. */
					__( 'قیمت این محصول %1$s است، در حالی که میانه قیمت %3$d محصول دیگر دسته «%4$s» برابر %2$s است. در همین بازه %6$d عدد از این محصول فروش رفته و میانه فروش هم‌قفسه‌هایش %7$d عدد بوده — یعنی هم گران‌تر است و هم کمتر می‌فروشد. رسیدن به میانه دسته یعنی %5$d درصد کاهش. اگر محصول واقعاً بهتر است، این گرانی را روی صفحه توضیح دهید (ضمانت، کیفیت، خدمات پس از فروش)؛ اگر نه، %5$d درصد تخفیف زمان‌دار بگذارید و نتیجه را در همین گزارش ببینید. دقت کنید: گران بودن به‌خودی‌خود اشکال نیست، گران بودن بدون دلیلِ قابل دیدن اشکال است.', 'bahoosh-analytics-pro' ),
					self::money( $value['price'], $value['currency'] ?? '' ),
					self::money( $value['peer_median'], $value['currency'] ?? '' ),
					(int) $value['peers'],
					$value['category'],
					(int) $value['gap_pc'],
					(int) $value['units'],
					(int) $value['peer_units']
				),
				'medium',
				self::confidence( (int) $fact['sample_size'], 10 ),
				array( $fact['id'] )
			);
		}

		return $items;
	}

	/**
	 * When the list price is fiction.
	 *
	 * Carries no executable action on purpose. Every other price
	 * recommendation here can be applied and reverted in one click; "your list
	 * prices are too high across the board" is a decision about the whole shop,
	 * and no automatic mechanism should make it.
	 *
	 * @param array  $facts Facts by kind.
	 * @param string $run   Run id.
	 * @return array Recommendations.
	 */
	private static function coupon_reliance_rule( array $facts, $run ) {
		$fact = ( $facts['commerce.coupon_reliance'] ?? array() )[0] ?? null;

		if ( ! $fact ) {
			return array();
		}

		$value = $fact['value'];
		$share = (float) $value['share_pc'];

		if ( $share < BAP_Price_Facts::COUPON_HEAVY ) {
			return array();
		}

		$currency = $value['currency'] ?? '';

		// Whether the coupons are buying bigger baskets or just cheaper ones is
		// the entire question, and the two answers point in opposite directions.
		$verdict = (float) $value['aov_with'] >= (float) $value['aov_without']
			? __( 'نکته مهم: میانگین سبد سفارش‌های تخفیف‌دار از سفارش‌های بدون تخفیف بیشتر است، یعنی کد تخفیف دارد سبد را بزرگ‌تر می‌کند نه فقط ارزان‌تر. این کد تخفیف‌ها را حذف نکنید؛ به‌جایش شرط حداقل مبلغ سبد را روی آن‌ها بگذارید تا همین اثر را با هزینه کمتر بگیرید.', 'bahoosh-analytics-pro' )
			: __( 'نکته مهم: میانگین سبد سفارش‌های تخفیف‌دار از سفارش‌های بدون تخفیف کمتر است، یعنی کد تخفیف سبد را بزرگ نمی‌کند و فقط همان خرید را ارزان‌تر می‌کند. این بدترین حالت است: دارید به مشتری‌ای تخفیف می‌دهید که بدون آن هم خرید می‌کرد.', 'bahoosh-analytics-pro' );

		return array(
			self::item(
				$run,
				'coupon_reliance',
				sprintf(
					/* translators: %s: percentage of orders. */
					__( '%s درصد سفارش‌ها فقط با تخفیف بسته می‌شود — قیمت فهرست شما واقعی نیست', 'bahoosh-analytics-pro' ),
					number_format_i18n( $share, 1 )
				),
				sprintf(
					/* translators: 1: orders with a discount, 2: total orders, 3: discount given, 4: AOV with, 5: AOV without, 6: verdict sentence. */
					__( 'از %2$d سفارش این بازه، %1$d سفارش با تخفیف بسته شده و در کل %3$s تخفیف داده‌اید. میانگین سبد با تخفیف %4$s و بدون تخفیف %5$s بوده است. %6$s وقتی بیشتر از نیمی از فروش با کد تخفیف انجام می‌شود، قیمت روی برچسب دیگر قیمت فروش شما نیست؛ عدد واقعی همان قیمت بعد از تخفیف است و شما فقط هزینه اداره‌کردن دو قیمت را می‌پردازید. دو گزینه دارید: قیمت فهرست را به عدد واقعی نزدیک کنید و تخفیف عمومی را بردارید، یا تخفیف را شرطی کنید (اولین خرید، حداقل مبلغ سبد، بازگشت مشتری خاموش) تا به کسی که بدون آن هم می‌خرید تخفیف نرسد.', 'bahoosh-analytics-pro' ),
					(int) $value['orders_with_discount'],
					(int) $value['orders_total'],
					self::money( $value['discount_given'], $currency ),
					self::money( $value['aov_with'], $currency ),
					self::money( $value['aov_without'], $currency ),
					$verdict
				),
				'high',
				self::confidence( (int) $fact['sample_size'], 60 ),
				array( $fact['id'] )
			),
		);
	}

	/**
	 * Likely causes of leaving at a given step.
	 *
	 * Written per step because the reasons differ completely. Someone who
	 * abandons a cart is usually reacting to a total; someone who abandons a
	 * payment form is usually blocked by it. Generic checkout advice attached to
	 * the wrong step sends an administrator to audit a page that is fine.
	 *
	 * @param string $step Step key.
	 * @return string
	 */
	private static function causes( $step ) {
		$causes = array(
			'add_to_cart'      => __( 'دلایل رایج در این مرحله: هزینه ارسال یا مالیات که تازه اینجا دیده می‌شود، نبود گزینه ارسال رایگان، یا نبود اطمینان درباره مرجوعی. مبلغ نهایی را زودتر و در صفحه محصول نشان دهید.', 'bahoosh-analytics-pro' ),
			'view_cart'        => __( 'دلایل رایج در این مرحله: دکمه ادامه خرید کم‌پیدا است، کد تخفیف کار نمی‌کند، یا کاربر برای مقایسه قیمت از سایت خارج شده. مسیر رفتن از سبد به تسویه‌حساب را کوتاه و واضح کنید.', 'bahoosh-analytics-pro' ),
			'begin_checkout'   => __( 'دلایل رایج در این مرحله: اجباری بودن ثبت‌نام، فرم طولانی، یا الزام به وارد کردن اطلاعاتی که کاربر آماده ندارد. خرید مهمان را فعال کنید و تعداد فیلدها را کم کنید.', 'bahoosh-analytics-pro' ),
			'add_payment_info' => __( 'دلایل رایج در این مرحله: نبود درگاه پرداخت مورد اعتماد کاربر، خطای درگاه، یا خطای جاوااسکریپت روی همین صفحه. یک بار خودتان پرداخت واقعی انجام دهید و کنسول مرورگر را باز بگذارید.', 'bahoosh-analytics-pro' ),
		);

		return $causes[ $step ] ?? '';
	}

	/**
	 * Builds one recommendation in the same shape a model must return.
	 *
	 * @param string $run        Run id.
	 * @param string $key        Stable key.
	 * @param string $title      Title.
	 * @param string $summary    Body.
	 * @param string $priority   Priority.
	 * @param int    $confidence Confidence.
	 * @param array  $evidence   Fact ids.
	 * @return array
	 */
	/**
	 * What Clarity saw going wrong, on which page.
	 *
	 * This is the rule that answers "what is the bug". The rest of the engine
	 * can say where shoppers stop; only this one can say that the page they stop
	 * on throws a script error, or that people click something there that does
	 * not respond. A script error is treated as more serious than frustration
	 * clicks because it is a defect rather than a design problem — someone can
	 * open the console and see it today.
	 *
	 * @param array  $facts Facts by kind.
	 * @param string $run   Run id.
	 * @return array Recommendations.
	 */
	private static function friction_rule( array $facts, $run ) {
		$signals = $facts['ux.friction'] ?? array();

		if ( ! $signals ) {
			return array();
		}

		// Worst first, by how many sessions hit the problem rather than by the
		// share: 3% of a busy checkout is a bigger problem than 40% of a page
		// nobody visits.
		usort(
			$signals,
			static function ( $a, $b ) {
				return (int) $b['value']['sessions'] <=> (int) $a['value']['sessions'];
			}
		);

		$items = array();
		$seen  = array();

		foreach ( array_slice( $signals, 0, 6 ) as $signal ) {
			$page   = (string) $signal['value']['page_path'];
			$type   = (string) $signal['value']['signal'];
			$key    = $page . '|' . $type;

			if ( isset( $seen[ $page ] ) || isset( $seen[ $key ] ) ) {
				continue;
			}

			$seen[ $page ] = true;

			$sessions = (int) $signal['value']['sessions'];
			$share    = (float) $signal['value']['share_pc'];

			$items[] = self::item(
				$run,
				'friction_' . md5( $key ),
				sprintf(
					/* translators: 1: friction type, 2: page path. */
					__( '%1$s در صفحه %2$s', 'bahoosh-analytics-pro' ),
					BAP_Clarity::metric_label( $type ),
					$page
				),
				sprintf(
					/* translators: 1: session count, 2: share of sessions, 3: window in days, 4: advice. */
					__( 'کلاریتی در %1$d نشست (%2$s درصد نشست‌های این صفحه) طی %3$d روز گذشته این نشانه را ثبت کرده است. %4$s', 'bahoosh-analytics-pro' ),
					$sessions,
					number_format_i18n( $share, 1 ),
					(int) $signal['value']['window_days'],
					self::friction_advice( $type )
				),
				'script_errors' === $type ? 'critical' : 'high',
				self::confidence( $sessions, 200 ),
				array( $signal['id'] )
			);
		}

		return $items;
	}

	/**
	 * What to do about one kind of friction.
	 *
	 * @param string $type Signal slug.
	 * @return string
	 */
	private static function friction_advice( $type ) {
		$advice = array(
			'rage_clicks'      => __( 'کلیک عصبی یعنی کاربر روی چیزی پشت سر هم کلیک کرده و پاسخی نگرفته. معمولاً دکمه‌ای است که کند است یا خطا می‌دهد؛ همان صفحه را با ضبط جلسه در کلاریتی ببینید.', 'bahoosh-analytics-pro' ),
			'dead_clicks'      => __( 'کلیک بی‌اثر یعنی کاربر روی چیزی کلیک کرده که اصلاً قابل کلیک نبوده. متن یا تصویری که شبیه دکمه دیده می‌شود را یا واقعاً قابل کلیک کنید یا ظاهرش را تغییر دهید.', 'bahoosh-analytics-pro' ),
			'script_errors'    => __( 'خطای جاوااسکریپت روی این صفحه رخ می‌دهد و می‌تواند دکمه‌ها را از کار بیندازد. کنسول مرورگر را روی همین صفحه باز کنید؛ این معمولاً ریشه اصلی رها کردن خرید است.', 'bahoosh-analytics-pro' ),
			'quick_backs'      => __( 'بازگشت سریع یعنی کاربر وارد شده و بلافاصله برگشته. محتوای صفحه با انتظار او نخوانده؛ عنوان، تصویر یا قیمت را بررسی کنید.', 'bahoosh-analytics-pro' ),
			'excessive_scroll' => __( 'اسکرول بیش از حد یعنی کاربر دنبال چیزی می‌گشته و پیدا نکرده. اطلاعات مهم مثل قیمت، هزینه ارسال یا دکمه خرید را بالاتر بیاورید.', 'bahoosh-analytics-pro' ),
		);

		return $advice[ $type ] ?? '';
	}

	private static function item( $run, $key, $title, $summary, $priority, $confidence, array $evidence ) {
		return array(
			'id'           => 'rec_' . substr( md5( $run . '|' . $key ), 0, 20 ),
			'title'        => substr( $title, 0, 180 ),
			'summary'      => substr( $summary, 0, 1200 ),
			'rationale'    => __( 'این پیشنهاد با قواعد داخلی افزونه و مستقیماً از روی داده‌های همین فروشگاه ساخته شده است؛ هیچ مدل زبانی در تولید آن دخالت نداشته.', 'bahoosh-analytics-pro' ),
			'priority'     => $priority,
			'confidence'   => max( 0, min( 100, (int) $confidence ) ),
			'impact'       => '',
			'evidence'     => array_slice( array_values( array_unique( $evidence ) ), 0, 12 ),
			'action'       => null,
			'created_at'   => gmdate( 'c' ),
			'model_run_id' => $run,
		);
	}

	/**
	 * Scales confidence by how much data stands behind a claim.
	 *
	 * A conclusion drawn from eight orders and one drawn from eight hundred must
	 * not be presented to a shop owner with the same certainty, and this is the
	 * only place that judgement is made.
	 *
	 * @param int $sample Observations.
	 * @param int $target Sample size at which the rule is fully trusted.
	 * @return int 0-100.
	 */
	private static function confidence( $sample, $target ) {
		$target = max( 1, (int) $target );
		$ratio  = min( 1.0, max( 0, (int) $sample ) / $target );

		// Caps at 92: a rule of thumb over a complete dataset is still a rule of
		// thumb, and certainty is not something this engine has earned.
		return (int) round( 40 + ( $ratio * 52 ) );
	}

	/**
	 * Formats money with its currency.
	 *
	 * @param float  $amount   Amount.
	 * @param string $currency Currency code.
	 * @return string
	 */
	private static function money( $amount, $currency ) {
		$formatted = number_format_i18n( (float) $amount );

		return '' !== $currency ? $formatted . ' ' . $currency : $formatted;
	}
}
