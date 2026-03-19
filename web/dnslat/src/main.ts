import {
  fetchJSON,
  formatNumber,
  formatDateTime,
  renderLineChart,
  renderCombinedChart,
  renderPercentileChart,
  type TimeSeriesRow,
  type RangeKey,
  type SeriesDef,
  type PercentileStats,
} from "../../../packages/planeweb/src/index.ts";

type Resolver = { id: string; name: string; address: string; builtin: boolean; enabled: boolean };

function resolversToProbe(list: Resolver[]): Resolver[] {
  return list.filter((r) => r.enabled);
}
type RunResult = {
  resolver_id: string;
  resolver_name?: string;
  latency_ms: number;
  rcode: number;
  answer_count: number;
  ttl_min?: number;
  details_json?: string;
};
type Run = { id: string; timestamp: string; query_domain: string; results: RunResult[] };
type Schedule = {
  id: string;
  name: string;
  enabled: boolean;
  type: string;
  every?: string;
  time_of_day?: string;
};

const COLORS = ["#4ade80", "#60a5fa", "#fbbf24", "#f87171", "#a78bfa", "#2dd4bf", "#fb7185", "#38bdf8"];

function $(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error("#" + id);
  return e;
}

/** App-styled confirm dialog (avoids browser `confirm()`). */
function showConfirm(
  title: string,
  message: string,
  okLabel = "OK",
  danger = false
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = $("confirm-modal") as HTMLElement;
    ($("confirm-modal-title") as HTMLElement).textContent = title;
    ($("confirm-modal-message") as HTMLElement).textContent = message;
    const okBtn = $("confirm-modal-ok") as HTMLButtonElement;
    const cancelBtn = $("confirm-modal-cancel") as HTMLButtonElement;
    okBtn.textContent = okLabel;
    okBtn.classList.toggle("btn-danger", danger);
    overlay.style.display = "flex";
    const done = (v: boolean) => {
      overlay.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === overlay) done(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(false);
    };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

async function loadResolvers(): Promise<Resolver[]> {
  return fetchJSON<Resolver[]>("/api/resolvers");
}

function applyCombinedPanelVisibility(): void {
  const on = localStorage.getItem("combined-graph") === "true";
  ($("combined-chart-panel") as HTMLElement).style.display = on ? "" : "none";
  ($("individual-charts") as HTMLElement).style.display = on ? "none" : "";
}

async function refreshDashboardCards(): Promise<void> {
  const dash = await fetchJSON<{
    query_domain: string;
    run_count_30d: number;
    fastest_name: string;
    fastest_ms: number;
    slowest_name: string;
    slowest_ms: number;
    median_all_ms: number;
    avg_median_30d_ms: number;
  }>("/api/dashboard-summary");
  $("card-domain").textContent = dash.query_domain || "–";
  const hasFast = dash.fastest_name && dash.fastest_ms > 0;
  $("card-fastest-name").textContent = hasFast ? dash.fastest_name : "–";
  $("card-fastest-ms").textContent = hasFast ? `${formatNumber(dash.fastest_ms, 1)} ms` : "–";
  $("card-median").textContent =
    dash.median_all_ms > 0 ? `${formatNumber(dash.median_all_ms, 1)} ms` : "–";
  const hasSlow = dash.slowest_name && dash.slowest_ms > 0;
  $("card-slowest-name").textContent = hasSlow ? dash.slowest_name : "–";
  $("card-slowest-ms").textContent = hasSlow ? `${formatNumber(dash.slowest_ms, 1)} ms` : "–";
  $("card-runs").textContent = String(dash.run_count_30d ?? 0);
  const avg = dash.avg_median_30d_ms;
  if (avg > 0 && dash.fastest_ms > 0) {
    const d = dash.fastest_ms - avg;
    ($("card-fastest-compare") as HTMLElement).textContent =
      d <= 0 ? `${formatNumber(Math.abs(d), 1)} ms vs 30d avg` : `+${formatNumber(d, 1)} ms vs 30d avg`;
  } else ($("card-fastest-compare") as HTMLElement).textContent = "";
  if (avg > 0 && dash.median_all_ms > 0) {
    const d = dash.median_all_ms - avg;
    ($("card-median-compare") as HTMLElement).textContent =
      Math.abs(d) < 0.01
        ? "On 30d avg"
        : d < 0
          ? `${formatNumber(Math.abs(d), 1)} ms below 30d avg`
          : `${formatNumber(d, 1)} ms above 30d avg`;
  } else ($("card-median-compare") as HTMLElement).textContent = "";
}

async function refreshCombinedChart(): Promise<void> {
  if (localStorage.getItem("combined-graph") !== "true") return;
  const range = ($("range-combined") as HTMLSelectElement).value as RangeKey;
  const resolvers = resolversToProbe(await loadResolvers());
  const j = await fetchJSON<{ data: TimeSeriesRow[] }>(
    "/api/chart-combined?range=" + encodeURIComponent(range)
  );
  const series: SeriesDef[] = resolvers.map((r, i) => ({
    key: r.id,
    name: r.name,
    unit: "ms",
    color: COLORS[i % COLORS.length],
  }));
  const el = $("combined-chart");
  if (!j.data.length) {
    el.textContent = "No data yet.";
    return;
  }
  renderCombinedChart("combined-chart", j.data, series, {
    range,
    useLogarithmic: localStorage.getItem("logarithmic-scale") === "true",
  });
}

type ChartDataResp = {
  data: TimeSeriesRow[];
  stats?: PercentileStats;
  min_value: number;
  max_value: number;
};

async function renderResolverChart(resolver: Resolver): Promise<void> {
  const cid = "chart-res-" + safeId(resolver.id);
  const range = (
    document.getElementById("range-res-" + safeId(resolver.id)) as HTMLSelectElement
  )?.value as RangeKey;
  const toggle = document.getElementById("toggle-res-" + safeId(resolver.id));
  const pct = toggle?.classList.contains("active");
  if (!range) return;
  if (pct) {
    const cd = await fetchJSON<ChartDataResp>(
      "/api/chart-data?range=" + encodeURIComponent(range) + "&metric=" + encodeURIComponent(resolver.id)
    );
    if (!cd.stats || !cd.data.length) {
      const box = document.getElementById(cid);
      if (box) box.textContent = "No data.";
      return;
    }
    renderPercentileChart(cid, cd.stats, resolver.name, "ms");
    return;
  }
  const j = await fetchJSON<{ data: TimeSeriesRow[] }>(
    "/api/chart-data?range=" + encodeURIComponent(range) + "&metric=" + encodeURIComponent(resolver.id)
  );
  const rows: TimeSeriesRow[] = (j.data || []).map((row) => ({
    timestamp: row.timestamp,
    values: { latency: row.values?.latency ?? 0 },
  }));
  const box = document.getElementById(cid);
  if (!rows.length) {
    if (box) box.textContent = "No data";
    return;
  }
  const idx = (await loadResolvers()).findIndex((r) => r.id === resolver.id);
  renderLineChart(cid, rows, "latency", {
    range,
    metricName: resolver.name,
    metricUnit: "ms",
    strokeColor: COLORS[(idx >= 0 ? idx : 0) % COLORS.length],
  });
}

async function buildIndividualChartPanels(): Promise<void> {
  const grid = $("individual-charts") as HTMLElement;
  grid.innerHTML = "";
  const resolvers = resolversToProbe(await loadResolvers());
  if (!resolvers.length) {
    grid.innerHTML =
      "<p class='muted' style='padding:12px;'>No enabled resolvers. Enable at least one under Preferences.</p>";
    return;
  }
  for (let i = 0; i < resolvers.length; i++) {
    const r = resolvers[i];
    const sid = safeId(r.id);
    const pctOn = localStorage.getItem("chart-pct-" + r.id) === "true";
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">${r.name} (ms)</div>
        <div style="display:flex;gap:12px;align-items:center;">
          <select id="range-res-${sid}" class="select">
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;color:var(--muted);">Percentile</span>
            <button type="button" class="chart-toggle${pctOn ? " active" : ""}" id="toggle-res-${sid}"><span class="chart-toggle-slider"></span></button>
          </div>
        </div>
      </div>
      <div class="chart" id="chart-res-${sid}"></div>`;
    grid.appendChild(panel);
    const sel = document.getElementById("range-res-" + sid) as HTMLSelectElement;
    sel.addEventListener("change", () => renderResolverChart(r).catch(console.error));
    const tog = document.getElementById("toggle-res-" + sid);
    tog?.addEventListener("click", () => {
      tog.classList.toggle("active");
      localStorage.setItem("chart-pct-" + r.id, tog.classList.contains("active") ? "true" : "false");
      renderResolverChart(r).catch(console.error);
    });
    await renderResolverChart(r);
  }
}

let historyPage = 0;
let historyPerPage = 100;
let historyTotal = 0;
/** sort key: timestamp | id | query_domain | resolver id */
let historySortCol = "timestamp";
let historySortAsc = false;

function defaultSortAscForColumn(col: string): boolean {
  if (col === "query_domain") return true;
  if (col === "timestamp" || col === "id") return false;
  return true;
}

function renderHistoryThead(resolvers: Resolver[]): void {
  const tr = $("history-thead-row");
  tr.innerHTML = "";
  const headers: { label: string; key: string | null }[] = [
    { label: "ID", key: "id" },
    { label: "When", key: "timestamp" },
    { label: "Domain", key: "query_domain" },
    ...resolvers.map((r) => ({ label: r.name, key: r.id })),
    { label: "", key: null },
  ];
  for (const h of headers) {
    const th = document.createElement("th");
    if (h.key == null) {
      th.textContent = h.label;
      tr.appendChild(th);
      continue;
    }
    th.className = "history-sortable";
    th.title = "Sort by " + h.label;
    const label = document.createElement("span");
    label.textContent = h.label;
    th.appendChild(label);
    if (historySortCol === h.key) {
      const ind = document.createElement("span");
      ind.className = "history-sort-indicator";
      ind.textContent = historySortAsc ? " ▲" : " ▼";
      th.appendChild(ind);
    }
    th.addEventListener("click", () => {
      if (historySortCol === h.key) historySortAsc = !historySortAsc;
      else {
        historySortCol = h.key;
        historySortAsc = defaultSortAscForColumn(historySortCol);
      }
      historyPage = 0;
      loadHistoryPage().catch(console.error);
    });
    tr.appendChild(th);
  }
}

async function loadHistoryPage(): Promise<void> {
  const resolvers = await loadResolvers();
  renderHistoryThead(resolvers);
  const off = historyPage * historyPerPage;
  const sortQ = encodeURIComponent(historySortCol);
  const dirQ = historySortAsc ? "asc" : "desc";
  const j = await fetchJSON<{ results: Run[]; total: number }>(
    `/api/history?limit=${historyPerPage}&offset=${off}&sort=${sortQ}&dir=${dirQ}`
  );
  historyTotal = j.total;
  const tb = document.querySelector("#history-table tbody") as HTMLTableSectionElement;
  tb.innerHTML = "";
  for (const run of j.results) {
    const tr = document.createElement("tr");
    const byId: Record<string, number> = {};
    for (const rr of run.results) byId[rr.resolver_id] = rr.latency_ms;
    const cells = [
      run.id.slice(0, 8) + "…",
      formatDateTime(new Date(run.timestamp)),
      run.query_domain,
      ...resolvers.map((rv) => formatNumber(byId[rv.id] ?? 0, 2)),
    ];
    cells.forEach((c) => {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    });
    const td = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Delete";
    btn.onclick = async () => {
      const ok = await showConfirm(
        "Delete run?",
        "Remove this probe run from the database. This cannot be undone.",
        "Delete",
        true
      );
      if (!ok) return;
      await fetch("/api/runs/" + encodeURIComponent(run.id), { method: "DELETE" });
      await loadHistoryPage();
      refreshDashboardCards().catch(console.error);
    };
    td.appendChild(btn);
    tr.appendChild(td);
    tb.appendChild(tr);
  }
  const pages = Math.max(1, Math.ceil(historyTotal / historyPerPage));
  historyPage = Math.min(historyPage, pages - 1);
  $("history-page-info").textContent = `Page ${historyPage + 1} of ${pages} (${historyTotal} runs)`;
}

async function refreshSchemes(template: string): Promise<void> {
  const sel = $("pref-scheme") as HTMLSelectElement;
  sel.innerHTML = "";
  try {
    const schemes = await fetchJSON<{ name: string; display: string }[]>(
      "/api/schemes?template=" + encodeURIComponent(template)
    );
    for (const s of schemes) {
      const o = document.createElement("option");
      o.value = s.name;
      o.textContent = s.display || s.name;
      sel.appendChild(o);
    }
    const saved = localStorage.getItem("scheme") || "";
    if ([...sel.options].some((o) => o.value === saved)) sel.value = saved;
  } catch {
    sel.innerHTML = "<option value='default'>default</option>";
  }
}

function applyTheme(template: string, scheme: string): void {
  localStorage.setItem("template", template);
  localStorage.setItem("scheme", scheme);
  document.documentElement.setAttribute("data-template", template);
  document.documentElement.setAttribute("data-scheme", scheme);
  fetch("/api/theme?template=" + encodeURIComponent(template) + "&scheme=" + encodeURIComponent(scheme))
    .then((r) => r.text())
    .then((css) => {
      const s = document.getElementById("theme-css");
      if (s) s.textContent = css;
    })
    .catch(console.error);
}

let scheduleTimerInterval: ReturnType<typeof setInterval> | null = null;
let nextRunTime: number | null = null;
let intervalDurationMs: number | null = null;
let intervalStartTime: number | null = null;

async function fetchNextRunForTimer(): Promise<void> {
  const timerEl = document.getElementById("schedule-timer") as HTMLElement | null;
  if (!timerEl) return;
  try {
    const data = await fetchJSON<{
      next_run: string | null;
      remaining: number;
      interval_duration: number;
    }>("/api/next-run");
    if (!data.next_run) {
      timerEl.style.display = "none";
      nextRunTime = null;
      intervalDurationMs = null;
      intervalStartTime = null;
      timerEl.textContent = "";
      return;
    }
    timerEl.style.display = "block";
    const nextRun = new Date(data.next_run).getTime();
    nextRunTime = nextRun;
    const ivSec = data.interval_duration > 0 ? data.interval_duration : 3600;
    intervalDurationMs = ivSec * 1000;
    intervalStartTime = nextRun - intervalDurationMs;
    updateTimerDisplay();
  } catch {
    timerEl.style.display = "none";
  }
}

function updateTimerDisplay(): void {
  const timerEl = document.getElementById("schedule-timer") as HTMLElement | null;
  if (!timerEl || !nextRunTime || !intervalDurationMs || intervalStartTime == null) return;

  const now = Date.now();
  const remaining = Math.max(0, nextRunTime - now);
  const elapsed = now - intervalStartTime;
  const percent = Math.min(100, Math.max(0, (elapsed / intervalDurationMs) * 100));

  const totalSeconds = Math.ceil(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  const timeStr = parts.join(" ");

  timerEl.textContent = "";
  if (remaining > 0) {
    timerEl.title = `Next DNS run in ${timeStr}`;
    timerEl.classList.remove("paused");
    timerEl.style.setProperty("--progress-percent", percent + "%");
  } else {
    timerEl.title = "Ready (checking schedules…)";
    timerEl.classList.add("paused");
    timerEl.style.setProperty("--progress-percent", "100%");
  }
}

function startScheduleTimer(): void {
  void fetchNextRunForTimer();
  if (scheduleTimerInterval) clearInterval(scheduleTimerInterval);
  let tick = 0;
  scheduleTimerInterval = window.setInterval(() => {
    updateTimerDisplay();
    tick++;
    if (tick % 30 === 0) void fetchNextRunForTimer();
  }, 1000);
}

let editingScheduleId: string | null = null;

async function loadSchedules(): Promise<void> {
  const list = await fetchJSON<Schedule[]>("/api/schedules");
  const box = $("schedules-list");
  box.innerHTML = "";
  for (const sc of list) {
    const div = document.createElement("div");
    div.className = "form-row";
    div.style.marginBottom = "8px";
    const t =
      sc.type === "daily"
        ? `daily @ ${sc.time_of_day || "?"}`
        : `every ${sc.every || "?"}`;
    div.innerHTML = `<span style="flex:1">${sc.enabled ? "●" : "○"} <strong>${sc.name}</strong> — ${t}</span>`;
    const ed = document.createElement("button");
    ed.className = "btn";
    ed.textContent = "Edit";
    ed.onclick = () => {
      editingScheduleId = sc.id;
      ($("schedule-form-id") as HTMLInputElement).value = sc.id;
      ($("schedule-form-name") as HTMLInputElement).value = sc.name;
      ($("schedule-form-type") as HTMLSelectElement).value = sc.type;
      ($("schedule-form-every") as HTMLInputElement).value = sc.every || "";
      ($("schedule-form-timeOfDay") as HTMLInputElement).value = sc.time_of_day || "";
      ($("schedule-form-enabled") as HTMLInputElement).checked = sc.enabled;
      ($("schedule-form-submit") as HTMLButtonElement).textContent = "Save";
      ($("schedule-form-cancel") as HTMLElement).style.display = "";
      syncScheduleFields();
    };
    const del = document.createElement("button");
    del.className = "btn";
    del.textContent = "Delete";
    del.onclick = async () => {
      const ok = await showConfirm(
        "Delete schedule?",
        `Remove schedule "${sc.name || sc.id}"? This cannot be undone.`,
        "Delete",
        true
      );
      if (!ok) return;
      await fetch("/api/schedules/" + encodeURIComponent(sc.id), { method: "DELETE" });
      await loadSchedules();
      void fetchNextRunForTimer();
    };
    div.appendChild(ed);
    div.appendChild(del);
    box.appendChild(div);
  }
}

function syncScheduleFields(): void {
  const t = ($("schedule-form-type") as HTMLSelectElement).value;
  ($("schedule-form-every-field") as HTMLElement).style.display = t === "interval" ? "" : "none";
  ($("schedule-form-timeOfDay-field") as HTMLElement).style.display = t === "daily" ? "" : "none";
}

function showView(name: string): void {
  const titles: Record<string, string> = {
    dashboard: "Dashboard",
    history: "Results",
    preferences: "Preferences",
    about: "About",
  };
  $("subtitle").textContent = titles[name] || "";
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("view-active"));
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("nav-item-active"));
  const map: Record<string, string> = {
    dashboard: "view-dashboard",
    history: "view-history",
    preferences: "view-preferences",
    about: "view-about",
  };
  document.getElementById(map[name])?.classList.add("view-active");
  document.querySelector(`[data-view="${name}"]`)?.classList.add("nav-item-active");
  if (name === "history") loadHistoryPage().catch(console.error);
  if (name === "preferences") {
    loadSchedules().catch(console.error);
    loadResolvers().then(renderResolverList).catch(console.error);
  }
}

function renderResolverList(resolvers: Resolver[]): void {
  const ul = $("resolver-list") as HTMLUListElement;
  ul.innerHTML = "";
  for (const r of resolvers) {
    const li = document.createElement("li");
    li.style.marginBottom = "10px";
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.flexWrap = "wrap";
    li.style.gap = "10px";

    const probe = document.createElement("label");
    probe.style.display = "inline-flex";
    probe.style.alignItems = "center";
    probe.style.gap = "6px";
    probe.style.cursor = "pointer";
    probe.style.fontSize = "12px";
    probe.style.color = "var(--muted)";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = r.enabled;
    cb.title = "When checked, this resolver is queried on each run";
    cb.addEventListener("change", async () => {
      const want = cb.checked;
      try {
        await fetchJSON<Resolver>("/api/resolvers/" + encodeURIComponent(r.id), {
          method: "PATCH",
          body: JSON.stringify({ enabled: want }),
        });
      } catch {
        cb.checked = !want;
        return;
      }
      refreshAll().catch(console.error);
    });
    probe.appendChild(cb);
    probe.appendChild(document.createTextNode("Probe"));

    const info = document.createElement("span");
    info.style.flex = "1";
    info.style.minWidth = "200px";
    const strong = document.createElement("strong");
    strong.textContent = r.name;
    info.appendChild(strong);
    info.appendChild(document.createTextNode(" "));
    const addr = document.createElement("span");
    addr.className = "muted";
    addr.textContent = r.address;
    info.appendChild(addr);
    if (r.builtin) {
      const tag = document.createElement("span");
      tag.className = "muted";
      tag.style.fontSize = "11px";
      tag.textContent = " (default)";
      info.appendChild(tag);
    }

    const b = document.createElement("button");
    b.className = "btn";
    b.style.fontSize = "11px";
    b.textContent = "Remove";
    b.onclick = async () => {
      const ok = await showConfirm(
        "Remove resolver?",
        `Remove “${r.name}” (${r.address})? This cannot be undone.`,
        "Remove",
        true
      );
      if (!ok) return;
      const res = await fetch("/api/resolvers/" + encodeURIComponent(r.id), { method: "DELETE" });
      if (!res.ok) {
        alert("Could not remove resolver");
        return;
      }
      await renderResolverList(await loadResolvers());
      refreshAll().catch(console.error);
    };

    li.appendChild(probe);
    li.appendChild(info);
    li.appendChild(b);
    ul.appendChild(li);
  }
}

async function refreshAll(): Promise<void> {
  await refreshDashboardCards();
  applyCombinedPanelVisibility();
  if (localStorage.getItem("combined-graph") === "true") {
    await refreshCombinedChart();
  } else {
    await buildIndividualChartPanels();
  }
}

function connectWS(): void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(proto + "//" + location.host + "/ws");
  ws.onmessage = () => {
    refreshAll().catch(console.error);
    void fetchNextRunForTimer();
  };
  ws.onclose = () => setTimeout(connectWS, 2000);
}

async function loadPrefs(): Promise<void> {
  const p = await fetchJSON<{ save_manual_runs: boolean; default_query_domain: string }>("/api/preferences");
  ($("pref-save-manual-runs") as HTMLInputElement).checked = p.save_manual_runs;
  ($("pref-default-domain") as HTMLInputElement).value = p.default_query_domain || "example.com";
}

async function savePrefsPartial(body: object): Promise<void> {
  await fetchJSON("/api/preferences", { method: "PATCH", body: JSON.stringify(body) });
}

async function main(): Promise<void> {
  const tmpl = ($("pref-template") as HTMLSelectElement).value || localStorage.getItem("template") || "modern";
  await refreshSchemes(tmpl);
  ($("pref-template") as HTMLSelectElement).value = localStorage.getItem("template") || tmpl;

  ($("pref-combined-graph") as HTMLInputElement).checked = localStorage.getItem("combined-graph") === "true";
  ($("pref-logarithmic-scale") as HTMLInputElement).checked =
    localStorage.getItem("logarithmic-scale") === "true";

  await loadPrefs();

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => showView((btn as HTMLElement).dataset.view || "dashboard"));
  });

  $("sidebar-toggle").addEventListener("click", () => {
    $("sidebar").classList.toggle("collapsed");
  });

  ($("range-combined") as HTMLSelectElement).addEventListener("change", () =>
    refreshCombinedChart().catch(console.error)
  );

  ($("pref-combined-graph") as HTMLInputElement).addEventListener("change", (e) => {
    localStorage.setItem("combined-graph", (e.target as HTMLInputElement).checked ? "true" : "false");
    applyCombinedPanelVisibility();
    refreshAll().catch(console.error);
  });
  ($("pref-logarithmic-scale") as HTMLInputElement).addEventListener("change", (e) => {
    localStorage.setItem("logarithmic-scale", (e.target as HTMLInputElement).checked ? "true" : "false");
    refreshCombinedChart().catch(console.error);
  });

  ($("pref-template") as HTMLSelectElement).addEventListener("change", async () => {
    const t = ($("pref-template") as HTMLSelectElement).value;
    await refreshSchemes(t);
    const sc = ($("pref-scheme") as HTMLSelectElement).value;
    applyTheme(t, sc);
  });
  ($("pref-scheme") as HTMLSelectElement).addEventListener("change", () => {
    applyTheme(
      ($("pref-template") as HTMLSelectElement).value,
      ($("pref-scheme") as HTMLSelectElement).value
    );
  });

  ($("pref-save-manual-runs") as HTMLInputElement).addEventListener("change", async (e) => {
    await savePrefsPartial({ save_manual_runs: (e.target as HTMLInputElement).checked });
  });
  let domainTimer: ReturnType<typeof setTimeout> | null = null;
  ($("pref-default-domain") as HTMLInputElement).addEventListener("input", () => {
    if (domainTimer) clearTimeout(domainTimer);
    domainTimer = setTimeout(async () => {
      await savePrefsPartial({
        default_query_domain: ($("pref-default-domain") as HTMLInputElement).value.trim() || "example.com",
      });
    }, 500);
  });

  $("pref-clear-all-data").addEventListener("click", async () => {
    const ok = await showConfirm(
      "Clear all results?",
      "This permanently deletes every stored DNS probe run. Resolvers, schedules, and preferences are kept. Continue?",
      "Clear all",
      true
    );
    if (!ok) return;
    try {
      await fetchJSON<{ deleted_runs: number }>("/api/history", { method: "DELETE" });
    } catch (e) {
      console.error(e);
      window.alert("Could not clear results. Check the connection and try again.");
      return;
    }
    historyPage = 0;
    await loadHistoryPage();
    await refreshDashboardCards();
    await refreshAll();
  });

  ($("history-per-page") as HTMLSelectElement).addEventListener("change", () => {
    historyPerPage = parseInt(($("history-per-page") as HTMLSelectElement).value, 10);
    historyPage = 0;
    loadHistoryPage().catch(console.error);
  });
  $("history-page-first").addEventListener("click", () => {
    historyPage = 0;
    loadHistoryPage().catch(console.error);
  });
  $("history-page-prev").addEventListener("click", () => {
    historyPage = Math.max(0, historyPage - 1);
    loadHistoryPage().catch(console.error);
  });
  $("history-page-next").addEventListener("click", () => {
    const pages = Math.max(1, Math.ceil(historyTotal / historyPerPage));
    historyPage = Math.min(pages - 1, historyPage + 1);
    loadHistoryPage().catch(console.error);
  });
  $("history-page-last").addEventListener("click", () => {
    const pages = Math.max(1, Math.ceil(historyTotal / historyPerPage));
    historyPage = pages - 1;
    loadHistoryPage().catch(console.error);
  });

  ($("schedule-form-type") as HTMLSelectElement).addEventListener("change", syncScheduleFields);
  syncScheduleFields();
  $("schedule-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const body: Schedule = {
      id: ($("schedule-form-id") as HTMLInputElement).value || "",
      name: ($("schedule-form-name") as HTMLInputElement).value.trim(),
      enabled: ($("schedule-form-enabled") as HTMLInputElement).checked,
      type: ($("schedule-form-type") as HTMLSelectElement).value as "interval" | "daily",
      every: ($("schedule-form-every") as HTMLInputElement).value.trim(),
      time_of_day: ($("schedule-form-timeOfDay") as HTMLInputElement).value.trim(),
    };
    if (editingScheduleId) {
      await fetchJSON("/api/schedules/" + encodeURIComponent(editingScheduleId), {
        method: "PUT",
        body: JSON.stringify(body),
      });
    } else {
      await fetchJSON("/api/schedules", { method: "POST", body: JSON.stringify(body) });
    }
    editingScheduleId = null;
    ($("schedule-form-id") as HTMLInputElement).value = "";
    ($("schedule-form-name") as HTMLInputElement).value = "";
    ($("schedule-form-submit") as HTMLButtonElement).textContent = "Add";
    ($("schedule-form-cancel") as HTMLElement).style.display = "none";
    await loadSchedules();
    void fetchNextRunForTimer();
  });
  $("schedule-form-cancel").addEventListener("click", () => {
    editingScheduleId = null;
    ($("schedule-form-id") as HTMLInputElement).value = "";
    ($("schedule-form-submit") as HTMLButtonElement).textContent = "Add";
    ($("schedule-form-cancel") as HTMLElement).style.display = "none";
  });

  $("add-resolver").addEventListener("click", async () => {
    const name = ($("new-res-name") as HTMLInputElement).value.trim();
    const address = ($("new-res-addr") as HTMLInputElement).value.trim();
    if (!name || !address) return;
    await fetchJSON("/api/resolvers", { method: "POST", body: JSON.stringify({ name, address }) });
    ($("new-res-name") as HTMLInputElement).value = "";
    ($("new-res-addr") as HTMLInputElement).value = "";
    await refreshAll();
    await renderResolverList(await loadResolvers());
  });

  function showResultModal(title: string, html: string): void {
    ($("result-modal-title") as HTMLElement).textContent = title;
    ($("result-modal-body") as HTMLElement).innerHTML = html;
    ($("result-modal") as HTMLElement).style.display = "flex";
  }
  $("result-modal-close").addEventListener("click", () => {
    ($("result-modal") as HTMLElement).style.display = "none";
  });

  $("run-now-btn").addEventListener("click", async () => {
    const all = await loadResolvers();
    const resolvers = resolversToProbe(all);
    if (!resolvers.length) {
      alert("Enable at least one resolver under Preferences (Probe checkbox).");
      return;
    }
    const domain =
      ($("pref-default-domain") as HTMLInputElement).value.trim() ||
      (await fetchJSON<{ default_query_domain: string }>("/api/preferences")).default_query_domain;
    ($("progress-modal") as HTMLElement).style.display = "flex";
    ($("progress-status") as HTMLElement).textContent = "Probing";
    let i = 0;
    const spin = setInterval(() => {
      const r = resolvers[i % resolvers.length];
      ($("progress-message") as HTMLElement).textContent = r ? `Querying ${r.name}…` : "…";
      i++;
    }, 400);
    try {
      const out = await fetchJSON<{ run_id: string; results: RunResult[]; saved: boolean }>("/api/run", {
        method: "POST",
        body: JSON.stringify({ domain }),
      });
      clearInterval(spin);
      ($("progress-modal") as HTMLElement).style.display = "none";
      let rows = "";
      for (const r of out.results) {
        rows += `<tr><td>${r.resolver_name || r.resolver_id}</td><td>${formatNumber(r.latency_ms, 2)} ms</td><td>${r.rcode}</td></tr>`;
      }
      const note = out.saved ? `Run saved (${out.run_id.slice(0, 8)}…).` : "Not saved (enable in Preferences).";
      showResultModal("Probe complete", `<p class="muted">${note}</p><table class="table"><thead><tr><th>Resolver</th><th>Latency</th><th>RCODE</th></tr></thead><tbody>${rows}</tbody></table>`);
      await refreshAll();
      void fetchNextRunForTimer();
    } catch (e) {
      clearInterval(spin);
      ($("progress-modal") as HTMLElement).style.display = "none";
      alert(e instanceof Error ? e.message : String(e));
    }
  });

  startScheduleTimer();
  await refreshAll();
  connectWS();
}

document.addEventListener("DOMContentLoaded", () => main().catch(console.error));
