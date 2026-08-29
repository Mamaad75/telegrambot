<?php
/**
 * Field Mapping admin view.
 *
 * @package WPEventPublisher
 *
 * @var array<string,string>                        $post_types Selectable post types.
 * @var string                                      $post_type  Current post type slug.
 * @var string                                      $taxonomy   Taxonomy driving the category selectors.
 * @var array<string,\WPEventPublisher\FieldProvider> $providers Registered providers.
 * @var array<string,string>                        $formats    List format choices.
 * @var string                                      $page       Screen slug.
 * @var array<string,string> $platform_labels Platform display names.
 * @var array<string,mixed>  $initial_state Screen state available before AJAX.
 */

// No direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

use WPEventPublisher\Field;
use WPEventPublisher\FieldProvider;
?>
<script type="application/json" id="wpep-fields-initial-state">
<?php echo wp_json_encode( $initial_state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ); ?>
</script>
<div class="wrap wpep-wrap wpep-fields-wrap">
	<h1><?php esc_html_e( 'فیلدها', 'wp-event-publisher' ); ?></h1>

	<p class="description">
		<?php esc_html_e( 'Every field this post type actually has was discovered automatically, whatever plugin or theme provides it. Choose which ones are sent, what they are called, and in what order. A category can override what it inherits from its parent, so cars and real estate can send completely different fields.', 'wp-event-publisher' ); ?>
	</p>

	<h2 class="screen-reader-text"><?php esc_html_e( 'Scope', 'wp-event-publisher' ); ?></h2>

	<div class="wpep-fields-toolbar">
		<label for="wpep-post-type"><strong><?php esc_html_e( 'Post type', 'wp-event-publisher' ); ?></strong></label>
		<select id="wpep-post-type">
			<?php foreach ( $post_types as $wpep_slug => $wpep_label ) : ?>
				<option value="<?php echo esc_attr( $wpep_slug ); ?>" <?php selected( $wpep_slug, $post_type ); ?>>
					<?php echo esc_html( $wpep_label ); ?> (<?php echo esc_html( $wpep_slug ); ?>)
				</option>
			<?php endforeach; ?>
		</select>

		<span class="wpep-fields-taxonomy" <?php echo '' === $taxonomy ? 'hidden' : ''; ?>>
			<label for="wpep-category"><strong><?php esc_html_e( 'Category', 'wp-event-publisher' ); ?></strong></label>
			<select id="wpep-category">
				<option value="0"><?php esc_html_e( 'All (post type default)', 'wp-event-publisher' ); ?></option>
			</select>

			<label for="wpep-subcategory"><strong><?php esc_html_e( 'Subcategory', 'wp-event-publisher' ); ?></strong></label>
			<select id="wpep-subcategory" disabled>
				<option value="0"><?php esc_html_e( 'All', 'wp-event-publisher' ); ?></option>
			</select>
		</span>

		<input type="hidden" id="wpep-taxonomy" value="<?php echo esc_attr( $taxonomy ); ?>" />

		<button type="button" class="button" id="wpep-rescan">
			<?php esc_html_e( 'Rescan fields', 'wp-event-publisher' ); ?>
		</button>
	</div>

	<div class="wpep-result" id="wpep-fields-notice" role="status" aria-live="polite" hidden></div>

	<div class="wpep-scope-banner" id="wpep-scope-banner" hidden></div>

	<h2><?php esc_html_e( 'اطلاعاتی که منتشر می‌شود', 'wp-event-publisher' ); ?></h2>

	<p class="description">
		<?php esc_html_e( 'هر کارت یک قلم اطلاعات از محتوای شماست. تعیین کنید کدام‌ها منتشر شوند، در کدام پلتفرم‌ها دیده شوند، با چه عنوانی و به چه ترتیبی.', 'wp-event-publisher' ); ?>
	</p>

	<div class="wpep-fields-controls">
		<label for="wpep-field-search" class="screen-reader-text"><?php esc_html_e( 'جستجو در اطلاعات', 'wp-event-publisher' ); ?></label>
		<input type="search" id="wpep-field-search" class="regular-text" placeholder="<?php esc_attr_e( 'جستجو…', 'wp-event-publisher' ); ?>" />

		<label for="wpep-filter-state" class="screen-reader-text"><?php esc_html_e( 'نمایش', 'wp-event-publisher' ); ?></label>
		<select id="wpep-filter-state">
			<option value="all"><?php esc_html_e( 'همه', 'wp-event-publisher' ); ?></option>
			<option value="on"><?php esc_html_e( 'فقط منتشرشونده‌ها', 'wp-event-publisher' ); ?></option>
			<option value="off"><?php esc_html_e( 'فقط غیرفعال‌ها', 'wp-event-publisher' ); ?></option>
		</select>

		<button type="button" class="button" id="wpep-enable-all"><?php esc_html_e( 'روشن کردن همه', 'wp-event-publisher' ); ?></button>
		<button type="button" class="button" id="wpep-disable-all"><?php esc_html_e( 'خاموش کردن همه', 'wp-event-publisher' ); ?></button>

		<span class="wpep-field-count" id="wpep-field-count"></span>
	</div>

	<div id="wpep-fields-table" class="wpep-fields-table">
		<p class="wpep-loading"><?php esc_html_e( 'Loading fields…', 'wp-event-publisher' ); ?></p>
	</div>

	<h2><?php esc_html_e( 'قالب پیام', 'wp-event-publisher' ); ?></h2>

	<p class="description">
		<?php esc_html_e( 'اگر چیزی نسازید، پیام به‌صورت خودکار از فیلدهای روشن ساخته می‌شود. برای کنترل دقیق‌تر، از سازنده زیر استفاده کنید.', 'wp-event-publisher' ); ?>
	</p>

	<nav class="wpep-template-tabs" role="tablist">
		<button type="button" class="button wpep-template-tab is-active" data-tab="builder" role="tab" aria-selected="true">
			<?php esc_html_e( 'ساختن قالب', 'wp-event-publisher' ); ?>
		</button>
		<button type="button" class="button wpep-template-tab" data-tab="code" role="tab" aria-selected="false">
			<?php esc_html_e( 'ویرایش پیشرفته', 'wp-event-publisher' ); ?>
		</button>
	</nav>

	<div class="wpep-template-grid">
		<div class="wpep-template-editor">

			<!-- Builder: the primary UX (spec 8). Nobody should have to learn
			     the placeholder syntax to lay out a message. -->
			<div class="wpep-template-pane" data-pane="builder">
				<p class="description">
					<?php esc_html_e( 'روی هر فیلد بزنید تا به پیام اضافه شود. ترتیب همان ترتیبی است که اضافه می‌کنید و با کشیدن قابل تغییر است.', 'wp-event-publisher' ); ?>
				</p>

				<div class="wpep-builder-picker">
					<h4><?php esc_html_e( 'افزودن به پیام', 'wp-event-publisher' ); ?></h4>
					<div id="wpep-builder-chips" class="wpep-builder-chips"></div>
				</div>

				<div class="wpep-builder-canvas">
					<h4><?php esc_html_e( 'پیام شما', 'wp-event-publisher' ); ?></h4>
					<ol id="wpep-builder-lines" class="wpep-builder-lines"></ol>
					<p class="description wpep-builder-empty" id="wpep-builder-empty">
						<?php esc_html_e( 'هنوز چیزی اضافه نشده است. پیام به‌صورت خودکار ساخته می‌شود.', 'wp-event-publisher' ); ?>
					</p>
				</div>
			</div>

			<!-- Advanced: still here, still fully supported, no longer the
			     first thing anyone meets. -->
			<div class="wpep-template-pane" data-pane="code" hidden>
				<label for="wpep-template" class="screen-reader-text"><?php esc_html_e( 'قالب پیام', 'wp-event-publisher' ); ?></label>
				<textarea id="wpep-template" rows="14" class="large-text code" spellcheck="false" dir="auto" placeholder="<?php echo esc_attr( "🚗 {{title}}\n💰 {{price}}\n📍 {{location}}\n{{#if phone}}📞 {{phone}}{{/if}}\n🔗 {{permalink}}" ); ?>"></textarea>

				<p class="description">
					<?php
					printf(
						/* translators: 1: placeholder syntax, 2: conditional syntax, 3: inverse conditional syntax. */
						esc_html__( '%1$s یک فیلد را چاپ می‌کند. %2$s فقط وقتی بلوکش را نگه می‌دارد که فیلد مقدار داشته باشد و %3$s برعکس آن است. خطی که همه جایگزین‌هایش خالی درآمده باشد حذف می‌شود.', 'wp-event-publisher' ),
						'<code>{{field}}</code>',
						'<code>{{#if field}}…{{/if}}</code>',
						'<code>{{#unless field}}…{{/unless}}</code>'
					);
					?>
				</p>

				<div class="wpep-placeholder-list">
					<h4><?php esc_html_e( 'جایگزین‌های موجود', 'wp-event-publisher' ); ?></h4>
					<p class="description"><?php esc_html_e( 'برای درج در محل مکان‌نما کلیک کنید.', 'wp-event-publisher' ); ?></p>
					<ul id="wpep-placeholders"></ul>
				</div>
			</div>

			<p>
				<button type="button" class="button" id="wpep-preview"><?php esc_html_e( 'پیش‌نمایش با یک آگهی واقعی', 'wp-event-publisher' ); ?></button>
			</p>

			<div class="wpep-preview-output" id="wpep-preview-output" hidden></div>
		</div>
	</div>

	<h2 class="screen-reader-text"><?php esc_html_e( 'Save', 'wp-event-publisher' ); ?></h2>

	<p class="wpep-fields-actions">
		<button type="button" class="button button-primary button-hero" id="wpep-save">
			<?php esc_html_e( 'Save Mapping', 'wp-event-publisher' ); ?>
		</button>

		<button type="button" class="button" id="wpep-reset" hidden>
			<?php esc_html_e( 'Discard this scope’s mapping and inherit again', 'wp-event-publisher' ); ?>
		</button>
	</p>

	<h2><?php esc_html_e( 'Field sources on this site', 'wp-event-publisher' ); ?></h2>

	<table class="widefat striped wpep-table">
		<thead>
			<tr>
				<th><?php esc_html_e( 'Provider', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Identifier', 'wp-event-publisher' ); ?></th>
				<th><?php esc_html_e( 'Status', 'wp-event-publisher' ); ?></th>
			</tr>
		</thead>
		<tbody>
			<?php foreach ( $providers as $wpep_provider ) : ?>
				<?php if ( ! $wpep_provider instanceof FieldProvider ) { continue; } ?>
				<tr>
					<td><?php echo esc_html( $wpep_provider->label() ); ?></td>
					<td><code><?php echo esc_html( $wpep_provider->id() ); ?></code></td>
					<td>
						<span class="wpep-badge wpep-badge-<?php echo $wpep_provider->is_available() ? 'ok' : 'skipped'; ?>">
							<?php echo esc_html( $wpep_provider->is_available() ? __( 'Detected', 'wp-event-publisher' ) : __( 'Not installed', 'wp-event-publisher' ) ); ?>
						</span>
					</td>
				</tr>
			<?php endforeach; ?>
		</tbody>
	</table>

	<p class="description">
		<?php esc_html_e( 'None of these is required. A provider that is not installed simply contributes nothing; the custom fields scan still finds the same data.', 'wp-event-publisher' ); ?>
	</p>

	<script type="text/template" id="wpep-row-template">
		<?php
		// The row markup lives here rather than in JavaScript so every
		// translated string stays in the PHP catalogue and is escaped by
		// WordPress rather than assembled in the browser.
		?>
		<article class="wpep-field-card wpep-card" data-key="">
			<header class="wpep-card__head">
				<div class="wpep-field-card__identity">
					<h3 class="wpep-card__title wpep-field-name"></h3>
					<p class="wpep-card__hint wpep-field-hint"></p>
				</div>

				<label class="wpep-switch wpep-field-card__master">
					<input type="checkbox" class="wpep-enabled" />
					<span class="wpep-switch__track" aria-hidden="true"></span>
					<span class="wpep-switch__label"><?php esc_html_e( 'این اطلاعات منتشر شود', 'wp-event-publisher' ); ?></span>
				</label>
			</header>

			<div class="wpep-card__body wpep-field-card__body">
				<div class="wpep-field-card__block">
					<span class="wpep-field-card__legend"><?php esc_html_e( 'نمایش در پلتفرم‌ها', 'wp-event-publisher' ); ?></span>
					<p class="wpep-card__hint"><?php esc_html_e( 'انتخاب کنید این اطلاعات در کدام پلتفرم‌ها نمایش داده شود.', 'wp-event-publisher' ); ?></p>

					<div class="wpep-platform-group">
						<?php foreach ( $platform_labels as $wpep_platform => $wpep_platform_label ) : ?>
							<label class="wpep-chip">
								<input type="checkbox" class="wpep-platform" data-platform="<?php echo esc_attr( $wpep_platform ); ?>" />
								<span><?php echo esc_html( $wpep_platform_label ); ?></span>
							</label>
						<?php endforeach; ?>
					</div>
				</div>

				<div class="wpep-field-card__row">
					<label class="wpep-field-card__block">
						<span class="wpep-field-card__legend"><?php esc_html_e( 'عنوان نمایشی', 'wp-event-publisher' ); ?></span>
						<input type="text" class="wpep-label regular-text" />
						<span class="wpep-card__hint"><?php esc_html_e( 'همین عنوان کنار مقدار نمایش داده می‌شود.', 'wp-event-publisher' ); ?></span>
					</label>

					<label class="wpep-field-card__block wpep-field-card__block--narrow">
						<span class="wpep-field-card__legend"><?php esc_html_e( 'ترتیب نمایش', 'wp-event-publisher' ); ?></span>
						<input type="number" class="wpep-order small-text" min="0" step="1" />
						<span class="wpep-card__hint"><?php esc_html_e( 'عدد کوچک‌تر بالاتر.', 'wp-event-publisher' ); ?></span>
					</label>
				</div>

				<!-- Everything an administrator does not need in order to decide
				     is behind this, not in front of it. -->
				<details class="wpep-field-card__advanced">
					<summary><?php esc_html_e( 'اطلاعات فنی', 'wp-event-publisher' ); ?></summary>

					<div class="wpep-field-card__row">
						<label class="wpep-field-card__block">
							<span class="wpep-field-card__legend"><?php esc_html_e( 'نحوه نمایش چند مقدار', 'wp-event-publisher' ); ?></span>
							<select class="wpep-format">
								<?php foreach ( $formats as $wpep_format => $wpep_format_label ) : ?>
									<option value="<?php echo esc_attr( $wpep_format ); ?>"><?php echo esc_html( $wpep_format_label ); ?></option>
								<?php endforeach; ?>
							</select>
						</label>

						<label class="wpep-field-card__block wpep-field-card__block--narrow">
							<span class="wpep-field-card__legend"><?php esc_html_e( 'جداکننده', 'wp-event-publisher' ); ?></span>
							<input type="text" class="wpep-separator small-text" maxlength="10" />
						</label>
					</div>

					<div class="wpep-field-card__row">
						<label class="wpep-field-card__block wpep-field-card__block--narrow">
							<span class="wpep-field-card__legend"><?php esc_html_e( 'آیکون فیلد', 'wp-event-publisher' ); ?></span>
							<input type="text" class="wpep-icon small-text" maxlength="8" placeholder="📌" />
						</label>
						<label class="wpep-field-card__block">
							<span class="wpep-field-card__legend"><?php esc_html_e( 'پیشوند', 'wp-event-publisher' ); ?></span>
							<input type="text" class="wpep-prefix regular-text" maxlength="30" placeholder="" />
						</label>
						<label class="wpep-field-card__block">
							<span class="wpep-field-card__legend"><?php esc_html_e( 'پسوند', 'wp-event-publisher' ); ?></span>
							<input type="text" class="wpep-suffix regular-text" maxlength="30" placeholder="" />
						</label>
					</div>

					<label class="wpep-field-card__block">
						<span class="wpep-field-card__legend"><?php esc_html_e( 'مقصد ارسال', 'wp-event-publisher' ); ?></span>
						<select class="wpep-visibility">
							<option value="<?php echo esc_attr( Field::VISIBILITY_TELEGRAM ); ?>"><?php esc_html_e( 'داخل پیام منتشرشده', 'wp-event-publisher' ); ?></option>
							<option value="<?php echo esc_attr( Field::VISIBILITY_BACKEND ); ?>"><?php esc_html_e( 'فقط ارسال به سرویس جارچی', 'wp-event-publisher' ); ?></option>
							<option value="<?php echo esc_attr( Field::VISIBILITY_ADMIN ); ?>"><?php esc_html_e( 'فقط در پیشخوان', 'wp-event-publisher' ); ?></option>
							<option value="<?php echo esc_attr( Field::VISIBILITY_HIDDEN ); ?>"><?php esc_html_e( 'نمایش داده نشود', 'wp-event-publisher' ); ?></option>
						</select>
					</label>

					<dl class="wpep-field-card__meta">
						<dt><?php esc_html_e( 'شناسه فنی', 'wp-event-publisher' ); ?></dt>
						<dd><code class="wpep-field-key"></code></dd>
						<dt><?php esc_html_e( 'منبع', 'wp-event-publisher' ); ?></dt>
						<dd class="wpep-field-source"></dd>
						<dt><?php esc_html_e( 'نمونه مقدار', 'wp-event-publisher' ); ?></dt>
						<dd class="wpep-sample"></dd>
					</dl>
				</details>
			</div>
		</article>
	</script>
</div>
