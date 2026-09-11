<?php
/**
 * Test seam for is_uploaded_file().
 *
 * Under the CLI there is no POST, so the real builtin refuses everything and
 * the upload validation could never be exercised. PHP resolves an unqualified
 * call inside a namespace against that namespace before falling back to the
 * global one, so declaring the function here is enough to substitute it for
 * the plugin's calls — without changing a line of the plugin, which still
 * reaches the genuine builtin when no such function is defined.
 *
 * A test registers a path by adding it to $GLOBALS['uploaded_files']; anything
 * not registered is refused, which is what the path-injection case relies on.
 *
 * @package WPEventPublisher
 */

namespace WPEventPublisher;

if ( ! function_exists( __NAMESPACE__ . '\\is_uploaded_file' ) ) {
	/**
	 * Whether the path was registered as a genuine upload by the test.
	 *
	 * @param string $path Temporary path.
	 *
	 * @return bool True when registered.
	 */
	function is_uploaded_file( $path ) {
		return in_array( (string) $path, (array) ( $GLOBALS['uploaded_files'] ?? array() ), true );
	}
}
