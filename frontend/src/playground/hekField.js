/** Widefield HEK293 GFP field: flat adherent cells, not lattice pixels
 * and not spherical beads. */

export const FIELD_CELLS = 500;
export const FIELD_NX = 25;
export const FIELD_NY = 20;
export const FIELD_W = 960;
export const FIELD_H = 620;

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function hekOutline(cell, k, n) {
  const a = (k / n) * Math.PI * 2;
  const wobble =
    1 +
    cell.a1 * Math.cos(2 * a + cell.p1) +
    cell.a2 * Math.cos(3 * a + cell.p2) +
    cell.a3 * Math.cos(4 * a + cell.p3) +
    cell.a4 * Math.cos(6 * a + cell.p4);
  const ca = Math.cos(a + cell.rot);
  const sa = Math.sin(a + cell.rot);
  return {
    x: cell.x + ca * cell.rx * wobble,
    y: cell.y + sa * cell.ry * wobble,
  };
}

function traceCell(ctx, cell, n = 28) {
  ctx.beginPath();
  for (let k = 0; k < n; k += 1) {
    const p = hekOutline(cell, k, n);
    if (k === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

/**
 * @param {{ seed?: number, transfectedFraction: number }} opts
 */
export function buildMonolayer({ seed = 1, transfectedFraction }) {
  const rand = rng(seed);
  const pitchX = FIELD_W / FIELD_NX;
  const pitchY = FIELD_H / FIELD_NY;
  const cells = [];
  let nGfp = 0;

  for (let j = 0; j < FIELD_NY; j += 1) {
    for (let i = 0; i < FIELD_NX; i += 1) {
      const hex = j % 2 ? 0.38 : 0;
      const x = (i + 0.48 + hex + (rand() - 0.5) * 0.42) * pitchX;
      const y = (j + 0.5 + (rand() - 0.5) * 0.36) * pitchY;
      const stretch = 0.88 + rand() * 0.45;
      const fat = 0.72 + rand() * 0.38;
      const transfected = rand() < transfectedFraction;
      if (transfected) nGfp += 1;
      cells.push({
        x,
        y,
        rx: pitchX * 0.4 * stretch,
        ry: pitchY * 0.36 * fat,
        rot: (rand() - 0.5) * 1.1,
        a1: 0.12 + rand() * 0.14,
        a2: 0.1 + rand() * 0.14,
        a3: 0.06 + rand() * 0.1,
        a4: 0.03 + rand() * 0.06,
        p1: rand() * Math.PI * 2,
        p2: rand() * Math.PI * 2,
        p3: rand() * Math.PI * 2,
        p4: rand() * Math.PI * 2,
        transfected,
        expr: transfected ? Math.min(1.3, 0.4 + rand() ** 1.35 * 0.95) : 0,
        nx: (rand() - 0.5) * 7,
        ny: (rand() - 0.5) * 5.5,
        nr: 0.26 + rand() * 0.07,
      });
    }
  }

  return { width: FIELD_W, height: FIELD_H, nCells: FIELD_CELLS, nGfp, cells };
}

function noise(ctx, width, height, rand) {
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 8;
    d[i] = Math.max(0, d[i] + n);
    d[i + 1] = Math.max(0, d[i + 1] + n);
    d[i + 2] = Math.max(0, d[i + 2] + n * 0.7);
  }
  ctx.putImageData(img, 0, 0);
}

export function paintField(ctx, field, { intensity = 1 }) {
  const { width, height, cells } = field;
  const g = Math.max(0, Math.min(1, intensity));
  const rand = rng(3);

  ctx.fillStyle = "#06080c";
  ctx.fillRect(0, 0, width, height);

  for (const cell of cells) {
    if (cell.transfected) continue;
    traceCell(ctx, cell);
    ctx.fillStyle = "rgba(52, 62, 76, 0.2)";
    ctx.fill();
    ctx.strokeStyle = "rgba(110, 124, 142, 0.32)";
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cell.x + cell.nx, cell.y + cell.ny, cell.rx * cell.nr, cell.ry * cell.nr * 1.12, cell.rot * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(24, 30, 40, 0.4)";
    ctx.fill();
  }

  const layer = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const gctx = layer.getContext("2d");

  for (const cell of cells) {
    if (!cell.transfected) continue;
    const amp = g * cell.expr;
    const glow = 0.22 + 0.78 * amp;
    traceCell(gctx, cell);
    const fill = gctx.createRadialGradient(
      cell.x + cell.nx * 0.15,
      cell.y + cell.ny * 0.15,
      Math.min(cell.rx, cell.ry) * 0.2,
      cell.x,
      cell.y,
      Math.max(cell.rx, cell.ry) * 1.05,
    );
    fill.addColorStop(0, `rgba(55, ${190 + 40 * glow}, 85, ${0.88 * glow})`);
    fill.addColorStop(0.55, `rgba(32, ${150 + 45 * glow}, 62, ${0.72 * glow})`);
    fill.addColorStop(0.88, `rgba(18, ${95 + 35 * glow}, 40, ${0.38 * glow})`);
    fill.addColorStop(1, "rgba(6, 28, 12, 0)");
    gctx.fillStyle = fill;
    gctx.fill();
    gctx.strokeStyle = `rgba(30, ${90 + 40 * glow}, 45, ${0.35 * glow})`;
    gctx.lineWidth = 0.8;
    gctx.stroke();

    const nx = cell.x + cell.nx;
    const ny = cell.y + cell.ny;
    const nrx = cell.rx * cell.nr;
    const nry = cell.ry * cell.nr * 1.15;
    gctx.beginPath();
    gctx.ellipse(nx, ny, nrx, nry, cell.rot * 0.25, 0, Math.PI * 2);
    gctx.fillStyle = `rgba(90, ${210 + 30 * glow}, 120, ${0.55 * glow})`;
    gctx.fill();
    gctx.beginPath();
    gctx.ellipse(nx - nrx * 0.2, ny - nry * 0.15, nrx * 0.18, nry * 0.16, 0, 0, Math.PI * 2);
    gctx.fillStyle = `rgba(10, 42, 18, ${0.28 * glow})`;
    gctx.fill();
  }

  ctx.save();
  ctx.filter = "blur(0.45px)";
  ctx.drawImage(layer, 0, 0);
  ctx.restore();

  ctx.strokeStyle = "rgba(220, 228, 236, 0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width - 132, height - 22);
  ctx.lineTo(width - 32, height - 22);
  ctx.stroke();
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(220, 228, 236, 0.72)";
  ctx.fillText("50 µm", width - 108, height - 28);

  noise(ctx, width, height, rand);
}
