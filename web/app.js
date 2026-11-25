const PALETTE = ["#10b981", "#06b6d4", "#f59e0b", "#a855f7", "#ec4899", "#3b82f6"];

const state = {
  instances: new Map(), // instanceId -> { meta, hits, color, lastSeen }
  totalHits: 0,
  recentPills: [],
  stressLoopActive: false,
  stressEndAt: 0,
  stressTimerId: null,
  pollTimerId: null,
};

const el = {
  kpiInstances: document.getElementById("kpiInstances"),
  currentBadge: document.getElementById("currentInstanceBadge"),
  stressBadge: document.getElementById("stressStateBadge"),
  stressBanner: document.getElementById("stressBanner"),
  stressDuration: document.getElementById("stressDuration"),
  btnStartStress: document.getElementById("btnStartStress"),
  btnStopStress: document.getElementById("btnStopStress"),
  burstCount: document.getElementById("burstCount"),
  btnRunLoadTest: document.getElementById("btnRunLoadTest"),
  btnResetStats: document.getElementById("btnResetStats"),
  toggleAutoPoll: document.getElementById("toggleAutoPoll"),
  stackedBar: document.getElementById("stackedBar"),
  totalHitsLabel: document.getElementById("totalHitsLabel"),
  fleetGrid: document.getElementById("fleetGrid"),
  requestPills: document.getElementById("requestPills"),
};

function getColorForInstance(instanceId) {
  if (state.instances.has(instanceId)) {
    return state.instances.get(instanceId).color;
  }
  const color = PALETTE[state.instances.size % PALETTE.length];
  return color;
}

function recordResponse(data, latencyMs, countHit = true) {
  const id = data.instanceId || "unknown";
  const color = getColorForInstance(id);
  const existing = state.instances.get(id) || {
    hits: 0,
    color,
    meta: data,
    lastSeen: Date.now(),
  };

  existing.meta = data;
  existing.lastSeen = Date.now();
  if (countHit) {
    existing.hits += 1;
    state.totalHits += 1;
    state.recentPills.unshift({
      num: state.totalHits,
      id,
      shortId: id.slice(-7),
      az: data.availabilityZone,
      cpu: data.cpuPercent,
      latencyMs,
      color,
    });
    if (state.recentPills.length > 60) state.recentPills.pop();
  }
  state.instances.set(id, existing);

  el.currentBadge.innerHTML = `<span class="dot"></span><span>Última respuesta: ${id} (${data.availabilityZone})</span>`;
  render();
}

async function fetchInfo(countHit = false) {
  const t0 = performance.now();
  const res = await fetch(`/api/info?_=${Date.now()}-${Math.random()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const latency = Math.round(performance.now() - t0);
  recordResponse(data, latency, countHit);
  return data;
}

async function runLoadBalancingBurst() {
  const count = parseInt(el.burstCount.value, 10) || 40;
  el.btnRunLoadTest.disabled = true;
  el.btnRunLoadTest.textContent = `⏳ Enviando ${count} peticiones...`;

  try {
    // Enviar en lotes concurrentes de 5 para demostrar Round-Robin en vivo
    const batchSize = 5;
    for (let i = 0; i < count; i += batchSize) {
      const batch = [];
      for (let j = 0; j < batchSize && i + j < count; j++) {
        batch.push(fetchInfo(true).catch(() => null));
      }
      await Promise.all(batch);
    }
  } finally {
    el.btnRunLoadTest.disabled = false;
    el.btnRunLoadTest.textContent = "⚡ Ejecutar Prueba de Balanceo";
  }
}

async function dispatchStressPulse() {
  const remaining = Math.max(30, Math.ceil((state.stressEndAt - Date.now()) / 1000));
  const payload = JSON.stringify({ duration: remaining, workers: 0 });
  // Enviar varias peticiones rápidas al ALB para alcanzar todas las instancias activas
  const fanout = Math.max(4, state.instances.size * 2);
  await Promise.all(
    Array.from({ length: fanout }, () =>
      fetch(`/api/stress?_=${Date.now()}-${Math.random()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) recordResponse(d, 0, false);
        })
        .catch(() => null)
    )
  );
}

async function startStressTest() {
  const durationSec = parseInt(el.stressDuration.value, 10) || 360;
  state.stressLoopActive = true;
  state.stressEndAt = Date.now() + durationSec * 1000;

  el.btnStartStress.disabled = true;
  el.btnStopStress.disabled = false;
  el.stressBadge.textContent = "🔥 Estrés Activo";
  el.stressBadge.classList.add("active");

  await dispatchStressPulse();
  updateStressBanner();

  if (state.stressTimerId) clearInterval(state.stressTimerId);
  state.stressTimerId = setInterval(async () => {
    if (!state.stressLoopActive || Date.now() >= state.stressEndAt) {
      stopStressUIOnly();
      return;
    }
    await dispatchStressPulse();
    updateStressBanner();
  }, 12000);
}

function stopStressUIOnly() {
  state.stressLoopActive = false;
  if (state.stressTimerId) {
    clearInterval(state.stressTimerId);
    state.stressTimerId = null;
  }
  el.btnStartStress.disabled = false;
  el.btnStopStress.disabled = true;
  el.stressBadge.textContent = "Inactivo";
  el.stressBadge.classList.remove("active");
  el.stressBanner.innerHTML =
    "Prueba de estrés finalizada. Si las instancias bajaron su CPU &le; 20%, CloudWatch activará la alarma <strong>Scale-In</strong> tras 2 períodos de 5 min para volver a <strong>1 instancia</strong>.";
}

async function stopStressTest() {
  stopStressUIOnly();
  const fanout = Math.max(8, state.instances.size * 3);
  await Promise.all(
    Array.from({ length: fanout }, () =>
      fetch(`/api/stress/stop?_=${Date.now()}-${Math.random()}`, {
        method: "POST",
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) recordResponse(d, 0, false);
        })
        .catch(() => null)
    )
  );
}

function updateStressBanner() {
  const sec = Math.max(0, Math.ceil((state.stressEndAt - Date.now()) / 1000));
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  el.stressBanner.innerHTML = `🔥 <strong>Prueba de estrés en curso (${min}m ${rem}s restantes):</strong> El navegador envía pulsos continuos vía ALB para saturar las instancias actuales y cualquier nueva instancia que se sume hasta el límite de <strong>4 instancias</strong>.`;
}

function cpuColor(cpu) {
  if (cpu >= 75) return "#ef4444";
  if (cpu >= 50) return "#f59e0b";
  return "#10b981";
}

function render() {
  // Limpiar instancias no vistas en los últimos 90s (terminadas por scale-in)
  const cutoff = Date.now() - 90000;
  for (const [id, info] of state.instances.entries()) {
    if (info.lastSeen < cutoff && state.instances.size > 1) {
      state.instances.delete(id);
    }
  }

  el.kpiInstances.textContent = String(state.instances.size);
  el.totalHitsLabel.textContent = `${state.totalHits} peticiones registradas`;

  // Stacked Bar
  if (state.totalHits === 0) {
    el.stackedBar.innerHTML = `<div class="stacked-empty">Ejecuta una prueba de balanceo para ver la distribución (%)</div>`;
  } else {
    el.stackedBar.innerHTML = Array.from(state.instances.entries())
      .map(([id, info]) => {
        const pct = ((info.hits / state.totalHits) * 100).toFixed(1);
        if (info.hits === 0) return "";
        return `<div class="stacked-segment" style="width:${pct}%;background:${info.color}" title="${id}: ${info.hits} (${pct}%)">${id.slice(-6)} · ${pct}%</div>`;
      })
      .join("");
  }

  // Fleet Grid
  el.fleetGrid.innerHTML = Array.from(state.instances.entries())
    .map(([id, info]) => {
      const m = info.meta;
      const pct = state.totalHits > 0 ? ((info.hits / state.totalHits) * 100).toFixed(1) : "0.0";
      const statusBadge = m.stressActive
        ? `<span class="tag-az" style="color:#fca5a5;background:rgba(239,68,68,0.2)">🔥 STRESS (${m.stressRemainingSec}s)</span>`
        : `<span class="tag-az" style="color:#6ee7b7;background:rgba(16,185,129,0.15)">✅ NORMAL</span>`;
      return `
        <div class="instance-card" style="border-top-color:${info.color}">
          <div class="instance-top">
            <span class="instance-id" style="color:${info.color}">${id}</span>
            ${statusBadge}
          </div>
          <div class="meta-line">
            <span>AZ: <strong>${m.availabilityZone}</strong></span>
            <span>IP: <strong>${m.privateIp}</strong></span>
          </div>
          <div>
            <div class="meta-line" style="margin-bottom:4px">
              <span>CPU (${m.cpuCores} vCPU · ${m.instanceType})</span>
              <strong>${m.cpuPercent}%</strong>
            </div>
            <div class="cpu-track">
              <div class="cpu-fill" style="width:${m.cpuPercent}%;background:${cpuColor(m.cpuPercent)}"></div>
            </div>
          </div>
          <div class="meta-line">
            <span>Peticiones atendidas:</span>
            <strong>${info.hits} (${pct}%)</strong>
          </div>
        </div>
      `;
    })
    .join("");

  // Pills
  el.requestPills.innerHTML = state.recentPills
    .map(
      (p) =>
        `<span class="req-pill" style="background:${p.color}" title="Instancia ${p.id} | AZ: ${p.az} | CPU: ${p.cpu}%">#${p.num} → ${p.shortId} (${p.latencyMs}ms)</span>`
    )
    .join("");
}

function startPolling() {
  if (state.pollTimerId) clearInterval(state.pollTimerId);
  state.pollTimerId = setInterval(() => {
    if (el.toggleAutoPoll.checked) {
      fetchInfo(false).catch(() => null);
    }
  }, 2000);
}

el.btnRunLoadTest.addEventListener("click", runLoadBalancingBurst);
el.btnStartStress.addEventListener("click", startStressTest);
el.btnStopStress.addEventListener("click", stopStressTest);
el.btnResetStats.addEventListener("click", () => {
  state.totalHits = 0;
  state.recentPills = [];
  for (const info of state.instances.values()) info.hits = 0;
  render();
});

fetchInfo(true).catch(() => null);
startPolling();
