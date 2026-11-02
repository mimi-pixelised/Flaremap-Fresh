// Recent in-page history of the simulated sensor readings.
// This is not real sensor telemetry and it is intentionally not persisted.
(() => {
  const sources = [
    { id: "temperature", name: "Temperature · DHT22", unit: "°C", min: 27, max: 30, color: "#8368b1", decimals: 1 },
    { id: "humidity", name: "Humidity · DHT22", unit: "%", min: 60, max: 70, color: "#3b83aa", decimals: 0 },
    { id: "gas", name: "Gas · MQ-5 (raw)", unit: "", min: 160, max: 205, color: "#199b9d", decimals: 0 },
    { id: "co", name: "CO · MQ-7 (raw)", unit: "", min: 95, max: 130, color: "#db8442", decimals: 0 }
  ];
  const spanMs = 5 * 60 * 1000;
  const histories = Object.fromEntries(sources.map(source => [source.id, []]));
  const section = document.createElement("section");
  section.className = "panel charts-panel";
  section.setAttribute("aria-label", "Sensor reading graphs");
  section.innerHTML = `
    <h2>Reading trends</h2>
    <p>Simulated values from the last five minutes while this page is open. No live sensors are connected.</p>
    <div class="chart-grid">
      ${sources.map(source => `
        <div class="chart-card">
          <h3>${source.name}</h3>
          <canvas id="chart-${source.id}" role="img"
            aria-label="Recent ${source.name} readings over time"></canvas>
        </div>
      `).join("")}
    </div>
  `;
  document.querySelector(".cards").insertAdjacentElement("afterend", section);

  function draw(source, now) {
    const canvas = document.getElementById("chart-" + source.id);
    const width = Math.max(1, Math.round(canvas.getBoundingClientRect().width));
    const height = 160;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(width * dpr) ||
        canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const left = 46, right = width - 12, top = 12, bottom = height - 27;
    const plotWidth = Math.max(1, right - left);
    const plotHeight = bottom - top;
    ctx.font = "11px Arial, sans-serif";
    ctx.lineWidth = 1;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 3; i++) {
      const y = top + plotHeight * i / 3;
      ctx.strokeStyle = "#e8ebef";
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = "#687078";
      const value = source.max - (source.max - source.min) * i / 3;
      ctx.fillText(value.toFixed(source.decimals), left - 7, y);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#687078";
    ctx.fillText("5 min ago", left, height - 7);
    ctx.textAlign = "right";
    ctx.fillText("Now", right, height - 7);

    const points = histories[source.id].filter(point => now - point.time <= spanMs);
    if (!points.length) return;

    const coordinate = point => ({
      x: left + Math.max(0, (point.time - (now - spanMs)) / spanMs) * plotWidth,
      y: top + (source.max - Math.max(source.min, Math.min(source.max, point.value))) /
        (source.max - source.min) * plotHeight
    });

    ctx.beginPath();
    for (const [index, point] of points.entries()) {
      const { x, y } = coordinate(point);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = source.color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    const last = coordinate(points[points.length - 1]);
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3.5, 0, 2 * Math.PI);
    ctx.fillStyle = source.color;
    ctx.fill();
  }

  function redraw() {
    const now = Date.now();
    for (const source of sources) draw(source, now);
  }

  function sample() {
    const now = Date.now();
    for (const source of sources) {
      const value = Number(document.getElementById(source.id)?.textContent);
      if (!Number.isFinite(value)) continue;
      const history = histories[source.id];
      history.push({ time: now, value });
      while (history.length && now - history[0].time > spanMs) history.shift();
    }
    redraw();
  }

  sample();
  setInterval(sample, 5000);
  window.addEventListener("resize", redraw);
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(redraw);
    observer.observe(section);
  }
})();
