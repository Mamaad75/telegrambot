=== Particle Hero — WebGL Cubic Character ===
Contributors: particlehero
Tags: hero, webgl, three.js, particles, elementor, animation, 3d
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A premium interactive hero: a futuristic cubic character built entirely from luminous particles.

== Description ==

Particle Hero renders a futuristic, cubic humanoid made of tens of thousands of
glowing particles, directly on the GPU. There is no 3D model to download — the
character is generated from a parametric blueprint at runtime, so the whole
experience is one JavaScript file.

**What the visitor sees**

* On load, particles float in a wide dust cloud and converge on a centre point,
  assembling the character over roughly 4–6 seconds.
* The chest reactor ignites part way through the assembly and keeps a slow
  heartbeat, bleeding orange light into the surrounding blue body particles.
* The field reacts to the cursor: the character leans toward it and particles
  are pushed and swirled around it.
* Scrolling scatters the character into drifting dust; scrolling back rebuilds
  it, with a flash from the core.

**Built for production**

* Custom GLSL shaders; every state is computed on the GPU from a handful of
  uniforms, so no vertex buffer is ever touched after upload.
* Custom multi-scale bloom, ACES tone mapping, vignette and film grain in a
  five-draw post pipeline.
* Automatic quality tiers from CPU cores, memory and screen size, plus runtime
  adaptation if frames drop.
* The render loop stops completely when the hero is off screen or the tab is
  hidden.
* Honours `prefers-reduced-motion`: the character renders assembled, in a single
  static frame.
* Graceful fallback image when WebGL is unavailable.

== Installation ==

1. Upload the `particle-hero` folder to `/wp-content/plugins/`.
2. Activate the plugin through the *Plugins* menu.
3. In Elementor, drag the **Particle Hero** widget into a section, or use the
   `[particle_hero]` shortcode anywhere.

== Usage ==

Elementor: search for "Particle Hero" in the widget panel.

Shortcode:

`[particle_hero height="90vh" title="Your headline" color_core="#ff7a1a"]`

Theme template:

`<?php particle_hero_render( array( 'height' => '100vh', 'title' => 'Hello' ) ); ?>`

== Frequently Asked Questions ==

= Does it work without Elementor? =

Yes. The shortcode and the `particle_hero_render()` template function do not
require a page builder.

= Will it slow my site down? =

The bundle is deferred, enqueued only on pages that actually use a hero, and the
render loop is fully stopped when the hero is not visible. On weak devices the
plugin automatically steps down pixel ratio, then bloom resolution, then bloom.

= Can I use my own colours? =

Every colour in the palette is a control: body shadow, body blue, edge
highlight, core, core shell, and the three background colours.

== Changelog ==

= 1.0.0 =
* Initial release.
