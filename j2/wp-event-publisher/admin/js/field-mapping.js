/**
 * Field Mapping screen.
 *
 * Holds the whole screen in one state object: which scope is selected,
 * what was discovered, and what the administrator has changed but not yet
 * saved. Every server call is nonce-signed and every value the server
 * returns is inserted with textContent or as a form value, never as HTML,
 * so a field label coming from a third-party plugin cannot become markup.
 *
 * @package WPEventPublisher
 */
( function ( $ ) {
	'use strict';

	var cfg = window.wpepFields || {};
	var i18n = cfg.i18n || {};
	var labels = { save: '', preview: '' };

	var state = {
		postType: '',
		taxonomy: '',
		termId: 0,
		category: 0,
		subcategory: 0,
		groups: [],
		terms: [],
		placeholders: [],
		hasOwn: false,
		inherits: [],
		template: '',
		ownTemplate: '',
		sampleTitle: '',
		newFields: [],
		favorites: [],
		previewTimer: null,
		loading: false
	};

	/**
	 * Posts to admin-ajax with the screen nonce.
	 *
	 * @param {string} action Action name without the wpep_ prefix.
	 * @param {Object} data   Extra payload.
	 *
	 * @return {jQuery.Deferred} Request promise.
	 */
	function request( action, data ) {
		return $.post(
			cfg.ajaxUrl,
			$.extend(
				{
					action: 'wpep_' + action,
					nonce: cfg.nonce,
					post_type: state.postType,
					taxonomy: state.taxonomy,
					term_id: state.termId
				},
				data || {}
			)
		);
	}

	/**
	 * Shows a message above the table.
	 *
	 * @param {string}  message Text to show.
	 * @param {boolean} isError Whether it is a failure.
	 */
	function notice( message, isError ) {
		var $box = $( '#wpep-fields-notice' );

		$box
			.removeClass( 'wpep-result-ok wpep-result-error' )
			.addClass( isError ? 'wpep-result-error' : 'wpep-result-ok' )
			.text( message )
			.prop( 'hidden', false );

		if ( ! isError ) {
			window.setTimeout( function () {
				$box.prop( 'hidden', true );
			}, 4000 );
		}
	}

	/**
	 * Reads the effective term the selectors point at.
	 *
	 * @return {number} Term ID, 0 for the post type scope.
	 */
	function selectedTerm() {
		return state.subcategory > 0 ? state.subcategory : state.category;
	}

	/**
	 * Loads a scope from the server.
	 *
	 * @param {boolean} fresh Bypass the discovery cache.
	 */
	function load( fresh ) {
		if ( state.loading ) {
			return;
		}

		state.loading = true;
		state.termId = selectedTerm();

		$( '#wpep-fields-table' ).html( $( '<p class="wpep-loading"></p>' ).text( fresh ? i18n.rescanning : i18n.loading ) );

		request( fresh ? 'rescan_fields' : 'load_fields', { fresh: fresh ? 1 : 0 } )
			.done( function ( response ) {
				if ( ! response || ! response.success ) {
					notice( ( response && response.data && response.data.message ) || i18n.failed, true );
					renderLoadFailure();

					return;
				}

				apply( response.data );
			} )
			.fail( function () {
				notice( i18n.failed, true );
				renderLoadFailure();
			} )
			.always( function () {
				state.loading = false;
			} );
	}

	/**
	 * Shows that the request failed, with a way to try again.
	 *
	 * Emptying the container instead would leave the screen looking exactly
	 * like a site that genuinely has no fields, which is the single most
	 * misleading thing this screen can do: the administrator concludes their
	 * fields are gone when the request simply did not arrive.
	 *
	 * @return {void}
	 */
	function renderLoadFailure() {
		var $retry = $( '<button type="button" class="button"></button>' )
			.text( i18n.retry || '' )
			.on( 'click', function () {
				load( false );
			} );

		$( '#wpep-fields-table' )
			.empty()
			.append(
				$( '<div class="wpep-fields-empty is-error"></div>' )
					.append( $( '<strong></strong>' ).text( i18n.loadFailedTitle || '' ) )
					.append( $( '<span></span>' ).text( i18n.loadFailedBody || '' ) )
					.append( $( '<p></p>' ).append( $retry ) )
			);
	}

	/**
	 * Applies a server state object to the screen.
	 *
	 * @param {Object} data Screen state.
	 */
	function apply( data ) {
		state.groups = data.groups || [];
		state.terms = data.terms || [];
		state.placeholders = data.placeholders || [];
		state.hasOwn = !! data.has_own;
		state.inherits = data.inherits || [];
		state.template = data.template || '';
		state.ownTemplate = data.own_template || '';
		state.taxonomy = data.taxonomy || '';
		state.sampleTitle = data.sample_title || '';
		state.newFields = data.new_fields || [];
		state.favorites = data.favorites || [];

		$( '#wpep-taxonomy' ).val( state.taxonomy );

		renderTerms();
		renderTable( data.order || [] );
		renderPlaceholders();
		renderScopeBanner( data.scope );

		$( '#wpep-template' ).val( state.ownTemplate || state.template );
		hydrateBuilder( state.ownTemplate || state.template );
		$( '#wpep-reset' ).prop( 'hidden', ! state.hasOwn );
		$( '#wpep-preview-output' ).prop( 'hidden', true ).empty();
	}

	/**
	 * Explains what the current scope inherits.
	 *
	 * @param {string} scope Scope key.
	 */
	function renderScopeBanner( scope ) {
		var $banner = $( '#wpep-scope-banner' );
		var parts = [];

		parts.push( scope );

		if ( state.hasOwn ) {
			parts.push( '— ' + i18n.scopeOwn );
		} else if ( state.inherits.length ) {
			parts.push( '— ' + i18n.scopeInherits + ' ' + state.inherits.join( ' ‹ ' ) );
		}

		$banner.text( parts.join( ' ' ) ).prop( 'hidden', false );
	}

	/**
	 * Fills the category and subcategory selectors.
	 */
	function renderTerms() {
		var $category = $( '#wpep-category' );
		var $sub = $( '#wpep-subcategory' );

		$( '.wpep-fields-taxonomy' ).prop( 'hidden', '' === state.taxonomy );

		$category.find( 'option:gt(0)' ).remove();
		$sub.find( 'option:gt(0)' ).remove();

		state.terms.forEach( function ( term ) {
			if ( 0 !== term.parent ) {
				return;
			}

			$category.append(
				$( '<option></option>' )
					.val( term.id )
					.text( term.name + ( term.has_own ? ' •' : '' ) )
			);
		} );

		$category.val( String( state.category ) );

		renderSubcategories();
	}

	/**
	 * Fills the subcategory selector for the chosen category.
	 */
	function renderSubcategories() {
		var $sub = $( '#wpep-subcategory' );

		$sub.find( 'option:gt(0)' ).remove();

		if ( ! state.category ) {
			$sub.prop( 'disabled', true ).val( '0' );

			return;
		}

		var children = state.terms.filter( function ( term ) {
			return term.parent === state.category;
		} );

		children.forEach( function ( term ) {
			$sub.append(
				$( '<option></option>' )
					.val( term.id )
					.text( term.name + ( term.has_own ? ' •' : '' ) )
			);
		} );

		$sub.prop( 'disabled', 0 === children.length ).val( String( state.subcategory ) );
	}

	/**
	 * Renders the field table, grouped by provider and ordered by the
	 * saved mapping.
	 *
	 * @param {Array} order Field keys in mapping order.
	 */
	function renderTable( order ) {
		var $container = $( '#wpep-fields-table' ).empty();
		var rank = {};
		var total = 0;

		order.forEach( function ( key, index ) {
			rank[ key ] = index;
		} );

		// Three different situations, three different messages. An empty list
		// because the site genuinely has no fields is not the same as a load
		// that failed, and showing "no fields" for a failed request is how a
		// broken screen gets mistaken for an empty one.
		if ( ! state.groups.length ) {
			$container.append(
				$( '<div class="wpep-fields-empty"></div>' )
					.append( $( '<strong></strong>' ).text( i18n.noFieldsTitle || '' ) )
					.append( $( '<span></span>' ).text( i18n.noFieldsBody || '' ) )
			);

			return;
		}

		state.groups.forEach( function ( group ) {
			if ( ! group.fields.length ) {
				return;
			}

			var fields = group.fields.slice().sort( function ( a, b ) {
				var left = rank.hasOwnProperty( a.key ) ? rank[ a.key ] : 9999;
				var right = rank.hasOwnProperty( b.key ) ? rank[ b.key ] : 9999;

				return left - right;
			} );

			var enabled = fields.filter( function ( field ) {
				return field.enabled;
			} ).length;

			// A section of cards. The previous implementation built a <table>
			// and appended each card into its <tbody>; an <article> is not
			// valid there, so browsers hoisted it out of the table and the
			// fields silently vanished from the screen even though the server
			// had sent them.
			var $group = $( '<section class="wpep-field-group"></section>' );

			var $tools = $( '<span class="wpep-group-tools"></span>' )
				.append(
					$( '<button type="button" class="button-link wpep-group-all"></button>' )
						.text( i18n.selectAll )
				)
				.append(
					$( '<button type="button" class="button-link wpep-group-none"></button>' )
						.text( i18n.selectNone )
				);

			var $head = $( '<header class="wpep-field-group__head"></header>' )
				.append(
					$( '<h3 class="wpep-field-group__title"></h3>' ).text( group.label )
				)
				.append(
					$( '<span class="wpep-field-group__count"></span>' )
						.text( enabled + ' / ' + fields.length )
				)
				.append( $tools );

			var $list = $( '<div class="wpep-field-group__list"></div>' );

			$group.append( $head ).append( $list );

			// Favourites first, then whatever the mapping order says.
			fields.sort( function ( a, b ) {
				var left = a.favorite ? 0 : 1;
				var right = b.favorite ? 0 : 1;

				return left - right;
			} );

			fields.forEach( function ( field ) {
				$list.append( buildRow( field ) );
				total += 1;
			} );

			$container.append( $group );
		} );

		// Ordering is set by the "ترتیب نمایش" number on each card, so there
		// is no drag handle to bind a sortable to any more. Dropping it also
		// removes the jQuery UI dependency this screen no longer needs.
		updateCount( total, total );
	}

	/**
	 * Builds one field row from the template in the view.
	 *
	 * @param {Object} field Field descriptor.
	 *
	 * @return {jQuery} Row element.
	 */
	function buildRow( field ) {
		var $row = $( $( '#wpep-row-template' ).html() ).filter( '.wpep-field-card' );

		$row.attr( 'data-key', field.key );
		$row.attr( 'data-search', ( field.label + ' ' + field.key + ' ' + field.storage + ' ' + field.source ).toLowerCase() );

		$row.find( '.wpep-enabled' ).prop( 'checked', !! field.enabled );
		$row.find( '.wpep-label' ).val( field.label ).attr( 'placeholder', field.default );
		$row.find( '.wpep-order' ).val( field.order );

		// The human name leads; the internal key is available but demoted to
		// the advanced block, because an administrator deciding whether to
		// publish a price does not need to know it is stored as `ad_price`.
		$row.find( '.wpep-field-name' ).text( field.label || field.default || field.key );
		$row.find( '.wpep-field-hint' ).text( field.description || describeType( field ) );
		$row.find( '.wpep-field-key' ).text( field.key );
		$row.find( '.wpep-field-source' ).text( field.source );
		$row.find( '.wpep-visibility' ).val( field.visibility );

		// Per-platform visibility. A mapping saved before 1.6.0 has no
		// platforms object; the server fills that in, so an absent value here
		// means the field genuinely is not shown on that platform.
		$row.find( '.wpep-platform' ).each( function () {
			var $box = $( this );
			var name = $box.attr( 'data-platform' );
			var on = !! ( field.platforms && field.platforms[ name ] );

			$box.prop( 'checked', on );
			$box.closest( '.wpep-chip' ).toggleClass( 'is-on', on );
		} );

		reflectCardState( $row );
		$row.find( '.wpep-format' ).val( field.format );
		$row.find( '.wpep-separator' ).val( field.separator );
		$row.find( '.wpep-icon' ).val( field.icon || '' );
		$row.find( '.wpep-prefix' ).val( field.prefix || '' );
		$row.find( '.wpep-suffix' ).val( field.suffix || '' );

		var meta = [];

		if ( field.repeatable ) {
			meta.push( 'repeatable' );
		}

		if ( field.required ) {
			meta.push( 'required' );
		}

		if ( field.choices ) {
			meta.push( field.choices + ' choices' );
		}

		// Structural facts live in the advanced block, where they inform
		// without competing with the decision the card is asking for.
		$row.attr( 'data-meta', meta.join( ' ' ) );
		$row.find( '.wpep-sample' ).text( field.sample || '—' );

		if ( field.is_new ) {
			$row.find( '.wpep-field-card__identity' ).prepend(
				$( '<span class="wpep-badge wpep-badge-new"></span>' ).text( i18n.badgeNew )
			);
		}

		$row.find( '.wpep-field-card__master' ).before(
			$( '<button type="button" class="wpep-favorite"></button>' )
				.attr( 'title', i18n.favorite )
				.toggleClass( 'is-favorite', !! field.favorite )
				.attr( 'data-key', field.key )
				.text( field.favorite ? '★' : '☆' )
		);

		toggleFormatCell( $row );

		return $row;
	}

	/**
	 * Shows the list formatting controls only where they mean something.
	 *
	 * @param {jQuery} $row Row element.
	 */
	function toggleFormatCell( $row ) {
		var meta = ( $row.attr( 'data-meta' ) || '' );
		var repeatable = meta.indexOf( 'repeatable' ) !== -1;

		$row.find( '.wpep-format, .wpep-separator' ).prop( 'disabled', ! repeatable );
	}

	/**
	 * Renders the placeholder list.
	 */
	function renderPlaceholders() {
		var $list = $( '#wpep-placeholders' ).empty();

		state.placeholders.forEach( function ( placeholder ) {
			var $button = $( '<button type="button" class="button-link"></button>' )
				.attr( 'data-key', placeholder.key )
				.text( '{{' + placeholder.key + '}}' );

			var $item = $( '<li></li>' )
				.toggleClass( 'wpep-placeholder-off', ! placeholder.visible )
				.append( $button )
				.append( $( '<span class="wpep-placeholder-label"></span>' ).text( placeholder.label ) );

			$list.append( $item );
		} );

		renderBuilderChips();
	}

	/* ------------------------------------------------------------------ *
	 * Visual template builder (spec 8).
	 *
	 * The builder and the textarea are two views of one value. The textarea
	 * stays the single source of truth — it is what gets saved, previewed and
	 * rendered — and the builder compiles into it. That direction matters:
	 * a template hand-written in the advanced pane is never silently
	 * rewritten by the builder, it simply cannot be represented as chips and
	 * the builder says so.
	 * ------------------------------------------------------------------ */

	/**
	 * Reads the placeholder list into the chip picker.
	 *
	 * Only fields that actually produce something are offered: a chip for a
	 * field that is switched off would insert a placeholder that renders
	 * empty, which looks like a bug to whoever clicked it.
	 *
	 * @return {void}
	 */
	function renderBuilderChips() {
		var $chips = $( '#wpep-builder-chips' ).empty();

		state.placeholders.forEach( function ( placeholder ) {
			if ( ! placeholder.visible ) {
				return;
			}

			$( '<button type="button" class="button wpep-builder-chip"></button>' )
				.attr( 'data-key', placeholder.key )
				.text( placeholder.label || placeholder.key )
				.appendTo( $chips );
		} );

		if ( ! $chips.children().length ) {
			$chips.append(
				$( '<p class="description"></p>' ).text( i18n.nothingEnabled || '' )
			);
		}
	}

	/**
	 * Returns the builder lines currently on the canvas.
	 *
	 * @return {Array} Line descriptors.
	 */
	function builderLines() {
		return $( '#wpep-builder-lines .wpep-builder-line' ).map( function () {
			return {
				key: $( this ).attr( 'data-key' ),
				label: $( this ).find( '.wpep-builder-line-label' ).text()
			};
		} ).get();
	}

	/**
	 * Compiles the canvas into template text.
	 *
	 * Each line is wrapped in a conditional so a field with no value on a
	 * given advertisement drops its whole line rather than leaving a stray
	 * label behind.
	 *
	 * @return {string} Template text.
	 */
	function compileBuilder() {
		return builderLines().map( function ( line ) {
			return '{{#if ' + line.key + '}}' + line.label + ': {{' + line.key + '}}{{/if}}';
		} ).join( '\n' );
	}

	/**
	 * Adds one field to the canvas.
	 *
	 * @param {string} key   Field key.
	 * @param {string} label Readable label.
	 *
	 * @return {void}
	 */
	function addBuilderLine( key, label ) {
		if ( $( '#wpep-builder-lines .wpep-builder-line[data-key="' + key + '"]' ).length ) {
			return;
		}

		var $line = $( '<li class="wpep-builder-line" draggable="true"></li>' ).attr( 'data-key', key );

		$line.append( $( '<span class="wpep-builder-line-handle" aria-hidden="true"></span>' ).text( '⋮⋮' ) );
		$line.append( $( '<span class="wpep-builder-line-label"></span>' ).text( label ) );
		$line.append( $( '<code class="wpep-builder-line-key"></code>' ).text( '{{' + key + '}}' ) );
		$line.append(
			$( '<button type="button" class="button-link wpep-builder-remove"></button>' )
				.attr( 'aria-label', i18n.removeLine || 'Remove' )
				.text( '×' )
		);

		$( '#wpep-builder-lines' ).append( $line );

		syncBuilderToTemplate();
	}

	/**
	 * Pushes the compiled builder output into the textarea.
	 *
	 * @return {void}
	 */
	function syncBuilderToTemplate() {
		var lines = builderLines();

		$( '#wpep-builder-empty' ).toggle( ! lines.length );

		$( '#wpep-template' ).val( compileBuilder() );

		schedulePreview();
	}

	/**
	 * Rebuilds the canvas from template text, when it is representable.
	 *
	 * A template the builder itself wrote round-trips exactly. Anything else
	 * — a hand-written template with emoji, prose or nested conditionals —
	 * is left alone and the builder stays empty rather than mangling it.
	 *
	 * @param {string} template Template text.
	 *
	 * @return {void}
	 */
	function hydrateBuilder( template ) {
		var $lines = $( '#wpep-builder-lines' ).empty();
		var text = ( template || '' ).trim();

		if ( '' === text ) {
			$( '#wpep-builder-empty' ).show();

			return;
		}

		var pattern = /^\{\{#if ([a-zA-Z0-9_\-]+)\}\}(.*): \{\{\1\}\}\{\{\/if\}\}$/;
		var ok = true;

		text.split( /\n/ ).forEach( function ( line ) {
			var match = pattern.exec( line.trim() );

			if ( ! match ) {
				ok = false;

				return;
			}

			var $line = $( '<li class="wpep-builder-line" draggable="true"></li>' ).attr( 'data-key', match[ 1 ] );

			$line.append( $( '<span class="wpep-builder-line-handle" aria-hidden="true"></span>' ).text( '⋮⋮' ) );
			$line.append( $( '<span class="wpep-builder-line-label"></span>' ).text( match[ 2 ] ) );
			$line.append( $( '<code class="wpep-builder-line-key"></code>' ).text( '{{' + match[ 1 ] + '}}' ) );
			$line.append(
				$( '<button type="button" class="button-link wpep-builder-remove"></button>' )
					.attr( 'aria-label', i18n.removeLine || 'Remove' )
					.text( '×' )
			);

			$lines.append( $line );
		} );

		if ( ! ok ) {
			// Not builder-shaped. Keep the author's template untouched and
			// send them to the pane that can actually edit it.
			$lines.empty();
			$( '#wpep-builder-empty' ).show().text( i18n.customTemplate || '' );
			switchTemplateTab( 'code' );

			return;
		}

		$( '#wpep-builder-empty' ).toggle( ! $lines.children().length );
	}

	/**
	 * Switches the template tab.
	 *
	 * @param {string} tab Tab name.
	 *
	 * @return {void}
	 */
	function switchTemplateTab( tab ) {
		$( '.wpep-template-tab' ).each( function () {
			var active = $( this ).attr( 'data-tab' ) === tab;

			$( this ).toggleClass( 'is-active', active ).attr( 'aria-selected', active ? 'true' : 'false' );
		} );

		$( '.wpep-template-pane' ).each( function () {
			$( this ).prop( 'hidden', $( this ).attr( 'data-pane' ) !== tab );
		} );
	}

	/**
	 * Describes a field in words rather than in type names.
	 *
	 * The provider reports "gallery" or "repeater"; an administrator wants to
	 * know what that means for their message. Anything unrecognised falls back
	 * to nothing rather than to jargon.
	 *
	 * @param {Object} field Field descriptor.
	 *
	 * @return {string} Human sentence, possibly empty.
	 */
	function describeType( field ) {
		var map = i18n.typeHints || {};

		return map[ field.type ] || '';
	}

	/**
	 * Mirrors a card's on/off state onto the card itself.
	 *
	 * A disabled field keeps every control it had — the spec is explicit that
	 * its configuration stays available — but recedes visually so the enabled
	 * ones are what the eye lands on.
	 *
	 * @param {jQuery} $card Card element.
	 *
	 * @return {void}
	 */
	function reflectCardState( $card ) {
		$card.toggleClass( 'is-off', ! $card.find( '.wpep-enabled' ).is( ':checked' ) );
	}

	/**
	 * Warns when the saved mapping would publish nothing.
	 *
	 * A mapping with no field that both is enabled and reaches a platform is
	 * not an error — it is a legitimate way to pause a site — but it is
	 * rarely what someone meant, and without a message the visible result is
	 * a site that quietly sends empty messages.
	 *
	 * @param {Array} rows Collected rows.
	 *
	 * @return {void}
	 */
	function warnIfNothingEnabled( rows ) {
		var usable = rows.filter( function ( row ) {
			if ( ! row.enabled ) {
				return false;
			}

			return Object.keys( row.platforms || {} ).some( function ( name ) {
				return !! row.platforms[ name ];
			} );
		} );

		var $notice = $( '#wpep-fields-empty-state' );

		if ( ! $notice.length ) {
			$notice = $( '<div id="wpep-fields-empty-state" class="wpep-fields-empty"></div>' ).hide();
			$( '#wpep-fields-table' ).before( $notice );
		}

		if ( usable.length ) {
			$notice.hide();

			return;
		}

		// Deliberately not a validation error. Nothing is broken — the
		// administrator simply has not chosen yet — so this says what to do
		// next rather than what went wrong.
		$notice
			.empty()
			.append( $( '<strong></strong>' ).text( i18n.emptyTitle || '' ) )
			.append( $( '<span></span>' ).text( i18n.emptyBody || '' ) )
			.show();
	}

	/**
	 * Collects the current table state for saving.
	 *
	 * @return {Array} Field rows in display order.
	 */
	function collect() {
		var rows = [];

		$( '#wpep-fields-table .wpep-field-card' ).each( function () {
			var $row = $( this );

			rows.push( {
				key: $row.attr( 'data-key' ),
				enabled: $row.find( '.wpep-enabled' ).is( ':checked' ) ? 1 : 0,
				label: $row.find( '.wpep-label' ).val(),
				visibility: $row.find( '.wpep-visibility' ).val(),
				format: $row.find( '.wpep-format' ).val(),
				separator: $row.find( '.wpep-separator' ).val(),
				icon: $row.find( '.wpep-icon' ).val(),
				prefix: $row.find( '.wpep-prefix' ).val(),
				suffix: $row.find( '.wpep-suffix' ).val(),
				order: parseInt( $row.find( '.wpep-order' ).val(), 10 ) || 0,
				platforms: ( function () {
					var out = {};

					$row.find( '.wpep-platform' ).each( function () {
						out[ $( this ).attr( 'data-platform' ) ] = $( this ).is( ':checked' ) ? 1 : 0;
					} );

					return out;
				} )()
			} );
		} );

		warnIfNothingEnabled( rows );

		return rows;
	}

	/**
	 * Updates the "showing x of y" counter.
	 *
	 * @param {number} shown Rows currently visible.
	 * @param {number} total Rows in total.
	 */
	function updateCount( shown, total ) {
		$( '#wpep-field-count' ).text( shown + ' / ' + total );
	}

	/**
	 * Filters the table by the search box.
	 */
	function filter() {
		var needle = ( $( '#wpep-field-search' ).val() || '' ).toString().toLowerCase().trim();
		var shown = 0;
		var total = 0;

		$( '#wpep-fields-table .wpep-field-card' ).each( function () {
			var $row = $( this );
			var haystack = $row.attr( 'data-search' ) || '';
			var match = '' === needle || haystack.indexOf( needle ) !== -1;

			$row.toggle( match );

			total += 1;
			shown += match ? 1 : 0;
		} );

		$( '#wpep-fields-table .wpep-field-group' ).each( function () {
			var $table = $( this );

			$table.toggle( $table.find( '.wpep-field-card:visible' ).length > 0 );
		} );

		updateCount( shown, total );
	}

	/**
	 * Renders the preview after a short pause, so typing does not fire a
	 * request per keystroke.
	 */
	function schedulePreview() {
		if ( state.previewTimer ) {
			window.clearTimeout( state.previewTimer );
		}

		state.previewTimer = window.setTimeout( renderPreview, 600 );
	}

	/**
	 * Asks the server to render the current template and shows the result.
	 */
	function renderPreview() {
		var $output = $( '#wpep-preview-output' );

		request( 'preview_template', { template: $( '#wpep-template' ).val() } )
			.done( function ( response ) {
				if ( ! response || ! response.success ) {
					$output
						.prop( 'hidden', false )
						.empty()
						.append(
							$( '<p class="wpep-result-error"></p>' ).text(
								( response && response.data && response.data.message ) || i18n.failed
							)
						);

					return;
				}

				$output
					.prop( 'hidden', false )
					.empty()
					.append( $( '<h4></h4>' ).text( response.data.title || '' ) )
					.append( $( '<pre class="wpep-preview-message"></pre>' ).text( response.data.message || '' ) );
			} );
	}

	/**
	 * Inserts text at the cursor position in the template editor.
	 *
	 * @param {string} text Text to insert.
	 */
	function insert( text ) {
		var area = document.getElementById( 'wpep-template' );

		if ( ! area ) {
			return;
		}

		var start = area.selectionStart || 0;
		var end = area.selectionEnd || 0;
		var value = area.value || '';

		area.value = value.slice( 0, start ) + text + value.slice( end );
		area.selectionStart = start + text.length;
		area.selectionEnd = area.selectionStart;
		area.focus();
	}

	$( function () {
		state.postType = $( '#wpep-post-type' ).val() || '';
		state.taxonomy = $( '#wpep-taxonomy' ).val() || '';

		// Remember the buttons' resting labels before any handler swaps
		// them for a progress message.
		labels.save = $( '#wpep-save' ).text().trim();
		labels.preview = $( '#wpep-preview' ).text().trim();

		// Render the server-provided state immediately. This makes the screen
		// useful even before the first AJAX request completes and prevents a
		// transient empty screen on slow/admin-heavy sites.
		var initialNode = document.getElementById( 'wpep-fields-initial-state' );
		if ( initialNode ) {
			try {
				var initial = JSON.parse( initialNode.textContent || '{}' );
				if ( initial && initial.groups ) {
					apply( initial );
				}
			} catch ( error ) {
				// The AJAX path below remains the authoritative fallback.
			}
		}

		if ( ! state.postType ) {
			return;
		}

		load( false );

		$( '#wpep-post-type' ).on( 'change', function () {
			state.postType = $( this ).val();
			state.category = 0;
			state.subcategory = 0;
			load( false );
		} );

		$( '#wpep-category' ).on( 'change', function () {
			state.category = parseInt( $( this ).val(), 10 ) || 0;
			state.subcategory = 0;
			renderSubcategories();
			load( false );
		} );

		$( '#wpep-subcategory' ).on( 'change', function () {
			state.subcategory = parseInt( $( this ).val(), 10 ) || 0;
			load( false );
		} );

		$( '#wpep-rescan' ).on( 'click', function () {
			load( true );
		} );

		$( '#wpep-field-search' ).on( 'input', filter );

		// Collapsible groups.
		$( document ).on( 'click', '.wpep-field-group caption', function ( event ) {
			if ( $( event.target ).is( 'button' ) ) {
				return;
			}

			$( this ).closest( '.wpep-field-group' ).toggleClass( 'wpep-collapsed' );
		} );

		$( document ).on( 'click', '.wpep-group-all, .wpep-group-none', function () {
			var on = $( this ).hasClass( 'wpep-group-all' );
			var $cards = $( this ).closest( '.wpep-field-group' ).find( '.wpep-field-card:visible' );

			$cards.find( '.wpep-enabled' ).prop( 'checked', on );
			$cards.each( function () {
				reflectCardState( $( this ) );
			} );

			schedulePreview();
		} );

		$( document ).on( 'click', '.wpep-favorite', function () {
			var $button = $( this );
			var key = $button.attr( 'data-key' );
			var on = ! $button.hasClass( 'is-favorite' );

			$button.toggleClass( 'is-favorite', on ).text( on ? '★' : '☆' );

			state.favorites = state.favorites.filter( function ( candidate ) {
				return candidate !== key;
			} );

			if ( on ) {
				state.favorites.push( key );
			}
		} );

		// Live state + preview: when a field is turned on/off, the visual card
		// must immediately follow the switch. This was previously missing, so
		// an enabled card could keep the `.is-off` class and remain blurred until
		// a full re-render/reload.
		$( document ).on( 'change', '#wpep-fields-table .wpep-enabled', function () {
			reflectCardState( $( this ).closest( '.wpep-field-card' ) );
			schedulePreview();
		} );

		$( document ).on(
			'change',
			'#wpep-fields-table .wpep-visibility, #wpep-fields-table .wpep-format, #wpep-fields-table .wpep-label, #wpep-fields-table .wpep-separator, #wpep-fields-table .wpep-platform',
			schedulePreview
		);

		$( '#wpep-template' ).on( 'input', schedulePreview );

		$( '#wpep-enable-all' ).on( 'click', function () {
			var $cards = $( '#wpep-fields-table .wpep-field-card:visible' );
			$cards.find( '.wpep-enabled' ).prop( 'checked', true );
			$cards.each( function () {
				reflectCardState( $( this ) );
			} );
			schedulePreview();
		} );

		$( '#wpep-disable-all' ).on( 'click', function () {
			var $cards = $( '#wpep-fields-table .wpep-field-card:visible' );
			$cards.find( '.wpep-enabled' ).prop( 'checked', false );
			$cards.each( function () {
				reflectCardState( $( this ) );
			} );
			schedulePreview();
		} );

		// The bulk visibility control was removed with the table layout: it set a
		// technical value in bulk, which is exactly the kind of decision the card
		// layout exists to stop anyone having to make.


		$( document ).on( 'change', '#wpep-fields-table .wpep-platform', function () {
			$( this ).closest( '.wpep-chip' ).toggleClass( 'is-on', $( this ).is( ':checked' ) );
		} );

		$( '#wpep-filter-state' ).on( 'change', function () {
			var mode = $( this ).val();

			$( '#wpep-fields-table .wpep-field-card' ).each( function () {
				var on = $( this ).find( '.wpep-enabled' ).is( ':checked' );

				$( this ).toggle( 'all' === mode || ( 'on' === mode && on ) || ( 'off' === mode && ! on ) );
			} );
		} );

		$( document ).on( 'click', '.wpep-template-tab', function () {
			switchTemplateTab( $( this ).attr( 'data-tab' ) );
		} );

		$( document ).on( 'click', '.wpep-builder-chip', function () {
			addBuilderLine( $( this ).attr( 'data-key' ), $( this ).text() );
		} );

		$( document ).on( 'click', '.wpep-builder-remove', function () {
			$( this ).closest( '.wpep-builder-line' ).remove();
			syncBuilderToTemplate();
		} );

		// Reordering by drag, same interaction as the field table above it.
		var $dragged = null;

		$( document ).on( 'dragstart', '.wpep-builder-line', function ( e ) {
			$dragged = $( this );
			if ( e.originalEvent && e.originalEvent.dataTransfer ) {
				e.originalEvent.dataTransfer.effectAllowed = 'move';
				e.originalEvent.dataTransfer.setData( 'text/plain', '' );
			}
		} );

		$( document ).on( 'dragover', '.wpep-builder-line', function ( e ) {
			e.preventDefault();

			if ( ! $dragged || $dragged.is( this ) ) {
				return;
			}

			var box = this.getBoundingClientRect();
			var after = ( e.originalEvent.clientY - box.top ) > ( box.height / 2 );

			$dragged[ after ? 'insertAfter' : 'insertBefore' ]( this );
		} );

		$( document ).on( 'dragend', '.wpep-builder-line', function () {
			$dragged = null;
			syncBuilderToTemplate();
		} );

		$( document ).on( 'click', '#wpep-placeholders button', function () {
			insert( '{{' + $( this ).attr( 'data-key' ) + '}}' );
		} );

		$( '#wpep-save' ).on( 'click', function () {
			var $button = $( this ).prop( 'disabled', true ).text( i18n.saving );

			request( 'save_mapping', {
				fields: collect(),
				favorites: state.favorites,
				template: $( '#wpep-template' ).val()
			} )
				.done( function ( response ) {
					if ( ! response || ! response.success ) {
						notice( ( response && response.data && response.data.message ) || i18n.failed, true );

						return;
					}

					notice( response.data.message || i18n.saved, false );

					if ( response.data.state ) {
						apply( response.data.state );
					}
				} )
				.fail( function () {
					notice( i18n.failed, true );
				} )
				.always( function () {
					$button.prop( 'disabled', false ).text( labels.save );
				} );
		} );

		$( '#wpep-reset' ).on( 'click', function () {
			if ( ! window.confirm( i18n.confirm ) ) {
				return;
			}

			var $button = $( this ).prop( 'disabled', true ).text( i18n.resetting );

			request( 'reset_mapping', {} )
				.done( function ( response ) {
					if ( ! response || ! response.success ) {
						notice( ( response && response.data && response.data.message ) || i18n.failed, true );

						return;
					}

					notice( response.data.message || i18n.reset, false );

					if ( response.data.state ) {
						apply( response.data.state );
					}
				} )
				.fail( function () {
					notice( i18n.failed, true );
				} )
				.always( function () {
					$button.prop( 'disabled', false );
				} );
		} );

		$( '#wpep-preview' ).on( 'click', function () {
			var $button = $( this ).prop( 'disabled', true ).text( i18n.previewing );
			var $output = $( '#wpep-preview-output' );

			request( 'preview_template', { template: $( '#wpep-template' ).val() } )
				.done( function ( response ) {
					if ( ! response || ! response.success ) {
						$output
							.prop( 'hidden', false )
							.empty()
							.append( $( '<p class="wpep-result-error"></p>' ).text( ( response && response.data && response.data.message ) || i18n.failed ) );

						return;
					}

					// The rendered message is inserted as text: a template is
					// content, and content is never markup here.
					$output
						.prop( 'hidden', false )
						.empty()
						.append( $( '<h4></h4>' ).text( response.data.title || '' ) )
						.append( $( '<pre class="wpep-preview-message"></pre>' ).text( response.data.message || '' ) );
				} )
				.fail( function () {
					notice( i18n.failed, true );
				} )
				.always( function () {
					$button.prop( 'disabled', false ).text( labels.preview );
				} );
		} );
	} );
} )( jQuery );
