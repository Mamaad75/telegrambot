<?php
/**
 * Uninstall handler.
 *
 * Runs only when the plugin is deleted through the WordPress admin.
 * Removes every trace of the plugin: options, the custom log table,
 * post meta state and any scheduled cron events.
 *
 * @package WPEventPublisher
 */

// Bail if WordPress did not trigger this file.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

/**
 * Removes all plugin data for the current site.
 *
 * @since 1.0.0
 *
 * @return void
 */
function wpep_uninstall_site(): void {
	global $wpdb;

	// Options.
	delete_option( 'wpep_settings' );
	delete_option( 'wpep_db_version' );
	delete_option( 'wpep_version' );
	delete_option( 'wpep_event_index' );

	// Delivery locks written while an attempt was in flight.
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- uninstall cleanup.
	$wpep_locks = $wpdb->get_col(
		$wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( 'wpep_lock_' ) . '%' )
	);

	foreach ( (array) $wpep_locks as $wpep_lock ) {
		delete_option( (string) $wpep_lock );
	}

	delete_option( 'wpep_queue_db_version' );
	delete_option( 'wpep_last_hook' );
	delete_option( 'wpep_queue_has_work' );
	delete_option( 'wpep_delivery_stats' );
	delete_option( 'wpep_field_mappings' );

	// New in 1.6.0. Uninstall is the one explicitly destructive path in the
	// plugin — the administrator asked for the data to go — so anything 1.6.0
	// added is removed here too rather than being left behind as orphaned
	// rows. Nothing in this file runs on deactivation or upgrade.
	delete_option( 'wpep_field_defaults_mode' );

	// Announcements are real posts, so they are deleted as posts; the meta
	// goes with them.
	$wpep_announcements = get_posts(
		array(
			'post_type'        => 'jarchi_announcement',
			'post_status'      => 'any',
			'numberposts'      => -1,
			'fields'           => 'ids',
			'suppress_filters' => true,
		)
	);

	foreach ( (array) $wpep_announcements as $wpep_announcement_id ) {
		wp_delete_post( (int) $wpep_announcement_id, true );
	}

	// The per-post publication channel choice.
	delete_post_meta_by_key( '_jarchi_channels' );
	delete_option( 'wpep_fields_generation' );
	delete_option( 'wpep_profiles' );
	delete_option( 'wpep_profile_assignments' );
	delete_option( 'wpep_rules' );
	delete_option( 'wpep_destinations' );
	delete_option( 'wpep_installed_at' );

	// Custom tables.
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.SchemaChange -- uninstall cleanup.
	$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}wpep_logs" );

	// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.SchemaChange -- uninstall cleanup.
	$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}wpep_queue" );

	// Post meta written by the delivery pipeline and the event detector.
	delete_post_meta_by_key( '_wpep_webhook_state' );
	delete_post_meta_by_key( '_wpep_webhook_sent_at' );
	delete_post_meta_by_key( '_wpep_first_published_at' );
	delete_post_meta_by_key( '_wpep_content_hash' );
	delete_post_meta_by_key( '_wpep_last_event_id' );
	delete_post_meta_by_key( '_wpep_last_event_type' );
	delete_post_meta_by_key( '_wpep_pending_events' );
	delete_post_meta_by_key( '_wpep_delete_announced' );

	// In-flight snapshots, completion markers and duplicate guards held
	// as transients.
	foreach ( array( '_transient_wpep_evt_', '_transient_wpep_done_', '_transient_wpep_emit_', '_transient_timeout_wpep_evt_', '_transient_timeout_wpep_done_', '_transient_timeout_wpep_emit_' ) as $wpep_prefix ) {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- uninstall cleanup.
		$wpep_transients = $wpdb->get_col(
			$wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( $wpep_prefix ) . '%' )
		);

		foreach ( (array) $wpep_transients as $wpep_transient ) {
			delete_option( (string) $wpep_transient );
		}
	}

	delete_transient( 'wpep_sweep_throttle' );

	// Scheduled cron events, current and legacy.
	wp_unschedule_hook( 'wpep_dispatch_event' );
	wp_unschedule_hook( 'wpep_dispatch_webhook' );
	wp_unschedule_hook( 'wpep_sweep_queue' );
	wp_unschedule_hook( 'wpep_deliver_destination' );
}

if ( is_multisite() ) {
	$wpep_site_ids = get_sites( array( 'fields' => 'ids' ) );

	foreach ( $wpep_site_ids as $wpep_site_id ) {
		switch_to_blog( (int) $wpep_site_id );
		wpep_uninstall_site();
		restore_current_blog();
	}
} else {
	wpep_uninstall_site();
}
