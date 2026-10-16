<?php
/**
 * Features that exist in the code but not yet in the world.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * One switch per feature that is waiting on a service that does not exist yet.
 *
 * Parts of this plugin were written against a backend — the ASP.NET collector
 * and the licensing service — that has not been built. The code is complete and
 * correct; it simply has nothing to talk to. Until now that showed up in the
 * interface as screens that load and do nothing, a sidebar permanently
 * announcing «بدون لایسنس», and a header chip reading «Inactive» on a plugin
 * that is working perfectly well. Every one of those is the interface telling
 * the shop owner something is broken when nothing is.
 *
 * Hiding them behind a flag rather than commenting the code out is deliberate,
 * and the difference matters more than it looks:
 *
 * - commented-out code stops being compiled, so it stops being checked, and by
 *   the time the backend arrives it no longer matches the rest of the plugin;
 * - commented-out code has no single place to un-comment. The licensing
 *   feature alone touches a menu entry, two header widgets, a dashboard card
 *   and a settings section, and finding all five again in six months is how
 *   half a feature ships;
 * - a flag is testable. The tests below assert that nothing is advertised that
 *   cannot be used, which a comment cannot do.
 *
 * **Turning one back on is one line.** Delete its entry from
 * {@see self::WAITING}, or answer the `bap_feature_pending` filter, and every
 * menu entry, nav row and card for it reappears exactly as it was written.
 *
 * Features that merely *degrade* without the backend are not listed here. The
 * event store, the reports, the UX tasks, Search Rescue, the AI centre and the
 * commerce agent all run entirely on this site's own data, and they stay.
 *
 * @since 4.16.0
 */
class BAP_Roadmap {

	/**
	 * Features whose backing service does not exist yet.
	 *
	 * Each value is what the feature is waiting for, which is the thing a
	 * future reader actually needs to know.
	 *
	 * @var array<string,string>
	 */
	const WAITING = array(
		// The licensing/subscription service. Without it `api_base()` is empty,
		// every plan check falls through to its legacy default, and the account
		// screen can only ever report "inactive" — which reads as a fault.
		'licensing' => 'commercial licensing API',

		// The hosted collector. Events are stored locally and every report is
		// built from them, so the only thing missing is forwarding; the queue
		// screen exists to inspect a queue that is never filled.
		'collector' => 'ASP.NET collector',
	);

	/**
	 * Whether a feature is still waiting on its backend.
	 *
	 * @param string $feature Key from {@see self::WAITING}.
	 * @return bool
	 */
	public static function pending( $feature ) {
		$feature = sanitize_key( (string) $feature );
		$pending = array_key_exists( $feature, self::WAITING );

		// A site that *does* have the backend says so by defining the constant
		// its client reads, so the flag answers itself on a real deployment
		// rather than needing to be edited there too.
		if ( 'licensing' === $feature && defined( 'BAP_COMMERCIAL_API_URL' ) && '' !== (string) BAP_COMMERCIAL_API_URL ) {
			$pending = false;
		}

		if ( 'collector' === $feature && BAP_Settings::is_configured() ) {
			$pending = false;
		}

		/**
		 * Filters whether a feature is still waiting on its backend.
		 *
		 * @param bool   $pending Whether it is hidden.
		 * @param string $feature Feature key.
		 */
		return (bool) apply_filters( 'bap_feature_pending', $pending, $feature );
	}

	/**
	 * Whether a feature is usable, which is the inverse and reads better at
	 * call sites that are deciding whether to render something.
	 *
	 * @param string $feature Feature key.
	 * @return bool
	 */
	public static function available( $feature ) {
		return ! self::pending( $feature );
	}

	/**
	 * What to tell an administrator who goes looking for a hidden screen.
	 *
	 * Used by the settings screen, which lists what the plugin can do, so the
	 * answer to "where did the subscription page go" is written down somewhere
	 * rather than being a mystery.
	 *
	 * @return array<string,string> Feature key => sentence.
	 */
	public static function notes() {
		$notes = array(
			'licensing' => __( 'صفحه اشتراک و لایسنس تا زمانی که سرویس لایسنس راه‌اندازی شود نمایش داده نمی‌شود. تا آن موقع همه قابلیت‌های افزونه بدون محدودیت پلن کار می‌کنند.', 'bahoosh-analytics-pro' ),
			'collector' => __( 'ارسال رویدادها به کالکتور بیرونی تا راه‌اندازی سرویس غیرفعال است. رویدادها روی همین سایت ذخیره می‌شوند و همه گزارش‌ها از همان‌ها ساخته می‌شوند، بنابراین چیزی از دست نمی‌رود.', 'bahoosh-analytics-pro' ),
		);

		$out = array();

		foreach ( $notes as $feature => $note ) {
			if ( self::pending( $feature ) ) {
				$out[ $feature ] = $note;
			}
		}

		return $out;
	}
}
