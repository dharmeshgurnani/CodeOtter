# 11. Lazy-load the review page, shiki and markdown

Priority: P3 · Effort: S (30 min) · Type: fix

## Problem
`pnpm build` emits one 871 KB JS chunk (264 KB gzip). Shiki grammars and the markdown renderer ship to the
login page and the home page, which render neither.

## Lazy fix
`const ReviewPage = lazy(() => import("./review-page"))` in `App.tsx` with the existing skeleton as the
`Suspense` fallback. Same for `onboarding-page`. Vite splits the rest. If shiki is still in the main chunk,
`await import("shiki")` inside `markdown.tsx` on the first code block.

## Done when
The main chunk is under 300 KB and the review page still highlights code.
