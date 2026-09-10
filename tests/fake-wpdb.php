<?php
/**
 * A $wpdb that understands just enough SQL to exercise the rollup table.
 *
 * It implements the three statement shapes BAP_Rollup issues — the upsert, the
 * grouped SELECT and the ordered SELECT — against an in-memory array. Anything
 * else is logged and answered with a neutral value, so a test can never pass by
 * accident on a query nobody modelled.
 *
 * @package Bahoosh_Analytics_Pro
 */

// phpcs:disable

class Fake_WPDB {
	public string $prefix = 'wp_';
	public string $options = 'wp_options';
	public string $last_error = '';
	public array $log = array();
	/** @var array<string,array<string,mixed>> Rollup rows, keyed by bucket. */
	public array $rollup = array();
	public array $tables = array();

	public function get_charset_collate(): string { return 'DEFAULT CHARACTER SET utf8mb4'; }

	public function prepare( string $query, ...$args ) {
		if ( 1 === count( $args ) && is_array( $args[0] ) ) { $args = $args[0]; }
		// Keep the values addressable rather than interpolating them away: the
		// query methods below read them back out.
		return array( 'sql' => $query, 'args' => $args );
	}

	public function query( $prepared ) {
		[ $sql, $args ] = $this->unpack( $prepared );
		$this->log[]    = $sql;

		if ( str_contains( $sql, 'INSERT INTO' ) && str_contains( $sql, 'ON DUPLICATE KEY UPDATE' ) ) {
			// (date, device, step, path, value, updated, value, updated)
			[ $date, $device, $step, $path, $value ] = $args;
			$key = "{$date}|{$device}|{$step}|{$path}";

			if ( isset( $this->rollup[ $key ] ) ) {
				$this->rollup[ $key ]['hits']++;
				$this->rollup[ $key ]['value_sum'] += (float) $value;
			} else {
				$this->rollup[ $key ] = array(
					'bucket_date' => $date, 'device' => $device, 'step' => $step,
					'page_path' => $path, 'hits' => 1, 'value_sum' => (float) $value,
				);
			}
			return 1;
		}

		if ( str_contains( $sql, 'DELETE FROM' ) ) { return 0; }
		return 0;
	}

	public function get_results( $prepared, $output = OBJECT ) {
		[ $sql, $args ] = $this->unpack( $prepared );
		$this->log[]    = $sql;

		if ( str_contains( $sql, 'GROUP BY step, device' ) ) {
			[ $from, $to ] = $args;
			$grouped = array();
			foreach ( $this->rollup as $row ) {
				if ( $row['bucket_date'] < $from || $row['bucket_date'] > $to ) { continue; }
				$k = $row['step'] . '|' . $row['device'];
				if ( ! isset( $grouped[ $k ] ) ) {
					$grouped[ $k ] = array( 'step' => $row['step'], 'device' => $row['device'], 'hits' => 0, 'value_sum' => 0 );
				}
				$grouped[ $k ]['hits']      += $row['hits'];
				$grouped[ $k ]['value_sum'] += $row['value_sum'];
			}
			return array_values( $grouped );
		}

		if ( str_contains( $sql, 'GROUP BY page_path' ) ) {
			[ $step, $from, $to, $limit ] = $args;
			$grouped = array();
			foreach ( $this->rollup as $row ) {
				if ( $row['step'] !== $step || '' === $row['page_path'] ) { continue; }
				if ( $row['bucket_date'] < $from || $row['bucket_date'] > $to ) { continue; }
				$grouped[ $row['page_path'] ] = ( $grouped[ $row['page_path'] ] ?? 0 ) + $row['hits'];
			}
			arsort( $grouped );
			$out = array();
			foreach ( array_slice( $grouped, 0, (int) $limit, true ) as $path => $hits ) {
				$out[] = array( 'page_path' => $path, 'hits' => $hits );
			}
			return $out;
		}

		return array();
	}

	public function get_var( $prepared, $x = 0, $y = 0 ) {
		[ $sql, $args ] = $this->unpack( $prepared );
		$this->log[]    = $sql;

		if ( str_contains( $sql, 'SELECT SUM(hits)' ) ) {
			[ $from, $to ] = $args;
			$total = 0;
			foreach ( $this->rollup as $row ) {
				if ( $row['bucket_date'] >= $from && $row['bucket_date'] <= $to ) { $total += $row['hits']; }
			}
			return (string) $total;
		}

		if ( str_contains( $sql, 'SELECT COUNT(*)' ) ) { return (string) count( $this->rollup ); }
		return null;
	}

	public function get_row( $p = null, $o = OBJECT, $y = 0 ) { return null; }
	public function insert( $t, $d, $f = null ) { $this->tables[ $t ][] = $d; return 1; }
	public function update( $t, $d, $w, $f = null, $wf = null ) { return 1; }
	public function delete( $t, $w, $f = null ) { return 1; }
	public function esc_like( $t ) { return addcslashes( (string) $t, '_%\\' ); }

	private function unpack( $prepared ): array {
		if ( is_array( $prepared ) && isset( $prepared['sql'] ) ) {
			return array( $prepared['sql'], $prepared['args'] );
		}
		return array( (string) $prepared, array() );
	}
}

if ( ! defined( 'OBJECT' ) ) { define( 'OBJECT', 'OBJECT' ); }
if ( ! defined( 'ARRAY_A' ) ) { define( 'ARRAY_A', 'ARRAY_A' ); }

function dbDelta( $q, $e = true ) { return array(); }
