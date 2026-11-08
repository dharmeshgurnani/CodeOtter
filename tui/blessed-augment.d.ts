// Blessed internals the TUI relies on that @types/blessed does not declare.
import "blessed";

declare module "blessed" {
  export const unicode: {
    charWidth(value: string | number, index?: number): number;
    chars: { all: RegExp };
  };
  export const helpers: { escape(text: string): string };

  interface BlessedProgram {
    _write(data: string | Buffer): unknown;
  }

  // Blessed also takes 256-color indices and functions of the styled element (or its label/item) as colors.
  export type ThemeColor = string | number | ((element: { parent: { focused: boolean } }) => string | number);
  export interface ThemeStyle {
    fg?: ThemeColor;
    bg?: ThemeColor;
    bold?: boolean;
    border?: { fg?: ThemeColor; bg?: ThemeColor };
    label?: ThemeStyle;
    selected?: ThemeStyle;
    item?: ThemeStyle;
    scrollbar?: ThemeStyle;
    track?: ThemeStyle;
  }
  export namespace Widgets {
    interface BlessedElement {
      parseTags: boolean;
      wrap: boolean;
      readonly focused: boolean;
      // Wrapped content lines; rtof maps each line back to its unwrapped source line.
      _clines?: string[] & { rtof?: number[] };
    }
    interface ListElement {
      selected: number;
    }
  }

  export function list(options?: Omit<Widgets.ListOptions<Widgets.ListElementStyle>, "style"> & { style?: ThemeStyle }): Widgets.ListElement;
}
