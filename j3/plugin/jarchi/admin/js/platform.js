/**
 * Profiles, Destinations and Rules screens.
 *
 * One script for three screens, because they share a state object, a
 * request helper and a notice area. Which screen is running is decided by
 * `wpepPlatform.screen`, set server-side.
 *
 * Every server call carries the screen nonce, and every value the server
 * returns is inserted with textContent or as a form value, never as HTML:
 * a profile name, a destination name and a provider's error message are
 * all administrator- or third-party-authored text.
 *
 * @package WPEventPublisher
 */
( function ( $ ) {
	'use strict';

	var cfg = window.wpepPlatform || {};
	var i18n = cfg.i18n || {};

	var state = {
		profiles: [],
		destinations: [],
		rules: [],
		providers: [],
		assignments: {},
		current: null
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
			$.extend( { action: 'wpep_' + action, nonce: cfg.nonce }, data || {} )
		);
	}

	/**
	 * Shows a message.
	 *
	 * @param {string}  message Text to show.
	 * @param {boolean} isError Whether it is a failure.
	 */
	function notice( message, isError ) {
		var $box = $( '#wpep-platform-notice' );

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
	 * Renders a validation problem list.
	 *
	 * @param {string} selector Container selector.
	 * @param {Array}  problems Problems from the server.
	 */
	function showProblems( selector, problems ) {
		var $box = $( selector ).empty();

		if ( ! problems || ! problems.length ) {
			$box.prop( 'hidden', true );

			return;
		}

		var $list = $( '<ul></ul>' );

		problems.forEach( function ( problem ) {
			var text = typeof problem === 'string' ? problem : ( problem.message || '' );
			var level = typeof problem === 'string' ? 'error' : ( problem.level || 'error' );

			$list.append( $( '<li></li>' ).addClass( 'wpep-problem-' + level ).text( text ) );
		} );

		$box.append( $list ).prop( 'hidden', false );
	}

	/**
	 * Refreshes the whole screen from the server.
	 *
	 * @param {Object} data Screen state.
	 */
	function apply( data ) {
		if ( ! data ) {
			return;
		}

		state.profiles = data.profiles || [];
		state.destinations = data.destinations || [];
		state.rules = data.rules || [];
		state.providers = data.providers || [];
		state.assignments = data.assignments || {};

		if ( 'profiles' === cfg.screen ) {
			renderProfileList();
			renderParentOptions();
			renderDestinationOptions();
		} else if ( 'destinations' === cfg.screen ) {
			renderDestinationList();
		} else if ( 'rules' === cfg.screen ) {
			renderRuleList();
		}
	}

	/**
	 * Reloads the state after a change.
	 *
	 * @param {Object} response Server response.
	 */
	function refresh( response ) {
		if ( response && response.data && response.data.state ) {
			apply( response.data.state );
		}
	}

	/* ----------------------------------------------------------- profiles */

	/**
	 * Renders the profile list.
	 */
	function renderProfileList() {
		var $list = $( '#wpep-profile-list' ).empty();

		state.profiles.forEach( function ( profile ) {
			var $meta = $( '<span class="wpep-item-meta"></span>' )
				.append( $( '<code></code>' ).text( profile.id ) );

			if ( profile.parent ) {
				$meta.append( document.createTextNode( ' · ' + i18n.inherits + ' ' + profile.parent ) );
			}

			$list.append(
				$( '<li></li>' ).append(
					$( '<button type="button" class="wpep-item"></button>' )
						.attr( 'data-id', profile.id )
						.append( $( '<span class="wpep-item-name"></span>' ).text( profile.name ) )
						.append( $meta )
				)
			);
		} );
	}

	/**
	 * Fills the parent selector, excluding anything that would loop.
	 */
	function renderParentOptions() {
		var $select = $( '#wpep-profile-parent' ).empty();
		var current = state.current || '';

		$select.append( $( '<option></option>' ).val( '' ).text( '—' ) );

		state.profiles.forEach( function ( profile ) {
			if ( profile.id === current ) {
				return;
			}

			// A profile whose own chain already contains the one being
			// edited would close a loop; the server refuses it too, but the
			// list should not offer it in the first place.
			if ( current && ( profile.chain || [] ).indexOf( current ) !== -1 ) {
				return;
			}

			$select.append( $( '<option></option>' ).val( profile.id ).text( profile.name ) );
		} );
	}

	/**
	 * Fills the destination multi-selector.
	 */
	function renderDestinationOptions() {
		var $select = $( '#wpep-profile-destinations' ).empty();

		state.destinations.forEach( function ( destination ) {
			$select.append( $( '<option></option>' ).val( destination.id ).text( destination.name ) );
		} );
	}

	/**
	 * Loads one profile into the editor.
	 *
	 * @param {string} id Profile identifier.
	 */
	function editProfile( id ) {
		var profile = null;

		state.profiles.forEach( function ( candidate ) {
			if ( candidate.id === id ) {
				profile = candidate;
			}
		} );

		if ( ! profile ) {
			return;
		}

		state.current = id;

		$( '#wpep-profile-title' ).text( profile.name );
		$( '#wpep-profile-name' ).val( profile.name );
		$( '#wpep-profile-description' ).val( profile.description || '' );
		$( '#wpep-profile-template' ).val( profile.template || '' );
		$( '#wpep-profile-images' ).val( ( profile.images || {} ).mode || 'both' );
		$( '#wpep-profile-image-max' ).val( ( profile.images || {} ).max || 10 );
		$( '#wpep-profile-prepend' ).val( ( profile.formatting || {} ).prepend || '' );
		$( '#wpep-profile-append' ).val( ( profile.formatting || {} ).append || '' );

		renderParentOptions();
		$( '#wpep-profile-parent' ).val( profile.parent || '' );

		$( '#wpep-profile-destinations option' ).each( function () {
			$( this ).prop( 'selected', ( profile.destinations || [] ).indexOf( $( this ).val() ) !== -1 );
		} );

		$( '#wpep-export-profile' ).attr(
			'href',
			$( '#wpep-export-profile' ).attr( 'href' ).split( '&what=' )[0] + '&what=profiles&id=' + encodeURIComponent( id )
		);

		$( '#wpep-delete-profile' ).prop( 'disabled', !! profile.locked );
		$( '#wpep-profile-editor' ).prop( 'hidden', false );

		showProblems( '#wpep-profile-problems', [] );
	}

	/**
	 * Collects the profile editor into a payload.
	 *
	 * @return {Object} Profile payload.
	 */
	function collectProfile() {
		var destinations = [];

		$( '#wpep-profile-destinations option:selected' ).each( function () {
			destinations.push( $( this ).val() );
		} );

		return {
			id: state.current || '',
			name: $( '#wpep-profile-name' ).val(),
			description: $( '#wpep-profile-description' ).val(),
			parent: $( '#wpep-profile-parent' ).val(),
			template: $( '#wpep-profile-template' ).val(),
			image_mode: $( '#wpep-profile-images' ).val(),
			image_max: $( '#wpep-profile-image-max' ).val(),
			prepend: $( '#wpep-profile-prepend' ).val(),
			append: $( '#wpep-profile-append' ).val(),
			destinations: destinations
		};
	}

	/* ------------------------------------------------------- destinations */

	/**
	 * Renders the destination list.
	 */
	function renderDestinationList() {
		var $list = $( '#wpep-destination-list' ).empty();

		state.destinations.forEach( function ( destination ) {
			var $name = $( '<span class="wpep-item-name"></span>' ).text( destination.name );

			$name.append(
				$( '<span></span>' )
					.addClass( 'wpep-badge wpep-badge-' + ( destination.enabled ? 'ok' : 'skipped' ) )
					.text( destination.enabled ? 'on' : 'off' )
			);

			$list.append(
				$( '<li></li>' ).append(
					$( '<button type="button" class="wpep-item"></button>' )
						.attr( 'data-id', destination.id )
						.append( $name )
						.append( $( '<span class="wpep-item-meta"></span>' ).text( destination.provider_label + ' · ' + destination.id ) )
				)
			);
		} );
	}

	/**
	 * Returns a provider description by identifier.
	 *
	 * @param {string} id Provider identifier.
	 *
	 * @return {Object|null} Provider.
	 */
	function findProvider( id ) {
		var found = null;

		state.providers.forEach( function ( provider ) {
			if ( provider.id === id ) {
				found = provider;
			}
		} );

		return found;
	}

	/**
	 * Builds the settings form for a provider.
	 *
	 * @param {string} providerId Provider identifier.
	 * @param {Object} config     Stored configuration.
	 */
	function renderProviderForm( providerId, config ) {
		var provider = findProvider( providerId );
		var $body = $( '#wpep-destination-config' ).empty();

		if ( ! provider ) {
			return;
		}

		var capabilities = [];

		[ 'images', 'gallery', 'formatting', 'buttons', 'scheduling' ].forEach( function ( key ) {
			if ( provider[ key ] ) {
				capabilities.push( key );
			}
		} );

		$( '#wpep-provider-capabilities' ).text( capabilities.join( ' · ' ) );

		$.each( provider.schema || {}, function ( key, setting ) {
			var id = 'wpep-config-' + key;
			var value = ( config || {} )[ key ];
			var $input;

			if ( 'select' === setting.type ) {
				$input = $( '<select></select>' );

				$.each( setting.options || {}, function ( option, label ) {
					$input.append( $( '<option></option>' ).val( option ).text( label ) );
				} );

				$input.val( undefined === value ? setting['default'] : value );
			} else if ( 'textarea' === setting.type ) {
				$input = $( '<textarea rows="3" class="large-text"></textarea>' ).val( value || '' );
			} else if ( 'checkbox' === setting.type ) {
				$input = $( '<input type="checkbox" />' ).prop( 'checked', !! value );
			} else {
				$input = $( '<input class="regular-text" />' )
					.attr( 'type', 'password' === setting.type ? 'password' : ( 'number' === setting.type ? 'number' : 'text' ) )
					.val( undefined === value ? ( setting['default'] || '' ) : value );

				if ( setting.placeholder ) {
					$input.attr( 'placeholder', setting.placeholder );
				}

				if ( 'password' === setting.type ) {
					$input.attr( 'autocomplete', 'new-password' );
				}
			}

			$input.attr( 'id', id ).attr( 'data-config-key', key );

			var $cell = $( '<td></td>' ).append( $input );

			if ( setting.description ) {
				$cell.append( $( '<p class="description"></p>' ).text( setting.description ) );
			}

			$body.append(
				$( '<tr></tr>' )
					.append( $( '<th scope="row"></th>' ).append( $( '<label></label>' ).attr( 'for', id ).text( setting.label || key ) ) )
					.append( $cell )
			);
		} );
	}

	/**
	 * Loads one destination into the editor.
	 *
	 * @param {string} id Destination identifier.
	 */
	function editDestination( id ) {
		var destination = null;

		state.destinations.forEach( function ( candidate ) {
			if ( candidate.id === id ) {
				destination = candidate;
			}
		} );

		if ( ! destination ) {
			return;
		}

		state.current = id;

		$( '#wpep-destination-title' ).text( destination.name );
		$( '#wpep-destination-name' ).val( destination.name );
		$( '#wpep-destination-provider' ).val( destination.provider );
		$( '#wpep-destination-enabled' ).prop( 'checked', !! destination.enabled );
		$( '#wpep-destination-template' ).val( destination.template || '' );
		$( '#wpep-destination-images' ).val( undefined === destination.images ? -1 : destination.images );

		var delay = parseInt( destination.delay, 10 ) || 0;
		var $preset = $( '#wpep-destination-delay' );

		if ( $preset.find( 'option[value="' + delay + '"]' ).length ) {
			$preset.val( String( delay ) );
			$( '#wpep-destination-delay-custom' ).val( '' );
		} else {
			$preset.val( '0' );
			$( '#wpep-destination-delay-custom' ).val( delay );
		}

		renderProviderForm( destination.provider, destination.config );

		showProblems( '#wpep-destination-problems', destination.problems || [] );

		$( '#wpep-destination-result' ).prop( 'hidden', true ).empty();
		$( '#wpep-destination-editor' ).prop( 'hidden', false );
	}

	/**
	 * Collects the destination editor into a payload.
	 *
	 * @return {Object} Destination payload.
	 */
	function collectDestination() {
		var config = {};

		$( '#wpep-destination-config [data-config-key]' ).each( function () {
			var $field = $( this );
			var key = $field.attr( 'data-config-key' );

			config[ key ] = $field.is( ':checkbox' ) ? ( $field.is( ':checked' ) ? 1 : 0 ) : $field.val();
		} );

		var custom = parseInt( $( '#wpep-destination-delay-custom' ).val(), 10 );
		var delay = isNaN( custom ) || custom < 0 ? parseInt( $( '#wpep-destination-delay' ).val(), 10 ) || 0 : custom;

		return {
			id: state.current || '',
			name: $( '#wpep-destination-name' ).val(),
			provider: $( '#wpep-destination-provider' ).val(),
			enabled: $( '#wpep-destination-enabled' ).is( ':checked' ) ? 1 : 0,
			template: $( '#wpep-destination-template' ).val(),
			images: $( '#wpep-destination-images' ).val(),
			delay: delay,
			config: config
		};
	}

	/* -------------------------------------------------------------- rules */

	/**
	 * Renders the rule list.
	 */
	function renderRuleList() {
		var $list = $( '#wpep-rule-list' ).empty();

		if ( ! state.rules.length ) {
			$list.append( $( '<li class="description"></li>' ).text( i18n.noRules ) );

			return;
		}

		state.rules.forEach( function ( rule ) {
			var $name = $( '<span class="wpep-item-name"></span>' ).text( rule.name );

			if ( ! rule.enabled ) {
				$name.append( $( '<span class="wpep-badge wpep-badge-skipped"></span>' ).text( 'off' ) );
			}

			$list.append(
				$( '<li></li>' )
					.attr( 'data-id', rule.id )
					.append( $( '<span class="wpep-drag"></span>' ).text( '⋮⋮' ) )
					.append(
						$( '<button type="button" class="wpep-item"></button>' )
							.attr( 'data-id', rule.id )
							.append( $name )
							.append(
								$( '<span class="wpep-item-meta"></span>' ).text(
									( ( rule.conditions || {} ).conditions || [] ).length + ' / ' + ( rule.actions || [] ).length
								)
							)
					)
			);
		} );

		$list.sortable( {
			handle: '.wpep-drag',
			axis: 'y',
			update: function () {
				var order = [];

				$list.find( 'li[data-id]' ).each( function () {
					order.push( $( this ).attr( 'data-id' ) );
				} );

				request( 'reorder_rules', { order: order } )
					.done( function ( response ) {
						if ( response && response.success ) {
							notice( response.data.message, false );
							refresh( response );
						}
					} );
			}
		} );
	}

	/**
	 * Builds one condition row.
	 *
	 * @param {Object} condition Stored condition.
	 *
	 * @return {jQuery} Row element.
	 */
	function buildCondition( condition ) {
		var $row = $( $( '#wpep-condition-template' ).html() ).filter( '.wpep-condition' );

		condition = condition || {};

		$row.find( '.wpep-condition-subject' ).val( condition.subject || 'category' );
		$row.find( '.wpep-condition-key' ).val( condition.key || '' );
		$row.find( '.wpep-condition-operator' ).val( condition.operator || 'is' );
		$row.find( '.wpep-condition-value' ).val( condition.value || '' );

		toggleKey( $row );

		return $row;
	}

	/**
	 * Shows the key box only for subjects that need one.
	 *
	 * @param {jQuery} $row Condition row.
	 */
	function toggleKey( $row ) {
		var needs = $row.find( '.wpep-condition-subject option:selected' ).attr( 'data-needs-key' ) === '1';

		$row.find( '.wpep-condition-key' ).toggle( needs );
	}

	/**
	 * Builds one nested group.
	 *
	 * @param {Object} group Stored group.
	 *
	 * @return {jQuery} Group element.
	 */
	function buildGroup( group ) {
		var $group = $( $( '#wpep-group-template' ).html() ).filter( '.wpep-condition-group' );

		group = group || {};

		$group.find( '.wpep-group-match' ).first().val( group.match || 'all' );

		var $body = $group.find( '.wpep-group-conditions' ).first();

		( group.conditions || [] ).forEach( function ( condition ) {
			if ( condition.conditions || condition.match ) {
				return;
			}

			$body.append( buildCondition( condition ) );
		} );

		if ( ! $body.children().length ) {
			$body.append( buildCondition( {} ) );
		}

		return $group;
	}

	/**
	 * Builds one action row.
	 *
	 * @param {Object} action Stored action.
	 *
	 * @return {jQuery} Row element.
	 */
	function buildAction( action ) {
		var $row = $( $( '#wpep-action-template' ).html() ).filter( '.wpep-action' );

		action = action || {};

		$row.find( '.wpep-action-type' ).val( action.type || 'assign_profile' );
		$row.find( '.wpep-action-value' ).val( action.value || '' );

		updateActionHint( $row );

		return $row;
	}

	/**
	 * Shows the selected action's hint as a placeholder.
	 *
	 * @param {jQuery} $row Action row.
	 */
	function updateActionHint( $row ) {
		var hint = $row.find( '.wpep-action-type option:selected' ).attr( 'data-hint' ) || '';

		$row.find( '.wpep-action-value' ).attr( 'placeholder', hint ).toggle( '' !== hint );
	}

	/**
	 * Loads one rule into the editor.
	 *
	 * @param {string} id Rule identifier.
	 */
	function editRule( id ) {
		var rule = null;

		state.rules.forEach( function ( candidate ) {
			if ( candidate.id === id ) {
				rule = candidate;
			}
		} );

		if ( ! rule ) {
			return;
		}

		state.current = id;

		$( '#wpep-rule-title' ).text( rule.name );
		$( '#wpep-rule-name' ).val( rule.name );
		$( '#wpep-rule-enabled' ).prop( 'checked', !! rule.enabled );
		$( '#wpep-rule-match' ).val( ( rule.conditions || {} ).match || 'all' );

		var $conditions = $( '#wpep-rule-conditions' ).empty();

		( ( rule.conditions || {} ).conditions || [] ).forEach( function ( entry ) {
			$conditions.append( entry.conditions || entry.match ? buildGroup( entry ) : buildCondition( entry ) );
		} );

		var $actions = $( '#wpep-rule-actions' ).empty();

		( rule.actions || [] ).forEach( function ( action ) {
			$actions.append( buildAction( action ) );
		} );

		showProblems( '#wpep-rule-problems', [] );

		$( '#wpep-rule-editor' ).prop( 'hidden', false );
	}

	/**
	 * Collects the rule editor into a payload.
	 *
	 * @return {Object} Rule payload.
	 */
	function collectRule() {
		var conditions = [];

		$( '#wpep-rule-conditions' ).children().each( function () {
			var $child = $( this );

			if ( $child.hasClass( 'wpep-condition-group' ) ) {
				var nested = [];

				$child.find( '.wpep-group-conditions' ).first().children( '.wpep-condition' ).each( function () {
					nested.push( readCondition( $( this ) ) );
				} );

				conditions.push( {
					match: $child.find( '.wpep-group-match' ).first().val(),
					conditions: nested
				} );

				return;
			}

			conditions.push( readCondition( $child ) );
		} );

		var actions = [];

		$( '#wpep-rule-actions' ).children( '.wpep-action' ).each( function () {
			actions.push( {
				type: $( this ).find( '.wpep-action-type' ).val(),
				value: $( this ).find( '.wpep-action-value' ).val()
			} );
		} );

		return {
			id: state.current || '',
			name: $( '#wpep-rule-name' ).val(),
			enabled: $( '#wpep-rule-enabled' ).is( ':checked' ) ? 1 : 0,
			conditions: { match: $( '#wpep-rule-match' ).val(), conditions: conditions },
			actions: actions
		};
	}

	/**
	 * Reads one condition row.
	 *
	 * @param {jQuery} $row Condition row.
	 *
	 * @return {Object} Condition.
	 */
	function readCondition( $row ) {
		return {
			subject: $row.find( '.wpep-condition-subject' ).val(),
			key: $row.find( '.wpep-condition-key' ).val(),
			operator: $row.find( '.wpep-condition-operator' ).val(),
			value: $row.find( '.wpep-condition-value' ).val()
		};
	}

	/**
	 * Renders the rule tester result.
	 *
	 * @param {Object} data Test result.
	 */
	function renderTest( data ) {
		var $out = $( '#wpep-test-output' ).empty().prop( 'hidden', false );

		$out.append( $( '<h3></h3>' ).text( data.post.title + ' (#' + data.post.id + ')' ) );

		if ( data.skipped ) {
			$out.append( $( '<p class="wpep-result-error"></p>' ).text( data.reason ) );
		}

		var $table = $( '<table class="widefat striped wpep-table"></table>' );
		var $body = $( '<tbody></tbody>' );

		( data.trace || [] ).forEach( function ( entry ) {
			$body.append(
				$( '<tr></tr>' )
					.append(
						$( '<td style="width:110px"></td>' ).append(
							$( '<span></span>' )
								.addClass( 'wpep-badge wpep-badge-' + ( entry.matched ? 'ok' : 'skipped' ) )
								.text( entry.matched ? i18n.matched : i18n.notMatched )
						)
					)
					.append( $( '<td style="width:200px"></td>' ).text( entry.name ) )
					.append(
						$( '<td></td>' )
							.text( entry.reason )
							.append( ( entry.actions || [] ).length ? $( '<br /><code></code>' ).text( ( entry.actions || [] ).join( ', ' ) ) : null )
					)
			);
		} );

		if ( ! ( data.trace || [] ).length ) {
			$body.append( $( '<tr></tr>' ).append( $( '<td colspan="3"></td>' ).text( i18n.noRules ) ) );
		}

		$out.append( $table.append( $body ) );

		var summary = $( '<table class="widefat striped wpep-table wpep-system-table"></table>' );
		var rows = $( '<tbody></tbody>' );

		function row( label, value ) {
			rows.append(
				$( '<tr></tr>' )
					.append( $( '<th scope="row" style="width:220px"></th>' ).text( label ) )
					.append( $( '<td></td>' ).text( value ) )
			);
		}

		row( 'Profile', data.profile.name + ' (' + data.profile.id + ')' );
		row( 'Inheritance', ( data.profile.chain || [] ).join( ' ‹ ' ) );
		row( 'Fields', ( data.fields || [] ).join( ', ' ) );
		row( 'Images', String( ( data.images || [] ).length ) );
		row(
			'Destinations',
			( data.destinations || [] ).map( function ( destination ) {
				return destination.name + ( destination.delay ? ' (+' + destination.delay + 's)' : '' );
			} ).join( ', ' )
		);

		$out.append( summary.append( rows ) );

		$out.append( $( '<h4></h4>' ).text( 'Message' ) );
		$out.append( $( '<pre class="wpep-preview-message"></pre>' ).text( data.message || '' ) );

		$out.append( $( '<h4></h4>' ).text( 'Payload' ) );
		$out.append( $( '<pre class="wpep-preview-message wpep-payload"></pre>' ).text( data.payload || '' ) );
	}

	/* ------------------------------------------------------------- wiring */

	$( function () {
		if ( ! cfg.ajaxUrl ) {
			return;
		}

		// The screen already rendered server-side; this loads the data the
		// editors need without a second page request.
		request( 'platform_state', {} ).done( function ( response ) {
			if ( response && response.success ) {
				apply( response.data );
			}
		} );

		/* profiles */

		$( document ).on( 'click', '#wpep-profile-list .wpep-item', function () {
			editProfile( $( this ).attr( 'data-id' ) );
		} );

		$( '#wpep-new-profile' ).on( 'click', function () {
			var name = window.prompt( i18n.namePrompt, i18n.newProfile );

			if ( null === name ) {
				return;
			}

			request( 'save_profile', { profile: { id: '', name: name } } )
				.done( function ( response ) {
					if ( ! response || ! response.success ) {
						showProblems( '#wpep-profile-problems', response && response.data ? response.data.problems : [] );
						notice( ( response && response.data && response.data.message ) || i18n.failed, true );

						return;
					}

					notice( response.data.message, false );
					refresh( response );
					editProfile( response.data.id );
				} )
				.fail( function () {
					notice( i18n.failed, true );
				} );
		} );

		$( '#wpep-save-profile' ).on( 'click', function () {
			var $button = $( this ).prop( 'disabled', true );

			request( 'save_profile', { profile: collectProfile() } )
				.done( function ( response ) {
					showProblems( '#wpep-profile-problems', response && response.data ? response.data.problems : [] );

					if ( ! response || ! response.success ) {
						notice( ( response && response.data && response.data.message ) || i18n.failed, true );

						return;
					}

					notice( response.data.message, false );
					state.current = response.data.id;
					refresh( response );
				} )
				.fail( function () {
					notice( i18n.failed, true );
				} )
				.always( function () {
					$button.prop( 'disabled', false );
				} );
		} );

		$( '#wpep-duplicate-profile' ).on( 'click', function () {
			if ( ! state.current ) {
				return;
			}

			request( 'duplicate_profile', { id: state.current } )
				.done( function ( response ) {
					if ( response && response.success ) {
						notice( response.data.message, false );
						refresh( response );
						editProfile( response.data.id );
					}
				} );
		} );

		$( '#wpep-delete-profile' ).on( 'click', function () {
			if ( ! state.current || ! window.confirm( i18n.confirmDelete ) ) {
				return;
			}

			request( 'delete_profile', { id: state.current } )
				.done( function ( response ) {
					if ( ! response || ! response.success ) {
						notice( ( response && response.data && response.data.message ) || i18n.failed, true );

						return;
					}

					notice( response.data.message, false );
					state.current = null;
					$( '#wpep-profile-editor' ).prop( 'hidden', true );
					refresh( response );
				} );
		} );

		$( document ).on( 'change', '.wpep-assign', function () {
			var $select = $( this );

			request( 'assign_profile', { scope: $select.attr( 'data-scope' ), profile: $select.val() } )
				.done( function ( response ) {
					if ( ! response || ! response.success ) {
						notice( ( response && response.data && response.data.message ) || i18n.failed, true );

						return;
					}

					notice( response.data.message, false );
				} );
		} );

		/* destinations */

		$( document ).on( 'click', '#wpep-destination-list .wpep-item', function () {
			editDestination( $( this ).attr( 'data-id' ) );
		} );

		$( '#wpep-destination-provider' ).on( 'change', function () {
			renderProviderForm( $( this ).val(), {} );
		} );

		$( '#wpep-new-destination' ).on( 'click', function () {
			var name = window.prompt( i18n.namePrompt, i18n.newDest );

			if ( null === name ) {
				return;
			}

			request( 'save_destination', {
				destination: {
					id: '',
					name: name,
					provider: $( '#wpep-destination-provider' ).val() || 'telegram',
					enabled: 0,
					config: {}
				}
			} ).done( function ( response ) {
				if ( ! response || ! response.success ) {
					notice( ( response && response.data && response.data.message ) || i18n.failed, true );

					return;
				}

				notice( response.data.message, false );
				refresh( response );
				editDestination( response.data.id );
			} );
		} );

		$( '#wpep-save-destination' ).on( 'click', function () {
			var $button = $( this ).prop( 'disabled', true ).text( i18n.saving );

			request( 'save_destination', { destination: collectDestination() } )
				.done( function ( response ) {
					showProblems( '#wpep-destination-problems', response && response.data ? response.data.problems : [] );

					if ( ! response || ! response.success ) {
						notice( ( response && response.data && response.data.message ) || i18n.failed, true );

						return;
					}

					notice( response.data.message, false );
					state.current = response.data.id;
					refresh( response );
				} )
				.fail( function () {
					notice( i18n.failed, true );
				} )
				.always( function () {
					$button.prop( 'disabled', false ).text( $button.attr( 'data-label' ) );
				} );
		} );

		$( '#wpep-test-destination' ).on( 'click', function () {
			if ( ! state.current ) {
				return;
			}

			var $button = $( this ).prop( 'disabled', true ).text( i18n.testing );
			var $out = $( '#wpep-destination-result' );

			request( 'test_destination', { id: state.current } )
				.done( function ( response ) {
					var payload = ( response && response.data ) || {};

					$out
						.prop( 'hidden', false )
						.empty()
						.append(
							$( '<p></p>' )
								.addClass( response && response.success ? 'wpep-result-ok' : 'wpep-result-error' )
								.text( payload.message || i18n.failed )
						);

					if ( payload.body ) {
						$out.append( $( '<pre class="wpep-preview-message"></pre>' ).text( payload.body ) );
					}
				} )
				.fail( function () {
					notice( i18n.failed, true );
				} )
				.always( function () {
					$button.prop( 'disabled', false ).text( $button.attr( 'data-label' ) );
				} );
		} );

		$( '#wpep-duplicate-destination' ).on( 'click', function () {
			if ( ! state.current ) {
				return;
			}

			request( 'duplicate_destination', { id: state.current } )
				.done( function ( response ) {
					if ( response && response.success ) {
						notice( response.data.message, false );
						refresh( response );
					}
				} );
		} );

		$( '#wpep-delete-destination' ).on( 'click', function () {
			if ( ! state.current || ! window.confirm( i18n.confirmDelete ) ) {
				return;
			}

			request( 'delete_destination', { id: state.current } )
				.done( function ( response ) {
					if ( response && response.success ) {
						notice( response.data.message, false );
						state.current = null;
						$( '#wpep-destination-editor' ).prop( 'hidden', true );
						refresh( response );
					}
				} );
		} );

		/* rules */

		$( document ).on( 'click', '#wpep-rule-list .wpep-item', function () {
			editRule( $( this ).attr( 'data-id' ) );
		} );

		$( document ).on( 'change', '.wpep-condition-subject', function () {
			toggleKey( $( this ).closest( '.wpep-condition' ) );
		} );

		$( document ).on( 'change', '.wpep-action-type', function () {
			updateActionHint( $( this ).closest( '.wpep-action' ) );
		} );

		$( document ).on( 'click', '.wpep-remove', function () {
			$( this ).closest( '.wpep-condition, .wpep-condition-group, .wpep-action' ).remove();
		} );

		$( document ).on( 'click', '.wpep-group-add', function () {
			$( this ).closest( '.wpep-condition-group' ).find( '.wpep-group-conditions' ).first().append( buildCondition( {} ) );
		} );

		$( '#wpep-add-condition' ).on( 'click', function () {
			$( '#wpep-rule-conditions' ).append( buildCondition( {} ) );
		} );

		$( '#wpep-add-group' ).on( 'click', function () {
			$( '#wpep-rule-conditions' ).append( buildGroup( {} ) );
		} );

		$( '#wpep-add-action' ).on( 'click', function () {
			$( '#wpep-rule-actions' ).append( buildAction( {} ) );
		} );

		$( '#wpep-new-rule' ).on( 'click', function () {
			var name = window.prompt( i18n.namePrompt, i18n.newRule );

			if ( null === name ) {
				return;
			}

			request( 'save_rule', { rule: { id: '', name: name, enabled: 1, conditions: {}, actions: [] } } )
				.done( function ( response ) {
					if ( ! response || ! response.success ) {
						notice( ( response && response.data && response.data.message ) || i18n.failed, true );

						return;
					}

					notice( response.data.message, false );
					refresh( response );
					editRule( response.data.id );
				} );
		} );

		$( '#wpep-save-rule' ).on( 'click', function () {
			var $button = $( this ).prop( 'disabled', true );

			request( 'save_rule', { rule: collectRule() } )
				.done( function ( response ) {
					showProblems( '#wpep-rule-problems', response && response.data ? response.data.problems : [] );

					if ( ! response || ! response.success ) {
						notice( ( response && response.data && response.data.message ) || i18n.failed, true );

						return;
					}

					notice( response.data.message, false );
					state.current = response.data.id;
					refresh( response );
				} )
				.fail( function () {
					notice( i18n.failed, true );
				} )
				.always( function () {
					$button.prop( 'disabled', false );
				} );
		} );

		$( '#wpep-delete-rule' ).on( 'click', function () {
			if ( ! state.current || ! window.confirm( i18n.confirmDelete ) ) {
				return;
			}

			request( 'delete_rule', { id: state.current } )
				.done( function ( response ) {
					if ( response && response.success ) {
						notice( response.data.message, false );
						state.current = null;
						$( '#wpep-rule-editor' ).prop( 'hidden', true );
						refresh( response );
					}
				} );
		} );

		$( '#wpep-run-test' ).on( 'click', function () {
			var $button = $( this ).prop( 'disabled', true ).text( i18n.testing );

			request( 'test_rules', { post_id: $( '#wpep-test-post' ).val() } )
				.done( function ( response ) {
					if ( ! response || ! response.success ) {
						notice( ( response && response.data && response.data.message ) || i18n.failed, true );

						return;
					}

					renderTest( response.data );
				} )
				.fail( function () {
					notice( i18n.failed, true );
				} )
				.always( function () {
					$button.prop( 'disabled', false ).text( $button.attr( 'data-label' ) );
				} );
		} );

		/* import */

		$( '#wpep-do-import' ).on( 'click', function () {
			var $button = $( this ).prop( 'disabled', true );

			request( 'import', {
				document: $( '#wpep-import' ).val(),
				overwrite: $( '#wpep-import-overwrite' ).is( ':checked' ) ? 1 : 0
			} )
				.done( function ( response ) {
					if ( ! response || ! response.success ) {
						notice( ( response && response.data && response.data.message ) || i18n.failed, true );

						return;
					}

					notice( response.data.message, false );
					showProblems( '#wpep-profile-problems', response.data.errors || [] );
					refresh( response );
				} )
				.fail( function () {
					notice( i18n.failed, true );
				} )
				.always( function () {
					$button.prop( 'disabled', false );
				} );
		} );

		// Remember every button's resting label before a handler swaps it.
		$( '#wpep-save-destination, #wpep-test-destination, #wpep-run-test' ).each( function () {
			$( this ).attr( 'data-label', $( this ).text().trim() );
		} );
	} );
} )( jQuery );
