# Paper Shaders Liquid Metal subset

Upstream: https://github.com/paper-design/shaders

Version: `0.0.82`; commit: `71be01576e8402c62ac76386bb4a7c59092e24c7`.

License: Apache-2.0. See `LICENSE` and upstream `NOTICE`.

The generated ESM bundle contains unchanged upstream ShaderMount, Liquid Metal GLSL, shader sizing, color parsing and the transparent image placeholder. No React runtime, external CDN request or dependency installation is needed at runtime.

`source-manifest.json` identifies the exact input URLs and SHA-256 hashes. `bundle-manifest.json` records output hashes. The external source map includes the upstream source text.

Built with esbuild 0.28.0: browser platform, ESM, ES2020, bundle and tree shaking enabled, no minification, external source map with source contents, inline legal comments. The subset entry re-exports ShaderMount; liquidMetalFragmentShader and LiquidMetalShapes; defaultObjectSizing, defaultPatternSizing and ShaderFitOptions; getShaderColorFromString; and emptyPixel. Bundle banner identifies this version, commit and license.

Playbook's optical compositor and Canvas fallback live outside this vendor directory. They do not modify the upstream implementation.
