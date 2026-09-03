<?php
/**
 * Markup builder shared by the Elementor widget, the shortcode and the theme
 * helper — one template, so all three stay in sync.
 *
 * @package ParticleHero
 */

defined( 'ABSPATH' ) || exit;

class Particle_Hero_Renderer {

	/**
	 * @param array $args Raw (unsanitised) settings.
	 * @return string Escaped HTML.
	 */
	public static function render( array $args ) {
		$s      = Particle_Hero_Config::sanitize( $args );
		$config = Particle_Hero_Config::to_js( $s );

		$classes = array( 'particle-hero', 'particle-hero--align-' . $s['align'] );
		if ( $s['class'] ) {
			$classes[] = $s['class'];
		}

		// Heights travel as custom properties so one stylesheet can serve every
		// instance without printing a <style> block per widget.
		$style = sprintf(
			'--ph-height:%s;--ph-height-mobile:%s;',
			$s['height'],
			$s['height_mobile']
		);

		$attributes = array(
			'class'                => implode( ' ', array_map( 'sanitize_html_class', $classes ) ),
			'style'                => $style,
			'data-particle-hero'   => wp_json_encode( $config ),
		);

		$html = '<div';
		foreach ( $attributes as $name => $value ) {
			$html .= sprintf( ' %s="%s"', esc_attr( $name ), esc_attr( $value ) );
		}
		if ( 'yes' === $s['eager'] ) {
			// Above the fold: skip the IntersectionObserver and boot immediately.
			$html .= ' data-particle-hero-eager';
		}
		$html .= '>';

		if ( $s['fallback_image'] ) {
			$html .= sprintf(
				'<div class="particle-hero__fallback" style="background-image:url(%s)" role="img" aria-label="%s"></div>',
				esc_url( $s['fallback_image'] ),
				esc_attr( wp_strip_all_tags( $s['title'] ) )
			);
		}

		if ( 'yes' === $s['show_content'] && ( $s['title'] || $s['subtitle'] || $s['button_text'] ) ) {
			$html .= '<div class="particle-hero__content">';

			if ( $s['title'] ) {
				$html .= sprintf( '<h2 class="particle-hero__title">%s</h2>', wp_kses_post( $s['title'] ) );
			}
			if ( $s['subtitle'] ) {
				$html .= sprintf( '<p class="particle-hero__subtitle">%s</p>', wp_kses_post( $s['subtitle'] ) );
			}
			if ( $s['button_text'] && $s['button_url'] ) {
				$target = $s['button_target'] ? sprintf( ' target="%s" rel="noopener noreferrer"', esc_attr( $s['button_target'] ) ) : '';
				$html  .= sprintf(
					'<a class="particle-hero__cta" href="%s"%s>%s</a>',
					esc_url( $s['button_url'] ),
					$target,
					esc_html( $s['button_text'] )
				);
			}

			$html .= '</div>';
		}

		$html .= '</div>';

		/**
		 * Filter the finished hero markup.
		 *
		 * @param string $html
		 * @param array  $s Sanitised settings.
		 */
		return apply_filters( 'particle_hero_markup', $html, $s );
	}
}
