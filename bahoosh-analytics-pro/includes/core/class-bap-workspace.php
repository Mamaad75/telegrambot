<?php
/**
 * Local analytics workspace definitions.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Stores user-defined funnels, alerts, annotations and dashboard preferences.
 *
 * Analytics facts remain in the ASP.NET backend; only lightweight definitions
 * and UI state live in WordPress so they are portable with the site.
 */
class BAP_Workspace {

	const OPTION_FUNNELS     = 'bap_workspace_funnels';
	const OPTION_ALERTS      = 'bap_workspace_alerts';
	const OPTION_ANNOTATIONS = 'bap_workspace_annotations';
	const OPTION_DASHBOARD   = 'bap_workspace_dashboard';

	/**
	 * Returns saved funnels.
	 *
	 * @return array
	 */
	public static function funnels() {
		$value = get_option( self::OPTION_FUNNELS, array() );
		return is_array( $value ) ? array_values( $value ) : array();
	}

	/**
	 * Gets one funnel.
	 *
	 * @param string $id Funnel id.
	 * @return array|null
	 */
	public static function funnel( $id ) {
		$id      = sanitize_key( $id );
		$funnels = get_option( self::OPTION_FUNNELS, array() );
		return is_array( $funnels ) && isset( $funnels[ $id ] ) && is_array( $funnels[ $id ] ) ? $funnels[ $id ] : null;
	}

	/**
	 * Creates or replaces a funnel definition.
	 *
	 * @param array $input Funnel input.
	 * @return array|WP_Error
	 */
	public static function upsert_funnel( array $input ) {
		$name = isset( $input['name'] ) ? sanitize_text_field( (string) $input['name'] ) : '';
		if ( '' === $name ) {
			return new WP_Error( 'bap_funnel_name', __( 'برای قیف باید یک نام وارد کنید.', 'bahoosh-analytics-pro' ) );
		}

		$steps = isset( $input['steps'] ) && is_array( $input['steps'] ) ? $input['steps'] : array();
		$clean_steps = array();
		foreach ( $steps as $step ) {
			if ( ! is_array( $step ) ) {
				continue;
			}
			$event_type = isset( $step['event_type'] ) ? sanitize_key( $step['event_type'] ) : '';
			if ( '' === $event_type || ! BAP_Event_Validator::is_allowed_type( $event_type ) ) {
				continue;
			}
			$clean_steps[] = array(
				'label'      => isset( $step['label'] ) ? sanitize_text_field( (string) $step['label'] ) : $event_type,
				'event_type' => $event_type,
				'path'       => isset( $step['path'] ) ? substr( sanitize_text_field( (string) $step['path'] ), 0, 512 ) : '',
			);
			if ( count( $clean_steps ) >= 12 ) {
				break;
			}
		}

		if ( count( $clean_steps ) < 2 ) {
			return new WP_Error( 'bap_funnel_steps', __( 'قیف باید حداقل دو مرحله معتبر داشته باشد.', 'bahoosh-analytics-pro' ) );
		}

		$id = isset( $input['id'] ) ? sanitize_key( $input['id'] ) : '';
		if ( '' === $id ) {
			$id = 'fn_' . substr( str_replace( '-', '', wp_generate_uuid4() ), 0, 20 );
		}

		$funnels = get_option( self::OPTION_FUNNELS, array() );
		$funnels = is_array( $funnels ) ? $funnels : array();
		$created = isset( $funnels[ $id ]['created_at'] ) ? $funnels[ $id ]['created_at'] : gmdate( 'c' );

		$funnel = array(
			'id'         => $id,
			'name'       => $name,
			'steps'      => $clean_steps,
			'created_at' => $created,
			'updated_at' => gmdate( 'c' ),
		);
		$funnels[ $id ] = $funnel;
		update_option( self::OPTION_FUNNELS, $funnels, false );

		return $funnel;
	}

	/**
	 * Deletes a funnel.
	 *
	 * @param string $id Funnel id.
	 * @return bool
	 */
	public static function delete_funnel( $id ) {
		$id      = sanitize_key( $id );
		$funnels = get_option( self::OPTION_FUNNELS, array() );
		if ( ! is_array( $funnels ) || ! isset( $funnels[ $id ] ) ) {
			return false;
		}
		unset( $funnels[ $id ] );
		update_option( self::OPTION_FUNNELS, $funnels, false );
		return true;
	}

	/**
	 * Returns saved analytics alerts.
	 *
	 * @return array
	 */
	public static function alerts() {
		$value = get_option( self::OPTION_ALERTS, array() );
		return is_array( $value ) ? array_values( $value ) : array();
	}


	/**
	 * Creates an analytics alert definition.
	 *
	 * @param array $input Alert input.
	 * @return array
	 */
	public static function create_alert( array $input ) {
		$alerts = get_option( self::OPTION_ALERTS, array() );
		$alerts = is_array( $alerts ) ? $alerts : array();
		$id     = 'al_' . substr( str_replace( '-', '', wp_generate_uuid4() ), 0, 20 );
		$alert  = array(
			'id'         => $id,
			'name'       => sanitize_text_field( isset( $input['name'] ) ? (string) $input['name'] : __( 'هشدار هوش مصنوعی', 'bahoosh-analytics-pro' ) ),
			'metric'     => sanitize_key( isset( $input['metric'] ) ? $input['metric'] : 'conversions' ),
			'operator'   => in_array( isset( $input['operator'] ) ? $input['operator'] : '', array( 'gt', 'gte', 'lt', 'lte', 'change_gt', 'change_lt' ), true ) ? $input['operator'] : 'change_lt',
			'threshold'  => isset( $input['threshold'] ) && is_numeric( $input['threshold'] ) ? (float) $input['threshold'] : -20,
			'enabled'    => true,
			'created_at' => gmdate( 'c' ),
		);
		$alerts[ $id ] = $alert;
		update_option( self::OPTION_ALERTS, $alerts, false );
		return $alert;
	}

	/**
	 * Returns saved timeline annotations.
	 *
	 * @return array
	 */
	public static function annotations() {
		$value = get_option( self::OPTION_ANNOTATIONS, array() );
		return is_array( $value ) ? array_values( $value ) : array();
	}


	/**
	 * Adds an annotation to the local analytics timeline.
	 *
	 * @param array $input Annotation input.
	 * @return array
	 */
	public static function add_annotation( array $input ) {
		$items = get_option( self::OPTION_ANNOTATIONS, array() );
		$items = is_array( $items ) ? $items : array();
		$item  = array(
			'id'         => 'an_' . substr( str_replace( '-', '', wp_generate_uuid4() ), 0, 20 ),
			'label'      => sanitize_text_field( isset( $input['label'] ) ? (string) $input['label'] : __( 'بینش هوش مصنوعی', 'bahoosh-analytics-pro' ) ),
			'note'       => sanitize_textarea_field( isset( $input['note'] ) ? (string) $input['note'] : '' ),
			'date'       => isset( $input['date'] ) && preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) $input['date'] ) ? (string) $input['date'] : gmdate( 'Y-m-d' ),
			'created_at' => gmdate( 'c' ),
		);
		$items[] = $item;
		$items   = array_slice( $items, -500 );
		update_option( self::OPTION_ANNOTATIONS, $items, false );
		return $item;
	}

	/**
	 * Updates dashboard preferences using a narrow allowlist.
	 *
	 * @param array $input Dashboard preferences.
	 * @return array
	 */
	public static function update_dashboard( array $input ) {
		$current = get_option( self::OPTION_DASHBOARD, array() );
		$current = is_array( $current ) ? $current : array();
		$allowed = array( 'cards', 'panels' );
		foreach ( $allowed as $key ) {
			if ( isset( $input[ $key ] ) && is_array( $input[ $key ] ) ) {
				$current[ $key ] = array_values( array_unique( array_filter( array_map( 'sanitize_key', $input[ $key ] ) ) ) );
			}
		}
		update_option( self::OPTION_DASHBOARD, $current, false );
		return $current;
	}

	/**
	 * Dashboard preferences.
	 *
	 * @return array
	 */
	public static function dashboard() {
		$value = get_option( self::OPTION_DASHBOARD, array() );
		return is_array( $value ) ? $value : array();
	}
}
