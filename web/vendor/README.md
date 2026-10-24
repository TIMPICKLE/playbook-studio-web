# Vendored browser dependency

`tsparticles.slim-4.4.0.min.js` is the unmodified tsParticles Slim 4.4.0 browser bundle.

- Upstream: https://github.com/tsparticles/tsparticles
- Download: https://cdn.jsdelivr.net/npm/@tsparticles/slim@4.4.0/tsparticles.slim.bundle.min.js
- License: MIT; see `tsparticles.LICENSE.txt`.
- The local copy avoids a runtime CDN dependency. It is loaded lazily, after the usable interface, and never loaded when decorative motion is disabled.
- Upgrade deliberately: update the filename, service-worker cache and source URL together, and check the particle options and reduced-motion behavior.

## Embla Carousel 8.6.0

`embla-carousel-8.6.0/` contains the unmodified ESM browser bundle and source map from the already-installed `embla-carousel` 8.6.0 package. The editor uses its framework-independent core for the playbook card chooser. The stable v8 API is used; no RC upgrade or runtime CDN is needed.

- Source: https://github.com/davidjerleke/embla-carousel/tree/v8.6.0
- Docs: https://www.embla-carousel.com/docs/v8/
- License: MIT; see `embla-carousel-8.6.0/LICENSE`.
