/**
 * Excalidraw scene -> text for the professor (ARCHITECTURE D5).
 *
 * The bridge injects this string as a spoken student turn, so the output has to
 * read like something a person said. Text elements alone are not enough: a
 * student who draws three boxes and two arrows has said something real, and a
 * text-only extractor would send an empty string and silently drop their work.
 *
 * Pure module. No React, no DOM, no Excalidraw import — the element shape below
 * is a structural subset, so real scene elements pass straight in and unit tests
 * can use hand-written literals.
 */

/** Structural subset of an Excalidraw scene element: only the fields we read. */
export interface SceneElement {
  readonly type: string;
  readonly id?: string;
  readonly isDeleted?: boolean;
  /** Present on text elements. */
  readonly text?: string;
  /** Set when a text element is a label bound to a shape or arrow. */
  readonly containerId?: string | null;
  readonly startBinding?: { readonly elementId: string } | null;
  readonly endBinding?: { readonly elementId: string } | null;
}

/** Guards against a pathological scene producing a novel. The bridge caps too. */
const MAX_TEXT_LINES = 40;
const MAX_LABELS = 12;
const MAX_CONNECTIONS = 8;

const SHAPE_NOUNS: Record<string, readonly [string, string]> = {
  rectangle: ["rectangle", "rectangles"],
  diamond: ["diamond", "diamonds"],
  ellipse: ["ellipse", "ellipses"],
  line: ["line", "lines"],
  freedraw: ["freehand mark", "freehand marks"],
  image: ["image", "images"],
  frame: ["frame", "frames"],
  arrow: ["arrow", "arrows"],
};

/** Arrows read last so the sentence lands on how things connect. */
const SHAPE_ORDER: readonly string[] = [
  "rectangle",
  "diamond",
  "ellipse",
  "line",
  "freedraw",
  "image",
  "frame",
  "arrow",
];

function noun(type: string, count: number): string {
  const pair = SHAPE_NOUNS[type];
  if (!pair) return count === 1 ? "shape" : "shapes";
  return count === 1 ? pair[0] : pair[1];
}

function clean(value: string | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function quote(value: string): string {
  return `"${value}"`;
}

function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * Serialize a scratch-pane scene into something the professor can respond to.
 * Returns "" when the scene is genuinely empty — the submit gate blocks on that.
 */
export function summarizeNotesPane(
  elements: readonly SceneElement[] | null | undefined,
): string {
  if (!elements || elements.length === 0) return "";

  const live = elements.filter((el) => el && !el.isDeleted);
  if (live.length === 0) return "";

  const byId = new Map<string, SceneElement>();
  for (const el of live) {
    if (typeof el.id === "string") byId.set(el.id, el);
  }

  // --- text, split into free-standing lines and shape labels ---------------
  const freeText: string[] = [];
  const labelByContainer = new Map<string, string>();
  const labels: string[] = [];

  for (const el of live) {
    if (el.type !== "text") continue;
    const text = clean(el.text);
    if (!text) continue;
    if (typeof el.containerId === "string" && el.containerId) {
      labelByContainer.set(el.containerId, text);
      labels.push(text);
    } else {
      freeText.push(text);
    }
  }

  // --- shape census --------------------------------------------------------
  const counts = new Map<string, number>();
  for (const el of live) {
    if (el.type === "text") continue;
    counts.set(el.type, (counts.get(el.type) ?? 0) + 1);
  }

  const censusParts: string[] = [];
  for (const type of SHAPE_ORDER) {
    const n = counts.get(type);
    if (n) censusParts.push(`${n} ${noun(type, n)}`);
  }
  for (const [type, n] of counts) {
    if (!SHAPE_ORDER.includes(type)) censusParts.push(`${n} ${noun(type, n)}`);
  }

  // --- arrow connections ---------------------------------------------------
  const describeEnd = (elementId: string | undefined): string | null => {
    if (!elementId) return null;
    const label = labelByContainer.get(elementId);
    if (label) return quote(label);
    const target = byId.get(elementId);
    return target ? `a ${noun(target.type, 1)}` : null;
  };

  const connections: string[] = [];
  for (const el of live) {
    if (el.type !== "arrow") continue;
    const from = describeEnd(el.startBinding?.elementId);
    const to = describeEnd(el.endBinding?.elementId);
    if (!from || !to) continue;
    const arrowLabel = typeof el.id === "string" ? labelByContainer.get(el.id) : undefined;
    connections.push(
      arrowLabel ? `${from} to ${to}, marked ${quote(arrowLabel)}` : `${from} to ${to}`,
    );
    if (connections.length >= MAX_CONNECTIONS) break;
  }

  // --- assemble ------------------------------------------------------------
  const lines: string[] = [];

  for (const line of freeText.slice(0, MAX_TEXT_LINES)) lines.push(line);

  if (censusParts.length > 0) {
    lines.push(`Sketch: ${joinList(censusParts)}.`);
  }

  const uniqueLabels = Array.from(new Set(labels)).slice(0, MAX_LABELS);
  if (uniqueLabels.length > 0) {
    lines.push(`Labelled: ${joinList(uniqueLabels.map(quote))}.`);
  }

  if (connections.length > 0) {
    lines.push(`Arrows run ${connections.join("; ")}.`);
  }

  return lines.join("\n").trim();
}
