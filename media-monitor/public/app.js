const KNOWN_SOURCES = [
  { slug: "the-star", label: "The Star" },
  { slug: "new-straits-times", label: "New Straits Times" },
  { slug: "malaysiakini", label: "Malaysiakini" },
  { slug: "twitter", label: "Twitter" },
  { slug: "facebook", label: "Facebook" },
  { slug: "instagram", label: "Instagram" },
];

function populateSourceOptions() {
  const select = document.getElementById("source");
  for (const { slug, label } of KNOWN_SOURCES) {
    const option = document.createElement("option");
    option.value = slug;
    option.textContent = label;
    select.appendChild(option);
  }
}

function currentQuery() {
  const q = document.getElementById("q").value.trim();
  const source = document.getElementById("source").value;
  const from = document.getElementById("from").value;
  const to = document.getElementById("to").value;

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (source) params.set("source", source);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return params;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showStatus(message, isError = false) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.classList.remove("info", "error");
  if (message) status.classList.add(isError ? "error" : "info");
}

function renderBars(container, buckets) {
  if (!buckets || buckets.length === 0) {
    container.innerHTML = '<p class="empty-state">No data.</p>';
    return;
  }

  const max = Math.max(...buckets.map((b) => b.count));

  container.innerHTML = buckets
    .map((b) => {
      const label = escapeHtml(b.label ?? b.key ?? "unknown");
      const widthPct = max > 0 ? Math.round((b.count / max) * 100) : 0;
      return `
        <div class="bar-row">
          <span class="bar-label" title="${label}">${label}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${widthPct}%"></span></span>
          <span class="bar-count">${b.count}</span>
        </div>
      `;
    })
    .join("");
}

function renderList(items) {
  const container = document.getElementById("list");

  if (!items || items.length === 0) {
    container.innerHTML = '<p class="empty-state">No mentions match these filters.</p>';
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const title = escapeHtml(item.title ?? "(untitled)");
      const titleHtml = item.url
        ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${title}</a>`
        : title;

      const snippetSource = item.content ?? "";
      const snippet = escapeHtml(
        snippetSource.length > 220 ? `${snippetSource.slice(0, 220)}...` : snippetSource,
      );

      const date = item.published_at
        ? new Date(item.published_at).toISOString().slice(0, 10)
        : "unknown date";

      return `
        <article class="mention-card">
          <h3>${titleHtml}</h3>
          <div class="mention-meta">
            <span class="badge">${escapeHtml(item.source_display ?? item.source)}</span>
            <span class="meta-date">${date}</span>
            <span class="meta-engagement">${item.engagement} eng.</span>
          </div>
          <p class="mention-snippet">${snippet}</p>
        </article>
      `;
    })
    .join("");
}

async function load() {
  showStatus("Loading...");
  try {
    const params = currentQuery();
    const [list, bySource, byDay] = await Promise.all([
      fetch(`/mentions?${params}&limit=50`).then((r) => {
        if (!r.ok) throw new Error(`mentions: ${r.status}`);
        return r.json();
      }),
      fetch(`/mentions/stats?${params}&group_by=source`).then((r) => {
        if (!r.ok) throw new Error(`stats/source: ${r.status}`);
        return r.json();
      }),
      fetch(`/mentions/stats?${params}&group_by=day`).then((r) => {
        if (!r.ok) throw new Error(`stats/day: ${r.status}`);
        return r.json();
      }),
    ]);

    renderBars(document.getElementById("by-source"), bySource.buckets);
    renderBars(document.getElementById("by-day"), byDay.buckets);
    renderList(list.data);
    showStatus("");
  } catch (err) {
    console.error(err);
    showStatus("Failed to load mentions. Is the server running?", true);
  }
}

function resetFilters() {
  document.getElementById("q").value = "";
  document.getElementById("source").value = "";
  document.getElementById("from").value = "";
  document.getElementById("to").value = "";
  load();
}

populateSourceOptions();
document.getElementById("apply").addEventListener("click", load);
document.getElementById("reset").addEventListener("click", resetFilters);
document.getElementById("q").addEventListener("keydown", (event) => {
  if (event.key === "Enter") load();
});

load();
