"use strict";

const PAGE_SIZE = 25;
const VIEW_NAMES = { overview: "Overview", relationships: "Relationships", watchlist: "Watchlist", activity: "Activity", system: "System" };
const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  relationships: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m3 9v-2a6 6 0 0 0-3-5.2"/>',
  watchlist: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  system: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"/><circle cx="12" cy="12" r="5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  previous: '<path d="m15 5-7 7 7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.5 1.5c-1 1-2 1-2 3M12 17h.01"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  alert: '<path d="m10.3 4-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  link: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/>',
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.activity}</svg>`;
}

function h(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function list(value) { return Array.isArray(value) ? value : []; }
function numeric(value) { return typeof value === "number" && Number.isFinite(value); }
function count(value) { return numeric(value) ? new Intl.NumberFormat().format(value) : "Unknown"; }
function signed(value) { return numeric(value) ? `${value > 0 ? "+" : ""}${count(value)}` : "Unknown"; }

function dateValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, withTime = false) {
  const date = dateValue(value);
  if (!date) return "Not recorded";
  const options = { month: "short", day: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  return date.toLocaleString(undefined, options);
}

function relativeTime(value) {
  const date = dateValue(value);
  if (!date) return "Not recorded";
  const diff = Math.max(0, Date.now() - date.getTime());
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}d ago`;
  return formatDate(value);
}

function profileURL(username) {
  if (typeof username !== "string" || !/^[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?$/.test(username) || username.includes("..")) return null;
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function statusInfo(source = {}) {
  const status = String(source.status || "missing").toLowerCase();
  if (["failed", "error", "failure"].includes(status)) return { label: "Collection failed", tone: "danger", icon: "alert" };
  if (["hidden", "private", "restricted"].includes(status)) return { label: "List unavailable", tone: "warning", icon: "lock" };
  if (status === "missing") return { label: "No local data", tone: "neutral", icon: "question" };
  if (source.stale || status === "stale") return { label: "Stale data", tone: "warning", icon: "clock" };
  if (["degraded", "partial", "incomplete"].includes(status)) return { label: "Partial coverage", tone: "warning", icon: "alert" };
  if (["ok", "success", "complete", "completed"].includes(status)) return { label: "Up to date", tone: "ok", icon: "check" };
  return { label: "Status unknown", tone: "neutral", icon: "question" };
}

function badge(source) {
  const info = statusInfo(source);
  return `<span class="badge ${info.tone}"><span class="badge-dot"></span>${info.label}</span>`;
}

function describeEvent(event = {}) {
  const type = String(event.type || "unknown");
  const anonymous = /unknown|unattributed|count_delta|balance/.test(type);
  if (anonymous) return { title: "Unattributed follower change", detail: `${numeric(event.delta) ? `Reported count changed by ${signed(event.delta)}. ` : "Reported count changed. "}No account can be identified from this count change.`, anonymous: true, tone: "neutral", icon: "activity" };
  const labels = {
    follower_started: ["Started following you", "Confirmed in the personal relationship graph.", "ok", "plus"],
    follower_stopped: ["Stopped following you", "Confirmed in the personal relationship graph.", "warning", "minus"],
    following_started: ["Following added", "Confirmed in the observed following list.", "ok", "plus"],
    following_stopped: ["Following removed", "Confirmed removed from the observed following list.", "warning", "minus"],
    became_mutual: ["Became mutual", "Both sides of the relationship were observed.", "ok", "relationships"],
    lost_mutual: ["Mutual status changed", "This does not establish which side changed. Check the latest relationship evidence.", "warning", "relationships"],
    privacy_changed: ["Profile visibility changed", "A public profile flag changed in the existing source.", "neutral", "shield"],
    verification_changed: ["Verification status changed", "A profile flag changed in the existing source.", "neutral", "shield"],
    username_changed: ["Username changed", "The observed account now has a different username.", "neutral", "activity"],
  };
  const match = labels[type] || ["Relationship observation", "An observation was recorded by the source tracker.", "neutral", "activity"];
  return { title: match[0], detail: match[1], tone: match[2], icon: match[3], anonymous: false };
}

function avatar(account = {}) {
  const name = String(account.full_name || account.username || "?");
  const initials = name.split(/[\s_.]+/).filter(Boolean).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase() || "?";
  const hash = [...String(account.username || "")].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6;
  return `<span class="avatar avatar-${hash}" aria-hidden="true">${h(initials)}</span>`;
}

function accountCell(account) {
  return `<div class="account-cell">${avatar(account)}<span class="account-cell-copy"><strong>${h(account.username ? `@${account.username}` : "Unknown account")}</strong>${account.full_name ? `<small>${h(account.full_name)}</small>` : ""}</span></div>`;
}

function externalLink(username) {
  const url = profileURL(username);
  return url ? `<a class="profile-link" href="${h(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open @${h(username)} on Instagram">${icon("external", 14)}</a>` : "";
}

function truth(value) {
  if (value === true) return `<span class="truth yes">${icon("check", 12)}Yes</span>`;
  if (value === false) return `<span class="truth">${icon("minus", 12)}No</span>`;
  return `<span class="truth unknown">${icon("question", 12)}Unknown</span>`;
}

function relationshipLabel(value) {
  const labels = { mutual: ["Mutual", "ok"], not_following_back: ["Not following back", "neutral"], follows_you: ["Follows you", "info"], unknown: ["Unconfirmed", "warning"], inactive: ["Inactive", "neutral"] };
  const item = labels[value] || labels.unknown;
  return `<span class="badge ${item[1]}">${item[0]}</span>`;
}

function emptyState(title, detail, symbol = "relationships", action = "") {
  return `<div class="empty-state">${icon(symbol, 28)}<h2>${h(title)}</h2><p>${h(detail)}</p>${action}</div>`;
}

function pageHeading(title, description, actions = "", eyebrow = "YOUR WORKSPACE") {
  return `<div class="page-heading"><div><p class="eyebrow">${h(eyebrow)}</p><h1 id="page-title" tabindex="-1">${h(title)}</h1><p class="page-description">${h(description)}</p></div>${actions ? `<div class="page-heading-actions">${actions}</div>` : `<div class="date-label">${icon("calendar", 14)}${h(new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }))}</div>`}</div>`;
}

function sourceBanner(source, personal = true) {
  const info = statusInfo(source);
  if (info.tone === "ok") return "";
  const timestamp = personal ? source.last_success_at : source.last_run_at;
  let copy = timestamp ? `Last ${personal ? "successful collection" : "recorded run"}: ${formatDate(timestamp, true)}. ` : "No successful collection is recorded. ";
  if (source.stale && dateValue(timestamp)) copy += "These are historical observations, not a current relationship check. ";
  if (info.label === "Partial coverage") copy += "Some relationships are unknown until more evidence is available.";
  if (info.label === "List unavailable") copy += "An unavailable list is not an empty following list.";
  if (info.label === "Collection failed") copy += "Existing observations are preserved. Refresh data does not retry Instagram collection.";
  return `<section class="status-banner ${info.tone === "danger" ? "danger" : ""}" aria-label="Data status">${icon(info.icon, 18)}<div class="status-banner-copy"><strong>${personal ? "Personal graph" : "Watchlist source"}: ${h(info.label.toLowerCase())}</strong><p>${h(copy)}</p></div><button type="button" class="button" data-go="system">View system ${icon("arrow", 12)}</button></section>`;
}

const ui = {
  data: null, loading: false, error: "", view: "overview",
  relationships: { query: "", filter: "all", sort: "username", page: 1 },
  watchlist: { selected: 0, query: "", page: 1 },
  activity: { source: "all", range: "30", query: "", page: 1 },
  chart: { metric: "followers", range: "30" },
};

function personalData() { return ui.data?.personal || {}; }
function metrics() { return personalData().metrics || {}; }
function watched() { return list(ui.data?.watchlist); }

function personalStats() {
  const data = metrics();
  const items = [
    ["Followers", data.followers, "Reported by the source", "relationships"],
    ["Following", data.following, "Reported by the source", "arrow"],
    ["Mutuals", data.mutuals, "Both directions confirmed", "link"],
    ["Not following back", data.not_following_back, "Confirmed, not inferred", "question"],
  ];
  return `<section class="stats-strip" aria-label="Personal relationship totals">${items.map(([label, value, note, symbol]) => `<div class="stat"><div class="stat-label">${icon(symbol, 13)}${h(label)}</div><div class="stat-value">${h(count(value))}</div><div class="stat-foot">${h(note)}</div></div>`).join("")}</section>`;
}

function historyPoints() {
  const threshold = ui.chart.range === "all" ? 0 : Date.now() - Number(ui.chart.range) * 86400000;
  return list(personalData().runs).filter(run => dateValue(run.ts) && dateValue(run.ts).getTime() >= threshold && numeric(run[ui.chart.metric]) && !["error", "failed", "failure"].includes(String(run.status).toLowerCase())).sort((a, b) => dateValue(a.ts) - dateValue(b.ts));
}

function historySVG(points) {
  const viewport = typeof window === "undefined" ? 1440 : window.innerWidth;
  const rail = viewport > 1200 ? 224 : viewport > 768 ? 200 : 0;
  const gutter = viewport > 1200 ? 80 : viewport > 768 ? 56 : viewport > 480 ? 44 : 36;
  const available = viewport - rail - gutter;
  const panelWidth = viewport > 1200 ? (available - 24) * 1.95 / 2.95 : viewport > 1000 ? (available - 18) * 1.65 / 2.65 : available;
  const width = Math.max(240, Math.min(820, panelWidth - 36)), height = 190, left = 46, right = 18, top = 18, bottom = 36;
  const values = points.map(point => point[ui.chart.metric]);
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max(1, Math.ceil((high - low) * .2));
  const min = Math.max(0, low - padding), max = high + padding;
  const start = dateValue(points[0].ts).getTime(), end = dateValue(points.at(-1).ts).getTime();
  const x = point => points.length === 1 ? (left + width - right) / 2 : left + ((dateValue(point.ts).getTime() - start) / Math.max(1, end - start)) * (width - left - right);
  const y = value => top + (1 - (value - min) / (max - min)) * (height - top - bottom);
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(point).toFixed(1)},${y(point[ui.chart.metric]).toFixed(1)}`).join(" ");
  const area = `${path} L${x(points.at(-1)).toFixed(1)},${height - bottom} L${x(points[0]).toFixed(1)},${height - bottom} Z`;
  const ticks = [...new Set([min, Math.round((min + max) / 2), max])];
  const indexes = [...new Set(width < 400 ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 3), Math.floor((points.length - 1) * 2 / 3), points.length - 1])];
  return `<svg class="history-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${h(ui.chart.metric)} history, ${h(count(values[0]))} to ${h(count(values.at(-1)))} across ${points.length} observations"><title>${h(ui.chart.metric)} history</title><desc>Recorded observations only. Lines connect recorded values and do not imply a collection happened between them.</desc>${ticks.map(tick => `<line class="chart-grid" x1="${left}" x2="${width - right}" y1="${y(tick).toFixed(1)}" y2="${y(tick).toFixed(1)}"/><text class="chart-axis" x="${left - 10}" y="${(y(tick) + 4).toFixed(1)}" text-anchor="end">${h(count(tick))}</text>`).join("")}<path class="chart-area" d="${area}"/><path class="chart-line" d="${path}"/>${points.map(point => `<circle class="chart-point" cx="${x(point).toFixed(1)}" cy="${y(point[ui.chart.metric]).toFixed(1)}" r="${points.length > 60 ? 2 : 3.5}"><title>${h(formatDate(point.ts, true))}: ${h(count(point[ui.chart.metric]))}</title></circle>`).join("")}${indexes.map(index => `<text class="chart-axis" x="${x(points[index]).toFixed(1)}" y="${height - 10}" text-anchor="${index === 0 && points.length > 1 ? "start" : index === points.length - 1 && points.length > 1 ? "end" : "middle"}">${h(formatDate(points[index].ts))}</text>`).join("")}</svg>`;
}

function historyPanel() {
  const points = historyPoints();
  const first = points[0]?.[ui.chart.metric], last = points.at(-1)?.[ui.chart.metric];
  return `<section class="panel history-panel"><div class="panel-heading"><h2>In perspective</h2><div class="segmented" aria-label="History range">${["7", "30", "90", "all"].map(range => `<button type="button" data-chart-range="${range}" aria-pressed="${ui.chart.range === range}">${range === "all" ? "All" : `${range}d`}</button>`).join("")}</div></div><div class="chart-tabs" aria-label="History metric">${["followers", "following"].map(metric => `<button type="button" data-chart-metric="${metric}" aria-pressed="${ui.chart.metric === metric}">${metric === "followers" ? "Followers" : "Following"}</button>`).join("")}</div>${points.length ? `<div class="chart-summary"><span class="chart-current">${h(count(last))}</span><span class="chart-change">${points.length > 1 ? `${h(signed(last - first))} over recorded observations` : "One recorded observation"}</span></div><div class="chart-wrap">${historySVG(points)}</div><div class="chart-foot"><span class="chart-legend"><span class="legend-line"></span>Recorded ${h(ui.chart.metric)}</span><span>${points.length} ${points.length === 1 ? "observation" : "observations"} in this range</span></div>` : `<div class="chart-empty">${emptyState("No history in this range", "Choose a wider range to see earlier successful observations.", "activity")}</div>`}</section>`;
}

function coveragePanel() {
  const data = metrics();
  const unknown = data.reciprocal_unknown;
  return `<section class="panel coverage-panel"><div class="panel-heading"><h2>What we know</h2><span class="badge neutral">Evidence first</span></div><div class="coverage-body"><p class="coverage-caption">Counts and account-level evidence are different. Orbit keeps that distinction visible.</p><div class="fact-row"><span>Followers observed</span><strong>${h(count(data.followers_observed))}</strong></div><div class="fact-row"><span>Following observed</span><strong>${h(count(data.following_observed))}</strong></div><div class="fact-row"><span>Reciprocity unknown</span><strong>${h(count(unknown))}</strong></div><div class="fact-row"><span>Unattributed balance</span><strong>${h(count(data.unattributed_balance))}</strong></div><div class="coverage-note"><strong>${numeric(unknown) && unknown > 0 ? `${h(count(unknown))} relationships need more evidence.` : "Unknown stays unknown."}</strong> A missing observation is never presented as a confirmed unfollow.</div><button class="button button-quiet coverage-link" type="button" data-go="relationships">Explore relationships ${icon("arrow", 14)}</button></div></section>`;
}

function allEvents() {
  const personal = list(personalData().events).map(event => ({ ...event, scope: "personal", sourceAccount: personalData().username || "Personal graph" }));
  const others = watched().flatMap(source => list(source.events).map(event => ({ ...event, scope: "watchlist", sourceAccount: source.username || "Watchlist source" })));
  return [...personal, ...others].sort((a, b) => (dateValue(b.ts)?.getTime() || 0) - (dateValue(a.ts)?.getTime() || 0));
}

function eventItem(event, showSource = true) {
  const description = describeEvent(event);
  const name = !description.anonymous && event.username ? ` <strong>@${h(event.username)}</strong>` : "";
  const title = event.scope === "watchlist" && event.type === "following_started" ? "Following added" : description.title;
  return `<li class="activity-item"><span class="event-icon ${description.tone}">${icon(description.icon, 14)}</span><div class="event-body"><p class="event-title">${h(title)}${name}</p><p class="event-detail">${h(description.detail)}</p>${showSource ? `<p class="event-source">${event.scope === "personal" ? "Personal graph" : `Watchlist${event.sourceAccount ? ` · @${h(event.sourceAccount)}` : ""}`}</p>` : ""}</div><time class="event-time"${dateValue(event.ts) ? ` datetime="${h(dateValue(event.ts).toISOString())}" title="${h(formatDate(event.ts, true))}"` : ""}>${h(relativeTime(event.ts))}</time></li>`;
}

function recentActivityPanel() {
  const events = allEvents().slice(0, 4);
  return `<section class="panel"><div class="panel-heading"><div><h2>Recent activity</h2><p class="section-subtitle">Changes with a clear source.</p></div><button class="button button-quiet" type="button" data-go="activity">View all ${icon("arrow", 14)}</button></div>${events.length ? `<ul class="activity-list">${events.map(event => eventItem(event)).join("")}</ul>` : emptyState("No recorded activity", "New confirmed changes will appear when your existing trackers record them.", "activity")}</section>`;
}

function watchlistPanel() {
  return `<section class="panel"><div class="panel-heading"><div><h2>On your watchlist</h2><p class="section-subtitle">Other accounts, tracked separately.</p></div><span class="badge neutral">${watched().length} sources</span></div>${watched().length ? `<div class="source-list">${watched().map((source, index) => `<div class="source-row">${avatar(source)}<div class="source-row-copy"><strong>@${h(source.username || "Unknown")}</strong><p>${numeric(source.following_count) ? `${h(count(source.following_count))} following observed` : "Following count unavailable"}</p></div>${badge(source)}<button type="button" class="source-row-action" data-watch="${index}" aria-label="View @${h(source.username || "unknown")}">${icon("chevron", 14)}</button></div>`).join("")}</div><p class="panel-foot">Unavailable lists stay unknown. Removals require confirmation.</p>` : emptyState("No watchlist data", "No local following-watch sources were found.", "watchlist")}</section>`;
}

function overviewView() {
  const personal = personalData();
  return `${pageHeading("Your orbit, in focus.", "A clear view of the relationships around you.", "", "PERSONAL RELATIONSHIP INTELLIGENCE")}<div class="account-context overview-account"><span class="account-handle">${personal.username ? `@${h(personal.username)}` : "Personal graph"}</span><span class="context-divider"></span>${badge(personal)}<span class="muted small">Latest success ${h(relativeTime(personal.last_success_at))}</span></div>${sourceBanner(personal)}${personalStats()}<div class="overview-primary">${historyPanel()}${coveragePanel()}</div><div class="overview-secondary">${recentActivityPanel()}${watchlistPanel()}</div>`;
}

function filteredRelationships() {
  const state = ui.relationships;
  let accounts = list(personalData().accounts).filter(account => `${account.username || ""} ${account.full_name || ""}`.toLowerCase().includes(state.query.toLowerCase().trim()));
  if (state.filter === "following") accounts = accounts.filter(account => account.following === true);
  else if (state.filter === "followers") accounts = accounts.filter(account => account.followed_by === true);
  else if (state.filter !== "all") accounts = accounts.filter(account => account.relationship === state.filter);
  accounts.sort(state.sort === "recent" ? (a, b) => (dateValue(b.updated_at)?.getTime() || 0) - (dateValue(a.updated_at)?.getTime() || 0) : (a, b) => String(a.username || "").localeCompare(String(b.username || "")));
  return accounts;
}

function searchField(id, value, placeholder) {
  return `<div class="search-field">${icon("search", 15)}<label class="sr-only" for="${h(id)}">${h(placeholder)}</label><input id="${h(id)}" type="search" autocomplete="off" spellcheck="false" value="${h(value)}" placeholder="${h(placeholder)}"></div>`;
}

function paginate(items, group) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  ui[group].page = Math.max(1, Math.min(ui[group].page, pages));
  const page = ui[group].page;
  return { rows: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), page, pages, total: items.length };
}

function pagination(result, group, label = "accounts") {
  const start = result.total ? (result.page - 1) * PAGE_SIZE + 1 : 0;
  const end = Math.min(result.page * PAGE_SIZE, result.total);
  return `<div class="pagination"><span>${h(count(start))}–${h(count(end))} of ${h(count(result.total))} ${h(label)}</span><div class="pagination-controls"><span>${result.page} / ${result.pages}</span><button type="button" data-page-group="${h(group)}" data-page="${result.page - 1}" aria-label="Previous page" ${result.page === 1 ? "disabled" : ""}>${icon("previous", 12)}</button><button type="button" data-page-group="${h(group)}" data-page="${result.page + 1}" aria-label="Next page" ${result.page === result.pages ? "disabled" : ""}>${icon("chevron", 12)}</button></div></div>`;
}

function relationshipsView() {
  const accounts = filteredRelationships();
  const result = paginate(accounts, "relationships");
  const filters = [["all", "All accounts"], ["mutual", "Mutuals"], ["following", "Following"], ["followers", "Followers"], ["not_following_back", "Not following back"], ["unknown", "Unconfirmed"]];
  const toolbar = `<div class="table-toolbar">${searchField("relationship-search", ui.relationships.query, "Search accounts or names")}<div class="toolbar-group"><label class="sr-only" for="relationship-sort">Sort relationships</label><select id="relationship-sort"><option value="username" ${ui.relationships.sort === "username" ? "selected" : ""}>Username A–Z</option><option value="recent" ${ui.relationships.sort === "recent" ? "selected" : ""}>Recently observed</option></select><span class="small muted">${h(count(accounts.length))} results</span></div></div><div class="filter-tabs" aria-label="Filter relationships">${filters.map(([key, label]) => `<button type="button" class="filter-tab" data-relationship-filter="${key}" aria-pressed="${ui.relationships.filter === key}">${label}</button>`).join("")}</div>`;
  const body = result.rows.length ? `<div class="table-scroll" tabindex="0" aria-label="Relationship table, scroll for more columns"><table><thead><tr><th scope="col">Account</th><th scope="col">Relationship</th><th scope="col">You follow</th><th scope="col">Follows you</th><th scope="col">Last observed</th><th scope="col"><span class="sr-only">Profile</span></th></tr></thead><tbody>${result.rows.map(account => `<tr><td>${accountCell(account)}</td><td>${relationshipLabel(account.relationship)}</td><td>${truth(account.following)}</td><td>${truth(account.followed_by)}</td><td class="muted">${h(formatDate(account.updated_at))}</td><td>${externalLink(account.username)}</td></tr>`).join("")}</tbody></table></div>` : emptyState("No matching relationships", accounts.length === 0 && (ui.relationships.query || ui.relationships.filter !== "all") ? "Try a different search or choose All accounts." : "This personal source has not recorded any account-level relationships yet.", "relationships");
  return `${pageHeading("Relationships", "Your personal graph, with confirmed and unknown relationships kept distinct.", `<button type="button" class="button button-light" data-export="relationships" ${accounts.length ? "" : "disabled"}>${icon("download", 14)}Export CSV</button>`)}${sourceBanner(personalData())}<section class="panel">${toolbar}${body}${pagination(result, "relationships")}<p class="table-note">“Not following back” requires a confirmed negative observation. Unknown reciprocity remains unconfirmed. Profile links open Instagram in a new tab.</p></section>`;
}

function currentWatch() { return watched()[Math.max(0, Math.min(ui.watchlist.selected, watched().length - 1))] || {}; }

function watchAccountTable(source) {
  if (!numeric(source.following_count) && !list(source.accounts).length) {
    return `<section class="panel"><div class="panel-heading"><h2>Observed following</h2><span class="badge neutral">Roster unavailable</span></div>${emptyState("No observed following list", "The source has no available account-level list. This does not mean it follows zero accounts.", "watchlist")}<p class="table-note">This is another account’s following list. It is separate from your own followers and following.</p></section>`;
  }
  const accounts = list(source.accounts).filter(account => `${account.username || ""} ${account.full_name || ""}`.toLowerCase().includes(ui.watchlist.query.toLowerCase().trim())).sort((a, b) => String(a.username || "").localeCompare(String(b.username || "")));
  const result = paginate(accounts, "watchlist");
  return `<section class="panel"><div class="panel-heading"><h2>Observed following</h2><span class="small muted">${h(count(accounts.length))} accounts</span></div><div class="table-toolbar">${searchField("watch-search", ui.watchlist.query, "Search this following list")}</div>${result.rows.length ? `<div class="table-scroll" tabindex="0" aria-label="Observed following table"><table><thead><tr><th scope="col">Account</th><th scope="col">Evidence</th><th scope="col">Last observed</th><th scope="col"><span class="sr-only">Profile</span></th></tr></thead><tbody>${result.rows.map(account => `<tr><td>${accountCell(account)}</td><td><span class="badge ${account.status === "pending" ? "warning" : "ok"}">${account.status === "pending" ? "Pending confirmation" : "Observed"}</span></td><td class="muted">${h(formatDate(account.updated_at))}</td><td>${externalLink(account.username)}</td></tr>`).join("")}</tbody></table></div>` : emptyState(ui.watchlist.query ? "No matching accounts" : "No observed following list", ui.watchlist.query ? "Try another username or name." : "The source has no available account-level list. This does not mean it follows zero accounts.", "watchlist")}${pagination(result, "watchlist")}<p class="table-note">This is another account’s following list. It is separate from your own followers and following.</p></section>`;
}

function watchlistView() {
  const heading = pageHeading("Watchlist", "Public following lists from other accounts, each with its own evidence and history.");
  if (!watched().length) return `${heading}<section class="panel">${emptyState("No local watchlist sources", "Your existing following trackers will appear here when local artifacts are available.", "watchlist")}</section>`;
  const source = currentWatch();
  const pending = numeric(source.pending_count) ? source.pending_count : list(source.pending_removals).length || null;
  const sourceNav = `<aside aria-label="Watchlist sources"><div class="watch-target-list">${watched().map((target, index) => `<button type="button" class="watch-target" data-watch="${index}" aria-pressed="${ui.watchlist.selected === index}"><span class="watch-target-head">${avatar(target)}<strong>@${h(target.username || "Unknown")}</strong></span><span class="watch-target-meta">${badge(target)}<span>${numeric(target.following_count) ? `${h(count(target.following_count))} following` : "Unavailable"}</span></span></button>`).join("")}</div><p class="watch-explainer">Each source has an independent baseline. New additions and removals only become events after the tracker’s confirmation rules pass.</p></aside>`;
  const summary = `<section class="panel watch-summary"><div class="panel-heading"><div><h2>@${h(source.username || "Unknown")}</h2><p class="section-subtitle">Other account’s following list</p></div>${externalLink(source.username)}</div><div class="watch-summary-body"><div class="watch-metric"><p>Following observed</p><strong>${h(count(source.following_count))}</strong></div><div class="watch-metric"><p>Pending confirmation</p><strong>${h(count(pending))}</strong></div><div class="watch-metric"><p>Latest recorded run</p><strong class="date-value">${h(formatDate(source.last_run_at, true))}</strong></div></div></section>`;
  const events = list(source.events).map(event => ({ ...event, scope: "watchlist", sourceAccount: source.username })).sort((a,b) => (dateValue(b.ts)?.getTime() || 0) - (dateValue(a.ts)?.getTime() || 0)).slice(0, 8);
  return `${heading}<div class="watch-layout">${sourceNav}<div>${sourceBanner(source, false)}${summary}${watchAccountTable(source)}<section class="panel watch-events"><div class="panel-heading"><h2>Source activity</h2><button class="button button-quiet" data-watch-activity="true" type="button">All watchlist activity ${icon("arrow", 14)}</button></div>${events.length ? `<ul class="activity-list">${events.map(event => eventItem(event, false)).join("")}</ul>` : emptyState("No confirmed changes recorded", "Pending observations stay out of this history until they are confirmed.", "activity")}</section></div></div>`;
}

function filteredActivity() {
  const threshold = ui.activity.range === "all" ? 0 : Date.now() - Number(ui.activity.range) * 86400000;
  return allEvents().filter(event => {
    if (ui.activity.source !== "all" && event.scope !== ui.activity.source) return false;
    if ((dateValue(event.ts)?.getTime() || 0) < threshold) return false;
    const description = describeEvent(event);
    const text = `${description.title} ${description.detail} ${description.anonymous ? "" : event.username || ""} ${event.sourceAccount || ""}`;
    return text.toLowerCase().includes(ui.activity.query.toLowerCase().trim());
  });
}

function activityView() {
  const events = filteredActivity();
  const result = paginate(events, "activity");
  let lastDay = "";
  const feed = result.rows.map(event => {
    const day = formatDate(event.ts);
    const heading = day !== lastDay ? `<li class="activity-date">${h(day)}</li>` : "";
    lastDay = day;
    return `${heading}${eventItem(event)}`;
  }).join("");
  return `${pageHeading("Activity", "An evidence-led history of changes across your personal graph and watchlist.", `<button type="button" class="button button-light" data-export="activity" ${events.length ? "" : "disabled"}>${icon("download", 14)}Export CSV</button>`)}<section class="panel"><div class="table-toolbar">${searchField("activity-search", ui.activity.query, "Search activity")}<div class="toolbar-group"><label for="activity-source" class="sr-only">Activity source</label><select id="activity-source">${[["all", "All sources"], ["personal", "Personal graph"], ["watchlist", "Watchlist"]].map(([value, label]) => `<option value="${value}" ${ui.activity.source === value ? "selected" : ""}>${label}</option>`).join("")}</select><label for="activity-range" class="sr-only">Activity time range</label><select id="activity-range">${[["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["all", "All time"]].map(([value, label]) => `<option value="${value}" ${ui.activity.range === value ? "selected" : ""}>${label}</option>`).join("")}</select></div></div>${result.rows.length ? `<ul class="activity-feed">${feed}</ul>` : emptyState("No activity in this view", "Choose a wider date range or adjust your source and search filters.", "activity")}${pagination(result, "activity", "events")}<p class="table-note">Count-only changes remain anonymous. A changed mutual status does not establish who changed the relationship.</p></section>`;
}

function issueMarkup(issues) {
  return list(issues).length ? `<ul class="issue-list">${list(issues).map(issue => `<li class="issue-item">${h(issue.message || "This source needs attention.")}</li>`).join("")}</ul>` : "";
}

function sourceSystemCard(source, personal = false) {
  return `<section class="system-source"><div class="system-source-header"><h3>${personal ? "Personal graph" : `@${h(source.username || "Unknown source")}`}</h3>${badge(source)}</div><dl><div><dt>${personal ? "Latest successful collection" : "Latest recorded run"}</dt><dd>${h(formatDate(personal ? source.last_success_at : source.last_run_at, true))}</dd></div><div><dt>${personal ? "Latest attempt" : "Latest visibility check"}</dt><dd>${h(formatDate(personal ? source.last_attempt_at : source.last_visibility_at, true))}</dd></div></dl>${personal && typeof source.coverage === "string" && source.coverage ? `<p class="system-guidance"><strong>Source coverage:</strong> ${h(source.coverage)}</p>` : ""}${issueMarkup(source.issues)}</section>`;
}

function scheduleStatus(schedule) {
  if (schedule.enabled === false) return '<span class="badge neutral">Paused</span>';
  const status = String(schedule.last_status || "").toLowerCase();
  if (["ok", "success", "completed", "complete"].includes(status)) return '<span class="badge ok">Last run succeeded</span>';
  if (["error", "failed", "failure"].includes(status)) return '<span class="badge danger">Last run failed</span>';
  if (status === "running") return '<span class="badge info">Running</span>';
  return '<span class="badge neutral">No confirmed outcome</span>';
}

function systemView() {
  const schedules = list(ui.data?.schedules);
  const sourceHealth = [personalData(), ...watched()];
  const needsAttention = sourceHealth.filter(source => statusInfo(source).tone !== "ok").length;
  const notice = needsAttention ? `<div class="status-banner">${icon("alert", 18)}<div class="status-banner-copy"><strong>${needsAttention} ${needsAttention === 1 ? "source needs" : "sources need"} attention</strong><p>A successful app refresh only means local artifacts were read. Collection health is shown per source below.</p></div></div>` : "";
  const scheduleTable = schedules.length ? `<div class="table-scroll" tabindex="0" aria-label="Existing schedules"><table><thead><tr><th scope="col">Tracker</th><th scope="col">Schedule</th><th scope="col">Last outcome</th><th scope="col">Last run</th><th scope="col">Next run</th><th scope="col">Recovery guidance</th></tr></thead><tbody>${schedules.map(schedule => `<tr><td class="schedule-name"><strong>${h(schedule.name || "Existing tracker")}</strong>${schedule.script ? `<small>${h(schedule.script)}</small>` : ""}</td><td><code class="schedule-code">${h(schedule.schedule || "Not recorded")}</code></td><td>${scheduleStatus(schedule)}</td><td class="muted">${h(formatDate(schedule.last_run_at, true))}</td><td class="muted">${schedule.enabled === false ? "Paused" : h(formatDate(schedule.next_run_at, true))}</td><td class="schedule-recovery">${h(schedule.recovery || (schedule.error_kind ? "Review the existing tracker configuration before collecting again." : "No recovery guidance recorded."))}</td></tr>`).join("")}</tbody></table></div>` : emptyState("No schedule records found", "Orbit does not create a new schedule. Existing tracker jobs appear here when their local configuration is available.", "clock");
  return `${pageHeading("System", "Collection health, data coverage, and the local systems behind your workspace.")}${notice}<div class="system-grid"><section class="panel"><div class="panel-heading"><h2>Source health</h2><span class="badge neutral">${sourceHealth.length} sources</span></div><div class="system-body">${sourceSystemCard(personalData(), true)}${watched().map(source => sourceSystemCard(source)).join("")}</div></section><section class="panel"><div class="panel-heading"><h2>Private by default</h2>${icon("shield", 18)}</div><div class="system-body"><div class="fact-row"><span>Storage</span><strong>This device only</strong></div><div class="fact-row"><span>Account access</span><strong>Read-only</strong></div><div class="fact-row"><span>Cloud sync</span><strong>None</strong></div><div class="fact-row"><span>Latest local refresh</span><strong>${h(formatDate(ui.data?.generated_at, true))}</strong></div><p class="system-guidance"><strong>Refresh data</strong> rereads local artifacts. It does not sign in, contact Instagram, run collection, or change existing schedules.</p><p class="system-guidance"><strong>When a source fails:</strong> keep the existing observations, review the tracker’s recovery guidance, and resolve its underlying collection problem before retrying. A hidden list never becomes zero.</p>${issueMarkup(ui.data?.issues)}</div></section></div><section class="panel"><div class="panel-heading"><div><h2>Existing schedules</h2><p class="section-subtitle">Status from your tracker jobs. Orbit does not modify them.</p></div></div><div class="schedule-table">${scheduleTable}</div><p class="table-note">Times are displayed in this browser’s local timezone. Schedule expressions are shown exactly as recorded by the source.</p></section>`;
}

function render() {
  if (typeof document === "undefined") return;
  const main = document.getElementById("main-content");
  const focused = document.activeElement;
  const activeId = focused?.id;
  const selection = focused instanceof HTMLInputElement ? focused.selectionStart : null;
  main.setAttribute("aria-busy", String(ui.loading));
  if (!ui.data) {
    if (ui.error) main.innerHTML = `<div class="loading-state"><h1 id="page-title">Your workspace is unavailable</h1><p>${h(ui.error)}</p><button class="button button-primary" type="button" data-retry="true">Try again</button></div>`;
    return;
  }
  const views = { overview: overviewView, relationships: relationshipsView, watchlist: watchlistView, activity: activityView, system: systemView };
  main.innerHTML = views[ui.view]();
  document.title = `${VIEW_NAMES[ui.view]} | Orbit OS`;
  document.getElementById("current-view").textContent = VIEW_NAMES[ui.view];
  document.querySelectorAll("[data-view]").forEach(link => {
    if (link.dataset.view === ui.view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.getElementById("relationship-nav-count").textContent = count(list(personalData().accounts).length);
  document.getElementById("watchlist-nav-count").textContent = String(watched().length);
  document.getElementById("system-dot").hidden = ![personalData(), ...watched()].some(source => statusInfo(source).tone !== "ok");
  document.getElementById("footer-updated").textContent = `Local data read ${formatDate(ui.data.generated_at, true)}`;
  document.getElementById("sidebar-profile").innerHTML = `${avatar(personalData())}<span>${h(personalData().username ? `@${personalData().username}` : "Personal workspace")}<small>Personal account</small></span>`;
  if (activeId) {
    const restored = document.getElementById(activeId);
    if (restored) {
      restored.focus({ preventScroll: true });
      if (selection !== null && restored instanceof HTMLInputElement) restored.setSelectionRange(selection, selection);
    }
  }
}

function announce(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => { toast.hidden = true; }, 4500);
}

async function loadState() {
  if (ui.loading) return;
  ui.loading = true;
  const button = document.getElementById("refresh-data");
  button.disabled = true;
  button.querySelector(".refresh-label").textContent = "Reading data…";
  document.getElementById("main-content").setAttribute("aria-busy", "true");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const hadData = Boolean(ui.data);
  try {
    const response = await fetch("/api/state", { cache: "no-store", credentials: "omit", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("The local server could not read your workspace. Check that Orbit OS is still running, then try again.");
    const data = await response.json();
    if (!data || data.schema_version !== 1 || typeof data !== "object") throw new Error("The local data format is not supported by this version of Orbit OS.");
    ui.data = data;
    ui.error = "";
    document.getElementById("app-notice").hidden = true;
    if (hadData) announce("Local data refreshed. No collection was started.");
  } catch (error) {
    ui.error = error.name === "AbortError" ? "The local server took too long to respond. Check that Orbit OS is running, then try again." : error.message === "Failed to fetch" ? "The local server is unavailable. Start Orbit OS again and refresh this page." : error.message || "The local workspace could not be read.";
    if (ui.data) {
      const notice = document.getElementById("app-notice");
      notice.textContent = `Refresh failed. Showing the previously loaded data. ${ui.error}`;
      notice.hidden = false;
    }
  } finally {
    clearTimeout(timer);
    ui.loading = false;
    button.disabled = false;
    button.querySelector(".refresh-label").textContent = "Refresh data";
    render();
  }
}

function navigate(view, focus = true) {
  if (!Object.hasOwn(VIEW_NAMES, view)) return;
  ui.view = view;
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  render();
  if (focus) document.getElementById("page-title")?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function exportCSV(kind) {
  let rows;
  if (kind === "relationships") {
    rows = [["username", "full_name", "relationship", "you_follow", "follows_you", "last_observed"], ...filteredRelationships().map(account => [account.username, account.full_name, account.relationship, typeof account.following === "boolean" ? account.following : "unknown", typeof account.followed_by === "boolean" ? account.followed_by : "unknown", account.updated_at])];
  } else {
    rows = [["time", "source", "source_account", "event", "username", "detail", "delta"], ...filteredActivity().map(event => {
      const description = describeEvent(event);
      return [event.ts, event.scope, event.sourceAccount, description.title, description.anonymous ? "" : event.username, description.detail, event.delta];
    })];
  }
  if (rows.length < 2) return;
  const content = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `orbit-os-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce(`Exported ${count(rows.length - 1)} filtered ${kind === "relationships" ? "relationships" : "events"}.`);
}

function handleClick(event) {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.dataset.view || target.dataset.go) {
    event.preventDefault();
    navigate(target.dataset.view || target.dataset.go);
  } else if (target.dataset.watch !== undefined) {
    ui.watchlist.selected = Number(target.dataset.watch);
    ui.watchlist.query = "";
    ui.watchlist.page = 1;
    navigate("watchlist");
  } else if (target.dataset.chartRange) {
    ui.chart.range = target.dataset.chartRange;
    render();
  } else if (target.dataset.chartMetric) {
    ui.chart.metric = target.dataset.chartMetric;
    render();
  } else if (target.dataset.relationshipFilter) {
    ui.relationships.filter = target.dataset.relationshipFilter;
    ui.relationships.page = 1;
    render();
  } else if (target.dataset.pageGroup && Object.hasOwn(ui, target.dataset.pageGroup)) {
    ui[target.dataset.pageGroup].page = Number(target.dataset.page);
    render();
  } else if (target.dataset.watchActivity) {
    ui.activity.source = "watchlist";
    ui.activity.page = 1;
    navigate("activity");
  } else if (target.dataset.export) exportCSV(target.dataset.export);
  else if (target.dataset.retry || target.id === "refresh-data") loadState();
}

function handleInput(event) {
  const queryGroups = { "relationship-search": "relationships", "watch-search": "watchlist", "activity-search": "activity" };
  const group = queryGroups[event.target.id];
  if (!group) return;
  ui[group].query = event.target.value;
  ui[group].page = 1;
  render();
}

function handleChange(event) {
  if (event.target.id === "relationship-sort") ui.relationships.sort = event.target.value;
  else if (event.target.id === "activity-source") ui.activity.source = event.target.value;
  else if (event.target.id === "activity-range") ui.activity.range = event.target.value;
  else return;
  ui.relationships.page = 1;
  ui.activity.page = 1;
  render();
}

function initialize() {
  document.querySelectorAll("[data-icon]").forEach(element => { element.innerHTML = icon(element.dataset.icon, 17); });
  const view = location.hash.slice(1);
  if (Object.hasOwn(VIEW_NAMES, view)) ui.view = view;
  document.addEventListener("click", handleClick);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleChange);
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (ui.data && ui.view === "overview") render(); }, 120);
  });
  loadState();
}

if (typeof module !== "undefined" && module.exports) module.exports = { h, profileURL, csvCell, describeEvent, statusInfo, dateValue, historySVG, sourceBanner, watchAccountTable };
if (typeof document !== "undefined") initialize();
