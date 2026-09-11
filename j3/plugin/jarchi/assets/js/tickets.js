/**
 * Jarchi — ticket centre behaviour.
 *
 * Two jobs: keep the unread badge honest, and make the ticket centre usable on
 * a phone. Both are deliberately small; there is no framework here.
 */
( function () {
	'use strict';

	if ( typeof window === 'undefined' ) {
		return;
	}

	// FAQ/form navigation is core UI and must keep working even when a cache,
	// optimizer or Elementor preview omits the localized AJAX object. Only the
	// unread polling depends on wpepTickets.

	var cfg = window.wpepTickets || null;

	function humanBytes( bytes ) {
		bytes = parseInt( bytes, 10 ) || 0;
		if ( bytes >= 1024 * 1024 ) {
			return Math.max( 1, Math.floor( bytes / ( 1024 * 1024 ) ) ) + ' MB';
		}
		return Math.max( 1, Math.floor( bytes / 1024 ) ) + ' KB';
	}

	function attachmentError( input, message ) {
		var host = input && input.closest ? input.closest( '[data-jarchi-upload]' ) : null;
		var box = host ? host.querySelector( '[data-jarchi-upload-error]' ) : null;
		if ( box ) {
			box.textContent = message || '';
			box.hidden = ! message;
		}
		if ( input && input.setCustomValidity ) {
			input.setCustomValidity( message || '' );
		}
	}

	function validateAttachments( input ) {
		if ( ! input ) {
			return true;
		}
		var files = Array.prototype.slice.call( input.files || [] );
		var maxFiles = parseInt( input.getAttribute( 'data-max-files' ), 10 ) || 5;
		var maxBytes = parseInt( input.getAttribute( 'data-max-bytes' ), 10 ) || 0;
		var maxTotal = parseInt( input.getAttribute( 'data-max-total' ), 10 ) || 0;
		var total = files.reduce( function ( sum, file ) { return sum + ( file.size || 0 ); }, 0 );
		var message = '';

		if ( files.length > maxFiles ) {
			message = 'حداکثر ' + maxFiles + ' فایل می‌توانید اضافه کنید.';
		} else if ( maxBytes ) {
			var tooLarge = files.find( function ( file ) { return ( file.size || 0 ) > maxBytes; } );
			if ( tooLarge ) {
				message = 'حجم «' + tooLarge.name + '» بیشتر از ' + humanBytes( maxBytes ) + ' است.';
			}
		}
		if ( ! message && maxTotal && total > maxTotal ) {
			message = 'حجم مجموع فایل‌ها بیشتر از ظرفیت ارسال سرور (' + humanBytes( maxTotal ) + ') است.';
		}

		attachmentError( input, message );
		return ! message;
	}

	function renderAttachmentPreview( input ) {
		var host = input && input.closest ? input.closest( '[data-jarchi-upload]' ) : null;
		var preview = host ? host.querySelector( '[data-jarchi-upload-preview]' ) : null;
		if ( ! preview ) {
			return;
		}

		preview.innerHTML = '';
		var files = Array.prototype.slice.call( input.files || [] );
		preview.hidden = ! files.length;

		files.forEach( function ( file ) {
			var item = document.createElement( 'div' );
			item.className = 'jarchi-ticket-upload__item';
			var media;
			if ( file.type && 0 === file.type.indexOf( 'image/' ) ) {
				media = document.createElement( 'img' );
				media.alt = '';
				media.loading = 'lazy';
				try {
					var objectUrl = URL.createObjectURL( file );
					media.src = objectUrl;
					media.addEventListener( 'load', function () { try { URL.revokeObjectURL( objectUrl ); } catch ( err ) {} }, { once: true } );
				} catch ( err ) {}
			} else {
				media = document.createElement( 'span' );
				media.className = 'jarchi-ticket-upload__file-icon';
				media.textContent = file.type === 'application/pdf' ? 'PDF' : ( file.type && 0 === file.type.indexOf( 'audio/' ) ? '♫' : '📎' );
			}
			item.appendChild( media );
			var meta = document.createElement( 'span' );
			meta.className = 'jarchi-ticket-upload__name';
			meta.textContent = file.name;
			item.appendChild( meta );
			preview.appendChild( item );
		} );
	}

	function refreshFormNonce( form ) {
		if ( ! cfg || ! cfg.ajaxUrl ) {
			return Promise.resolve( false );
		}
		var data = new FormData();
		data.append( 'action', 'wpep_ticket_fresh_nonce' );
		return fetch( cfg.ajaxUrl, { method: 'POST', credentials: 'same-origin', body: data, cache: 'no-store' } )
			.then( function ( response ) { return response.json(); } )
			.then( function ( result ) {
				var nonce = result && result.success && result.data ? result.data.nonce : '';
				var field = form.querySelector( 'input[name="_wpnonce"]' );
				if ( ! nonce || ! field ) {
					throw new Error( 'nonce_unavailable' );
				}
				field.value = nonce;
				return true;
			} );
	}

	/* Ten seconds while the tab is in front, as asked. Nothing at all while it
	 * is in the background: a hidden tab polling forever is how a support
	 * widget turns into the reason somebody's laptop fan is running. */
	var ACTIVE_INTERVAL = 10000;

	var timer = null;
	var inFlight = false;
	var failures = 0;

	function paint( count ) {
		count = parseInt( count, 10 ) || 0;

		// Pure ticket badges: launcher icon, menu item and any other unread badge.
		document.querySelectorAll( '[data-jarchi-ticket-badge]' ).forEach( function ( el ) {
			el.textContent = count > 99 ? '99+' : String( count );
			el.classList.toggle( 'is-visible', count > 0 );
			el.hidden = 0 === count;
		} );

		// Visible numeric ticket counters (for example Customer Hub stats) keep
		// showing zero, but always use the exact same unread source.
		document.querySelectorAll( '[data-jarchi-ticket-count]' ).forEach( function ( el ) {
			el.textContent = count > 99 ? '99+' : String( count );
		} );

		document.querySelectorAll( '[data-jarchi-ticket-unread]' ).forEach( function ( el ) {
			el.textContent = String( count );
			el.classList.toggle( 'is-visible', count > 0 );
		} );


		try {
			document.dispatchEvent( new CustomEvent( 'jarchi:ticket-unread', { detail: { count: count } } ) );
		} catch ( err ) {}
	}

	function clearRowUnread( ticketId ) {
		if ( ! ticketId ) {
			return false;
		}

		var wasUnread = false;
		document.querySelectorAll( '[data-jarchi-ticket-row][data-ticket-id="' + String( ticketId ).replace( /"/g, '' ) + '"]' ).forEach( function ( row ) {
			wasUnread = wasUnread || row.classList.contains( 'has-unread' ) || !! row.querySelector( '.jarchi-ticket-dot' );
			row.classList.remove( 'has-unread' );
			row.querySelectorAll( '.jarchi-ticket-dot' ).forEach( function ( dot ) { dot.remove(); } );
		} );

		return wasUnread;
	}

	function optimisticDecrement() {
		var source = document.querySelector( '[data-jarchi-ticket-badge], [data-jarchi-ticket-unread], [data-jarchi-ticket-count]' );
		if ( ! source ) {
			return;
		}

		var raw = String( source.textContent || '' ).trim();
		if ( ! /^\d+$/.test( raw ) ) {
			return;
		}

		paint( Math.max( 0, ( parseInt( raw, 10 ) || 0 ) - 1 ) );
	}

	function markRead( ticketId ) {
		ticketId = parseInt( ticketId, 10 ) || 0;
		if ( ! ticketId ) {
			return Promise.resolve();
		}

		// Remove the visual marker immediately. The server request below is the
		// authority and returns the exact remaining unread count. This also fixes
		// stale HTML served by page caches such as WP Rocket.
		if ( clearRowUnread( ticketId ) ) {
			optimisticDecrement();
		}

		if ( ! cfg || ! cfg.ajaxUrl || ! cfg.nonce ) {
			return Promise.resolve();
		}

		var data = new FormData();
		data.append( 'action', 'wpep_ticket_read' );
		data.append( 'nonce', cfg.nonce );
		data.append( 'ticket', String( ticketId ) );

		return fetch( cfg.ajaxUrl, { method: 'POST', credentials: 'same-origin', body: data, keepalive: true } )
			.then( function ( r ) { return r.json(); } )
			.then( function ( res ) {
				if ( res && res.success && res.data ) {
					paint( res.data.count );
				}
			} )
			.catch( function () {
				// The normal poll will recover the exact state; never restore a dot
				// just because the browser navigated before this request completed.
			} );
	}

	function poll() {
		if ( ! cfg || ! cfg.ajaxUrl || ! cfg.nonce ) {
			return;
		}

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
		if ( ! cfg ) {
			return;
		}

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


	/* Cached Elementor/WP Rocket markup can carry an expired WordPress nonce.
	 * Refresh it immediately before every customer write, then submit the same
	 * form normally so all existing PHP validation and redirect behaviour stays
	 * intact. */
	document.addEventListener( 'submit', function ( e ) {
		var form = e.target;
		if ( ! form || ! form.matches || ! form.matches( '[data-jarchi-ticket-submit-form], .jarchi-ticket-reply-form, .jarchi-ticket-rating' ) ) {
			return;
		}

		var attachment = form.querySelector( '[data-jarchi-attachment-input]' );
		if ( attachment && ! validateAttachments( attachment ) ) {
			e.preventDefault();
			try { attachment.reportValidity(); } catch ( err ) {}
			return;
		}

		if ( form.getAttribute( 'data-jarchi-nonce-ready' ) === '1' || ! cfg || ! cfg.ajaxUrl ) {
			return;
		}

		e.preventDefault();
		if ( form.getAttribute( 'data-jarchi-nonce-loading' ) === '1' ) {
			return;
		}
		form.setAttribute( 'data-jarchi-nonce-loading', '1' );
		var submit = form.querySelector( 'button[type="submit"], input[type="submit"]' );
		if ( submit ) {
			submit.disabled = true;
			submit.classList.add( 'is-loading' );
		}

		refreshFormNonce( form ).then( function () {
			form.setAttribute( 'data-jarchi-nonce-ready', '1' );
			HTMLFormElement.prototype.submit.call( form );
		} ).catch( function () {
			var box = form.querySelector( '[data-jarchi-upload-error]' );
			if ( ! box ) {
				box = document.createElement( 'div' );
				box.className = 'jarchi-ticket-upload__error';
				box.setAttribute( 'role', 'alert' );
				form.appendChild( box );
			}
			box.textContent = 'نشست صفحه منقضی شده است. اتصال را بررسی کنید و دوباره روی ارسال بزنید.';
			box.hidden = false;
			form.removeAttribute( 'data-jarchi-nonce-loading' );
			if ( submit ) {
				submit.disabled = false;
				submit.classList.remove( 'is-loading' );
			}
		} );
	}, true );

	document.addEventListener( 'change', function ( e ) {
		var input = e.target;
		if ( ! input || ! input.matches || ! input.matches( '[data-jarchi-attachment-input]' ) ) {
			return;
		}
		validateAttachments( input );
		renderAttachmentPreview( input );
	} );

	document.addEventListener( 'visibilitychange', function () {
		if ( ! document.hidden ) {
			poll();
		}

		schedule();
	} );

	/* Labels drive the three single-page states without JavaScript. Make their
	 * button semantics complete for keyboard users as well: Enter/Space clicks
	 * the associated radio just like a pointer click. */
	document.addEventListener( 'keydown', function ( e ) {
		var label = e.target && e.target.closest ? e.target.closest( '[data-jarchi-flow-label]' ) : null;
		if ( ! label || ( 'Enter' !== e.key && ' ' !== e.key ) ) {
			return;
		}
		e.preventDefault();
		label.click();
	} );

	/* A ticket becomes read when the customer actually opens it. Do this on the
	 * client as well as on the PHP render path so cached Elementor/JetEngine
	 * pages cannot leave a stale red dot or launcher badge behind. */
	document.addEventListener( 'click', function ( e ) {
		var row = e.target && e.target.closest ? e.target.closest( '[data-jarchi-ticket-row]' ) : null;
		if ( ! row || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) {
			return;
		}

		var ticketId = row.getAttribute( 'data-ticket-id' );
		if ( ticketId ) {
			markRead( ticketId );
		}
	}, true );

	/* The new-ticket CTA keeps a real href for no-JS fallback. Some themes and
	 * page builders install global AJAX-link handlers, though, and can swallow
	 * this navigation. Capture the click before those handlers and perform the
	 * same normal navigation ourselves. Modified clicks still behave natively. */
	document.addEventListener( 'click', function ( e ) {
		var btn = e.target && e.target.closest ? e.target.closest( '[data-jarchi-ticket-new]' ) : null;

		if ( ! btn || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) {
			return;
		}

		var href = btn.getAttribute( 'href' );
		if ( ! href ) {
			return;
		}

		e.preventDefault();
		e.stopPropagation();
		window.location.assign( href );
	}, true );

	/* FAQ-first creation flow: the form appears only after the customer says
	 * the knowledge base did not solve the problem. */
	document.addEventListener( 'click', function ( e ) {
		var btn = e.target.closest ? e.target.closest( '[data-jarchi-show-ticket-form]' ) : null;

		if ( ! btn ) {
			return;
		}

		var scope = btn.closest ? btn.closest( '.jarchi-ticket-center' ) : null;
		var form = scope ? scope.querySelector( '[data-jarchi-ticket-form]' ) : document.querySelector( '[data-jarchi-ticket-form]' );

		// Do not cancel the link until we know the inline form exists. If Elementor
		// or an optimizer produced a partial DOM, the real href remains a working
		// server-side fallback (?jarchi_form=1).
		if ( ! form ) {
			return;
		}

		e.preventDefault();
		form.hidden = false;
		form.classList.add( 'is-visible' );

		window.setTimeout( function () {
			form.scrollIntoView( { behavior: 'smooth', block: 'start' } );
			var field = form.querySelector( 'input[name="title"]' );
			if ( field ) {
				try { field.focus( { preventScroll: true } ); } catch ( err ) { field.focus(); }
			}
		}, 30 );
	} );

	document.addEventListener( 'DOMContentLoaded', function () {
		var openCenter = document.querySelector( '[data-jarchi-open-ticket]' );
		var openTicket = openCenter ? openCenter.getAttribute( 'data-jarchi-open-ticket' ) : '';
		if ( openTicket ) {
			markRead( openTicket ).finally( function () { poll(); } );
		} else {
			poll();
		}
		schedule();

		var createdNotice = document.querySelector( '[data-jarchi-ticket-created-notice]' );
		if ( createdNotice ) {
			// Keep refreshes clean: the confirmation belongs to this POST/redirect cycle,
			// not to every future visit to the inbox.
			try {
				var cleanUrl = new URL( window.location.href );
				cleanUrl.searchParams.delete( 'jarchi_ticket_created' );
				cleanUrl.searchParams.delete( 'jarchi_refresh' );
				window.history.replaceState( {}, document.title, cleanUrl.toString() );
			} catch ( err ) {}

			window.setTimeout( function () {
				createdNotice.classList.add( 'is-leaving' );
				window.setTimeout( function () {
					if ( createdNotice && createdNotice.parentNode ) {
						createdNotice.parentNode.removeChild( createdNotice );
					}
				}, 260 );
			}, 4500 );
		}
	} );
}() );

/* Ticket inbox filters are intentionally local. All rows are already in the
 * page, so changing status/search must not reload WordPress or lose scroll
 * position. Real hrefs remain as no-JS fallbacks. */
( function () {
	'use strict';

	function currentFilter( center ) {
		var active = center.querySelector( '[data-jarchi-ticket-filter].is-active' );
		return active ? ( active.getAttribute( 'data-jarchi-ticket-filter' ) || 'all' ) : ( center.getAttribute( 'data-initial-ticket-filter' ) || 'all' );
	}

	function applyInboxFilters( center ) {
		if ( ! center ) {
			return;
		}

		var search = center.querySelector( '[data-jarchi-ticket-list-search]' );
		var q = search ? String( search.value || '' ).toLowerCase().trim() : '';
		var filter = currentFilter( center );
		var visible = 0;

		center.querySelectorAll( '[data-jarchi-ticket-row]' ).forEach( function ( row ) {
			var text = String( row.getAttribute( 'data-search' ) || row.textContent || '' ).toLowerCase();
			var status = row.getAttribute( 'data-ticket-status' ) || '';
			var matchesStatus = 'all' === filter || status === filter;
			var matchesSearch = ! q || -1 !== text.indexOf( q );
			var show = matchesStatus && matchesSearch;
			row.hidden = ! show;
			if ( show ) {
				visible += 1;
			}
		} );

		var empty = center.querySelector( '[data-jarchi-ticket-filter-empty]' );
		if ( empty ) {
			empty.hidden = visible > 0;
		}
	}

	document.addEventListener( 'click', function ( e ) {
		var filter = e.target && e.target.closest ? e.target.closest( '[data-jarchi-ticket-filter]' ) : null;
		if ( ! filter || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ) {
			return;
		}

		var center = filter.closest( '.jarchi-ticket-center' );
		if ( ! center ) {
			return;
		}

		e.preventDefault();
		center.querySelectorAll( '[data-jarchi-ticket-filter]' ).forEach( function ( item ) {
			var active = item === filter;
			item.classList.toggle( 'is-active', active );
			item.setAttribute( 'aria-current', active ? 'page' : 'false' );
		} );
		center.setAttribute( 'data-initial-ticket-filter', filter.getAttribute( 'data-jarchi-ticket-filter' ) || 'all' );
		applyInboxFilters( center );

		// Keep reload/copy-link behaviour meaningful without actually navigating.
		try {
			var url = new URL( window.location.href );
			var value = filter.getAttribute( 'data-jarchi-ticket-filter' ) || 'all';
			if ( 'all' === value ) {
				url.searchParams.delete( 'ticket_status' );
			} else {
				url.searchParams.set( 'ticket_status', value );
			}
			url.searchParams.delete( 'jarchi_ticket' );
			window.history.replaceState( {}, document.title, url.toString() );
		} catch ( err ) {}
	} );

	document.addEventListener( 'input', function ( e ) {
		if ( ! e.target || ! e.target.matches || ! e.target.matches( '[data-jarchi-ticket-list-search]' ) ) {
			return;
		}
		applyInboxFilters( e.target.closest( '.jarchi-ticket-center' ) );
	} );

	function init() {
		document.querySelectorAll( '.jarchi-ticket-center' ).forEach( applyInboxFilters );

		var replyNotice = document.querySelector( '[data-jarchi-reply-sent]' );
		var replyError = document.querySelector( '[data-jarchi-reply-error]' );
		if ( replyNotice || replyError ) {
			try {
				var clean = new URL( window.location.href );
				clean.searchParams.delete( 'jarchi_reply_sent' );
				clean.searchParams.delete( 'jarchi_reply_error' );
				clean.searchParams.delete( 'jarchi_refresh' );
				window.history.replaceState( {}, document.title, clean.toString() );
			} catch ( err ) {}
		}
	}

	if ( 'loading' === document.readyState ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
}() );

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
