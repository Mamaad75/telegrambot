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
 * The providers:
 *
 * - `llama` — a Llama model served locally by Ollama, llama.cpp, LM Studio or
 *   vLLM. This is the default. Nothing leaves the machine, there is no key and
 *   no bill, and the shop's product names and revenue figures never travel to a
 *   third party. It speaks the OpenAI chat-completions shape, which every one of
 *   those servers exposes.
 * - `gemini` — Google's Gemini through an AI Studio key. The cheapest way to
 *   get a capable model running in minutes: a key is free to create and the
 *   free tier allows a modest number of requests a day, which is the right
 *   shape for this feature because an analysis is run on demand, not per
 *   visitor. The packet leaves the site, same trade as the webhook below.
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
	const PROVIDER_GEMINI  = 'gemini';

	const OPTION_API_KEY = 'bap_ai_provider_key';

	/**
	 * Gemini's API root.
	 *
	 * Filled in automatically, because unlike a Llama server there is only one
	 * address and nobody should have to find it. Overriding it is still allowed,
	 * for a regional endpoint or a corporate proxy.
	 *
	 * @var string
	 */
	const GEMINI_DEFAULT_URL = 'https://generativelanguage.googleapis.com/v1beta';

	/**
	 * Gemini model asked for by default.
	 *
	 * A Flash model on purpose: it is the one the free tier is generous with,
	 * and reading a few dozen precomputed numbers does not need the large one.
	 *
	 * @var string
	 */
	const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

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

		if ( self::PROVIDER_WEBHOOK === $provider ) {
			$result = self::analyze_webhook( $packet );
		} elseif ( self::PROVIDER_GEMINI === $provider ) {
			$result = self::analyze_gemini( $packet );
		} else {
			$result = self::analyze_chat( $packet, $provider );
		}

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
	 * Asks the configured model one question and returns its text.
	 *
	 * {@see analyze()} is built around the analysis packet: it attaches
	 * executable actions, falls back to the rule engine and verifies evidence
	 * ids. A second feature that needs a model for something else — matching a
	 * failed search term to the catalogue, say — needs none of that, and
	 * routing it through analyze() would mean pretending its question is an
	 * analysis packet.
	 *
	 * So this is the plain call: one system prompt, one user payload, text back.
	 * It speaks whichever provider is configured, and deliberately refuses the
	 * `local` provider rather than inventing an answer — a caller that needs to
	 * work without a model must bring its own deterministic path.
	 *
	 * @param string $system  System prompt.
	 * @param mixed  $payload User payload; arrays are JSON-encoded.
	 * @return array{ok:bool,text:string,error:string,provider:string}
	 */
	public static function complete( $system, $payload ) {
		$provider = self::current();
		$user     = is_string( $payload ) ? $payload : (string) wp_json_encode( $payload );

		if ( self::PROVIDER_LOCAL === $provider ) {
			return array(
				'ok'       => false,
				'text'     => '',
				'provider' => $provider,
				'error'    => __( 'موتور قانون‌محور داخلی مدل زبانی ندارد.', 'bahoosh-analytics-pro' ),
			);
		}

		if ( self::PROVIDER_GEMINI === $provider ) {
			return self::complete_gemini( $system, $user );
		}

		if ( self::PROVIDER_WEBHOOK === $provider ) {
			return self::complete_webhook( $system, $user );
		}

		return self::complete_chat( $system, $user, $provider );
	}

	/**
	 * `complete()` over an OpenAI-compatible endpoint.
	 *
	 * @param string $system   System prompt.
	 * @param string $user     User payload.
	 * @param string $provider Provider id.
	 * @return array
	 */
	private static function complete_chat( $system, $user, $provider ) {
		$base  = self::base_url();
		$model = self::model();

		if ( '' === $base || '' === $model ) {
			return self::completion( false, '', $provider, __( 'آدرس سرویس مدل یا نام مدل تنظیم نشده است.', 'bahoosh-analytics-pro' ) );
		}

		$headers = array( 'Content-Type' => 'application/json' );
		$key     = self::api_key();

		if ( '' !== $key ) {
			$headers['Authorization'] = 'Bearer ' . $key;
		}

		$response = wp_remote_post(
			self::chat_endpoint( $base ),
			array(
				'timeout' => self::TIMEOUT,
				'headers' => $headers,
				'body'    => wp_json_encode(
					array(
						'model'           => $model,
						'temperature'     => 0.1,
						'messages'        => array(
							array( 'role' => 'system', 'content' => $system ),
							array( 'role' => 'user', 'content' => $user ),
						),
						'response_format' => array( 'type' => 'json_object' ),
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return self::completion( false, '', $provider, self::connection_hint( $response->get_error_message() ) );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );

		if ( $status < 200 || $status >= 300 ) {
			return self::completion(
				false,
				'',
				$provider,
				sprintf(
					/* translators: %d: HTTP status code. */
					__( 'سرویس مدل با کد %d پاسخ داد.', 'bahoosh-analytics-pro' ),
					$status
				)
			);
		}

		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$text    = is_array( $decoded ) ? (string) ( $decoded['choices'][0]['message']['content'] ?? '' ) : '';

		return '' === trim( $text )
			? self::completion( false, '', $provider, __( 'پاسخ مدل قابل خواندن نبود.', 'bahoosh-analytics-pro' ) )
			: self::completion( true, $text, $provider, '' );
	}

	/**
	 * `complete()` over Gemini.
	 *
	 * @param string $system System prompt.
	 * @param string $user   User payload.
	 * @return array
	 */
	private static function complete_gemini( $system, $user ) {
		$key = self::api_key();

		if ( '' === $key ) {
			return self::completion( false, '', self::PROVIDER_GEMINI, __( 'کلید Google AI Studio وارد نشده است.', 'bahoosh-analytics-pro' ) );
		}

		$response = wp_remote_post(
			self::gemini_endpoint( self::base_url(), self::model(), 'generateContent' ),
			array(
				'timeout' => self::TIMEOUT,
				'headers' => array( 'Content-Type' => 'application/json', 'x-goog-api-key' => $key ),
				'body'    => wp_json_encode(
					array(
						'system_instruction' => array( 'parts' => array( array( 'text' => $system ) ) ),
						'contents'           => array( array( 'role' => 'user', 'parts' => array( array( 'text' => $user ) ) ) ),
						'generationConfig'   => array( 'temperature' => 0.1, 'responseMimeType' => 'application/json' ),
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return self::completion( false, '', self::PROVIDER_GEMINI, self::connection_hint( $response->get_error_message() ) );
		}

		$status  = (int) wp_remote_retrieve_response_code( $response );
		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$decoded = is_array( $decoded ) ? $decoded : array();

		if ( $status < 200 || $status >= 300 ) {
			return self::completion( false, '', self::PROVIDER_GEMINI, self::gemini_error( $status, $decoded ) );
		}

		$text = self::gemini_content( $decoded );

		return '' === $text
			? self::completion( false, '', self::PROVIDER_GEMINI, self::gemini_empty_reason( $decoded ) )
			: self::completion( true, $text, self::PROVIDER_GEMINI, '' );
	}

	/**
	 * `complete()` over an automation webhook.
	 *
	 * The workflow receives a `task` field so one webhook can serve more than
	 * one feature and branch on it, instead of needing a second URL.
	 *
	 * @param string $system System prompt.
	 * @param string $user   User payload.
	 * @return array
	 */
	private static function complete_webhook( $system, $user ) {
		$url = self::base_url();

		if ( '' === $url ) {
			return self::completion( false, '', self::PROVIDER_WEBHOOK, __( 'آدرس وبهوک تنظیم نشده است.', 'bahoosh-analytics-pro' ) );
		}

		$headers = array( 'Content-Type' => 'application/json' );
		$key     = self::api_key();

		if ( '' !== $key ) {
			$headers['Authorization']   = 'Bearer ' . $key;
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
						'task'          => 'search_rescue',
						'system_prompt' => $system,
						'payload'       => json_decode( $user, true ),
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return self::completion( false, '', self::PROVIDER_WEBHOOK, $response->get_error_message() );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );

		if ( $status < 200 || $status >= 300 ) {
			return self::completion(
				false,
				'',
				self::PROVIDER_WEBHOOK,
				sprintf(
					/* translators: %d: HTTP status code. */
					__( 'وبهوک با کد %d پاسخ داد.', 'bahoosh-analytics-pro' ),
					$status
				)
			);
		}

		// The same unwrapping the analysis path uses, so an n8n node that
		// returns {output: "..."} works here too.
		$text = self::webhook_content( (string) wp_remote_retrieve_body( $response ) );

		return '' === trim( $text )
			? self::completion( false, '', self::PROVIDER_WEBHOOK, __( 'پاسخ وبهوک قابل خواندن نبود.', 'bahoosh-analytics-pro' ) )
			: self::completion( true, $text, self::PROVIDER_WEBHOOK, '' );
	}

	/**
	 * Normalises a completion result.
	 *
	 * @param bool   $ok       Success.
	 * @param string $text     Model text.
	 * @param string $provider Provider id.
	 * @param string $error    Error message.
	 * @return array
	 */
	private static function completion( $ok, $text, $provider, $error ) {
		return array(
			'ok'       => (bool) $ok,
			'text'     => (string) $text,
			'provider' => (string) $provider,
			'error'    => (string) $error,
		);
	}

	/**
	 * Calls Gemini's generateContent endpoint.
	 *
	 * Gemini does publish an OpenAI-compatible surface, and routing through
	 * {@see analyze_chat()} would have been fewer lines. The native API is used
	 * instead for one reason that matters to whoever is setting this up: its
	 * errors are specific. A free-tier key that has run out of requests for the
	 * day returns 429 with a quota reason, and that deserves "you have used
	 * today's free allowance" rather than "the model service answered with 429".
	 * The compatibility shim flattens exactly those details away.
	 *
	 * The packet leaves the site and reaches Google. It contains no customers —
	 * {@see BAP_Analysis_Packet} builds aggregates only — but it does contain
	 * product names, order counts and revenue. Worth knowing before choosing
	 * this over a Llama server on your own machine.
	 *
	 * @param array $packet Analysis packet.
	 * @return array Result.
	 */
	private static function analyze_gemini( array $packet ) {
		$key = self::api_key();

		if ( '' === $key ) {
			return self::result(
				false,
				self::PROVIDER_GEMINI,
				array(),
				__( 'کلید Google AI Studio وارد نشده است. از aistudio.google.com/apikey یک کلید بسازید و در همین صفحه ذخیره کنید.', 'bahoosh-analytics-pro' )
			);
		}

		$response = wp_remote_post(
			self::gemini_endpoint( self::base_url(), self::model(), 'generateContent' ),
			array(
				'timeout' => self::TIMEOUT,
				'headers' => array(
					'Content-Type' => 'application/json',
					// In the header, never the query string: a key in a URL ends
					// up in access logs, proxy logs and error reports.
					'x-goog-api-key' => $key,
				),
				'body'    => wp_json_encode(
					array(
						'system_instruction' => array(
							'parts' => array( array( 'text' => self::system_prompt() ) ),
						),
						'contents'           => array(
							array(
								'role'  => 'user',
								'parts' => array( array( 'text' => wp_json_encode( $packet ) ) ),
							),
						),
						'generationConfig'   => array(
							'temperature'      => 0.2,
							// Gemini honours this properly, unlike most of the
							// OpenAI-compatible servers, so the reply really is
							// JSON rather than JSON wrapped in prose.
							'responseMimeType' => 'application/json',
						),
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			BAP_Debug_Log::log( 'ai', 'gemini request failed', array( 'error' => $response->get_error_message() ) );
			return self::result( false, self::PROVIDER_GEMINI, array(), self::connection_hint( $response->get_error_message() ) );
		}

		$status  = (int) wp_remote_retrieve_response_code( $response );
		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$decoded = is_array( $decoded ) ? $decoded : array();

		if ( $status < 200 || $status >= 300 ) {
			// `reason` is Google's machine-readable status; the human sentence
			// goes through gemini_error(), which scrubs it. Logging the status
			// alone was not enough to diagnose a 403.
			BAP_Debug_Log::log(
				'ai',
				'gemini returned an error status',
				array(
					'status' => $status,
					'reason' => (string) ( $decoded['error']['status'] ?? '' ),
				)
			);

			return self::result( false, self::PROVIDER_GEMINI, array(), self::gemini_error( $status, $decoded ) );
		}

		$content = self::gemini_content( $decoded );

		if ( '' === $content ) {
			return self::result( false, self::PROVIDER_GEMINI, array(), self::gemini_empty_reason( $decoded ) );
		}

		$items = self::parse_recommendations( $content, $packet );

		if ( ! $items ) {
			return self::result( false, self::PROVIDER_GEMINI, array(), __( 'مدل هیچ پیشنهاد معتبری تولید نکرد.', 'bahoosh-analytics-pro' ) );
		}

		return self::result( true, self::PROVIDER_GEMINI, $items, '' );
	}

	/**
	 * Builds a Gemini method URL from a configured root.
	 *
	 * Accepts the root with or without a version, and with or without a
	 * trailing `/models`, because all three are what people paste.
	 *
	 * @param string $base   Configured URL.
	 * @param string $model  Model name, with or without the `models/` prefix.
	 * @param string $method API method, e.g. `generateContent`.
	 * @return string
	 */
	public static function gemini_endpoint( $base, $model, $method ) {
		$base  = rtrim( trim( (string) $base ), '/' );
		$base  = '' === $base ? self::GEMINI_DEFAULT_URL : $base;
		$base  = (string) preg_replace( '#/models$#', '', $base );
		$model = ltrim( trim( (string) $model ), '/' );
		$model = (string) preg_replace( '#^models/#', '', $model );

		if ( ! preg_match( '#/v\d+[a-z0-9]*$#', $base ) ) {
			$base .= '/v1beta';
		}

		return $base . '/models/' . rawurlencode( $model ) . ':' . $method;
	}

	/**
	 * The text of a Gemini reply.
	 *
	 * Gemini may split one answer across several `parts`, so they are joined
	 * rather than the first one taken — taking only the first truncates a long
	 * reply into invalid JSON.
	 *
	 * @param array $decoded Decoded response body.
	 * @return string
	 */
	private static function gemini_content( array $decoded ) {
		$text = '';

		foreach ( (array) ( $decoded['candidates'][0]['content']['parts'] ?? array() ) as $part ) {
			if ( isset( $part['text'] ) && is_string( $part['text'] ) ) {
				$text .= $part['text'];
			}
		}

		return trim( $text );
	}

	/**
	 * Turns a Gemini error status into something actionable.
	 *
	 * @param int   $status  HTTP status.
	 * @param array $decoded Decoded response body.
	 * @return string
	 */
	private static function gemini_error( $status, array $decoded ) {
		$reason = (string) ( $decoded['error']['status'] ?? '' );
		$detail = (string) ( $decoded['error']['message'] ?? '' );

		if ( 429 === $status ) {
			// The one people hit on a free key, and the one where the right
			// advice is "wait", not "check your settings".
			return __( 'سهمیه کلید Google تمام شده است. کلید رایگان AI Studio در هر روز تعداد محدودی درخواست دارد؛ فردا دوباره کار می‌کند. تا آن موقع تحلیل با موتور قانون‌محور داخلی انجام می‌شود.', 'bahoosh-analytics-pro' );
		}

		// Where the call comes from, not whose key it is. Gemini is unavailable
		// in a number of countries and the request is made by the web server, so
		// what matters is the server's location — which no amount of changing the
		// key will fix. Checked before the generic 400 and 403 branches because
		// Google reports it as both, depending on the endpoint.
		if ( 'FAILED_PRECONDITION' === $reason || false !== stripos( $detail, 'location is not supported' ) || false !== stripos( $detail, 'user location' ) ) {
			return self::with_google_detail(
				__( 'Google این سرویس را برای موقعیت جغرافیایی سرور شما ارائه نمی‌دهد. درخواست از خود سرور وردپرس می‌رود، نه از مرورگر شما، پس کلید و تنظیمات بی‌تقصیرند و عوض‌کردنشان فایده ندارد. دو راه: از گزینه «وبهوک اتومیشن» استفاده کنید تا n8n از سرور خودش مدل را صدا بزند، یا سرور لاما را روی ماشینی بالا بیاورید که خودتان کنترلش می‌کنید.', 'bahoosh-analytics-pro' ),
				$detail
			);
		}

		if ( 400 === $status && ( 'INVALID_ARGUMENT' === $reason || false !== stripos( $detail, 'api key' ) ) ) {
			return self::with_google_detail(
				__( 'کلید Google پذیرفته نشد. یک کلید تازه از aistudio.google.com/apikey بسازید و جایگزین کنید.', 'bahoosh-analytics-pro' ),
				$detail
			);
		}

		if ( 403 === $status ) {
			// Three different problems share this status, and Google's own
			// sentence is what tells them apart.
			if ( false !== stripos( $detail, 'has not been used in project' ) || false !== stripos( $detail, 'is disabled' ) ) {
				return self::with_google_detail(
					__( 'Generative Language API برای پروژه این کلید فعال نیست. در Google Cloud Console همان پروژه، این API را Enable کنید — یا ساده‌تر، کلید را از aistudio.google.com/apikey بسازید که خودش پروژه را آماده می‌کند.', 'bahoosh-analytics-pro' ),
					$detail
				);
			}

			if ( false !== stripos( $detail, 'referer' ) || false !== stripos( $detail, 'referrer' ) || false !== stripos( $detail, 'blocked' ) ) {
				return self::with_google_detail(
					__( 'کلید به دامنه یا IP دیگری محدود شده است. در صفحه کلید، محدودیت را بردارید یا IP خروجی سرور را اضافه کنید. توجه کنید درخواست از سرور می‌رود نه از مرورگر، پس محدودیت بر اساس دامنه (HTTP referrer) هیچ‌وقت کار نمی‌کند.', 'bahoosh-analytics-pro' ),
					$detail
				);
			}

			return self::with_google_detail(
				__( 'Google این درخواست را رد کرد (۴۰۳). متن خود گوگل در ادامه می‌گوید چرا.', 'bahoosh-analytics-pro' ),
				$detail
			);
		}

		if ( 404 === $status ) {
			return sprintf(
				/* translators: %s: model name. */
				__( 'Google مدل «%s» را نمی‌شناسد. نام مدل را بررسی کنید؛ فهرست مدل‌های همین کلید را دکمه «آزمایش اتصال» نشان می‌دهد.', 'bahoosh-analytics-pro' ),
				self::model()
			);
		}

		return self::with_google_detail(
			sprintf(
				/* translators: %d: HTTP status code. */
				__( 'سرویس Gemini با کد %d پاسخ داد.', 'bahoosh-analytics-pro' ),
				$status
			),
			$detail
		);
	}

	/**
	 * Appends Google's own sentence to our advice.
	 *
	 * Discarding it was a mistake: three unrelated problems arrive as 403, and
	 * guessing which one sends people to check settings that were never wrong.
	 * Google's message is an error string rather than anything confidential, but
	 * it is scrubbed of anything key-shaped before being shown, because this
	 * text reaches a screen and a log the shop owner may paste into a support
	 * thread.
	 *
	 * @param string $advice Our own guidance.
	 * @param string $detail Google's `error.message`.
	 * @return string
	 */
	private static function with_google_detail( $advice, $detail ) {
		$detail = trim( (string) $detail );

		if ( '' === $detail ) {
			return $advice;
		}

		$detail = (string) preg_replace( '/AIza[0-9A-Za-z_\-]{10,}/', '[کلید حذف شد]', $detail );
		$detail = sanitize_text_field( $detail );

		if ( strlen( $detail ) > 300 ) {
			$detail = substr( $detail, 0, 300 ) . '…';
		}

		/* translators: 1: our advice, 2: Google's own error message. */
		return sprintf( __( '%1$s — پاسخ گوگل: %2$s', 'bahoosh-analytics-pro' ), $advice, $detail );
	}

	/**
	 * Why a 200 from Gemini carried no usable text.
	 *
	 * A blocked prompt and a reply cut off at the token limit both arrive as a
	 * successful response with nothing in it, and they need opposite fixes.
	 *
	 * @param array $decoded Decoded response body.
	 * @return string
	 */
	private static function gemini_empty_reason( array $decoded ) {
		$blocked = (string) ( $decoded['promptFeedback']['blockReason'] ?? '' );
		$finish  = (string) ( $decoded['candidates'][0]['finishReason'] ?? '' );

		if ( '' !== $blocked || 'SAFETY' === $finish ) {
			return __( 'Google این درخواست را به‌دلیل فیلترهای محتوایی خود پاسخ نداد. نام محصولات بسته تحلیل احتمالاً فیلتری را فعال کرده است.', 'bahoosh-analytics-pro' );
		}

		if ( 'MAX_TOKENS' === $finish ) {
			return __( 'پاسخ مدل نیمه‌کاره قطع شد. بازه زمانی تحلیل را کوتاه‌تر کنید تا بسته کوچک‌تر شود.', 'bahoosh-analytics-pro' );
		}

		return __( 'پاسخ مدل قابل خواندن نبود.', 'bahoosh-analytics-pro' );
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

		if ( self::PROVIDER_GEMINI === $provider ) {
			return self::probe_gemini();
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
	 * Asks Google which models this key may use.
	 *
	 * Listing models is itself a billable call on some projects but is outside
	 * the generate quota, so a connection test does not spend one of the day's
	 * free analyses — which matters when the whole appeal of this provider is a
	 * small daily allowance.
	 *
	 * @return array{ok:bool,error:string,models:string[],note?:string}
	 */
	private static function probe_gemini() {
		$key = self::api_key();

		if ( '' === $key ) {
			return array(
				'ok'     => false,
				'error'  => __( 'کلید Google AI Studio وارد نشده است. از aistudio.google.com/apikey یک کلید بسازید.', 'bahoosh-analytics-pro' ),
				'models' => array(),
			);
		}

		$base     = rtrim( self::base_url(), '/' );
		$base     = '' === $base ? self::GEMINI_DEFAULT_URL : $base;
		$response = wp_remote_get(
			preg_match( '#/models$#', $base ) ? $base : $base . '/models',
			array(
				'timeout' => self::PROBE_TIMEOUT,
				'headers' => array( 'x-goog-api-key' => $key ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return array(
				'ok'     => false,
				'error'  => self::connection_hint( $response->get_error_message() ),
				'models' => array(),
			);
		}

		$status  = (int) wp_remote_retrieve_response_code( $response );
		$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		$decoded = is_array( $decoded ) ? $decoded : array();

		if ( $status < 200 || $status >= 300 ) {
			return array(
				'ok'     => false,
				'error'  => self::gemini_error( $status, $decoded ),
				'models' => array(),
			);
		}

		$models = array();

		foreach ( (array) ( $decoded['models'] ?? array() ) as $row ) {
			$name = isset( $row['name'] ) && is_scalar( $row['name'] ) ? (string) $row['name'] : '';

			if ( '' === $name ) {
				continue;
			}

			// Only the models that can answer a prompt. The list also carries
			// embedding models, which would be a confusing thing to offer.
			$methods = (array) ( $row['supportedGenerationMethods'] ?? array() );

			if ( $methods && ! in_array( 'generateContent', $methods, true ) ) {
				continue;
			}

			$models[] = sanitize_text_field( (string) preg_replace( '#^models/#', '', $name ) );
		}

		$models  = array_slice( $models, 0, 50 );
		$wanted  = self::model();
		$present = ! $models || in_array( $wanted, $models, true );

		return array(
			'ok'     => true,
			'error'  => '',
			'models' => $models,
			'note'   => $present
				? __( 'کلید Google پذیرفته شد.', 'bahoosh-analytics-pro' )
				: sprintf(
					/* translators: %s: model name. */
					__( 'کلید کار می‌کند اما مدل «%s» در فهرست آن نیست.', 'bahoosh-analytics-pro' ),
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
		return array( self::PROVIDER_LLAMA, self::PROVIDER_GEMINI, self::PROVIDER_WEBHOOK, self::PROVIDER_OPENAI, self::PROVIDER_LOCAL );
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

		// Gemini has exactly one address, so leaving the field blank is the
		// normal configuration rather than a missing one.
		if ( '' === $url && self::PROVIDER_GEMINI === self::current() ) {
			return self::GEMINI_DEFAULT_URL;
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

		if ( '' === $model && self::PROVIDER_GEMINI === self::current() ) {
			return self::GEMINI_DEFAULT_MODEL;
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
