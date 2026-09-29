# CodeOtter cinematic film

The primary marketing version is `marketing/out/codeotter-cinematic-film-silent.mp4`: a 74-second, 1920x1080, 60 fps landscape film. It is authored and rendered with [Flute](https://github.com/webprodigies-org/flute), the tool in the user's [Web Prodigies reference](https://www.youtube.com/watch?v=4TOyv0CtmPE).

The visual direction uses close oblique views, camera rails along the app, layered assembly, and lifted controls. The white stage has a subtle warm gradient. Text stays sharp with focus blur disabled; the CodeOtter wordmark uses one charcoal color. The opening and closing use the first README mascot without an added frame. Music is omitted.

The earlier 30-second intro and flat 99-second product tour are retained as superseded drafts. They are not the primary delivery.

## Storyboard

| Time | Primary subject and movement |
| --- | --- |
| 0-4 s | Wordmark and mascot reveal; the camera turns into the application. |
| 4-11 s | Dashboard sections assemble at different depths while the camera travels across the app. |
| 11-21 s | PR context arrives, followed by six staggered score rings. Values animate to the fictional result. |
| 21-27 s | Pre-merge checks and the file walkthrough lift from the review surface. |
| 27-32 s | The camera moves into a finding and its fictional suggested diff. |
| 32-40 s | Repository settings appear; the detected-guidelines panel lifts forward. |
| 40-48 s | One camera rail travels from the language model to the System One provider. |
| 48-58 s | Local model download progresses, becomes active, then the camera travels down to local System One models. |
| 58-62 s | GitHub OAuth connection controls in close-up. |
| 62-69 s | Comment options and a generated PR score comment, followed by a closer view of the result. |
| 69-74 s | The app recedes and the camera returns to the wordmark and mascot. |

## Timeline spec

One 74,000 ms Flute clock, speed 1, drives 28 stable surfaces and 90 canonical tracks. Six camera tracks control translation and rotation. Each visual layer has opacity, depth and vertical assembly tracks. Camera rails hold their viewing angle during each survey; rotations connect different views. Camera positions are derived from Flute's `matrixFor`, so rails follow the projected app plane.

Assembly settles over 1,250 ms with Flute's cinematic easing. Short 180 ms opacity entrances keep the panels solid during the reveal; exits use 300 ms. Score counters use Flute's canonical `cinematicProgress`. Model download progress and selection derive from `useSceneTime`. No independent animation clock drives the product story.

Perspective is 2,400 px. Most reading shots use approximately 1.05-1.22 magnification, with the finding at 1.30-1.35. Camera yaw reaches 19 degrees. Depth-of-field blur is zero. Macro shots intentionally crop supporting app edges while keeping their primary subject readable.

## Implementation and reproduction

Requires Node 22.12+, pnpm, FFmpeg, and either Playwright Chromium or an installed Chrome/Edge. From `web/`:

```sh
pnpm install
pnpm cinematic:init
pnpm cinematic:compose
pnpm cinematic
```

Open `http://127.0.0.1:5188/?flute-preview=1&flute-scene=codeotter-cinematic-film` for editing and inspection. For the offline export, build and start the separate optimized local render server:

```sh
pnpm cinematic:render-build
pnpm cinematic:render-serve
```

That serves the fixed render build on `127.0.0.1:5189`. Leave it running and render from another terminal:

```sh
pnpm cinematic:export
```

The renderer writes `web/.flute/exports/codeotter-cinematic-film-silent.mp4`. It refuses to overwrite existing files. To render another revision:

```sh
pnpm cinematic:export .flute/exports/codeotter-cinematic-film-v2.mp4
```

- `scripts/compose-cinematic-film.mjs` authors the camera and surface choreography, validates it through Flute, and writes the canonical recipe.
- `src/flute/scenes/codeotter-cinematic-film.tsx` reuses `AppSidebar`, `JsonReport`, `JsonForm`, `MarkdownView`, `Ring`, and the application's `GitHubMark`. Layout is arranged into spatial surfaces; the controls retain their real component styling.
- `cinematic-film.css` supplies backing surfaces, reading sizes and the explicitly requested light stage. The suggested diff also has a light background.
- `scripts/render-cinematic-film.mjs` renders four contiguous 18.5-second sampling windows concurrently, then concatenates the MP4 streams without re-encoding. Each worker uses the same full Flute timeline; only the capture sampling offset and duration change. There are no missing or repeated frames at the joins.
- `scripts/export-cinematic-film.mjs` invokes Flute's PNG-frame renderer and FFmpeg at 60 fps. It selects installed Chrome/Edge when necessary, applies H.264 CRF 17 / fast encoding for moving UI text, and allows a longer offline render timeout. `CODEOTTER_RENDER_BROWSER` overrides the browser executable. No screen recording is used as the master.
- `vite.cinematic.render.config.ts` produces the local optimized render build under ignored `.flute/render-site`. It explicitly enables the dedicated preview in this one build; the ordinary production config continues to exclude it. The render server is loopback-only with a restrictive CSP and no live API proxy.
- The final export is copied to `marketing/out/` for the marketing team. Previous drafts remain available under their distinct filenames.

### Fictional data and isolation

`src/flute/tour-demo.json` supplies all records. User and author identities are Dharmesh Gurnani / dharmeshgurnani; emails use example.com. Model names and publishers are public catalog metadata. The suggested diff is fictional and illustrates the fictional finding. The GitHub score comment uses the production formatter with dummy input; it is a preview and is never posted. Model downloads and activation are simulated.

`vite.cinematic.config.ts` is a separate loopback-only fixture server with no live API proxy, credentials or storage. Writes return 405; unknown API routes return 404. CSP blocks remote images and network requests. The ordinary application can be inspected against fixtures with `?inspect=1`. The dedicated preview is loaded behind a development-only build condition, and production excludes the film and fixture data.

## Accessibility and fallback

The preview starts paused and provides play, pause, seek and replay. Reduced-motion CSS disables incidental sidebar transitions. Route-keyed sidebar instances keep backward scrubbing deterministic. Surface registrations remain stable; off-camera component content mounts only around its visibility window to avoid needless work. The fixed exported film contains the authored camera movement; video-player controls provide pause and seeking. The ordinary app remains unchanged in normal use.

## Validation

Run `pnpm build`, `pnpm exec flute validate`, and `git diff --check`. Inspect reading shots and intermediate transitions in the shared browser; compare the source app components, check panel overflow, and scrub backward as well as forward. The film must contain camera translation and relative layer movement, not merely static scene changes.

After export, inspect native-resolution frames from the MP4, decode the complete file, and confirm 1920x1080, 60 fps, 74 seconds, 4,440 frames, and no audio stream. Review the dashboard assembly, score animation, camera travel between the providers, download/active states, OAuth controls, and the final GitHub comment.

All artifacts and changes remain local. Nothing is committed or pushed.
