<?php
/**
 * Small encrypted option helper for server-side commercial secrets.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Encrypts secrets at rest using the WordPress auth salt as key material.
 *
 * This is not intended to defend against a fully compromised WordPress host;
 * it prevents accidental disclosure through database dumps, option exports and
 * debugging tools. Constants/filters remain available for proper secret
 * managers in managed deployments.
 */
class BAP_Secret_Store {

	/** Cipher used when OpenSSL is available. */
	const CIPHER = 'aes-256-gcm';

	/**
	 * Encrypts a string for storage.
	 *
	 * @param string $plaintext Secret.
	 * @return string|WP_Error
	 */
	public static function encrypt( $plaintext ) {
		$plaintext = (string) $plaintext;
		if ( '' === $plaintext ) {
			return '';
		}
		if ( ! function_exists( 'openssl_encrypt' ) || ! in_array( self::CIPHER, openssl_get_cipher_methods(), true ) ) {
			return new WP_Error( 'bap_crypto_unavailable', __( 'OpenSSL برای ذخیره امن کلید لایسنس در دسترس نیست. کلید را با ثابت BAP_LICENSE_KEY از محیط سرور تأمین کنید.', 'bahoosh-analytics-pro' ) );
		}

		$key = hash( 'sha256', wp_salt( 'auth' ) . '|bahoosh-commercial-secrets', true );
		$iv  = random_bytes( 12 );
		$tag = '';
		$raw = openssl_encrypt( $plaintext, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv, $tag, 'bahoosh-license-v1' );
		if ( false === $raw ) {
			return new WP_Error( 'bap_crypto_failed', __( 'رمزگذاری کلید لایسنس انجام نشد.', 'bahoosh-analytics-pro' ) );
		}

		return base64_encode( wp_json_encode( array( 'v' => 1, 'iv' => base64_encode( $iv ), 'tag' => base64_encode( $tag ), 'data' => base64_encode( $raw ) ) ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
	}

	/**
	 * Decrypts a stored value. Invalid data fails closed.
	 *
	 * @param string $ciphertext Stored value.
	 * @return string
	 */
	public static function decrypt( $ciphertext ) {
		if ( '' === (string) $ciphertext || ! function_exists( 'openssl_decrypt' ) ) {
			return '';
		}
		$json = base64_decode( (string) $ciphertext, true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		$data = $json ? json_decode( $json, true ) : null;
		if ( ! is_array( $data ) || 1 !== (int) ( $data['v'] ?? 0 ) ) {
			return '';
		}
		$iv  = base64_decode( (string) ( $data['iv'] ?? '' ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		$tag = base64_decode( (string) ( $data['tag'] ?? '' ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		$raw = base64_decode( (string) ( $data['data'] ?? '' ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		if ( false === $iv || false === $tag || false === $raw ) {
			return '';
		}
		$key   = hash( 'sha256', wp_salt( 'auth' ) . '|bahoosh-commercial-secrets', true );
		$plain = openssl_decrypt( $raw, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv, $tag, 'bahoosh-license-v1' );
		return false === $plain ? '' : (string) $plain;
	}
}
