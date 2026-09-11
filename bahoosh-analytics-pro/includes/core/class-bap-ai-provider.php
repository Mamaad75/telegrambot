<?php
/**
 * Where recommendations come from.
 *
 * @package Bahoosh_Analytics_Pro
 */

defined( 'ABSPATH' ) || exit;

/**
 * Turns an analysis packet into recommendations, entirely inside WordPress.
 *
 * There is no longer an external analysis service. Everything the feature needs
 * — the facts, the model call, the validation, the storage, the execution — runs
 * in this plugin. The site talks to a model the site owner controls, and to
 * nothing else.
 *
 * Three providers:
 *
 * - `llama` — a Llama model served locally by Ollama, llama.cpp, LM Studio or
 *   vLLM. This is the default. Nothing leaves the machine, there is no key and
 *   no bill, and the shop's product names and revenue figures never travel to a
 *   third party. It speaks the OpenAI chat-completions shape, which every one of
 *   those servers exposes.
 * - `openai_compatible` — the same wire protocol pointed at a remote service:
 *   a free tier, a paid endpoint, a company gateway. Identical code, different
 *   address, and a key when the service wants one.
 * - `local` — no network, no key, no model at all. Derives recommendations from
 *   the facts using explicit rules. This is not a toy: it makes the feature
 *   testable today, it is what answers when a model is unreachable, and its
 *   output is reproducible, which a model's is not.
 *
 * The model never sees a customer. It receives the packet built by
 * {@see BAP_Analysis_Packet}, which contains aggregates and product figures and
 * nothing that identifies a person.
 *
 * @since 4.3.0
 */
class BAP_AI_Provider {

	const PROVIDER_LOCAL  = 'local';
	const PROVIDER_LLAMA  = 'llama';
	const PROVIDER_OPENAI = 'openai_compatible';
	const PROVIDER_WEBHOOK = 'webhook';

	const OPTION_API_KEY = 'bap_ai_provider_key';

	/**
	 * Where a local Llama server listens by default.
	 *
	 * Ollama's own default. `127.0.0.1` rather than `localhost` on purpose: on
	 * hosts that resolve `localhost` to `::1` first, PHP spends a failed IPv6
	 * connection before trying IPv4, which turns an instant answer into a pause.
	 *
	 * @var string
	 */
	const LLAMA_DEFAULT_URL = 'http://127.0.0.1:11434/v1';

	/**
	 * Model asked for when the administrator has not named one.
	 *
	 * @var string
	 */
	const LLAMA_DEFAULT_MODEL = 'llama3.1:8b';

	/**
	 * Seconds to wait for a model. Long enough for a real answer from an 8B
	 * model on CPU, short enough that an admin screen never appears to hang.
	 *
	 * @var int
	 */
	const TIMEOUT = 120;

	/**
	 * Seconds to wait when only checking whether a server is there.
	 *
	 * @var int
	 */
	const PROBE_TIMEOUT = 8;

	/**
	 * Produces recommendations for a packet.
	 *
	 * @param array $packet Analysis packet.
	 * @return array{ok:bool,provider:string,recommendations:array,error:string,fallback:bool}
	 */
	public static function analyze( array $packet ) {
		$provider = self::current();

		// A packet with no facts is never sent anywhere. A model handed nothing
		// still produces fluent, confident, entirely invented advice — which is
		// the one failure mode this feature must not have.
		if ( empty( $packet['facts'] ) ) {
			return self::result( false, $provider, array(), __( 'داده‌ای برای تحلیل وجود ندارد.', 'bahoosh-analytics-pro' ) );
		}

		if ( self::PROVIDER_LOCAL === $provider ) {
			return self::result( true, self::PROVIDER_LOCAL, self::attach_actions( BAP_Local_Insights::derive( $packet ), $packet ), '' );
		}

		$result = self::PROVIDER_WEBHOOK === $provider
			? self::analyze_webhook( $packet )
			: self::analyze_chat( $packet, $provider );

		// A model that is down must not mean a blank screen. The rule engine
		// answers from the same facts, and the caller is told which source
		// actually produced what it is looking at.
		if ( empty( $result['ok'] ) ) {
			$fallback                  = BAP_Local_Insights::derive( $packet );
			$result['provider']        = self::PROVIDER_LOCAL;
			$result['ok']              = ! empty( $fallback );
			$result['fallback']        = true;
			$result['recommendations'] = self::attach_actions( $fallback, $packet );

			return $result;
		}

		$result['recommendations'] = self::attach_actions( $result['recommendations'], $packet );

		return $result;
	}

	/**
	 * Calls an OpenAI-compatible chat-completions endpoint.
	 *
	 * One method serves both `llama` and `openai_compatible` because the wire
	 * format is the same; only the defaults and the key differ.
	 *
	 * @param array  $packet   Analysis packet.
	 * @param string $provider Provider id, used for reporting.
	 * @return array Result.
	 */
	private static function analyze_chat( array $packet, $provider ) {
		$base  = self::base_url();
		$key   = self::api_key();
		$model = self::model();

		if ( '' === $base || '' === $model ) {
			return self::result( false, $provider, array(), __( 'آدرس سرویس مدل یا نام مدل تنظیم نشده است.', 'bahoosh-analytics-pro' ) );
		}

		$headers = array( 'Content-Type' => 'application/json' );

		// A local Llama server needs no key at all, and several free endpoints
		// do not either, so an empty key is a valid configuration rather than an
		// error.
		if ( '' !== $key ) {
			$headers['Authorization'] = 'Bearer ' . $key;
		}

		$body = array(
			'model'       => $model,
			// Low, not zero. This is an analyst reading numbers, not a writer;
			// the same facts should produce close to the same advice twice.
			'temperature' => 0.2,
			'messages'    => array(
				array(
					'role'    => 'system',
					'content' => self::system_prompt(),
				),
				array(
					'role'    => 'user',
					'content' => wp_json_encode( $packet ),
				),
			),
			// Asked for, not relied on: the response is parsed defensively
			// because plenty of endpoints ignore this hint. Ollama honours it.
			'response_format' => array( 'type' => 'json_object' ),
		);

		$response = wp_remote_post(
			self::chat_endpoint( $base ),
			array(
				'timeout' => self::TIMEOUT,
				'headers' => $headers,
				'body'    => wp_json_encode( $body ),
			)
		);

		if ( is_wp_error( $response ) ) {
			BAP_Debug_Log::log( 'ai', 'provider request failed', array( 'error' => $response->get_error_message() ) );
			return self::result( false, $provider, array(), self::connection_hint( $response->get_error_message() ) );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$raw    = (string) wp_remote_retrieve_body( $response );

		if ( $status < 200 || $status >= 300 ) {
			BAP_Debug_Log::log( 'ai', 'provider returned an error status', array( 'status' => $status ) );

			// 404 from a server that is running almost always means the model
			// name is wrong — worth saying, because the generic message sends
			// people to check a network that is fine.
			$message = 404 === $status
				? sprintf(
					/* translators: %s: model name. */
					__( 'سرویس مدل در دسترس است اما مدل «%s» را نمی‌شناسد. نام مدل را بررسی کنید.', 'bahoosh-analytics-pro' ),
					$model
				)
				: sprintf(
					/* translators: %d: HTTP status code. */
					__( 'سرویس مدل با کد %d پاسخ داد.', 'bahoosh-analytics-pro' ),
					$status
				);

			return self::result( false, $provider, array(), $message );
		}

		$decoded = json_decode( $raw, true );
		$content = $decoded['choices'][0]['message']['content'] ?? '';

		if ( ! is_string( $content ) || '' === $content ) {
			return self::result( false, $provider, array(), __( 'پاسخ مدل قابل خواندن نبود.', 'bahoosh-analytics-pro' ) );
		}

		$items = self::parse_recommendations( $content, $packet );

		if ( ! $items ) {
			return self::result( false, $provider, array(), __( 'مدل هیچ پیشنهاد معتبری تولید نکرد.', 'bahoosh-analytics-pro' ) );
		}

		return self::result( true, $provider, $items, '' );
	}

	/**
	 * Posts the packet to an automation webhook and reads back its answer.
	 *
	 * Built for n8n, Make, Zapier or anything else that accepts a POST and
	 * replies with text: the workflow owns the model call, its key and its
	 * billing, and this plugin never sees any of them. That is the appeal — a
	 * shop can use GPT-4 without an OpenAI key ever touching WordPress.
	 *
	 * The trade is worth stating plainly, because it is the opposite of the
	 * Llama option: the packet leaves the site. It contains no customers, but it
	 * does contain product names, order counts and revenue, and those travel to
	 * the workflow and onward to whatever model it calls.
	 *
	 * The reply is parsed by exactly the same hostile-input path as a direct
	 * model reply. A workflow is not more trusted for being the site owner's
	 * own: it still cannot cite a fact that was not sent, and it still cannot
	 * supply an executable action.
	 *
	 * @param array $packet Analysis packet.
	 * @return array Result.
	 */
	private static function analyze_webhook( array $packet ) {
		$url = self::base_url();

		if ( '' === $url ) {
			return self::result( false, self::PROVIDER_WEBHOOK, array(), __( 'آدرس وبهوک تنظیم نشده است.', 'bahoosh-analytics-pro' ) );
		}

		$headers = array( 'Content-Type' => 'application/json' );
		$key     = self::api_key();

		// A public webhook URL is a password that anyone who sees it can use.
		// When a shared secret is configured it is sent as a header the workflow
		// can check before doing anything expensive.
		if ( '' !== $key ) {
			$headers['Authorization'] = 'Bearer ' . $key;
			$headers['X-Bahoosh-Token'] = $key;
		}

		$response = wp_remote_post(
			$url,
			array(
				'timeout' => self::TIMEOUT,
				'headers' => $headers,
				'body'    => wp_json_encode(
					array(
						'source'        => 'bahoosh-analytics-pro',
						'version'       => BAP_VERSION,
						'site_id'       => (string) ( $packet['site_id'] ?? '' ),
						'run_id'        => (string) ( $packet['run_id'] ?? '' ),
						// Sent alongside the data so the workflow does not have
						// to keep its own copy in sync with this plugin's rules.
						'system_prompt' => self::system_prompt(),
						'packet'        => $packet,
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			BAP_Debug_Log::log( 'ai', 'webhook request failed', array( 'error' => $response->get_error_message() ) );
			return self::result( false, self::PROVIDER_WEBHOOK, array(), $response->get_error_message() );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$raw    = (string) wp_remote_retrieve_body( $response );

		if ( $status < 200 || $status >= 300 ) {
			// 404 from n8n almost always means the workflow is saved but not
			// active, or the test URL was copied instead of the production one.
			$message = 404 === $status
				? __( 'وبهوک پیدا نشد. در n8n مطمئن شوید ورک‌فلو Active است و آدرس Production را کپی کرده‌اید، نه آدرس Test را.', 'bahoosh-analytics-pro' )
				: sprintf(
					/* translators: %d: HTTP status code. */
					__( 'وبهوک با کد %d پاسخ داد.', 'bahoosh-analytics-pro' ),
					$status
				);

			return self::result( false, self::PROVIDER_WEBHOOK, array(), $message );
		}

		$items = self::parse_recommendations( self::webhook_content( $raw ), $packet );

		if ( ! $items ) {
			return self::result(
				false,
				self::PROVIDER_WEBHOOK,
				array(),
				__( 'پاسخ وبهوک هیچ پیشنهاد معتبری نداشت. خروجی باید JSON با آرایه recommendations باشد و هر پیشنهاد باید به شناسه یک Fact ارسالی اشاره کند.', 'bahoosh-analytics-pro' )
			);
		}

		return self::result( true, self::PROVIDER_WEBHOOK, $items, '' );
	}

	/**
	 * Digs the model's text out of whatever shape the workflow returned.
	 *
	 * Automation tools wrap their output differently and change it between
	 * versions: n8n's "Respond to Webhook" node returns the raw text, but its
	 * AI nodes emit `{"output": …}` or `{"text": …}`, and an unconfigured
	 * Respond node returns the whole item array. All of those are accepted,
	 * because the alternative is an error message that blames the shop owner
	 * for a node setting three screens away.
	 *
	 * @param string $raw Response body.
	 * @return string Content to parse.
	 */
	public static function webhook_content( $raw ) {
		$raw     = trim( (string) $raw );
		$decoded = json_decode( $raw, true );

		if ( ! is_array( $decoded ) ) {
			return $raw;
		}

		// A bare list of items: take the first, which is what a single-item
		// workflow run produces.
		if ( isset( $decoded[0] ) && is_array( $decoded[0] ) ) {
			$decoded = $decoded[0];
		}

		// Already the shape we want.
		if ( isset( $decoded['recommendations'] ) ) {
			return wp_json_encode( $decoded );
		}

		foreach ( array( 'output', 'text', 'content', 'message', 'response', 'result', 'data' ) as $key ) {
			if ( ! isset( $decoded[ $key ] ) ) {
				continue;
			}

			$value = $decoded[ $key ];

			if ( is_string( $value ) ) {
				return $value;
			}

			if ( is_array( $value ) ) {
				return wp_json_encode( $value );
			}
		}

		return $raw;
	}

	/**
	 * Checks whether the configured model server answers, without analysing.
	 *
	 * Exists so the settings screen can say "connected, and here are the models
	 * it has" instead of leaving an administrator to discover a typo the first
	 * time they run an analysis.
	 *
	 * @return array{ok:bool,error:string,models:string[]}
	 */
	public static function probe() {
		$provider = self::current();

		if ( self::PROVIDER_LOCAL === $provider ) {
			return array(
				'ok'     => true,
				'error'  => '',
				'models' => array(),
				'note'   => __( 'موتور قانون‌محور داخلی فعال است و به هیچ سرویسی وصل نمی‌شود.', 'bahoosh-analytics-pro' ),
			);
		}

		$base = self::base_url();

		if ( '' === $base ) {
			return array(
				'ok'     => false,
				'error'  => __( 'آدرس سرویس مدل تنظیم نشده است.', 'bahoosh-analytics-pro' ),
				'models' => array(),
			);
		}

		// A webhook has no model list to ask for, so the test is the real thing
		// in miniature: one POST with a single fact, checked for a parsable
		// answer. Anything less would report "connected" for a workflow that
		// returns the wrong shape, which is the failure people actually hit.
		if ( self::PROVIDER_WEBHOOK === $provider ) {
			$probe_packet = array(
				'schema_version' => 1,
				'site_id'        => BAP_Settings::resolved_site_id(),
				'run_id'         => 'run_connection_test',
				'focus'          => 'revenue',
				'period'         => array( 'from' => gmdate( 'c' ), 'to' => gmdate( 'c' ) ),
				'data_quality'   => array( 'score' => 0, 'warnings' => array( 'connection test' ) ),
				'facts'          => array(
					array(
						'id'          => 'fact_connection_test',
						'kind'        => 'diagnostic.ping',
						'label'       => 'Connection test',
						'value'       => array( 'ok' => true ),
						'sample_size' => 1,
						'dimensions'  => array(),
					),
				),
			);

			$result = self::analyze_webhook( $probe_packet );

			return array(
				'ok'     => ! empty( $result['ok'] ),
				'error'  => (string) $result['error'],
				'models' => array(),
				'note'   => ! empty( $result['ok'] )
					? __( 'وبهوک پاسخ داد و خروجی آن قابل خواندن بود.', 'bahoosh-analytics-pro' )
					: '',
			);
		}

		$headers = array();
		$key     = self::api_key();

		if ( '' !== $key ) {
			$headers['Authorization'] = 'Bearer ' . $key;
		}

		$response = wp_remote_get(
			rtrim( $base, '/' ) . '/models',
			array(
				'timeout' => self::PROBE_TIMEOUT,
				'headers' => $headers,
			)
		);

		if ( is_wp_error( $response ) ) {
			return array(
				'ok'     => false,
				'error'  => self::connection_hint( $response->get_error_message() ),
				'models' => array(),
			);
		}

		$status = (int) wp_remote_retrieve_response_code( $response );

		if ( $status < 200 || $status >= 300 ) {
			return array(
				'ok'     => false,
				'error'  => sprintf(
					/* translators: %d: HTTP status code. */
					__( 'سرویس مدل با کد %d پاسخ داد.', 'bahoosh-analytics-pro' ),
					$status
				),
				'models' => array(),
			);
		}

		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$models  = array();

		foreach ( (array) ( $decoded['data'] ?? array() ) as $row ) {
			if ( isset( $row['id'] ) && is_scalar( $row['id'] ) ) {
				$models[] = sanitize_text_field( (string) $row['id'] );
			}
		}

		$models  = array_slice( $models, 0, 50 );
		$wanted  = self::model();
		$present = ! $models || in_array( $wanted, $models, true );

		return array(
			'ok'     => true,
			'error'  => '',
			'models' => $models,
			'note'   => $present
				? ''
				: sprintf(
					/* translators: %s: model name. */
					__( 'سرویس پاسخ داد اما مدل «%s» در فهرست آن نیست.', 'bahoosh-analytics-pro' ),
					$wanted
				),
		);
	}

	/**
	 * Builds the chat endpoint from a configured root.
	 *
	 * Administrators paste whatever their server's README showed them, which is
	 * sometimes the root, sometimes `/v1`, and sometimes the full completions
	 * URL. All three are accepted rather than turned into a support question.
	 *
	 * @param string $base Configured URL.
	 * @return string
	 */
	public static function chat_endpoint( $base ) {
		$base = rtrim( trim( (string) $base ), '/' );

		if ( '' === $base ) {
			return '';
		}

		if ( preg_match( '#/chat/completions$#', $base ) ) {
			return $base;
		}

		// Ollama serves the OpenAI surface under `/v1` and its native API at the
		// root, so a bare host needs `/v1` appended or every call 404s.
		if ( ! preg_match( '#/v\d+$#', $base ) ) {
			$base .= '/v1';
		}

		return $base . '/chat/completions';
	}

	/**
	 * Turns a transport error into something an administrator can act on.
	 *
	 * @param string $error Raw WP_Error message.
	 * @return string
	 */
	private static function connection_hint( $error ) {
		$error = (string) $error;

		if ( false !== stripos( $error, 'refused' ) || false !== stripos( $error, 'connect' ) ) {
			return sprintf(
				/* translators: %s: configured model server URL. */
				__( 'اتصال به %s برقرار نشد. سرویس مدل روشن است؟ برای اولاما دستور «ollama serve» باید در حال اجرا باشد.', 'bahoosh-analytics-pro' ),
				self::base_url()
			);
		}

		if ( false !== stripos( $error, 'timed out' ) || false !== stripos( $error, 'timeout' ) ) {
			return __( 'سرویس مدل در زمان تعیین‌شده پاسخ نداد. مدل‌های بزرگ روی پردازنده کند هستند؛ یک مدل کوچک‌تر را امتحان کنید.', 'bahoosh-analytics-pro' );
		}

		return $error;
	}

	/**
	 * Attaches executable actions to recommendations.
	 *
	 * This is the part that makes the feature an agent rather than a report, and
	 * the direction matters: **the plugin builds the action, not the model.**
	 * A recommendation cites fact ids; those facts are looked up in the packet
	 * the plugin itself computed; the action's product ids, discount and dates
	 * come from those facts and from the administrator's own caps. Model text
	 * decides *whether* something is worth doing. It never supplies a number
	 * that will be written to the shop.
	 *
	 * Nothing here executes. It only proposes.
	 *
	 * @param array $items  Recommendations.
	 * @param array $packet The packet they were derived from.
	 * @return array
	 */
	private static function attach_actions( array $items, array $packet ) {
		if ( ! BAP_Commerce_Agent::enabled() ) {
			return $items;
		}

		$facts = array();
		foreach ( $packet['facts'] as $fact ) {
			if ( isset( $fact['id'] ) ) {
				$facts[ (string) $fact['id'] ] = $fact;
			}
		}

		foreach ( $items as $index => $item ) {
			$cited = array();
			foreach ( (array) ( $item['evidence'] ?? array() ) as $fact_id ) {
				if ( isset( $facts[ $fact_id ] ) ) {
					$cited[] = $facts[ $fact_id ];
				}
			}

			$items[ $index ]['action'] = BAP_Commerce_Agent::propose( $cited );
		}

		return $items;
	}

	/**
	 * Extracts recommendations from a model's reply.
	 *
	 * Treated as hostile input throughout. A model may wrap JSON in prose, fence
	 * it in markdown, return a bare array, cite facts that do not exist, or
	 * propose an action that is not in the allowlist. None of that may reach
	 * storage, so each item is checked against the packet it was supposed to be
	 * reasoning about.
	 *
	 * @param string $content Raw model content.
	 * @param array  $packet  The packet that was sent.
	 * @return array Valid recommendations.
	 */
	public static function parse_recommendations( $content, array $packet ) {
		$content = trim( (string) $content );

		// Strip a markdown fence if one is present.
		if ( preg_match( '/```(?:json)?\s*(.+?)\s*```/s', $content, $matches ) ) {
			$content = $matches[1];
		}

		$decoded = json_decode( $content, true );

		// Smaller Llama models like to introduce their JSON ("Here is the
		// analysis:"). Rather than fail the whole run over a greeting, take the
		// outermost JSON object and try again.
		if ( ! is_array( $decoded ) ) {
			$start = strpos( $content, '{' );
			$end   = strrpos( $content, '}' );

			if ( false !== $start && false !== $end && $end > $start ) {
				$decoded = json_decode( substr( $content, $start, $end - $start + 1 ), true );
			}
		}

		if ( ! is_array( $decoded ) ) {
			return array();
		}

		$items = $decoded['recommendations'] ?? $decoded;

		if ( ! is_array( $items ) ) {
			return array();
		}

		$known_facts = array();
		foreach ( $packet['facts'] as $fact ) {
			if ( isset( $fact['id'] ) ) {
				$known_facts[ (string) $fact['id'] ] = true;
			}
		}

		$run_id = (string) ( $packet['run_id'] ?? 'run_local' );
		$valid  = array();

		foreach ( $items as $index => $item ) {
			if ( ! is_array( $item ) || empty( $item['title'] ) ) {
				continue;
			}

			// Every cited fact must exist in the packet. A model that invents an
			// id has invented the evidence behind it, and a recommendation whose
			// evidence cannot be checked is exactly what this whole design is
			// built to prevent.
			$evidence = array();
			foreach ( (array) ( $item['evidence'] ?? array() ) as $fact_id ) {
				$fact_id = (string) $fact_id;
				if ( isset( $known_facts[ $fact_id ] ) ) {
					$evidence[] = $fact_id;
				}
			}

			if ( ! $evidence ) {
				BAP_Debug_Log::log(
					'ai',
					'recommendation discarded: no verifiable evidence',
					array( 'title' => BAP_Debug_Log::mask( (string) $item['title'] ) )
				);
				continue;
			}

			$valid[] = array(
				'id'           => 'rec_' . substr( md5( $run_id . '|' . $index . '|' . $item['title'] ), 0, 20 ),
				'title'        => substr( sanitize_text_field( (string) $item['title'] ), 0, 180 ),
				'summary'      => substr( sanitize_textarea_field( (string) ( $item['summary'] ?? '' ) ), 0, 1200 ),
				'rationale'    => substr( sanitize_textarea_field( (string) ( $item['rationale'] ?? '' ) ), 0, 2400 ),
				'priority'     => in_array( (string) ( $item['priority'] ?? '' ), array( 'critical', 'high', 'medium', 'low' ), true ) ? (string) $item['priority'] : 'medium',
				'confidence'   => max( 0, min( 100, (int) ( $item['confidence'] ?? 50 ) ) ),
				'impact'       => substr( sanitize_text_field( (string) ( $item['impact'] ?? '' ) ), 0, 500 ),
				'evidence'     => array_slice( array_values( array_unique( $evidence ) ), 0, 12 ),
				// Any `action` the model wrote is dropped here. Executable
				// actions are built by the plugin from the cited facts in
				// `attach_actions()`, so a model can never name the product or
				// choose the discount that gets written to the shop.
				'action'       => null,
				'created_at'   => gmdate( 'c' ),
				'model_run_id' => $run_id,
			);
		}

		return $valid;
	}

	/**
	 * The instruction given to the model.
	 *
	 * @return string
	 */
	public static function system_prompt() {
		return trim(
			"You are an e-commerce analyst for a WordPress/WooCommerce shop. You will receive a JSON analysis packet containing facts computed from the shop's own data.

RULES, all mandatory:
1. Use ONLY the numbers in `facts`. Never invent, estimate or extrapolate a figure. If the packet does not contain something, do not discuss it.
2. Every recommendation MUST cite the `id` of at least one fact in `evidence`. Recommendations without verifiable evidence are discarded before an administrator ever sees them.
3. Respect `sample_size`. A fact with a small sample supports a cautious suggestion at low confidence, not a firm one. Read `data_quality.warnings` and let them lower your confidence.
4. Be specific and actionable. 'Improve the checkout' is useless; 'the /checkout page loses 43% of shoppers who reach it — audit its form fields and payment methods' is useful.
5. Write for a shop owner, not an analyst. Persian (Farsi) output for every text field.
6. Never mention individual customers; the packet intentionally contains none.
7. Do not write an `action` field. The plugin decides what is executable, from the facts you cite. Describe the change in words instead.

Focus areas: which device converts better and what to do about it; where in the funnel shoppers abandon and what the likely cause is; which products sell best and how to capitalise; which sell worst and how to fix that; and which products are bought together and should be bundled.

Aim for between 3 and 8 recommendations, ordered by how much money they are worth.

Return ONLY JSON: {\"recommendations\":[{\"title\":\"…\",\"summary\":\"…\",\"rationale\":\"…\",\"priority\":\"critical|high|medium|low\",\"confidence\":0-100,\"impact\":\"…\",\"evidence\":[\"fact_…\"]}]}"
		);
	}

	/**
	 * The configured provider.
	 *
	 * @return string
	 */
	public static function current() {
		$provider = (string) BAP_Settings::get( 'ai_provider', self::PROVIDER_LLAMA );

		return in_array( $provider, self::providers(), true ) ? $provider : self::PROVIDER_LLAMA;
	}

	/**
	 * Every valid provider id.
	 *
	 * @return string[]
	 */
	public static function providers() {
		return array( self::PROVIDER_LLAMA, self::PROVIDER_WEBHOOK, self::PROVIDER_OPENAI, self::PROVIDER_LOCAL );
	}

	/**
	 * Configured endpoint root, with the Llama default filled in.
	 *
	 * @return string
	 */
	public static function base_url() {
		$url = trim( (string) BAP_Settings::get( 'ai_provider_url', '' ) );

		// The localhost default only stands in for a model on this machine, and
		// on shared or managed WordPress hosting there is never one: the model
		// lives on a separate server and its address has to be given. Falling
		// back to 127.0.0.1 there produces "connection refused" and sends the
		// shop owner looking for a service that was never meant to be local.
		if ( '' === $url && self::PROVIDER_LLAMA === self::current() && self::local_model_plausible() ) {
			return self::LLAMA_DEFAULT_URL;
		}

		return $url;
	}

	/**
	 * Whether a model on this same machine is even worth trying.
	 *
	 * @return bool
	 */
	private static function local_model_plausible() {
		/**
		 * Filters whether the localhost Llama default applies.
		 *
		 * @since 4.5.0
		 *
		 * @param bool $plausible Whether to fall back to 127.0.0.1.
		 */
		return (bool) apply_filters( 'bap_local_model_plausible', false );
	}

	/**
	 * Configured model name, with the Llama default filled in.
	 *
	 * @return string
	 */
	public static function model() {
		$model = trim( (string) BAP_Settings::get( 'ai_provider_model', '' ) );

		if ( '' === $model && self::PROVIDER_LLAMA === self::current() ) {
			return self::LLAMA_DEFAULT_MODEL;
		}

		return $model;
	}

	/**
	 * The provider key.
	 *
	 * Stored outside the main settings array and never autoloaded, for the same
	 * reason the collector key is: a secret that is not in memory on every page
	 * load cannot be serialised into one by accident.
	 *
	 * @return string
	 */
	public static function api_key() {
		$key = (string) get_option( self::OPTION_API_KEY, '' );

		/**
		 * Filters the AI provider key, e.g. to read it from an environment
		 * variable rather than the database.
		 *
		 * @since 4.3.0
		 *
		 * @param string $key Provider key.
		 */
		return (string) apply_filters( 'bap_ai_provider_key', $key );
	}

	/**
	 * Stores the provider key.
	 *
	 * @param string $key Key.
	 * @return void
	 */
	public static function set_api_key( $key ) {
		$key = preg_replace( '/[^\x21-\x7E]/', '', (string) $key );
		update_option( self::OPTION_API_KEY, $key, false );
	}

	/**
	 * Normalises a result.
	 *
	 * @param bool   $ok       Success.
	 * @param string $provider Provider id.
	 * @param array  $items    Recommendations.
	 * @param string $error    Error message.
	 * @return array
	 */
	private static function result( $ok, $provider, array $items, $error ) {
		return array(
			'ok'              => (bool) $ok,
			'provider'        => (string) $provider,
			'recommendations' => $items,
			'error'           => (string) $error,
			'fallback'        => false,
		);
	}
}
