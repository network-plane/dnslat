/** Load theme CSS from server and inject into #theme-css or given style element */
export async function applyThemeFromAPI(
  template: string,
  scheme: string,
  styleEl?: HTMLStyleElement | null
): Promise<void> {
  const url = `/api/theme?template=${encodeURIComponent(template)}&scheme=${encodeURIComponent(scheme)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("theme fetch failed");
  const css = await res.text();
  const el =
    styleEl ??
    (document.getElementById("theme-css") as HTMLStyleElement | null);
  if (el) el.textContent = css;
  document.documentElement.dataset.template = template;
  document.documentElement.dataset.scheme = scheme;
}
