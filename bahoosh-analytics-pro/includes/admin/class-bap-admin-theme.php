<?php
/**
 * Light and dark appearance for the admin screens.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Which of the two themes a given administrator sees.
 *
 * Three design decisions, each of which has a wrong answer that is easy to
 * reach for.
 *
 * **It is per user, not per site.** Appearance is a preference of the person
 * looking at the screen, not a property of the shop. A site option would mean
 * the shop owner's choice of dark is also imposed on the colleague who finds it
 * unreadable, and WordPress already has the right place for this: user meta.
 *
 * **`auto` is resolved in the browser, not on the server.** The server cannot
 * know the operating system's appearance setting — there is no request header
 * for it — so `auto` is stored as `auto` and turned into a concrete theme by
 * {@see self::head_script()}, which also means a user who switches their laptop
 * to night mode at 18:00 gets a dark panel at 18:00 without touching anything.
 *
 * **The resolved theme is applied in `<head>`, before the body is parsed.**
 * This is the whole reason the attribute lives on `<html>` rather than on the
 * body class where every other WordPress flag lives. A class added on
 * `DOMContentLoaded` arrives after the browser has already painted, so a user
 * who prefers light would see a full dark screen flash white on every single
 * page load. Eleven lines of inline script in the head is the price of not
 * doing that, and it is worth paying.
 *
 * @since 4.16.0
 */
class BAP_Admin_Theme {

	/**
	 * User meta key holding the preference.
	 *
	 * @var string
	 */
	const META = 'bap_admin_theme';

	/**
	 * The three valid values.
	 *
	 * @var string[]
	 */
	const CHOICES = array( 'auto', 'dark', 'light' );

	/**
	 * Registers the hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_head', array( __CLASS__, 'head_script' ), 0 );
		add_action( 'wp_ajax_bap_set_theme', array( __CLASS__, 'handle_save' ) );
	}

	/**
	 * The current user's stored preference.
	 *
	 * @return string One of {@see self::CHOICES}.
	 */
	public static function preference() {
		$stored = (string) get_user_meta( get_current_user_id(), self::META, true );

		return in_array( $stored, self::CHOICES, true ) ? $stored : 'auto';
	}

	/**
	 * Stores a preference.
	 *
	 * @param string $choice Requested theme.
	 * @return string What was actually stored.
	 */
	public static function remember( $choice ) {
		$choice = in_array( (string) $choice, self::CHOICES, true ) ? (string) $choice : 'auto';
		$user   = get_current_user_id();

		if ( $user > 0 ) {
			update_user_meta( $user, self::META, $choice );
		}

		return $choice;
	}

	/**
	 * Labels for the toggle, in order.
	 *
	 * @return array<string,string>
	 */
	public static function labels() {
		return array(
			'auto'  => __( 'خودکار', 'bahoosh-analytics-pro' ),
			'light' => __( 'روشن', 'bahoosh-analytics-pro' ),
			'dark'  => __( 'تیره', 'bahoosh-analytics-pro' ),
		);
	}

	/**
	 * Resolves and applies the theme before the first paint.
	 *
	 * Printed on every admin page rather than only on Bahoosh screens, because
	 * the notices this plugin renders appear above the shell on screens that are
	 * not ours, and they read the same tokens.
	 *
	 * @return void
	 */
	public static function head_script() {
		$preference = self::preference();
		?>
		<script id="bap-theme-boot">
		(function () {
			var choice = <?php echo wp_json_encode( $preference ); ?>;
			try {
				// A pending choice from this tab wins over the stored one: the
				// toggle writes it synchronously so the next page load is
				// already correct, even if the save request has not landed.
				var pending = window.localStorage.getItem('bapAdminTheme');
				if (pending === 'auto' || pending === 'dark' || pending === 'light') choice = pending;
			} catch (e) {}

			var resolved = choice;
			if (choice === 'auto') {
				resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)
					? 'light'
					: 'dark';
			}

			var root = document.documentElement;
			root.setAttribute('data-bap-theme', resolved);
			root.setAttribute('data-bap-theme-choice', choice);
		})();
		</script>
		<?php
	}

	/**
	 * Saves a preference sent by the toggle.
	 *
	 * @return void
	 */
	public static function handle_save() {
		if ( ! is_user_logged_in() ) {
			wp_send_json_error( array( 'message' => __( 'برای ذخیره ظاهر باید وارد شده باشید.', 'bahoosh-analytics-pro' ) ), 401 );
		}

		check_ajax_referer( 'bap_set_theme', 'nonce' );

		$choice = isset( $_POST['theme'] ) ? sanitize_key( wp_unslash( $_POST['theme'] ) ) : 'auto';

		wp_send_json_success( array( 'theme' => self::remember( $choice ) ) );
	}
}
