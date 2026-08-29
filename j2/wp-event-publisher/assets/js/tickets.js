/**
 * Jarchi — ticket centre behaviour.
 *
 * Two jobs: keep the unread badge honest, and make the ticket centre usable on
 * a phone. Both are deliberately small; there is no framework here.
 */
( function () {
	'use strict';

	if ( typeof window === 'undefined' || ! window.wpepTickets ) {
		return;
	}

	var cfg = window.wpepTickets;

	/* Ten seconds while the tab is in front, as asked. Nothing at all while it
	 * is in the background: a hidden tab polling forever is how a support
	 * widget turns into the reason somebody's laptop fan is running. */
	var ACTIVE_INTERVAL = 10000;

	var timer = null;
	var inFlight = false;
	var failures = 0;

	function paint( count ) {
		count = parseInt( count, 10 ) || 0;

		document.querySelectorAll( '[data-jarchi-ticket-badge]' ).forEach( function ( el ) {
			el.textContent = count > 99 ? '99+' : String( count );
			el.classList.toggle( 'is-visible', count > 0 );
			el.hidden = 0 === count;
		} );

		document.querySelectorAll( '[data-jarchi-ticket-unread]' ).forEach( function ( el ) {
			el.textContent = String( count );
			el.classList.toggle( 'is-visible', count > 0 );
		} );
	}

	function poll() {
		// One request at a time. A slow reply must not queue up behind itself
		// and arrive as a burst when the connection recovers.
		if ( inFlight || document.hidden ) {
			return;
		}

		inFlight = true;

		var data = new FormData();
		data.append( 'action', 'wpep_ticket_unread' );
		data.append( 'nonce', cfg.nonce );

		fetch( cfg.ajaxUrl, { method: 'POST', credentials: 'same-origin', body: data } )
			.then( function ( r ) {
				return r.json();
			} )
			.then( function ( res ) {
				failures = 0;

				if ( res && res.success && res.data ) {
					paint( res.data.count );
				}
			} )
			.catch( function () {
				// Back off rather than hammering an endpoint that is failing.
				failures = Math.min( failures + 1, 5 );
			} )
			.finally( function () {
				inFlight = false;
			} );
	}

	function schedule() {
		if ( timer ) {
			window.clearInterval( timer );
			timer = null;
		}

		if ( document.hidden ) {
			return;
		}

		timer = window.setInterval( function () {
			// Skip cycles after a failure instead of stopping for good, so the
			// badge recovers on its own when the network does.
			if ( failures > 0 && 0 !== Math.floor( Date.now() / ACTIVE_INTERVAL ) % ( failures + 1 ) ) {
				return;
			}

			poll();
		}, ACTIVE_INTERVAL );
	}

	document.addEventListener( 'visibilitychange', function () {
		if ( ! document.hidden ) {
			poll();
		}

		schedule();
	} );

	/* Jump to the new-ticket form from anywhere, including the locked-thread
	 * notice where it is the only thing left to do. */
	document.addEventListener( 'click', function ( e ) {
		var btn = e.target.closest ? e.target.closest( '[data-jarchi-ticket-new]' ) : null;

		if ( ! btn ) {
			return;
		}

		e.preventDefault();

		var form = document.querySelector( '.jarchi-ticket-form-card' );

		if ( form ) {
			form.scrollIntoView( { behavior: 'smooth', block: 'start' } );

			var field = form.querySelector( 'input[name="subject"], textarea' );

			if ( field ) {
				field.focus( { preventScroll: true } );
			}

			return;
		}

		// No form on this view — the thread is open. Go back to the list,
		// which is where the form lives.
		var back = document.querySelector( '.jarchi-ticket-back-link' );

		if ( back ) {
			window.location.href = back.href;
		}
	} );

	document.addEventListener( 'DOMContentLoaded', function () {
		poll();
		schedule();
	} );
}() );

/* FAQ search on the pre-submission help panel. */
document.addEventListener( 'input', function ( e ) {
	if ( ! e.target || ! e.target.matches || ! e.target.matches( '[data-jarchi-faq-search]' ) ) {
		return;
	}

	var q = ( e.target.value || '' ).toLowerCase().trim();
	var box = e.target.closest( '[data-jarchi-faq]' );

	if ( ! box ) {
		return;
	}

	box.querySelectorAll( '[data-jarchi-faq-item]' ).forEach( function ( item ) {
		var text = ( item.getAttribute( 'data-search' ) || item.textContent || '' ).toLowerCase();
		item.hidden = !! q && -1 === text.indexOf( q );
	} );
} );

/*
 * Ticket cleanup: ask the server for one batch at a time.
 *
 * Deleting ten thousand tickets cannot happen in one request — PHP's time
 * limit ends it partway through with no record of how far it got. The server
 * deletes a hundred and reports progress; this asks again until it says it
 * has finished.
 */
( function () {
	'use strict';

	var box = document.querySelector( '[data-jarchi-cleanup]' );

	if ( ! box ) {
		return;
	}

	var status = box.querySelector( '[data-jarchi-cleanup-status]' );
	var url = box.getAttribute( 'data-ajax-url' );
	var nonce = box.getAttribute( 'data-nonce' );
	var stopped = false;

	function step() {
		if ( stopped ) {
			return;
		}

		var data = new FormData();
		data.append( 'action', 'wpep_ticket_cleanup_step' );
		data.append( 'nonce', nonce );

		fetch( url, { method: 'POST', credentials: 'same-origin', body: data } )
			.then( function ( r ) { return r.json(); } )
			.then( function ( res ) {
				if ( ! res || ! res.success || ! res.data ) {
					stopped = true;
					return;
				}

				var d = res.data;

				if ( status ) {
					status.textContent = d.running
						? d.deleted + ' / ' + d.total
						: d.deleted + ' — پایان';
				}

				if ( d.running ) {
					// A short pause between batches, so a big cleanup does not
					// monopolise the server the customer site is running on.
					window.setTimeout( step, 400 );
				} else {
					window.setTimeout( function () { window.location.reload(); }, 1200 );
				}
			} )
			.catch( function () {
				stopped = true;

				if ( status ) {
					status.textContent = 'ارتباط قطع شد. صفحه را دوباره باز کنید تا ادامه پیدا کند.';
				}
			} );
	}

	document.addEventListener( 'DOMContentLoaded', step );

	if ( 'loading' !== document.readyState ) {
		step();
	}
}() );
