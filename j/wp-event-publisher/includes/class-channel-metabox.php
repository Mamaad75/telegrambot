<?php
/**
 * Per-post publication channel override.
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
 * The "publish this one where?" box on the post editor.
 *
 * The site-wide platform settings say where this site publishes; this box
 * lets one post opt out of one of them. It deliberately cannot opt *in* to a
 * platform the administrator has not configured — an author has no way to
 * supply a channel ID, so offering them a switch that silently does nothing
 * would be worse than not offering it at all. Platforms that are off
 * site-wide are shown disabled, with the reason stated.
 *
 * Absent meta means "inherit". That is why saving writes a marker even when
 * every box is unticked: without it, an author who deliberately turned
 * everything off would be indistinguishable from one who never opened the
 * box, and the post would inherit the site defaults and publish anyway.
 *
 * @since 1.6.0
 */
class ChannelMetabox {

	/**
	 * Nonce action and field name.
	 *
	 * @var string
	 */
	private const NONCE = 'wpep_channels';

	/**
	 * Settings dependency.
	 *
	 * @var Settings
	 */
	private Settings $settings;

	/**
	 * Constructor.
	 *
	 * @since 1.6.0
	 *
	 * @param Settings $settings Settings service.
	 */
	public function __construct( Settings $settings ) {
		$this->settings = $settings;
	}

	/**
	 * Registers the metabox and its save handler.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	public function register(): void {
		add_action( 'add_meta_boxes', array( $this, 'add' ) );
		add_action( 'save_post', array( $this, 'save' ), 10, 2 );
	}

	/**
	 * Adds the metabox to every post type the plugin publishes.
	 *
	 * @since 1.6.0
	 *
	 * @return void
	 */
	public function add(): void {
		$post_types = array_values( array_filter( array_map( 'sanitize_key', (array) $this->settings->allowed_post_types() ) ) );

		if ( empty( $post_types ) ) {
			return;
		}

		add_meta_box(
			'wpep-channels',
			__( 'انتشار در جارچی', 'wp-event-publisher' ),
			array( $this, 'render' ),
			$post_types,
			'side',
			'default'
		);
	}

	/**
	 * Renders the box.
	 *
	 * @since 1.6.0
	 *
	 * @param WP_Post $post Post being edited.
	 *
	 * @return void
	 */
	public function render( WP_Post $post ): void {
		$platforms = $this->settings->platforms();
		$stored    = get_post_meta( (int) $post->ID, Normalizer::META_CHANNELS, true );
		$stored    = is_array( $stored ) ? $stored : array();
		$inherits  = empty( $stored );

		wp_nonce_field( self::NONCE, self::NONCE );

		echo '<p class="description" style="margin-top:0">';
		esc_html_e( 'انتخاب کنید این محتوا در کدام پلتفرم‌ها منتشر شود.', 'wp-event-publisher' );
		echo '</p>';

		echo '<ul class="wpep-channel-list" style="margin:0">';

		foreach ( $platforms as $platform => $config ) {
			$site_on = ! empty( $config['enabled'] );
			$checked = $inherits ? $site_on : ! empty( $stored[ $platform ] );
			$id      = 'wpep-channel-' . $platform;

			printf(
				'<li style="margin:0 0 .5em"><label for="%1$s"><input type="checkbox" id="%1$s" name="wpep_channels[%2$s]" value="1"%3$s%4$s> %5$s</label>',
				esc_attr( $id ),
				esc_attr( $platform ),
				checked( $checked && $site_on, true, false ),
				disabled( $site_on, false, false ),
				esc_html( $this->label( $platform ) )
			);

			if ( ! $site_on ) {
				echo '<br><span class="description" style="font-size:11px">';
				esc_html_e( 'در تنظیمات جارچی خاموش است.', 'wp-event-publisher' );
				echo '</span>';
			}

			echo '</li>';
		}

		echo '</ul>';

		// Submitted with every save so an all-off choice is recorded as a
		// choice rather than read back as "never decided".
		echo '<input type="hidden" name="wpep_channels_submitted" value="1">';

		if ( $inherits ) {
			echo '<p class="description">';
			esc_html_e( 'در حال حاضر از تنظیمات پیش‌فرض سایت پیروی می‌کند.', 'wp-event-publisher' );
			echo '</p>';
		}
	}

	/**
	 * Persists the choice.
	 *
	 * @since 1.6.0
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    Post object.
	 *
	 * @return void
	 */
	public function save( int $post_id, WP_Post $post ): void {
		// An autosave or a revision is not a decision the author made.
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}

		if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
			return;
		}

		// The box was not on this screen, so there is nothing to record. This
		// is what stops a Quick Edit or a programmatic wp_update_post() from
		// wiping a choice the author made on the full editor.
		if ( ! isset( $_POST['wpep_channels_submitted'] ) ) {
			return;
		}

		if ( ! isset( $_POST[ self::NONCE ] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( (string) $_POST[ self::NONCE ] ) ), self::NONCE ) ) {
			return;
		}

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		$submitted = isset( $_POST['wpep_channels'] ) && is_array( $_POST['wpep_channels'] )
			? wp_unslash( $_POST['wpep_channels'] )
			: array();

		$choice = array();

		// Built from the known platform list rather than from the submitted
		// keys, so the stored value cannot be widened by extra form fields.
		foreach ( Field::PLATFORMS as $platform ) {
			$choice[ $platform ] = ! empty( $submitted[ $platform ] );
		}

		update_post_meta( $post_id, Normalizer::META_CHANNELS, $choice );
	}

	/**
	 * Returns the display name of a platform.
	 *
	 * @since 1.6.0
	 *
	 * @param string $platform Platform identifier.
	 *
	 * @return string Display name.
	 */
	private function label( string $platform ): string {
		$labels = array(
			Field::PLATFORM_TELEGRAM => __( 'تلگرام', 'wp-event-publisher' ),
			Field::PLATFORM_BALE     => __( 'بله', 'wp-event-publisher' ),
			Field::PLATFORM_WHATSAPP => __( 'واتس‌اپ', 'wp-event-publisher' ),
		);

		return $labels[ $platform ] ?? $platform;
	}
}
