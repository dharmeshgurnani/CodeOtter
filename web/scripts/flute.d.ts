// Flute's index.d.ts re-exports './core' without file extensions, which NodeNext resolution
// cannot follow from here. Declare the two functions the film composer calls, matching
// dist/library/types/core/spatial.d.ts and authoring.d.ts.
import "@webprodigies/flute";

declare module "@webprodigies/flute" {
  export type Matrix = readonly number[];
  export type Transform = { x: number; y: number; z: number; rotateX: number; rotateY: number; rotateZ: number; scale: number };
  export type AuthoringIssue = { code: string; path: string; message: string };
  export type AuthoringReview = { valid: boolean; issues: AuthoringIssue[]; advice: AuthoringIssue[]; requiresVisualReview: true };
  export function matrixFor(t: Transform): Matrix;
  export function reviewAuthoring(input: unknown): AuthoringReview;
}
