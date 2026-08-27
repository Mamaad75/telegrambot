/**
 * Jarchi announcement builder.
 *
 * Four jobs: reveal only the placement settings that apply, keep the preview
 * in step with what is typed, let conditions be added and removed, and warn
 * before unsaved work is thrown away.
 *
 * The form works without any of this — every field is a real input inside a
 * real form that posts to admin-post.php — so a failure here degrades to a
 * page that saves correctly but shows every placement option at once.
 *
 * @package WPEventPublisher
 * @since 1.7.1
 */
( function () {
	'use strict';

	var form = document.querySelector( '[data-wpep-builder]' );

	if ( ! form ) {
		return;
	}

	var config = window.wpepBuilder || {};
	var dirty = false;

	/* --- Placement-conditional settings --------------------------------- */

	var placement = form.querySelector( '[data-wpep-placement]' );
	var options = form.querySelectorAll( '[data-wpep-option-for]' );
	var noOptions = form.querySelector( '[data-wpep-no-options]' );

	/**
	 * Shows the settings the chosen placement uses, and hides the rest.
	 *
	 * Hidden rather than removed: a value already stored for an option that
	 * this placement does not use must still be submitted, or switching
	 * placement twice would quietly erase settings the user never touched.
	 *
	 * @return {void}
	 */
	function syncOptions() {
		if ( ! placement ) {
			return;
		}

		var current = placement.value;
		var shown = 0;

		options.forEach( function ( field ) {
			var applies = ( field.getAttribute( 'data-wpep-option-for' ) || '' )
				.split( ' ' )
				.indexOf( current ) !== -1;

			field.hidden = ! applies;

			if ( applies ) {
				shown += 1;
			}
		} );

		if ( noOptions ) {
			noOptions.hidden = shown > 0;
		}
	}

	if ( placement ) {
		placement.addEventListener( 'change', function () {
			syncOptions();
			schedulePreview();
		} );
	}

	syncOptions();

	/* --- Conditions ----------------------------------------------------- */

	var rules = form.querySelector( '[data-wpep-rules]' );
	var rulesEmpty = form.querySelector( '[data-wpep-rules-empty]' );
	var ruleTemplate = form.querySelector( '[data-wpep-rule-template]' );

	/**
	 * Renumbers every rule row.
	 *
	 * The names carry the index, so removing the first of three rules would
	 * otherwise leave a gap that PHP reads as a differently shaped array.
	 *
	 * @return {void}
	 */
	function renumber() {
		if ( ! rules ) {
			return;
		}

		var rows = rules.querySelectorAll( '[data-wpep-rule]' );

		rows.forEach( function ( row, index ) {
			[ 'subject', 'operator', 'value' ].forEach( function ( part ) {
				var field = row.querySelector( '[name$="[' + part + ']"], [data-name="' + part + '"]' );

				if ( field ) {
					field.name = 'wpep_conditions[rules][' + index + '][' + part + ']';
					field.removeAttribute( 'data-name' );
				}
			} );
		} );

		if ( rulesEmpty ) {
			rulesEmpty.hidden = rows.length > 0;
		}
	}

	form.addEventListener( 'click', function ( event ) {
		if ( event.target.closest( '[data-wpep-rule-add]' ) ) {
			event.preventDefault();

			if ( ! rules || ! ruleTemplate ) {
				return;
			}

			rules.appendChild( ruleTemplate.content.cloneNode( true ) );
			renumber();
			markDirty();

			return;
		}

		var remove = event.target.closest( '[data-wpep-rule-remove]' );

		if ( remove ) {
			event.preventDefault();

			var row = remove.closest( '[data-wpep-rule]' );

			if ( row ) {
				row.remove();
				renumber();
				markDirty();
			}
		}
	} );

	renumber();

	/* --- Media ---------------------------------------------------------- */

	var media = form.querySelector( '[data-wpep-media]' );

	if ( media && window.wp && window.wp.media ) {
		var frame = null;
		var idField = media.querySelector( '[data-wpep-media-id]' );
		var preview = media.querySelector( '[data-wpep-media-frame]' );
		var clear = media.querySelector( '[data-wpep-media-clear]' );

		media.addEventListener( 'click', function ( event ) {
			if ( event.target.closest( '[data-wpep-media-clear]' ) ) {
				event.preventDefault();
				idField.value = '0';
				preview.innerHTML = '<span class="dashicons dashicons-format-image" aria-hidden="true"></span>';
				clear.hidden = true;
				markDirty();
				schedulePreview();

				return;
			}

			if ( ! event.target.closest( '[data-wpep-media-pick]' ) ) {
				return;
			}

			event.preventDefault();

			if ( ! frame ) {
				frame = window.wp.media( {
					title: config.i18n && config.i18n.chooseImage ? config.i18n.chooseImage : '',
					library: { type: 'image' },
					multiple: false
				} );

				frame.on( 'select', function () {
					var picked = frame.state().get( 'selection' ).first().toJSON();

					idField.value = picked.id;
					preview.innerHTML = '';

					var img = document.createElement( 'img' );

					img.src = picked.sizes && picked.sizes.medium ? picked.sizes.medium.url : picked.url;
					img.alt = '';
					preview.appendChild( img );

					clear.hidden = false;
					markDirty();
					schedulePreview();
				} );
			}

			frame.open();
		} );
	}

	/* --- Icon and choice chips ------------------------------------------ */

	form.addEventListener( 'change', function ( event ) {
		var radio = event.target;

		if ( 'radio' !== radio.type ) {
			return;
		}

		var group = form.querySelectorAll( 'input[name="' + radio.name + '"]' );

		group.forEach( function ( one ) {
			var chip = one.closest( '.wpep-iconpicker__item, .wpep-choice' );

			if ( chip ) {
				chip.classList.toggle( 'is-on', one.checked );
			}
		} );
	} );

	/* --- Preview -------------------------------------------------------- */

	var surface = form.querySelector( '[data-wpep-preview-surface]' );
	var stage = form.querySelector( '[data-wpep-preview-stage]' );
	var timer = null;
	var inFlight = null;

	/**
	 * Asks the server to render the draft and swaps the result in.
	 *
	 * Rendered server side on purpose: the preview must be the same markup
	 * the front end produces, and that markup is built in PHP. Rebuilding it
	 * in JavaScript would be a second implementation that drifts.
	 *
	 * @return {void}
	 */
	function refreshPreview() {
		if ( ! surface || ! config.ajaxUrl || ! config.nonce ) {
			return;
		}

		var body = new FormData();

		body.append( 'action', 'wpep_builder_preview' );
		body.append( 'nonce', config.nonce );
		body.append( 'post_title', value( '[name="post_title"]' ) );
		body.append( 'post_content', value( '[name="post_content"]' ) );
		body.append( 'wpep_link', value( '[name="wpep_link"]' ) );
		body.append( 'wpep_image_id', value( '[name="wpep_image_id"]' ) );
		body.append( 'wpep_placement', value( '[name="wpep_placement"]' ) );

		var icon = form.querySelector( 'input[name="wpep_icon"]:checked' );

		body.append( 'wpep_icon', icon ? icon.value : '' );

		// Only the newest request may paint: a slow earlier one landing later
		// would show the preview going backwards as someone types.
		var token = {};

		inFlight = token;

		window.fetch( config.ajaxUrl, {
			method: 'POST',
			credentials: 'same-origin',
			body: body
		} ).then( function ( response ) {
			return response.json();
		} ).then( function ( result ) {
			if ( inFlight !== token || ! result || ! result.success ) {
				return;
			}

			surface.innerHTML = result.data.html;
		} ).catch( function () {
			if ( inFlight === token && config.i18n && config.i18n.previewFailed ) {
				surface.textContent = config.i18n.previewFailed;
			}
		} );
	}

	/**
	 * Reads a field's value.
	 *
	 * @param {string} selector Field selector.
	 *
	 * @return {string} Current value.
	 */
	function value( selector ) {
		var field = form.querySelector( selector );

		return field ? field.value : '';
	}

	/**
	 * Coalesces bursts of typing into one request.
	 *
	 * @return {void}
	 */
	function schedulePreview() {
		window.clearTimeout( timer );
		timer = window.setTimeout( refreshPreview, 400 );
	}

	form.querySelectorAll( '[data-wpep-preview-field]' ).forEach( function ( field ) {
		field.addEventListener( 'input', schedulePreview );
		field.addEventListener( 'change', schedulePreview );
	} );

	// Device and theme are pure presentation, so they need no round trip.
	form.addEventListener( 'click', function ( event ) {
		var device = event.target.closest( '[data-wpep-preview-device]' );

		if ( device && stage ) {
			event.preventDefault();
			setSegment( device );
			stage.classList.toggle( 'is-mobile', 'mobile' === device.getAttribute( 'data-wpep-preview-device' ) );
			stage.classList.toggle( 'is-desktop', 'mobile' !== device.getAttribute( 'data-wpep-preview-device' ) );

			return;
		}

		var theme = event.target.closest( '[data-wpep-preview-theme]' );

		if ( theme && stage ) {
			event.preventDefault();
			setSegment( theme );
			stage.setAttribute( 'data-theme', theme.getAttribute( 'data-wpep-preview-theme' ) );
		}
	} );

	/**
	 * Marks one button in a segmented control as chosen.
	 *
	 * @param {Element} button The clicked button.
	 *
	 * @return {void}
	 */
	function setSegment( button ) {
		var group = button.closest( '.wpep-seg' );

		if ( ! group ) {
			return;
		}

		group.querySelectorAll( 'button' ).forEach( function ( one ) {
			one.classList.toggle( 'is-on', one === button );
		} );
	}

	refreshPreview();

	/* --- Save ----------------------------------------------------------- */

	var statusField = form.querySelector( '[data-wpep-status]' );
	var dirtyLabel = form.querySelector( '[data-wpep-dirty-label]' );

	/**
	 * Records that there is unsaved work.
	 *
	 * @return {void}
	 */
	function markDirty() {
		dirty = true;

		if ( dirtyLabel ) {
			dirtyLabel.hidden = false;
		}
	}

	form.addEventListener( 'input', markDirty );
	form.addEventListener( 'change', markDirty );

	form.querySelectorAll( '[data-wpep-save]' ).forEach( function ( button ) {
		button.addEventListener( 'click', function () {
			if ( statusField ) {
				statusField.value = 'publish' === button.getAttribute( 'data-wpep-save' ) ? 'publish' : 'draft';
			}

			// The form is submitting, so the work is no longer being thrown
			// away — leaving the flag set would warn on the way out.
			dirty = false;

			button.classList.add( 'is-busy' );
			button.disabled = true;

			// Re-enabled on the next tick so the disabled attribute cannot
			// stop the button's own value from being submitted.
			window.setTimeout( function () {
				button.disabled = false;
			}, 0 );
		} );
	} );

	window.addEventListener( 'beforeunload', function ( event ) {
		if ( ! dirty ) {
			return undefined;
		}

		event.preventDefault();
		event.returnValue = '';

		return '';
	} );
}() );
