/**
 * Announcement placement editor.
 *
 * Reveals the options that belong to the chosen placement, and manages the
 * condition rows. Everything it toggles is server-rendered and server-
 * sanitized; hiding a panel never changes what is stored, so a browser with
 * JavaScript disabled still saves a correct announcement.
 *
 * @package WPEventPublisher
 */

( function () {
	'use strict';

	/**
	 * Shows the option panels that belong to the selected placement.
	 *
	 * @return {void}
	 */
	function syncPanels() {
		var checked = document.querySelector( 'input[name="wpep_placement"]:checked' );
		var current = checked ? checked.value : 'page';

		document.querySelectorAll( '.wpep-placement-options' ).forEach( function ( panel ) {
			var applies = ( panel.getAttribute( 'data-for' ) || '' ).split( ' ' );

			panel.hidden = applies.indexOf( current ) === -1;
		} );
	}

	/**
	 * Adds one blank condition row, renumbered so the names stay unique.
	 *
	 * @return {void}
	 */
	function addCondition() {
		var list = document.querySelector( '[data-jarchi-conditions]' );

		if ( ! list ) {
			return;
		}

		var first = list.querySelector( '.wpep-condition' );

		if ( ! first ) {
			return;
		}

		var clone = first.cloneNode( true );
		var index = list.querySelectorAll( '.wpep-condition' ).length;

		clone.querySelectorAll( 'select, input' ).forEach( function ( field ) {
			var name = field.getAttribute( 'name' ) || '';

			field.setAttribute( 'name', name.replace( /\[rules\]\[\d+\]/, '[rules][' + index + ']' ) );

			if ( 'INPUT' === field.tagName ) {
				field.value = '';
			} else {
				field.selectedIndex = 0;
			}
		} );

		list.appendChild( clone );
	}

	document.addEventListener( 'DOMContentLoaded', function () {
		syncPanels();

		document.querySelectorAll( 'input[name="wpep_placement"]' ).forEach( function ( radio ) {
			radio.addEventListener( 'change', syncPanels );
		} );

		document.addEventListener( 'click', function ( e ) {
			if ( e.target.closest( '[data-jarchi-add-condition]' ) ) {
				e.preventDefault();
				addCondition();
			}

			if ( e.target.closest( '.wpep-condition__remove' ) ) {
				e.preventDefault();

				var rows = document.querySelectorAll( '.wpep-condition' );

				// Always leave one row: an empty list has nothing to clone
				// from, and a blank row is ignored on save anyway.
				if ( rows.length > 1 ) {
					e.target.closest( '.wpep-condition' ).remove();
				}
			}
		} );
	} );
}() );
