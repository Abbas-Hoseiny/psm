import type { FieldLayout, LayoutMeta } from "../types";

export const GRID_COLUMNS = 12;
export const GRID_ROWS = 16;
export const GRID_CELL_SIZE = 60;
export const GRID_PADDING = 32;

export const DEFAULT_LAYOUT_META: LayoutMeta = {
  columns: GRID_COLUMNS,
  rows: GRID_ROWS,
  cellWidth: GRID_CELL_SIZE,
  cellHeight: GRID_CELL_SIZE,
  padding: GRID_PADDING,
};

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function gridToPixels(layout: FieldLayout): PixelRect {
  const left = layout.x * GRID_CELL_SIZE;
  const top = layout.y * GRID_CELL_SIZE;
  const width = layout.w * GRID_CELL_SIZE;
  const height = layout.h * GRID_CELL_SIZE;
  return { left, top, width, height };
}

export function pixelsToGrid(rect: PixelRect): FieldLayout {
  const rawX = Math.round(rect.left / GRID_CELL_SIZE);
  const rawY = Math.round(rect.top / GRID_CELL_SIZE);
  const rawW = Math.max(1, Math.round(rect.width / GRID_CELL_SIZE));
  const rawH = Math.max(1, Math.round(rect.height / GRID_CELL_SIZE));
  return clampLayout({
    x: rawX,
    y: rawY,
    w: rawW,
    h: rawH,
    layer: 0,
    align: "left",
  });
}

export function clampLayout(layout: FieldLayout): FieldLayout {
  const w = Math.min(Math.max(1, layout.w), GRID_COLUMNS);
  const h = Math.min(Math.max(1, layout.h), GRID_ROWS);
  const x = Math.min(Math.max(0, layout.x), GRID_COLUMNS - w);
  const y = Math.min(Math.max(0, layout.y), GRID_ROWS - h);
  return {
    ...layout,
    x,
    y,
    w,
    h,
  };
}

export function layoutToStyle(layout: FieldLayout): Record<string, string> {
  const rect = gridToPixels(layout);
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

export function pixelRectFromElement(element: HTMLElement): PixelRect {
  const left = parseFloat(element.dataset.left ?? "0");
  const top = parseFloat(element.dataset.top ?? "0");
  const width = parseFloat(element.dataset.width ?? `${element.offsetWidth}`);
  const height = parseFloat(
    element.dataset.height ?? `${element.offsetHeight}`
  );
  return {
    left,
    top,
    width,
    height,
  };
}
