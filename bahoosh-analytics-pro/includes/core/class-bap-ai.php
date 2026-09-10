<?php
/**
 * AI orchestration, signed callbacks and safe action execution.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Keeps AI untrusted by design.
 *
 * This class stores, decides on and executes recommendations. It deliberately
 * knows nothing about where they came from — {@see BAP_AI_Provider} produces
 * them, from a model or from rules, and the structure is identical either way.
 *
 * No model output can execute arbitrary PHP, SQL, shell commands, URLs or
 * WordPress options: every executable action must be registered in a narrow
 * allowlist, and every execution is audited.
 */
class BAP_AI {

	const OPTION_RECOMMENDATIONS = 'bap_ai_recommendations';
	const OPTION_AUDIT           = 'bap_ai_audit';
	const MAX_RECOMMENDATIONS    = 250;
	const MAX_AUDIT              = 500;

	/**
	 * Returns locally cached recommendations.
	 *
	 * @return array
	 */
	public static function recommendations() {
		$items = get_option( self::OPTION_RECOMMENDATIONS, array() );
		if ( ! is_array( $items ) ) {
			return array();
		}
		$items = array_values( $items );
		usort(
			$items,
			static function ( $a, $b ) {
				return strcmp( isset( $b['created_at'] ) ? $b['created_at'] : '', isset( $a['created_at'] ) ? $a['created_at'] : '' );
			}
		);
		return $items;
	}

	/**
	 * Returns the most recent AI audit entries for administrators.
	 *
	 * @param int $limit Maximum rows.
	 * @return array
	 */
	public static function audit_log( $limit = 30 ) {
		$rows = get_option( self::OPTION_AUDIT, array() );
		if ( ! is_array( $rows ) ) {
			return array();
		}
		$limit = max( 1, min( 100, (int) $limit ) );
		return array_reverse( array_slice( array_values( $rows ), -$limit ) );
	}


	/**
	 * Stores recommendations and applies safe-auto actions when allowed.
	 *
	 * @param array $payload Payload with a `recommendations` array.
	 * @return array Processing result.
	 */
	public static function ingest( array $payload ) {
		$incoming = isset( $payload['recommendations'] ) && is_array( $payload['recommendations'] ) ? $payload['recommendations'] : array();
		$stored   = get_option( self::OPTION_RECOMMENDATIONS, array() );
		$stored   = is_array( $stored ) ? $stored : array();
		$result   = array( 'stored' => 0, 'executed' => 0, 'failed' => 0 );

		foreach ( $incoming as $raw ) {
			if ( ! is_array( $raw ) ) {
				continue;
			}
			$item = self::normalize_recommendation( $raw );
			if ( null === $item ) {
				continue;
			}
			if ( isset( $stored[ $item['id'] ] ) && is_array( $stored[ $item['id'] ] ) ) {
				$previous = $stored[ $item['id'] ];
				if ( isset( $previous['status'] ) && in_array( $previous['status'], array( 'approved', 'rejected', 'applied', 'failed' ), true ) ) {
					foreach ( array( 'status', 'decided_at', 'applied_at', 'last_error', 'result' ) as $state_key ) {
						if ( isset( $previous[ $state_key ] ) ) {
							$item[ $state_key ] = $previous[ $state_key ];
						}
					}
				}
			}
			$stored[ $item['id'] ] = $item;
			$result['stored']++;

			if ( 'pending' === $item['status'] && self::should_auto_execute( $item ) ) {
				$execution = self::execute( $item, true );
				if ( is_wp_error( $execution ) ) {
					$result['failed']++;
					$stored[ $item['id'] ]['status'] = 'failed';
					$stored[ $item['id'] ]['last_error'] = $execution->get_error_message();
				} else {
					$result['executed']++;
					$stored[ $item['id'] ]['status'] = 'applied';
					$stored[ $item['id'] ]['applied_at'] = gmdate( 'c' );
				}
			}
		}

		if ( count( $stored ) > self::MAX_RECOMMENDATIONS ) {
			$stored = array_slice( $stored, -self::MAX_RECOMMENDATIONS, null, true );
		}
		update_option( self::OPTION_RECOMMENDATIONS, $stored, false );
		self::audit( 'callback_ingested', $result );
		return $result;
	}

	/**
	 * Applies a human decision to a cached recommendation.
	 *
	 * @param string $id       Recommendation id.
	 * @param string $decision approve|reject.
	 * @param bool   $execute  Apply registered action after approval.
	 * @return array|WP_Error
	 */
	public static function decide( $id, $decision, $execute = true ) {
		$id       = sanitize_key( $id );
		$decision = sanitize_key( $decision );
		if ( ! in_array( $decision, array( 'approve', 'reject' ), true ) ) {
			return new WP_Error( 'bap_ai_decision', __( 'تصمیم ارسال‌شده برای پیشنهاد هوش مصنوعی معتبر نیست.', 'bahoosh-analytics-pro' ) );
		}

		$stored = get_option( self::OPTION_RECOMMENDATIONS, array() );
		if ( ! is_array( $stored ) || ! isset( $stored[ $id ] ) ) {
			return new WP_Error( 'bap_ai_missing', __( 'پیشنهاد هوش مصنوعی پیدا نشد.', 'bahoosh-analytics-pro' ) );
		}

		$item = $stored[ $id ];
		if ( 'reject' === $decision ) {
			$item['status']     = 'rejected';
			$item['decided_at'] = gmdate( 'c' );
			$stored[ $id ]      = $item;
			update_option( self::OPTION_RECOMMENDATIONS, $stored, false );
			self::audit( 'recommendation_rejected', array( 'id' => $id ) );
			return $item;
		}

		$item['status']     = 'approved';
		$item['decided_at'] = gmdate( 'c' );
		if ( 'insights' === BAP_Settings::get( 'ai_autonomy' ) ) {
			$execute = false;
		}
		if ( $execute && ! empty( $item['action']['type'] ) ) {
			$result = self::execute( $item, false );
			if ( is_wp_error( $result ) ) {
				$item['status']     = 'failed';
				$item['last_error'] = $result->get_error_message();
			} else {
				$item['status']     = 'applied';
				$item['applied_at'] = gmdate( 'c' );
				$item['result']     = is_array( $result ) ? $result : array( 'success' => true );
			}
		}
		$stored[ $id ] = $item;
		update_option( self::OPTION_RECOMMENDATIONS, $stored, false );
		self::audit( 'recommendation_approved', array( 'id' => $id, 'status' => $item['status'] ) );
		return $item;
	}

	/**
	 * Executes one allowlisted action.
	 *
	 * @param array $recommendation Recommendation.
	 * @param bool  $automatic      Whether this is safe-auto mode.
	 * @return array|WP_Error
	 */
	public static function execute( array $recommendation, $automatic = false ) {
		$action = isset( $recommendation['action'] ) && is_array( $recommendation['action'] ) ? $recommendation['action'] : array();
		$type   = isset( $action['type'] ) ? sanitize_key( str_replace( '.', '_', $action['type'] ) ) : '';
		$raw_type = isset( $action['type'] ) ? strtolower( trim( (string) $action['type'] ) ) : '';
		if ( '' === $type || '' === $raw_type ) {
			return new WP_Error( 'bap_ai_no_action', __( 'این پیشنهاد اقدام قابل اجرایی ندارد.', 'bahoosh-analytics-pro' ) );
		}

		$registry = self::action_registry();
		if ( ! isset( $registry[ $raw_type ] ) || ! is_array( $registry[ $raw_type ] ) || ! is_callable( $registry[ $raw_type ]['callback'] ) ) {
			return new WP_Error( 'bap_ai_action_forbidden', __( 'اقدام درخواستی هوش مصنوعی در وردپرس ثبت و مجاز نشده است.', 'bahoosh-analytics-pro' ) );
		}
		$definition = $registry[ $raw_type ];
		if ( $automatic && empty( $definition['safe_auto'] ) ) {
			return new WP_Error( 'bap_ai_action_requires_approval', __( 'اجرای این اقدام به تأیید مدیر نیاز دارد.', 'bahoosh-analytics-pro' ) );
		}

		$payload = isset( $action['payload'] ) && is_array( $action['payload'] ) ? BAP_Event_Validator::sanitize_data( $action['payload'] ) : array();
		$result  = call_user_func( $definition['callback'], $payload, $recommendation );
		if ( is_wp_error( $result ) ) {
			self::audit( 'action_failed', array( 'type' => $raw_type, 'error' => $result->get_error_message() ) );
			return $result;
		}
		self::audit( 'action_applied', array( 'type' => $raw_type, 'recommendation_id' => $recommendation['id'] ) );
		return is_array( $result ) ? $result : array( 'success' => true );
	}

	/**
	 * Core AI actions. Site-specific actions can be added with a filter.
	 *
	 * @return array
	 */
	public static function action_registry() {
		$registry = array(
			'bahoosh.create_funnel' => array(
				'label'       => __( 'ساخت قیف تحلیلی', 'bahoosh-analytics-pro' ),
				'description' => __( 'یک قیف جدید از رویدادهای موجود می‌سازد تا ریزش مراحل قابل اندازه‌گیری شود.', 'bahoosh-analytics-pro' ),
				'safe_auto'   => true,
				'callback'  => static function ( $payload ) {
					return BAP_Workspace::upsert_funnel( $payload );
				},
			),
			'bahoosh.create_alert' => array(
				'label'       => __( 'ساخت هشدار تحلیلی', 'bahoosh-analytics-pro' ),
				'description' => __( 'برای افت یا رشد یک شاخص، هشدار قابل پیگیری در باهوش ایجاد می‌کند.', 'bahoosh-analytics-pro' ),
				'safe_auto'   => true,
				'callback'  => static function ( $payload ) {
					return BAP_Workspace::create_alert( $payload );
				},
			),
			'bahoosh.add_annotation' => array(
				'label'       => __( 'ثبت یادداشت روی خط زمانی', 'bahoosh-analytics-pro' ),
				'description' => __( 'یک رویداد یا بینش مهم را روی Timeline تحلیلی ثبت می‌کند تا اثر تغییرات بعداً قابل مقایسه باشد.', 'bahoosh-analytics-pro' ),
				'safe_auto'   => true,
				'callback'  => static function ( $payload ) {
					return BAP_Workspace::add_annotation( $payload );
				},
			),
			'bahoosh.update_dashboard' => array(
				'label'       => __( 'بهینه‌سازی چیدمان داشبورد', 'bahoosh-analytics-pro' ),
				'description' => __( 'کارت‌ها و پنل‌های داشبورد را بر اساس شاخص‌های مهم‌تر برای مدیر مرتب یا فعال می‌کند.', 'bahoosh-analytics-pro' ),
				'safe_auto'   => true,
				'callback'  => static function ( $payload ) {
					return BAP_Workspace::update_dashboard( $payload );
				},
			),
		);

		// The shop-mutating verbs are merged in here rather than hooked on at
		// boot. This registry is the security boundary — it decides what a
		// recommendation is allowed to do — and a boundary that depends on a
		// hook having fired is a boundary that can be missing. The agent adds
		// nothing while it is switched off, which is its default.
		$registry = BAP_Commerce_Agent::register_actions( $registry );

		/**
		 * Filters executable AI actions.
		 *
		 * Third-party callbacks are still never invoked unless their action type
		 * appears here. Mark `safe_auto` false for anything that mutates content,
		 * pricing, users, checkout or SEO.
		 *
		 * @param array $registry Action registry.
		 */
		return apply_filters( 'bap_ai_action_registry', $registry );
	}

	/**
	 * Public, callback-free action metadata for the admin UI.
	 *
	 * @return array
	 */
	public static function action_catalog() {
		$catalog = array();
		foreach ( self::action_registry() as $type => $definition ) {
			$catalog[ $type ] = array(
				'label'       => isset( $definition['label'] ) ? (string) $definition['label'] : $type,
				'description' => isset( $definition['description'] ) ? (string) $definition['description'] : '',
				'safe_auto'   => ! empty( $definition['safe_auto'] ),
			);
		}
		return $catalog;
	}


	/**
	 * Whether a recommendation may execute without a human click.
	 *
	 * @param array $item Recommendation.
	 * @return bool
	 */
	private static function should_auto_execute( array $item ) {
		if ( ! BAP_Settings::get( 'ai_enabled' ) || 'safe_auto' !== BAP_Settings::get( 'ai_autonomy' ) ) {
			return false;
		}
		if ( (int) $item['confidence'] < (int) BAP_Settings::get( 'ai_min_confidence', 80 ) ) {
			return false;
		}
		$registry = self::action_registry();
		$type     = isset( $item['action']['type'] ) ? strtolower( (string) $item['action']['type'] ) : '';
		return isset( $registry[ $type ] ) && ! empty( $registry[ $type ]['safe_auto'] );
	}

	/**
	 * Normalises one backend recommendation.
	 *
	 * @param array $raw Raw recommendation.
	 * @return array|null
	 */
	private static function normalize_recommendation( array $raw ) {
		$id = isset( $raw['id'] ) ? sanitize_key( $raw['id'] ) : '';
		if ( '' === $id ) {
			$id = 'rec_' . substr( str_replace( '-', '', wp_generate_uuid4() ), 0, 20 );
		}
		$title = isset( $raw['title'] ) ? sanitize_text_field( (string) $raw['title'] ) : '';
		if ( '' === $title ) {
			return null;
		}
		$confidence = isset( $raw['confidence'] ) && is_numeric( $raw['confidence'] ) ? (int) $raw['confidence'] : 0;
		$confidence = max( 0, min( 100, $confidence ) );
		$priority   = isset( $raw['priority'] ) ? sanitize_key( $raw['priority'] ) : 'medium';
		if ( ! in_array( $priority, array( 'critical', 'high', 'medium', 'low' ), true ) ) {
			$priority = 'medium';
		}

		$action = array();
		if ( isset( $raw['action'] ) && is_array( $raw['action'] ) ) {
			$action = array(
				'type'    => isset( $raw['action']['type'] ) ? strtolower( preg_replace( '/[^a-zA-Z0-9_.-]/', '', (string) $raw['action']['type'] ) ) : '',
				'payload' => isset( $raw['action']['payload'] ) && is_array( $raw['action']['payload'] ) ? BAP_Event_Validator::sanitize_data( $raw['action']['payload'] ) : array(),
			);
		}

		$evidence = array();
		if ( isset( $raw['evidence'] ) && is_array( $raw['evidence'] ) ) {
			foreach ( array_slice( $raw['evidence'], 0, 12 ) as $row ) {
				if ( is_scalar( $row ) ) {
					$evidence[] = sanitize_text_field( substr( (string) $row, 0, 500 ) );
				}
			}
		}

		return array(
			'id'          => $id,
			'title'       => $title,
			'summary'     => sanitize_textarea_field( isset( $raw['summary'] ) ? (string) $raw['summary'] : '' ),
			'rationale'   => sanitize_textarea_field( isset( $raw['rationale'] ) ? (string) $raw['rationale'] : '' ),
			'priority'    => $priority,
			'confidence'  => $confidence,
			'impact'      => sanitize_text_field( isset( $raw['impact'] ) ? (string) $raw['impact'] : '' ),
			'evidence'    => $evidence,
			'action'      => $action,
			'status'      => 'pending',
			'created_at'  => isset( $raw['created_at'] ) ? sanitize_text_field( (string) $raw['created_at'] ) : gmdate( 'c' ),
			'model_run_id'=> isset( $raw['model_run_id'] ) ? sanitize_key( $raw['model_run_id'] ) : '',
		);
	}

	/**
	 * Writes a bounded audit record.
	 *
	 * @param string $type Event type.
	 * @param array  $data Safe metadata.
	 * @return void
	 */
	private static function audit( $type, array $data ) {
		$rows = get_option( self::OPTION_AUDIT, array() );
		$rows = is_array( $rows ) ? $rows : array();
		$rows[] = array(
			'at'      => gmdate( 'c' ),
			'type'    => sanitize_key( $type ),
			'user_id' => get_current_user_id(),
			'data'    => BAP_Event_Validator::sanitize_data( $data ),
		);
		$rows = array_slice( $rows, -self::MAX_AUDIT );
		update_option( self::OPTION_AUDIT, $rows, false );
	}
}
