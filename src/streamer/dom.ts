/** DOM-only implementation keeps the feature dependency-free and testable in Chromium.
 * React owns the mounting div; this module owns only that div's descendants. No innerHTML.
 */
export type Child = Node | string | number | null | undefined | false;
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children.flat())
    if (child !== null && child !== undefined && child !== false)
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
export function action(label: string, handler: () => void, primary = false): HTMLButtonElement {
  const node = el(
    "button",
    `dc-streamer-button${primary ? " is-primary" : ""}`,
    label,
    el("span", "dc-streamer-arrow", "→"),
  );
  node.querySelector(".dc-streamer-arrow")?.setAttribute("aria-hidden", "true");
  node.type = "button";
  node.addEventListener("click", handler);
  return node;
}
const PATHS: Record<string, string> = {
  live: "M9 8v8l7-4z M4 4h16v16H4z",
  queue:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  calendar: "M4 5h16v16H4z M16 3v4 M8 3v4 M4 11h16 M8 15h2 M14 15h2",
  chart: "M4 20V10h3v10 M11 20V4h3v16 M18 20V7h3v13",
  settings:
    "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  star: "m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z",
  gift: "M3 9h18v4H3z M5 13v8h14v-8 M12 9v12 M12 9C3 9 4 1 8 3l4 6 M12 9c9 0 8-8 4-6l-4 6",
  announce: "m3 10 16-6v16L3 14z M6 15l1 6h4l-2-5",
  game: "M7 7h10c3 0 4 3 5 10 0 3-4 3-6-1H8c-2 4-6 4-6 1 1-7 2-10 5-10z M7 10v5 M4.5 12.5h5 M16 11h.1 M19 14h.1",
};
export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "dc-streamer-icon");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", PATHS[name] ?? PATHS.star);
  svg.append(path);
  return svg;
}
let fieldId = 0;
export function field(
  form: HTMLFormElement,
  name: string,
  label: string,
  value: string,
  opts: { multiline?: boolean; type?: string; required?: boolean; maxLength?: number; min?: string; max?: string } = {},
) {
  const input = opts.multiline ? el("textarea", "dc-streamer-input") : el("input", "dc-streamer-input");
  input.name = name;
  input.id = `dc-streamer-field-${++fieldId}`;
  input.value = value;
  input.required = opts.required ?? false;
  input.maxLength = opts.maxLength ?? 2000;
  if (input instanceof HTMLInputElement) {
    input.type = opts.type ?? "text";
    if (opts.min) input.min = opts.min;
    if (opts.max) input.max = opts.max;
  }
  const title = el("label", "", label);
  title.htmlFor = input.id;
  form.append(el("div", "dc-streamer-field", title, input));
  return input;
}
export function formValues(form: HTMLFormElement): Record<string, unknown> {
  return Object.fromEntries(new FormData(form).entries());
}
