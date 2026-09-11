/**
 * Jarchi application shell behaviour.
 *
 * The shell intentionally has one navigation model: expanded or collapsed.
 * There is no separate mobile drawer state. The same sidebar remains the
 * same component at every viewport size, which keeps navigation predictable.
 *
 * @package WPEventPublisher
 * @since 1.7.5
 */
( function () {
	'use strict';

	var app = document.querySelector( '.jarchi-app' );

	if ( ! app ) {
		return;
	}

	var config = window.wpepShell || {};
	var body = document.body;

	function remember( action, data ) {
		if ( ! config.ajaxUrl || ! config.nonce ) {
			return;
		}

		var payload = new FormData();
		payload.append( 'action', action );
		payload.append( 'nonce', config.nonce );

		Object.keys( data ).forEach( function ( key ) {
			payload.append( key, data[ key ] );
		} );

		window.fetch( config.ajaxUrl, {
			method: 'POST',
			credentials: 'same-origin',
			body: payload
		} ).catch( function () {
			/* UI state is already applied locally. */
		} );
	}

	function setCollapsed( collapsed ) {
		body.classList.toggle( 'jarchi-nav-collapsed', collapsed );

		var control = document.querySelector( '[data-jarchi-nav-collapse]' );
		if ( control ) {
			var label = collapsed
				? ( config.i18n && config.i18n.expand )
				: ( config.i18n && config.i18n.collapse );

			control.setAttribute( 'aria-expanded', collapsed ? 'false' : 'true' );
			if ( label ) {
				control.setAttribute( 'aria-label', label );
				control.setAttribute( 'title', label );
			}
		}

		remember( 'wpep_set_nav', { collapsed: collapsed ? '1' : '0' } );
	}

	function applyTheme( theme ) {
		if ( -1 === [ 'light', 'dark' ].indexOf( theme ) ) {
			return;
		}

		body.classList.toggle( 'jarchi-theme-light', 'light' === theme );
		body.classList.toggle( 'jarchi-theme-dark', 'dark' === theme );

		app.setAttribute( 'data-theme', theme );

		document.querySelectorAll( '[data-jarchi-theme]' ).forEach( function ( button ) {
			var active = button.getAttribute( 'data-jarchi-theme' ) === theme;
			button.classList.toggle( 'is-active', active );
			button.setAttribute( 'aria-pressed', active ? 'true' : 'false' );
		} );

		remember( 'wpep_set_theme', { theme: theme } );
	}

	document.addEventListener( 'click', function ( event ) {
		var target = event.target;
		if ( ! target || ! target.closest ) {
			return;
		}

		var collapse = target.closest( '[data-jarchi-nav-collapse]' );
		if ( collapse ) {
			event.preventDefault();
			setCollapsed( ! body.classList.contains( 'jarchi-nav-collapsed' ) );
			return;
		}

		var toggle = target.closest( '[data-jarchi-nav-toggle]' );
		if ( toggle ) {
			event.preventDefault();
			var group = toggle.closest( '.jarchi-nav__group' );
			if ( group ) {
				var open = group.classList.toggle( 'is-open' );
				toggle.setAttribute( 'aria-expanded', open ? 'true' : 'false' );
			}
			return;
		}

		var themeButton = target.closest( '[data-jarchi-theme]' );
		if ( themeButton ) {
			event.preventDefault();
			applyTheme( themeButton.getAttribute( 'data-jarchi-theme' ) );
		}
	} );

	/* Keyboard support for the only interactive shell state. */
	document.addEventListener( 'keydown', function ( event ) {
		if ( 'Escape' === event.key && document.activeElement && document.activeElement.matches( '[data-jarchi-nav-toggle]' ) ) {
			document.activeElement.blur();
		}
	} );
}() );
