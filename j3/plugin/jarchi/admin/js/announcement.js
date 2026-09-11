/**
 * Announcement editor: icon picker and image picker.
 *
 * Both write to a hidden input, so the form submission and the save handler
 * are exactly what they were before there was a picker. The pickers only
 * change how a value is chosen, never what is stored.
 *
 * @package WPEventPublisher
 */

( function ( $ ) {
	'use strict';

	var l10n = window.wpepAnnouncement || {};

	/**
	 * Wires the icon picker.
	 *
	 * A grid of the icons the plugin offers, rather than a text field asking
	 * for a Dashicon name — nobody knows Dashicon names, and a typo produced a
	 * silently missing icon.
	 *
	 * @return {void}
	 */
	function iconPicker() {
		var $picker = $( '[data-jarchi-icon-picker]' );

		if ( ! $picker.length ) {
			return;
		}

		var $value = $picker.find( '.wpep-icon-picker__value' );
		var $grid = $picker.find( '.wpep-icon-picker__grid' );
		var $preview = $picker.find( '.wpep-icon-picker__preview .dashicons' );
		var $clear = $picker.find( '.wpep-icon-picker__clear' );

		$picker.on( 'click', '.wpep-icon-picker__open', function () {
			$grid.prop( 'hidden', ! $grid.prop( 'hidden' ) );
		} );

		$picker.on( 'click', '.wpep-icon-picker__choice', function () {
			var icon = $( this ).attr( 'data-icon' );

			$value.val( icon );
			$preview.attr( 'class', 'dashicons dashicons-' + icon );
			$grid.find( '.wpep-icon-picker__choice' ).removeClass( 'is-selected' );
			$( this ).addClass( 'is-selected' );
			$clear.prop( 'hidden', false );
			$grid.prop( 'hidden', true );
		} );

		$clear.on( 'click', function () {
			$value.val( '' );
			$preview.attr( 'class', 'dashicons dashicons-megaphone' );
			$grid.find( '.wpep-icon-picker__choice' ).removeClass( 'is-selected' );
			$( this ).prop( 'hidden', true );
		} );
	}

	/**
	 * Wires the image picker to the WordPress media library.
	 *
	 * Uses wp.media rather than a URL field, so an administrator selects or
	 * uploads an image the same way they do everywhere else in WordPress, and
	 * what is stored is an attachment ID rather than a URL that breaks when the
	 * domain changes.
	 *
	 * @return {void}
	 */
	function mediaPicker() {
		var $picker = $( '[data-jarchi-media-picker]' );

		if ( ! $picker.length || ! window.wp || ! window.wp.media ) {
			return;
		}

		var $value = $picker.find( '.wpep-media-picker__value' );
		var $preview = $picker.find( '.wpep-media-picker__preview' );
		var $img = $preview.find( 'img' );
		var $select = $picker.find( '.wpep-media-picker__select' );
		var $remove = $picker.find( '.wpep-media-picker__remove' );
		var frame = null;

		$select.on( 'click', function ( e ) {
			e.preventDefault();

			// Built once and reused, so reopening the picker does not stack
			// another frame and its listeners each time.
			if ( ! frame ) {
				frame = window.wp.media( {
					title: l10n.chooseImage || '',
					button: { text: l10n.useImage || '' },
					library: { type: 'image' },
					multiple: false
				} );

				frame.on( 'select', function () {
					var attachment = frame.state().get( 'selection' ).first().toJSON();
					var url = attachment.sizes && attachment.sizes.medium
						? attachment.sizes.medium.url
						: attachment.url;

					$value.val( attachment.id );
					$img.attr( 'src', url );
					$preview.prop( 'hidden', false );
					$remove.prop( 'hidden', false );
					$select.text( l10n.change || '' );
				} );
			}

			frame.open();
		} );

		$remove.on( 'click', function ( e ) {
			e.preventDefault();

			$value.val( '' );
			$img.attr( 'src', '' );
			$preview.prop( 'hidden', true );
			$( this ).prop( 'hidden', true );
			$select.text( l10n.select || '' );
		} );
	}

	$( function () {
		iconPicker();
		mediaPicker();
	} );
}( jQuery ) );
