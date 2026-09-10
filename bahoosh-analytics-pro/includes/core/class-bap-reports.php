<?php
/**
 * Reporting helpers.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Date-range handling and metric normalisation for the dashboard.
 *
 * Normalising here means the admin UI has one stable shape to render, whatever
 * the collector currently returns. New collector metrics can be surfaced
 * without touching the JavaScript, and missing ones degrade to null rather
 * than breaking the page.
 */
class BAP_Reports {

	/**
	 * Supported named ranges.
	 *
	 * @return array<string,string>
	 */
	public static function ranges() {
		return array(
			'today'        => __( 'امروز', 'bahoosh-analytics-pro' ),
			'yesterday'    => __( 'دیروز', 'bahoosh-analytics-pro' ),
			'last_7_days'  => __( '۷ روز گذشته', 'bahoosh-analytics-pro' ),
			'last_30_days' => __( '۳۰ روز گذشته', 'bahoosh-analytics-pro' ),
			'last_90_days' => __( '۹۰ روز گذشته', 'bahoosh-analytics-pro' ),
			'custom'       => __( 'بازه دلخواه', 'bahoosh-analytics-pro' ),
		);
	}

	/**
	 * Resolves a range request into concrete UTC dates.
	 *
	 * @param string $range Named range.
	 * @param string $from  Custom start (Y-m-d).
	 * @param string $to    Custom end (Y-m-d).
	 * @return array{range:string,from:string,to:string}
	 */
	public static function normalize_range( $range, $from = '', $to = '' ) {
		$range = is_string( $range ) ? $range : 'last_7_days';
		if ( ! array_key_exists( $range, self::ranges() ) ) {
			$range = 'last_7_days';
		}

		$today = gmdate( 'Y-m-d' );

		switch ( $range ) {
			case 'today':
				return array(
					'range' => $range,
					'from'  => $today,
					'to'    => $today,
				);

			case 'yesterday':
				$yesterday = gmdate( 'Y-m-d', strtotime( '-1 day' ) );
				return array(
					'range' => $range,
					'from'  => $yesterday,
					'to'    => $yesterday,
				);

			case 'last_30_days':
				return array(
					'range' => $range,
					'from'  => gmdate( 'Y-m-d', strtotime( '-29 days' ) ),
					'to'    => $today,
				);

			case 'last_90_days':
				return array(
					'range' => $range,
					'from'  => gmdate( 'Y-m-d', strtotime( '-89 days' ) ),
					'to'    => $today,
				);

			case 'custom':
				$start = self::sanitize_date( $from );
				$end   = self::sanitize_date( $to );
				if ( '' === $start || '' === $end ) {
					return self::normalize_range( 'last_7_days' );
				}
				if ( $start > $end ) {
					$swap  = $start;
					$start = $end;
					$end   = $swap;
				}
				return array(
					'range' => 'custom',
					'from'  => $start,
					'to'    => $end,
				);

			case 'last_7_days':
			default:
				return array(
					'range' => 'last_7_days',
					'from'  => gmdate( 'Y-m-d', strtotime( '-6 days' ) ),
					'to'    => $today,
				);
		}
	}

	/**
	 * Validates a Y-m-d date.
	 *
	 * @param mixed $value Candidate.
	 * @return string Empty string when invalid.
	 */
	public static function sanitize_date( $value ) {
		if ( ! is_string( $value ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $value ) ) {
			return '';
		}
		list( $year, $month, $day ) = array_map( 'intval', explode( '-', $value ) );
		return checkdate( $month, $day, $year ) ? $value : '';
	}

	/**
	 * Normalises collector metrics into the dashboard's stable shape.
	 *
	 * @param mixed $body Decoded collector response.
	 * @return array
	 */
	public static function normalize_metrics( $body ) {
		$body = is_array( $body ) ? $body : array();

		// The collector may nest metrics or return them flat; accept both.
		$source = isset( $body['metrics'] ) && is_array( $body['metrics'] ) ? $body['metrics'] : $body;

		$metrics = array(
			'total_events'    => self::pick_int( $source, array( 'total_events', 'totalEvents' ) ),
			'unique_users'    => self::pick_int( $source, array( 'unique_users', 'uniqueUsers' ) ),
			'sessions'        => self::pick_int( $source, array( 'sessions', 'totalSessions' ) ),
			'page_views'      => self::pick_int( $source, array( 'page_views', 'pageViews' ) ),
			'searches'        => self::pick_int( $source, array( 'searches', 'totalSearches' ) ),
			'realtime_users'  => self::pick_int( $source, array( 'realtime_users', 'liveUsers', 'realtimeUsers' ) ),
			'conversions'     => self::pick_int( $source, array( 'conversions' ) ),
			'revenue'         => self::pick_float( $source, array( 'revenue', 'totalRevenue' ) ),
			'conversion_rate' => self::pick_float( $source, array( 'conversion_rate', 'conversionRate' ) ),
			'currency'        => isset( $source['currency'] ) ? sanitize_text_field( (string) $source['currency'] ) : '',
			'top_pages'       => self::normalize_rows( $source, array( 'top_pages', 'topPages' ), 'url', 'views' ),
			'traffic_sources' => self::normalize_rows( $source, array( 'traffic_sources', 'trafficSources' ), 'source', 'sessions' ),
			'devices'         => self::normalize_rows( $source, array( 'devices' ), 'device_type', 'sessions' ),
			'countries'       => self::normalize_rows( $source, array( 'countries' ), 'country', 'sessions' ),
			// Present only when the collector returns it. An empty array means
			// "not provided", and the dashboard says so rather than drawing a
			// chart out of nothing.
			'timeseries'      => self::normalize_timeseries( $source ),
		);

		/**
		 * Filters normalised dashboard metrics.
		 *
		 * @param array $metrics Normalised metrics.
		 * @param mixed $body    Raw collector response.
		 */
		return apply_filters( 'bap_dashboard_metrics', $metrics, $body );
	}

	/**
	 * Normalises a daily time series, if the collector supplied one.
	 *
	 * Accepts a few shapes because collectors differ, but invents nothing: when
	 * no recognisable series is present the result is an empty array and the
	 * dashboard renders an explanation instead of a graph.
	 *
	 * @param array $source Collector response.
	 * @return array List of `{date, events, users, sessions, page_views}`.
	 */
	private static function normalize_timeseries( array $source ) {
		$rows = null;
		foreach ( array( 'timeseries', 'time_series', 'daily', 'series' ) as $key ) {
			if ( isset( $source[ $key ] ) && is_array( $source[ $key ] ) ) {
				$rows = $source[ $key ];
				break;
			}
		}

		if ( null === $rows ) {
			return array();
		}

		$out = array();
		foreach ( $rows as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}

			$date = '';
			foreach ( array( 'date', 'day', 'bucket', 'timestamp' ) as $candidate ) {
				if ( ! empty( $row[ $candidate ] ) && is_scalar( $row[ $candidate ] ) ) {
					$date = self::sanitize_date( substr( (string) $row[ $candidate ], 0, 10 ) );
					break;
				}
			}
			if ( '' === $date ) {
				continue;
			}

			$out[] = array(
				'date'       => $date,
				'events'     => self::pick_int( $row, array( 'events', 'total_events', 'totalEvents' ) ),
				'users'      => self::pick_int( $row, array( 'users', 'unique_users', 'uniqueUsers' ) ),
				'sessions'   => self::pick_int( $row, array( 'sessions' ) ),
				'page_views' => self::pick_int( $row, array( 'page_views', 'pageViews' ) ),
			);

			if ( count( $out ) >= 400 ) {
				break;
			}
		}

		usort(
			$out,
			static function ( $a, $b ) {
				return strcmp( $a['date'], $b['date'] );
			}
		);

		return $out;
	}

	/**
	 * The window immediately before a given one, of equal length.
	 *
	 * Used for period-over-period comparison. The comparison is a second real
	 * query against the same endpoint, not an estimate.
	 *
	 * @param string $from Start date (Y-m-d).
	 * @param string $to   End date (Y-m-d), inclusive.
	 * @return array{from:string,to:string}
	 */
	public static function previous_period( $from, $to ) {
		$start = strtotime( $from . ' 00:00:00 UTC' );
		$end   = strtotime( $to . ' 00:00:00 UTC' );

		if ( ! $start || ! $end || $end < $start ) {
			return array(
				'from' => $from,
				'to'   => $to,
			);
		}

		$days = (int) round( ( $end - $start ) / DAY_IN_SECONDS ) + 1;

		return array(
			'from' => gmdate( 'Y-m-d', $start - ( $days * DAY_IN_SECONDS ) ),
			'to'   => gmdate( 'Y-m-d', $start - DAY_IN_SECONDS ),
		);
	}

	/**
	 * Percentage change between two periods, per metric.
	 *
	 * Returns null for a metric that is missing on either side, or where the
	 * previous value was zero — "up from nothing" is not a percentage, and
	 * printing one would be worse than printing nothing.
	 *
	 * @param array $current  Current-period metrics.
	 * @param array $previous Previous-period metrics.
	 * @return array<string,float|null>
	 */
	public static function compare( array $current, array $previous ) {
		$deltas = array();

		foreach ( $current as $key => $value ) {
			if ( ! is_int( $value ) && ! is_float( $value ) ) {
				continue;
			}
			$before = isset( $previous[ $key ] ) ? $previous[ $key ] : null;
			if ( ! is_int( $before ) && ! is_float( $before ) ) {
				$deltas[ $key ] = null;
				continue;
			}
			if ( 0.0 === (float) $before ) {
				$deltas[ $key ] = null;
				continue;
			}
			$deltas[ $key ] = round( ( ( $value - $before ) / abs( $before ) ) * 100, 1 );
		}

		return $deltas;
	}

	/**
	 * Reads the first present key as an integer.
	 *
	 * @param array    $source Source array.
	 * @param string[] $keys   Candidate keys.
	 * @return int|null
	 */
	private static function pick_int( array $source, array $keys ) {
		foreach ( $keys as $key ) {
			if ( isset( $source[ $key ] ) && is_numeric( $source[ $key ] ) ) {
				return (int) $source[ $key ];
			}
		}
		return null;
	}

	/**
	 * Reads the first present key as a float.
	 *
	 * @param array    $source Source array.
	 * @param string[] $keys   Candidate keys.
	 * @return float|null
	 */
	private static function pick_float( array $source, array $keys ) {
		foreach ( $keys as $key ) {
			if ( isset( $source[ $key ] ) && is_numeric( $source[ $key ] ) ) {
				return (float) $source[ $key ];
			}
		}
		return null;
	}

	/**
	 * Normalises a list of `{label, value}` rows.
	 *
	 * @param array    $source     Source array.
	 * @param string[] $keys       Candidate keys.
	 * @param string   $label_key  Preferred label field.
	 * @param string   $value_key  Preferred value field.
	 * @return array
	 */
	private static function normalize_rows( array $source, array $keys, $label_key, $value_key ) {
		$rows = null;
		foreach ( $keys as $key ) {
			if ( isset( $source[ $key ] ) && is_array( $source[ $key ] ) ) {
				$rows = $source[ $key ];
				break;
			}
		}
		if ( null === $rows ) {
			return array();
		}

		$out = array();
		foreach ( $rows as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}
			$label = '';
			foreach ( array( $label_key, 'label', 'name', 'key' ) as $candidate ) {
				if ( isset( $row[ $candidate ] ) && is_scalar( $row[ $candidate ] ) ) {
					$label = (string) $row[ $candidate ];
					break;
				}
			}
			$value = 0;
			foreach ( array( $value_key, 'value', 'count', 'total' ) as $candidate ) {
				if ( isset( $row[ $candidate ] ) && is_numeric( $row[ $candidate ] ) ) {
					$value = (float) $row[ $candidate ];
					break;
				}
			}
			if ( '' === $label ) {
				continue;
			}
			$out[] = array(
				'label' => sanitize_text_field( $label ),
				'value' => $value,
			);
			if ( count( $out ) >= 25 ) {
				break;
			}
		}
		return $out;
	}
}
