<?php
/**
 * Uninstall routine.
 *
 * Runs only when the user deletes the plugin, not on deactivation.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/**
 * Removes every trace of the plugin from one site.
 *
 * Undelivered events are dropped along with the plugin: the outbox is a local
 * queue, not the system of record. Data already sent lives in the collector and
 * is removed there, through the privacy tools or the collector's own admin.
 *
 * @return void
 */
function bap_uninstall_site() {
	global $wpdb;

	$table = $wpdb->prefix . 'bap_outbox';
	$wpdb->query( "DROP TABLE IF EXISTS {$table}" ); // phpcs:ignore WordPress.DB

	$options = array(
		'bap_settings',
		'bap_api_key',
		'bap_db_version',
		'bap_token_secret',
		'bap_identity_salt',
		'bap_debug_log',
		'bap_last_transport_result',
		'bap_ai_webhook_secret',
		'bap_ai_recommendations',
		'bap_ai_audit',
		'bap_ai_provider_key',
		'bap_ai_goals',
		'bap_agent_log',
		'bap_ga4_credentials',
		'bap_clarity_token',
		'bap_clarity_usage',
		'bap_workspace_funnels',
		'bap_workspace_alerts',
		'bap_workspace_annotations',
		'bap_workspace_dashboard',
	);

	foreach ( $options as $option ) {
		delete_option( $option );
	}

	delete_transient( 'bap_connection_test' );
	delete_transient( 'bap_outbox_purged' );
	delete_transient( 'bap_ga4_token' );

	// Product meta the agent writes before changing a sale price, so a revert
	// can restore exactly what was there.
	delete_metadata( 'post', 0, '_bap_agent_restore', '', true );

	// Per-user flags used to emit one login/signup event.
	//
	// `user` is a WordPress meta type, not display text. A localisation pass
	// once replaced it with the Persian word, which made this line delete
	// nothing — the same mistake that silently disabled the whole WooCommerce
	// integration in 4.2.1.
	delete_metadata( 'user', 0, '_bap_pending_auth_event', '', true );

	// Order meta. Left behind, these would silently suppress purchase events if
	// the plugin were ever reinstalled on the same store.
	delete_metadata( 'post', 0, '_bap_purchase_event_id', '', true );
	delete_metadata( 'post', 0, '_bap_anonymous_id', '', true );
	delete_metadata( 'post', 0, '_bap_analytics_consent', '', true );

	// WooCommerce HPOS keeps order meta in its own table rather than postmeta.
	$hpos_table = $wpdb->prefix . 'wc_orders_meta';
	// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is not user input.
	if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $hpos_table ) ) === $hpos_table ) {
		$wpdb->query( // phpcs:ignore WordPress.DB
			$wpdb->prepare(
				"DELETE FROM {$hpos_table} WHERE meta_key IN (%s, %s, %s)", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				'_bap_purchase_event_id',
				'_bap_anonymous_id',
				'_bap_analytics_consent'
			)
		);
	}

	wp_clear_scheduled_hook( 'bap_process_outbox' );
}

// Multisite installs need every site cleaned, not just the one that triggered
// the uninstall. Batched, because a large network must not exhaust memory.
if ( is_multisite() ) {
	$offset     = 0;
	$batch_size = 0;
	do {
		$site_ids = get_sites(
			array(
				'fields' => 'ids',
				'number' => 100,
				'offset' => $offset,
			)
		);

		foreach ( $site_ids as $site_id ) {
			switch_to_blog( $site_id );
			bap_uninstall_site();
			restore_current_blog();
		}

		$offset    += 100;
		$batch_size = count( $site_ids );
	} while ( 100 === $batch_size );
} else {
	bap_uninstall_site();
}
