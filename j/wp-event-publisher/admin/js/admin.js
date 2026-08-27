/**
 * Jarchi — admin behaviour.
 *
 * Vanilla JS only. Handles the AJAX tools (connection test, manual
 * dispatch, queue processing, sample payload, configuration validation),
 * log detail toggles and destructive action confirmations.
 *
 * No secret ever reaches this file: the API secret stays on the server,
 * and the only credential in the page is a single-use WordPress nonce.
 *
 * Depends on the `wpepAdmin` object injected via wp_localize_script():
 *   { ajaxUrl, nonce, i18n: {...} }
 */
( function () {
	'use strict';

	if ( typeof window.wpepAdmin === 'undefined' ) {
		return;
	}

	var config = window.wpepAdmin;

	/**
	 * Performs a plugin AJAX action.
	 *
	 * @param {string} action wp_ajax action name.
	 * @param {Object} data   Optional extra fields.
	 * @return {Promise<Object>} Parsed JSON response.
	 */
	function ajax( action, data ) {
		var body = new URLSearchParams();
		body.append( 'action', action );
		body.append( 'nonce', config.nonce );

		Object.keys( data || {} ).forEach( function ( key ) {
			body.append( key, data[ key ] );
		} );

		return fetch( config.ajaxUrl, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
			body: body.toString()
		} ).then( function ( response ) {
			return response.json();
		} );
	}

	/**
	 * Renders a result box.
	 *
	 * @param {HTMLElement} box     Target element.
	 * @param {boolean}     success Result state.
	 * @param {string}      message Main message.
	 * @param {Array}       errors  Optional list of detail strings.
	 * @param {Object}      meta    Optional endpoint/body details.
	 */
	function renderResult( box, success, message, errors, meta ) {
		box.hidden = false;
		box.classList.remove( 'wpep-result-success', 'wpep-result-error' );
		box.classList.add( success ? 'wpep-result-success' : 'wpep-result-error' );

		// Build content with DOM APIs — never innerHTML with server data.
		while ( box.firstChild ) {
			box.removeChild( box.firstChild );
		}

		var strong = document.createElement( 'strong' );
		strong.textContent = message;
		box.appendChild( strong );

		if ( Array.isArray( errors ) && errors.length > 0 ) {
			var list = document.createElement( 'ul' );
			errors.forEach( function ( error ) {
				var item = document.createElement( 'li' );
				item.textContent = String( error );
				list.appendChild( item );
			} );
			box.appendChild( list );
		}

		if ( meta && ( meta.endpoint || meta.body ) ) {
			var details = document.createElement( 'p' );
			var parts = [];

			if ( meta.endpoint ) {
				parts.push( meta.endpoint );
			}

			if ( meta.body ) {
				parts.push( meta.body );
			}

			details.className = 'wpep-result-meta';
			details.textContent = parts.join( ' — ' );
			box.appendChild( details );
		}
	}

	/**
	 * Wires a button to an AJAX action with busy-state handling.
	 *
	 * @param {string}      buttonId    Button element ID.
	 * @param {HTMLElement} resultBox   Result box element.
	 * @param {string}      action      wp_ajax action name.
	 * @param {string}      busyMessage Progress message.
	 * @param {Function}    collect     Optional callback returning extra fields, or false to abort.
	 */
	function bindAction( buttonId, resultBox, action, busyMessage, collect ) {
		var button = document.getElementById( buttonId );

		if ( ! button || ! resultBox ) {
			return;
		}

		button.addEventListener( 'click', function () {
			var extra = {};

			if ( typeof collect === 'function' ) {
				extra = collect();

				if ( false === extra ) {
					return;
				}
			}

			button.classList.add( 'wpep-busy' );
			button.disabled = true;
			renderResult( resultBox, true, busyMessage, [] );
			resultBox.classList.remove( 'wpep-result-success', 'wpep-result-error' );

			ajax( action, extra )
				.then( function ( json ) {
					var data = json.data || {};
					var message = data.message || ( json.success ? 'OK' : config.i18n.requestFailed );

					renderResult( resultBox, !! json.success, message, data.errors || [], data );
				} )
				.catch( function () {
					renderResult( resultBox, false, config.i18n.requestFailed, [] );
				} )
				.finally( function () {
					button.classList.remove( 'wpep-busy' );
					button.disabled = false;
				} );
		} );
	}

	/**
	 * Redraws the diagnostics table from a fresh result set.
	 *
	 * @param {Array} checks Check result objects.
	 */
	function repaintChecks( checks ) {
		var table = document.getElementById( 'wpep-diagnostics-table' );

		if ( ! table ) {
			return;
		}

		var body = table.querySelector( 'tbody' );

		while ( body.firstChild ) {
			body.removeChild( body.firstChild );
		}

		checks.forEach( function ( check ) {
			var row = document.createElement( 'tr' );

			var resultCell = document.createElement( 'td' );
			var badge = document.createElement( 'span' );
			badge.className = 'wpep-badge wpep-badge-' + String( check.status );
			badge.textContent = String( check.status );
			resultCell.appendChild( badge );

			var labelCell = document.createElement( 'td' );
			labelCell.textContent = String( check.label );

			var detailCell = document.createElement( 'td' );
			detailCell.textContent = String( check.detail );

			row.appendChild( resultCell );
			row.appendChild( labelCell );
			row.appendChild( detailCell );
			body.appendChild( row );
		} );
	}

	/** The inner-page sidebar uses the exact dashboard geometry; CSS owns placement. */
	function initGlobalSidebarPositioning() { return; }
	document.addEventListener( 'DOMContentLoaded', function () {
		initGlobalSidebarPositioning();
		/* Settings page: connection test below the form. */
		bindAction(
			'wpep-test-connection',
			document.getElementById( 'wpep-test-result' ),
			'wpep_test_connection',
			config.i18n.testing
		);

		/* Dashboard: quick connection test inside the status card. */
		var dashboardButton = document.getElementById( 'wpep-dashboard-test' );
		if ( dashboardButton ) {
			dashboardButton.addEventListener( 'click', function () {
				var statusBox = document.getElementById( 'wpep-connection-status' );
				dashboardButton.classList.add( 'wpep-busy' );

				ajax( 'wpep_test_connection', {} )
					.then( function ( json ) {
						var badge = statusBox.querySelector( '.wpep-badge' );
						badge.className = 'wpep-badge ' + ( json.success ? 'wpep-badge-success' : 'wpep-badge-failed' );
						badge.textContent = ( json.data && json.data.message ) || '';
					} )
					.catch( function () {
						var badge = statusBox.querySelector( '.wpep-badge' );
						badge.className = 'wpep-badge wpep-badge-failed';
						badge.textContent = config.i18n.requestFailed;
					} )
					.finally( function () {
						dashboardButton.classList.remove( 'wpep-busy' );
					} );
			} );
		}

		/* Tools page. */
		bindAction(
			'wpep-tools-test',
			document.getElementById( 'wpep-tools-test-result' ),
			'wpep_test_connection',
			config.i18n.testing
		);
		bindAction(
			'wpep-tools-sample',
			document.getElementById( 'wpep-tools-sample-result' ),
			'wpep_send_sample',
			config.i18n.sending
		);
		bindAction(
			'wpep-tools-validate',
			document.getElementById( 'wpep-tools-validate-result' ),
			'wpep_validate_config',
			config.i18n.validating
		);
		bindAction(
			'wpep-tools-queue',
			document.getElementById( 'wpep-tools-queue-result' ),
			'wpep_run_queue',
			config.i18n.processing
		);
		bindAction(
			'wpep-tools-dispatch',
			document.getElementById( 'wpep-tools-dispatch-result' ),
			'wpep_dispatch_post',
			config.i18n.dispatching,
			function () {
				var field = document.getElementById( 'wpep-dispatch-post-id' );
				var value = field ? parseInt( field.value, 10 ) : 0;

				if ( ! value || value < 1 ) {
					window.alert( config.i18n.missingPostId );
					return false;
				}

				return { post_id: value };
			}
		);

		/* Diagnostics page: re-run every check, including the network ones. */
		var diagnosticsButton = document.getElementById( 'wpep-run-diagnostics' );
		if ( diagnosticsButton ) {
			var diagnosticsBox = document.getElementById( 'wpep-diagnostics-result' );

			diagnosticsButton.addEventListener( 'click', function () {
				diagnosticsButton.classList.add( 'wpep-busy' );
				diagnosticsButton.disabled = true;
				renderResult( diagnosticsBox, true, config.i18n.diagnosing, [] );

				ajax( 'wpep_run_diagnostics', {} )
					.then( function ( json ) {
						var data = json.data || {};

						renderResult( diagnosticsBox, !! json.success, data.message || '', [] );

						if ( Array.isArray( data.checks ) ) {
							repaintChecks( data.checks );
						}
					} )
					.catch( function () {
						renderResult( diagnosticsBox, false, config.i18n.requestFailed, [] );
					} )
					.finally( function () {
						diagnosticsButton.classList.remove( 'wpep-busy' );
						diagnosticsButton.disabled = false;
					} );
			} );
		}

		/* Logs page: expandable payload/response details. */
		document.querySelectorAll( '.wpep-toggle-details' ).forEach( function ( toggle ) {
			toggle.addEventListener( 'click', function () {
				var detailsRow = toggle.closest( 'tr' ).nextElementSibling;

				if ( detailsRow && detailsRow.classList.contains( 'wpep-details-row' ) ) {
					detailsRow.hidden = ! detailsRow.hidden;
					toggle.setAttribute( 'aria-expanded', detailsRow.hidden ? 'false' : 'true' );
				}
			} );
		} );

		/* Destructive action confirmations. */
		document.querySelectorAll( 'form[data-wpep-confirm]' ).forEach( function ( form ) {
			form.addEventListener( 'submit', function ( event ) {
				var kind = form.getAttribute( 'data-wpep-confirm' );
				var message = 'clear' === kind ? config.i18n.confirmClear : config.i18n.confirmDelete;

				if ( ! window.confirm( message ) ) {
					event.preventDefault();
				}
			} );
		} );
	} );

	/* Admin ticket user picker: AJAX search by name, email or phone. */
	function initTicketUserPicker() {
		var picker = document.querySelector( '[data-ticket-user-picker]' );
		if ( ! picker ) { return; }
		var input = picker.querySelector( '.jarchi-ticket-user-search' );
		var hidden = picker.querySelector( '.jarchi-ticket-user-id' );
		var results = picker.querySelector( '.jarchi-ticket-user-results' );
		var selected = picker.querySelector( '.jarchi-ticket-selected-user' );
		var clear = picker.querySelector( '.jarchi-ticket-user-clear' );
		var timer = null;
		var controller = null;
		var endpoint = picker.getAttribute( 'data-ajax-url' ) || window.ajaxurl;
		var nonce = picker.getAttribute( 'data-nonce' ) || '';

		function escapeText( value ) {
			return String( value == null ? '' : value );
		}
		function clearResults() {
			results.hidden = true;
			results.innerHTML = '';
		}
		function selectUser( user ) {
			hidden.value = String( user.id || '' );
			input.value = user.name || '';
			input.readOnly = true;
			picker.classList.add( 'has-selected-user' );
			input.classList.add( 'jarchi-ticket-user-selected' );
			selected.hidden = false;
			selected.querySelector( 'strong' ).textContent = user.name || 'کاربر';
			selected.querySelector( '.jarchi-ticket-selected-user__phone' ).textContent = user.phone ? '📱 ' + user.phone : '';
			selected.querySelector( '.jarchi-ticket-selected-user__email' ).textContent = user.email ? '✉ ' + user.email : '';
			clearResults();
		}
		clear.addEventListener( 'click', function () {
			hidden.value = '';
			picker.classList.remove( 'has-selected-user' );
			input.readOnly = false;
			input.value = '';
			input.classList.remove( 'jarchi-ticket-user-selected' );
			selected.hidden = true;
			input.focus();
		} );
		input.addEventListener( 'input', function () {
			var q = input.value.trim();
			hidden.value = '';
			picker.classList.remove( 'has-selected-user' );
			selected.hidden = true;
			input.classList.remove( 'jarchi-ticket-user-selected' );
			clearTimeout( timer );
			if ( q.length < 2 ) { clearResults(); return; }
			timer = setTimeout( function () {
				if ( controller ) { controller.abort(); }
				controller = window.AbortController ? new AbortController() : null;
				var body = new URLSearchParams();
				body.append( 'action', 'wpep_ticket_user_search' );
				body.append( 'nonce', nonce );
				body.append( 'q', q );
				fetch( endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: body.toString(), signal: controller ? controller.signal : undefined } )
					.then( function ( response ) { return response.json(); } )
					.then( function (json) {
						results.innerHTML = '';
						var users = json && json.success && json.data && Array.isArray( json.data.users ) ? json.data.users : [];
						if ( ! users.length ) {
							var empty = document.createElement( 'div' ); empty.className = 'jarchi-ticket-user-result'; empty.textContent = 'کاربری پیدا نشد'; results.appendChild( empty ); results.hidden = false; return;
						}
						users.forEach( function (user) {
							var button = document.createElement( 'button' ); button.type = 'button'; button.className = 'jarchi-ticket-user-result';
							var avatar = document.createElement( 'span' ); avatar.className = 'jarchi-ticket-user-result__avatar dashicons dashicons-admin-users';
							var meta = document.createElement( 'span' ); meta.className = 'jarchi-ticket-user-result__meta';
							var strong = document.createElement( 'strong' ); strong.textContent = escapeText( user.name );
							var small = document.createElement( 'span' ); small.textContent = [ user.phone, user.email ].filter( Boolean ).join( ' · ' );
							meta.appendChild( strong ); meta.appendChild( small ); button.appendChild( avatar ); button.appendChild( meta );
							button.addEventListener( 'click', function () { selectUser( user ); } );
							results.appendChild( button );
						} );
						results.hidden = false;
					} )
					.catch( function (error) { if ( error && error.name === 'AbortError' ) { return; } clearResults(); } );
			}, 220 );
		} );
		document.addEventListener( 'click', function (event) { if ( ! picker.contains( event.target ) ) { clearResults(); } } );
	}

	/*
	 * Choosing "everybody" hides the recipient picker and, more importantly,
	 * releases its `required` attribute. A hidden input that is still required
	 * makes the browser refuse to submit while pointing at a field nobody can
	 * see, which looks exactly like a broken button.
	 */
	function initTicketAudience() {
		var audience = document.querySelector( '[data-ticket-audience]' );
		var picker = document.querySelector( '[data-ticket-user-picker]' );

		if ( ! audience || ! picker ) { return; }

		var hidden = picker.querySelector( '.jarchi-ticket-user-id' );

		function apply() {
			var choice = audience.querySelector( 'input[name="audience"]:checked' );
			var toAll = !! choice && 'all' === choice.value;

			picker.hidden = toAll;

			if ( hidden ) {
				if ( toAll ) {
					hidden.removeAttribute( 'required' );
				} else {
					hidden.setAttribute( 'required', 'required' );
				}
			}
		}

		audience.addEventListener( 'change', apply );
		apply();
	}

	/*
	 * The automation rule form.
	 *
	 * A rule needs only a few of its fields at a time: an order status means
	 * nothing for "user registered", and a hook name means nothing except for a
	 * custom event. Showing every field at once, each with the same unlabelled
	 * text box beside it, is most of why the screen read as impenetrable — so
	 * each block declares which events it belongs to and the rest stay away.
	 *
	 * The condition value is the same idea one level down: the administrator
	 * picks a role from a list or types a number into a number box, and the
	 * single field the server reads is kept in step behind the scenes.
	 */
	function initAutomationForm() {
		var form = document.querySelector( '[data-jarchi-rule-form]' );
		if ( ! form ) { return; }

		var trigger = form.querySelector( '[data-jarchi-trigger]' );
		var condition = form.querySelector( '[data-jarchi-condition]' );
		var triggerHint = form.querySelector( '[data-jarchi-trigger-hint]' );
		var conditionHint = form.querySelector( '[data-jarchi-condition-hint]' );
		var scanWarning = form.querySelector( '[data-jarchi-scan-warning]' );
		var target = form.querySelector( '[data-jarchi-condition-value]' );
		var triggerBlocks = form.querySelectorAll( '[data-when-trigger]' );
		var valueBlocks = form.querySelectorAll( '[data-when-value]' );

		if ( ! trigger || ! condition || ! target ) { return; }

		function selected( select ) {
			return select.options[ select.selectedIndex ] || null;
		}

		function applyTrigger() {
			var current = trigger.value;
			var option = selected( trigger );

			triggerBlocks.forEach( function ( block ) {
				var wanted = ( block.getAttribute( 'data-when-trigger' ) || '' ).split( /\s+/ );
				block.hidden = -1 === wanted.indexOf( current );
			} );

			if ( triggerHint ) {
				triggerHint.textContent = ( option && option.getAttribute( 'data-hint' ) ) || '';
			}

			if ( scanWarning ) {
				scanWarning.hidden = ! option || 'scan' !== option.getAttribute( 'data-scope' );
			}
		}

		function applyCondition() {
			var option = selected( condition );
			var type = ( option && option.getAttribute( 'data-value-type' ) ) || 'none';

			valueBlocks.forEach( function ( block ) {
				block.hidden = block.getAttribute( 'data-when-value' ) !== type;
			} );

			if ( conditionHint ) {
				conditionHint.textContent = ( option && option.getAttribute( 'data-hint' ) ) || '';
			}

			syncValue();
		}

		function syncValue() {
			var option = selected( condition );
			var type = ( option && option.getAttribute( 'data-value-type' ) ) || 'none';
			var source = null;

			if ( 'role' === type ) {
				source = form.querySelector( '[name="condition_value_role"]' );
			} else if ( 'number' === type ) {
				source = form.querySelector( '[name="condition_value_number"]' );
			} else if ( 'text' === type ) {
				source = form.querySelector( '[name="condition_value_text"]' );
			} else if ( 'meta' === type ) {
				source = form.querySelector( '[name="condition_value_meta"]' );
			}

			target.value = source ? source.value : '';
		}

		trigger.addEventListener( 'change', applyTrigger );
		condition.addEventListener( 'change', applyCondition );
		form.addEventListener( 'input', syncValue );
		form.addEventListener( 'change', syncValue );

		// The hidden field must be right at submit time even if the browser
		// restored values without firing an input event.
		form.addEventListener( 'submit', syncValue );

		applyTrigger();
		applyCondition();
	}

	document.addEventListener( 'DOMContentLoaded', initTicketUserPicker );
	document.addEventListener( 'DOMContentLoaded', initTicketAudience );
	document.addEventListener( 'DOMContentLoaded', initAutomationForm );

}() );
