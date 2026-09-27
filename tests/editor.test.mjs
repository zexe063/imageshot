import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const url = process.env.IMAGESHOT_TEST_URL || 'http://127.0.0.1:5173';
let browser;
let server;

before(async () => {
  try {
    await fetch(url);
  } catch {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { stdio: 'ignore', windowsHide: true });
    const deadline = Date.now() + 20000;
    while (true) {
      try { await fetch(url); break; } catch {
        if (Date.now() > deadline) throw new Error('The ImageShot test server did not start.');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
});

after(async () => {
  await browser?.close();
  server?.kill();
});

/** The dropdowns are custom, so an option is chosen the way a person chooses it. */
async function pick(page, label, option) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** What a dropdown currently shows. */
async function shown(page, label) {
  return (await page.getByLabel(label, { exact: true }).textContent()).trim();
}

async function editor() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(url);
  await page.locator('[data-testid="editor-artboard"] canvas').waitFor();
  return page;
}

async function imagePoint(page, x, y) {
  const stage = page.locator('[data-testid="editor-artboard"]');
  const box = await stage.boundingBox();
  const viewBox = (await stage.locator('svg').getAttribute('viewBox')).split(' ').map(Number);
  const transform = await stage.locator('svg > g').getAttribute('transform');
  const [offsetX, offsetY] = transform.match(/[\d.]+/g).map(Number);
  return { x: box.x + (offsetX + x) * box.width / viewBox[2], y: box.y + (offsetY + y) * box.height / viewBox[3] };
}

async function drag(page, from, to) {
  const start = await imagePoint(page, ...from);
  const end = await imagePoint(page, ...to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function selection(page) {
  return page.locator('[data-testid="editor-artboard"] svg > g > rect').first().evaluate(element => ({ x: +element.getAttribute('x'), y: +element.getAttribute('y'), width: +element.getAttribute('width'), height: +element.getAttribute('height') }));
}

/** Waits for the composition canvas to repaint after a state change. */
async function frames(page, count = 3) {
  await page.evaluate(async (total) => {
    for (let index = 0; index < total; index += 1) await new Promise(done => requestAnimationFrame(done));
  }, count);
}

/** Reads preview pixels at composition coordinates, whatever the raster scale is. */
async function probe(page, points) {
  return page.evaluate(coordinates => {
    const stage = document.querySelector('[data-testid="editor-artboard"]');
    const canvas = stage.querySelector('canvas');
    const svg = stage.querySelector('svg');
    const viewBox = svg.getAttribute('viewBox').split(' ').map(Number);
    const [offsetX, offsetY] = svg.querySelector('g').getAttribute('transform').match(/[\d.-]+/g).map(Number);
    const scale = canvas.width / viewBox[2];
    const context = canvas.getContext('2d');
    return coordinates.map(([x, y]) => {
      const pixel = context.getImageData(Math.round((x - offsetX) * scale), Math.round((y - offsetY) * scale), 1, 1).data;
      return [pixel[0], pixel[1], pixel[2], pixel[3]];
    });
  }, points);
}

/**
 * The sample workspace is a picture, so pixels are compared against the same spot
 * either side of a change. A drawn stroke moves a pixel far more than the raster's
 * own settling noise, which a strict equality would trip over.
 */
const distance = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const INK = 30;

test('arrow bodies bend three ways and the bend handle drags the curve', async () => {
  const page = await editor();
  try {
    // A flat drag puts the chord on the x axis, so the bend is a pure vertical offset.
    const chord = [350, 200];
    const bow = [350, 260];
    await frames(page);
    const emptyBow = (await probe(page, [bow]))[0];

    await page.getByRole('button', { name: 'Line (A)', exact: true }).click();
    await drag(page, [200, 200], [500, 200]);
    await frames(page);
    const straightChord = (await probe(page, [chord]))[0];
    assert.ok(distance(straightChord, emptyBow) > INK, 'the straight body sits on its chord');
    assert.ok(distance((await probe(page, [bow]))[0], emptyBow) <= INK, 'a straight arrow has no ink off its chord');
    assert.equal(await page.locator('[data-testid="editor-artboard"] [data-bend]').count(), 0);

    await page.getByRole('button', { name: 'Curved', exact: true }).click();
    await frames(page);
    assert.equal(await page.locator('[data-testid="editor-artboard"] [data-bend]').count(), 1);
    assert.equal(await page.locator('[data-testid="layer-select"]').filter({ hasText: 'Curved line' }).count(), 1);
    assert.ok(distance((await probe(page, [chord]))[0], straightChord) > INK, 'a curved arrow leaves its chord bare');
    assert.ok(distance((await probe(page, [bow]))[0], emptyBow) > INK, 'a curved arrow bows away from the chord');

    // Dragging the handle to the far side carries the bow with it.
    const handle = await page.locator('[data-testid="editor-artboard"] [data-bend]').boundingBox();
    const far = [350, 140];
    const above = await imagePoint(page, ...far);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(above.x, above.y, { steps: 10 });
    await page.mouse.up();
    await frames(page);
    assert.ok(distance((await probe(page, [far]))[0], emptyBow) > INK, 'the bow moved to the other side of the chord');
    assert.ok(distance((await probe(page, [bow]))[0], emptyBow) <= INK, 'the old side of the bow is bare again');
    assert.ok(Number(await page.getByLabel('Arrow bend', { exact: true }).inputValue()) < 0, 'the bend is negative after dragging above the chord');

    // A bent arrow needs two legs, so it is drawn on the diagonal where it has a corner.
    // The body runs along the tail's row, rounds the corner, then down the tip's column.
    const tailRow = [450, 400];
    const tipColumn = [500, 450];
    const across = [350, 460];
    const background = await probe(page, [tailRow, tipColumn, across]);
    await drag(page, [200, 400], [500, 520]);
    await frames(page);
    assert.ok(distance((await probe(page, [across]))[0], background[2]) > INK, 'the second arrow starts straight across its chord');
    await page.getByRole('button', { name: 'Bent', exact: true }).click();
    await frames(page);
    assert.equal(await page.locator('[data-testid="layer-select"]').filter({ hasText: 'Bent line' }).count(), 1);
    assert.ok(distance((await probe(page, [tailRow]))[0], background[0]) > INK, 'a bent arrow runs along the row it starts on');
    assert.ok(distance((await probe(page, [tipColumn]))[0], background[1]) > INK, 'a bent arrow finishes down the tip column');
    assert.ok(distance((await probe(page, [across]))[0], background[2]) <= INK, 'a bent arrow never crosses its own chord');
    assert.equal(await page.getByLabel('Arrow corner', { exact: true }).inputValue(), '40', 'the corner keeps the bend it was given');

    // Both arrows still select, and going back to straight restores the first body.
    await page.locator('[data-testid="layer-select"]').filter({ hasText: 'Curved line' }).click();
    await frames(page);
    await page.getByRole('button', { name: 'Straight', exact: true }).click();
    await frames(page);
    assert.equal(await page.locator('[data-testid="editor-artboard"] [data-bend]').count(), 0);
    assert.ok(distance((await probe(page, [chord]))[0], emptyBow) > INK, 'going back to straight restores the original body');
  } finally { await page.close(); }
});

test('canvas layers draw, move, resize, hide, lock, and undo as complete gestures', async () => {
  const page = await editor();
  try {
    await page.getByRole('button', { name: 'Rectangle (R)', exact: true }).click();
    await drag(page, [160, 140], [400, 260]);
    assert.equal(await page.locator('[data-testid="layer-row"]:not([data-kind="image"])').count(), 1);
    let box = await selection(page);
    assert.ok(Math.abs(box.x - 160) < 1 && Math.abs(box.width - 240) < 1);
    await page.getByRole('button', { name: 'Select (V)', exact: true }).click();
    await drag(page, [250, 200], [320, 230]);
    box = await selection(page);
    assert.ok(Math.abs(box.x - 230) < 1 && Math.abs(box.y - 170) < 1);
    const handle = await page.locator('[data-handle="se"]').boundingBox();
    const endpoint = await imagePoint(page, 530, 350);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(endpoint.x, endpoint.y, { steps: 8 });
    await page.mouse.up();
    box = await selection(page);
    assert.ok(Math.abs(box.width - 300) < 1 && Math.abs(box.height - 180) < 1);
    await page.getByRole('button', { name: 'Hide Rectangle', exact: true }).click();
    assert.equal(await page.locator('[data-testid="editor-artboard"] [data-handle]').count(), 0);
    await page.getByRole('button', { name: 'Show Rectangle', exact: true }).click();
    await page.getByRole('button', { name: 'Lock layer', exact: true }).click();
    assert.equal(await page.locator('[data-testid="editor-artboard"] [data-handle]').count(), 0);
    await drag(page, [300, 230], [380, 270]);
    await page.locator('[data-testid="layer-select"]').filter({ hasText: 'Rectangle' }).click();
    assert.deepEqual(await selection(page), box);
    await page.getByRole('button', { name: 'Unlock layer', exact: true }).click();
    await page.keyboard.press('Control+z');
    assert.equal(await page.getByRole('button', { name: 'Unlock layer', exact: true }).count(), 1);
  } finally { await page.close(); }
});

test('arrow heads come in four shapes, both ends, and a size of their own', async () => {
  const page = await editor();
  try {
    // A big head makes the shapes tell each other apart: `wing` sits between the two
    // barbs of an open head, `blob` is inside a dot, and `tailHead` only has ink when
    // the far end carries a head too. `body` is on the line itself, so it is the one
    // spot that must always be inked.
    const body = [300, 300];
    const wing = [470, 310];
    const blob = [500, 315];
    const tailHead = [180, 310];
    // Each point is compared with itself before the arrow existed: the sample
    // workspace is a picture, so one shared reference would be wrong this far out.
    const points = [body, wing, blob, tailHead];
    const background = await probe(page, points);
    const read = async () => {
      const now = await probe(page, points);
      return { body: distance(now[0], background[0]) > INK, wing: distance(now[1], background[1]) > INK, blob: distance(now[2], background[2]) > INK, tail: distance(now[3], background[3]) > INK };
    };

    await page.getByRole('button', { name: 'Line (A)', exact: true }).click();
    await drag(page, [200, 300], [500, 300]);
    await frames(page);
    const size = page.getByLabel('Arrowhead size', { exact: true });
    assert.equal(await size.inputValue(), '16', 'an unpinned head follows the 4px stroke');
    await size.fill('60');
    await size.press('Enter');
    await frames(page);
    assert.equal(await page.getByLabel('Arrowhead size', { exact: true }).inputValue(), '60');

    let ink = await read();
    assert.deepEqual(ink, { body: true, wing: false, blob: false, tail: false }, 'an open head is two strokes, so it has a gap');

    await page.getByRole('button', { name: 'Solid', exact: true }).click();
    await frames(page);
    ink = await read();
    assert.equal(ink.wing, true, 'a solid head fills the gap between the barbs');
    assert.equal(ink.tail, false, 'one end leaves the tail plain');

    await page.getByRole('button', { name: 'Both ends', exact: true }).click();
    await frames(page);
    ink = await read();
    assert.equal(ink.tail, true, 'both ends puts a head on the tail as well');

    await page.getByRole('button', { name: 'Dot', exact: true }).click();
    await frames(page);
    ink = await read();
    assert.equal(ink.blob, true, 'a dot head marks the tip');
    assert.equal(ink.wing, false, 'a dot is not a filled head');

    await page.getByRole('button', { name: 'None', exact: true }).click();
    await frames(page);
    ink = await read();
    assert.deepEqual(ink, { body: true, wing: false, blob: false, tail: false }, 'no head is a bare line');
    assert.equal(await page.getByLabel('Arrowhead size', { exact: true }).count(), 0, 'the size control is pointless without a head');
  } finally { await page.close() }
});

test('Shift with the Line key cycles the arrow body and the brackets step its bend', async () => {
  const page = await editor();
  try {
    await page.keyboard.press('Shift+a');
    assert.equal(await page.getByRole('button', { name: 'Line (A)', exact: true }).getAttribute('data-active'), 'true', 'Shift+A takes the Line tool when it is not in use');
    await page.keyboard.press('Shift+a');
    assert.equal(await page.getByRole('button', { name: 'Curved', exact: true }).getAttribute('aria-pressed'), 'true', 'a second press curves the next arrow');
    await page.keyboard.press('Shift+a');
    assert.equal(await page.getByRole('button', { name: 'Bent', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Shift+a');
    assert.equal(await page.getByRole('button', { name: 'Straight', exact: true }).getAttribute('aria-pressed'), 'true', 'the cycle comes back round');

    // With an arrow in hand the brackets move that arrow, not the tool default.
    await drag(page, [200, 200], [500, 200]);
    await frames(page);
    assert.equal(await page.getByLabel('Arrow bend', { exact: true }).count(), 0, 'a straight arrow has no bend to step');
    await page.getByRole('button', { name: 'Curved', exact: true }).click();
    await frames(page);
    const start = Number(await page.getByLabel('Arrow bend', { exact: true }).inputValue());
    await page.keyboard.press(']');
    await page.keyboard.press(']');
    assert.equal(Number(await page.getByLabel('Arrow bend', { exact: true }).inputValue()), start + 20, '] bends it further');
    await page.keyboard.press('[');
    assert.equal(Number(await page.getByLabel('Arrow bend', { exact: true }).inputValue()), start + 10, '[ bends it back');

    // A rounded corner never goes below flat, however far the bend is driven down.
    await page.getByRole('button', { name: 'Bent', exact: true }).click();
    await frames(page);
    for (let press = 0; press < 20; press += 1) await page.keyboard.press('[');
    assert.equal(Number(await page.getByLabel('Arrow corner', { exact: true }).inputValue()), 0, 'a corner stops at a square joint');
  } finally { await page.close(); }
});

test('inline text editing and inspector font changes keep selection bounds accurate', async () => {
  const page = await editor();
  try {
    await page.getByRole('button', { name: 'Text (T)', exact: true }).click();
    const point = await imagePoint(page, 280, 200);
    await page.mouse.click(point.x, point.y);
    const input = page.locator('[data-testid="editor-artboard"] textarea');
    await input.fill('Make this clearer');
    await input.press('Control+Enter');
    assert.equal(await page.locator('[data-testid="layer-select"]').filter({ hasText: 'Make this clearer' }).count(), 1);
    const first = await selection(page);
    await pick(page, 'Text size', '64');
    const larger = await selection(page);
    assert.ok(larger.width > first.width * 1.9 && larger.height > first.height * 1.9);
    const edit = await imagePoint(page, 320, 225);
    await page.mouse.dblclick(edit.x, edit.y);
    await page.locator('[data-testid="editor-artboard"] textarea').fill('Two lines\nof context');
    await page.locator('[data-testid="editor-artboard"] textarea').press('Control+Enter');
    const multiline = await selection(page);
    assert.ok(multiline.height > larger.height * 1.9);
    await page.mouse.dblclick(edit.x, edit.y);
    await page.locator('[data-testid="editor-artboard"] textarea').fill('Edited inline');
    await page.locator('[data-testid="editor-artboard"] textarea').press('Control+Enter');
    assert.equal(await page.locator('[data-testid="layer-select"]').filter({ hasText: 'Edited inline' }).count(), 1);
  } finally { await page.close(); }
});

test('canvas padding, background and frame stroke compose the exported plate', async () => {
  const page = await editor();
  try {
    const result = await page.evaluate(async () => {
      const { getCompositionSize } = await import('/src/lib/render.ts');
      const source = document.createElement('canvas');
      source.width = 200;
      source.height = 120;
      const context = source.getContext('2d');
      context.fillStyle = '#3366ff';
      context.fillRect(0, 0, 200, 120);
      const image = new Image();
      image.src = source.toDataURL();
      await image.decode();
      const base = { background: 'transparent', padding: 24, radius: 0, frame: 'none', strokeColor: '#000000', strokeWidth: 0 };
      return {
        plain: getCompositionSize(image, base),
        padded: getCompositionSize(image, { ...base, padding: 64 }),
        stroke: getCompositionSize(image, { ...base, strokeWidth: 4 }),
      };
    });
    assert.deepEqual([result.plain.width, result.plain.height], [248, 168]);
    assert.deepEqual([result.plain.imageX, result.plain.imageY], [24, 24]);
    assert.deepEqual([result.padded.width, result.padded.height], [328, 248]);
    assert.deepEqual([result.stroke.width, result.stroke.height], [256, 176]);
  } finally { await page.close(); }
});

test('rendered exports retain layer order, transparency, pixelation, and composition scaling', async () => {
  const page = await editor();
  try {
    const result = await page.evaluate(async () => {
      const { renderComposition, getCompositionSize, annotationBounds } = await import('/src/lib/render.ts');
      const source = document.createElement('canvas'); source.width = 160; source.height = 120;
      const ctx = source.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 160, 120);
      for (let i = 80; i < 150; i += 2) { ctx.fillStyle = '#000000'; ctx.fillRect(i, 50, 1, 50); }
      const image = new Image(); image.src = source.toDataURL(); await image.decode();
      const style = { background: 'transparent', padding: 20, radius: 0, shadow: 0, frame: 'none' };
      const rectangle = { id: 'r', type: 'rectangle', x: 20, y: 20, width: 40, height: 30, color: '#ff0000', strokeWidth: 4 };
      const upper = { ...rectangle, id: 'b', color: '#0000ff' };
      const pixel = (canvas, x, y) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data];
      const rendered = renderComposition(image, [rectangle, upper], style);
      const hidden = renderComposition(image, [rectangle, { ...upper, hidden: true }], style);
      const blurred = renderComposition(image, [{ id: 'p', type: 'blur', x: 80, y: 50, width: 70, height: 50, color: '#000', strokeWidth: 4 }], style);
      const plain = renderComposition(image, [], style);
      const framed = renderComposition(image, [], { ...style, frame: 'browser' }, 2);
      const text = { id: 't', type: 'text', x: 10, y: 10, width: 1, height: 1, color: '#000000', strokeWidth: 2, text: 'Accurate', fontSize: 24 };
      return {
        size: getCompositionSize(image, style), dimensions: [rendered.width, rendered.height],
        alpha: pixel(rendered, 2, 2), topLayer: pixel(rendered, 40, 55), hiddenLayer: pixel(hidden, 40, 55),
        originalStripe: pixel(plain, 100, 80), blurredStripe: pixel(blurred, 100, 80),
        frame: [framed.width, framed.height], textBounds: annotationBounds(text),
      };
    });
    assert.deepEqual(result.dimensions, [200, 160]);
    assert.deepEqual(result.alpha, [0, 0, 0, 0]);
    assert.deepEqual(result.topLayer, [0, 0, 255, 255]);
    assert.deepEqual(result.hiddenLayer, [255, 0, 0, 255]);
    assert.notDeepEqual(result.blurredStripe, result.originalStripe);
    assert.deepEqual(result.frame, [400, 400]);
    assert.ok(result.textBounds.width > 60 && result.textBounds.height > 24);
  } finally { await page.close(); }
});

test('downloaded PNG includes the annotations seen on the canvas', async () => {
  const page = await editor();
  try {
    await page.getByRole('button', { name: 'Rectangle (R)', exact: true }).click();
    await drag(page, [180, 120], [420, 300]);
    await page.getByRole('button', { name: 'Add fill', exact: true }).click();
    await page.getByLabel('Annotation color', { exact: true }).fill('#ff0000');
    await page.locator('[data-testid="header-actions"]').getByRole('button', { name: 'Export image', exact: false }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download image', exact: true }).click();
    const download = await downloadEvent;
    const bytes = await readFile(await download.path());
    // The plate starts bare, so the export is exactly the screenshot: 1200 x 760 with
    // no padding around it and no background behind it.
    assert.equal(bytes.readUInt32BE(16), 1200);
    assert.equal(bytes.readUInt32BE(20), 760);
    const color = await page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      // inside the rectangle that was drawn from (180, 120) to (420, 300)
      return [...ctx.getImageData(300, 200, 1, 1).data];
    }, bytes.toString('base64'));
    assert.ok(color[0] > 245 && color[1] < 10 && color[2] < 10);
  } finally { await page.close(); }
});

test('PDF export downloads the full image on a page with matching proportions', async () => {
  const page = await editor();
  try {
    await page.locator('[data-testid="header-actions"]').getByRole('button', { name: 'Export image', exact: false }).click();
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Download image', exact: true }).textContent(), 'Export PDF');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download image', exact: true }).click();
    const download = await downloadEvent;
    const bytes = await readFile(await download.path());
    assert.match(download.suggestedFilename(), /\.pdf$/);
    assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.ok(bytes.length > 200);
    const pdf = bytes.toString('latin1');
    const [, pageWidth, pageHeight] = pdf.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/).map(Number);
    assert.equal(pageWidth, 595.276, 'Full image uses a readable page width by default');
    assert.ok(Math.abs(pageWidth / pageHeight - 1200 / 760) < 0.000001, 'the composition keeps its own page proportions');
    assert.match(pdf, /\/Width 1200 \/Height 760/, 'the original image resolution is embedded');
    const placement = pdf.match(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/).slice(1).map(Number);
    assert.deepEqual(placement, [pageWidth, pageHeight, 0, 0], 'the whole image fills its matching page');
  } finally { await page.close(); }
});

test('PDF page and scale controls keep the menu open and fit a full-resolution image on A4', async () => {
  const page = await editor();
  try {
    await page.locator('[data-testid="header-actions"]').getByRole('button', { name: 'Export image', exact: false }).click();
    await pick(page, 'Export scale', '0.5×');
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    assert.equal(await shown(page, 'Export scale'), '1×', 'PDF defaults back to original resolution');
    assert.equal(await shown(page, 'PDF page size'), 'Full image');
    await pick(page, 'PDF page size', 'A4');
    await pick(page, 'Export scale', '2×');
    assert.equal(await shown(page, 'PDF page size'), 'A4');
    const preview = await page.getByLabel('A4 PDF page preview', { exact: true }).boundingBox();
    assert.ok(Math.abs(preview.width / preview.height - 841.89 / 595.276) < 0.001, 'preview matches the landscape A4 sheet');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download image', exact: true }).click();
    const download = await downloadEvent;
    const pdf = (await readFile(await download.path())).toString('latin1');
    assert.match(pdf, /\/MediaBox \[0 0 841\.89 595\.276\]/, 'higher resolution keeps A4 physical dimensions');
    assert.match(pdf, /\/Width 2400 \/Height 1520/, '2× embeds a larger bitmap');
    const [, width, height, x, y] = pdf.match(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/).map(Number);
    assert.ok(Math.abs(width / height - 1200 / 760) < 0.0001, 'drawing retains the original proportions');
    assert.ok(x >= 0 && y >= 0 && x + width <= 841.891 && y + height <= 595.277, 'every edge is inside the page');
  } finally { await page.close(); }
});

test('maximum-length captures retain their last row through composition rendering and PDF export', async () => {
  const page = await editor();
  try {
    const result = await page.evaluate(async () => {
      const { renderComposition } = await import('/src/lib/render.ts');
      const { createExportBlob } = await import('/src/lib/export.ts');
      const { DEFAULT_STYLE } = await import('/src/lib/editor-types.ts');
      const source = document.createElement('canvas');
      source.width = 32;
      source.height = 32760;
      const context = source.getContext('2d');
      context.fillStyle = 'white'; context.fillRect(0, 0, 32, 32760);
      context.fillStyle = '#ff0000'; context.fillRect(0, 0, 32, 1);
      context.fillStyle = '#0000ff'; context.fillRect(0, 32759, 32, 1);
      const image = new Image(); image.src = source.toDataURL(); await image.decode();
      const style = { ...DEFAULT_STYLE, padding: 0, radius: 0, strokeWidth: 0, frame: 'none' };
      const rendered = renderComposition(image, [], style);
      const pixels = rendered.getContext('2d');
      const pdf = await (await createExportBlob(rendered, 'pdf')).text();
      let oversizeError = '';
      try { renderComposition(image, [], { ...style, padding: 4 }); } catch (error) { oversizeError = error.message; }
      return {
        dimensions: [rendered.width, rendered.height],
        first: [...pixels.getImageData(0, 0, 1, 1).data],
        last: [...pixels.getImageData(0, 32759, 1, 1).data],
        imageHeight: Number(pdf.match(/\/Subtype \/Image \/Width 32 \/Height (\d+)/)[1]),
        oversizeError,
      };
    });
    assert.deepEqual(result.dimensions, [32, 32760]);
    assert.deepEqual(result.first, [255, 0, 0, 255]);
    assert.deepEqual(result.last, [0, 0, 255, 255]);
    assert.equal(result.imageHeight, 32760);
    assert.match(result.oversizeError, /too large/, 'oversized compositions report an error instead of silently clipping');
  } finally { await page.close(); }
});

test('text typography controls reshape the box and never rescale the font size', async () => {
  const page = await editor();
  try {
    await page.getByRole('button', { name: 'Text (T)', exact: true }).click();
    const point = await imagePoint(page, 280, 200);
    await page.mouse.click(point.x, point.y);
    const input = page.locator('[data-testid="editor-artboard"] textarea');
    await input.fill('Two lines\nof context');
    await input.press('Control+Enter');
    await page.locator('[data-testid="layer-select"]').filter({ hasText: 'Two lines' }).click();
    assert.equal(await shown(page, 'Text size'), '32');

    const base = await selection(page);
    await page.getByLabel('Letter spacing', { exact: true }).fill('6');
    await page.getByLabel('Letter spacing', { exact: true }).press('Enter');
    await page.waitForTimeout(150);
    const spaced = await selection(page);
    assert.ok(spaced.width > base.width + 20, `letter spacing must widen the box (${base.width} -> ${spaced.width})`);
    assert.equal(await shown(page, 'Text size'), '32', 'letter spacing must not touch the font size');

    await pick(page, 'Line height', '2.5');
    await page.waitForTimeout(150);
    const loose = await selection(page);
    assert.ok(loose.height > spaced.height, 'line height must make the box taller');
    assert.ok(Math.abs(loose.width - spaced.width) < 1, 'line height must not change the width');
    assert.equal(await shown(page, 'Text size'), '32');

    await pick(page, 'Font weight', 'Regular');
    await page.waitForTimeout(150);
    const lighter = await selection(page);
    assert.ok(lighter.width < loose.width, 'a lighter weight is narrower than a bold one');
    assert.equal(await shown(page, 'Text size'), '32');

    // the family dropdown re-measures the text, but must not touch the font size
    const before = await selection(page);
    await pick(page, 'Font family', 'Geist');
    await page.waitForTimeout(150);
    const geist = await selection(page);
    assert.equal(await shown(page, 'Text size'), '32');
    assert.ok(Math.abs(geist.height - before.height) < 1, 'the line count cannot change with the family');
    assert.ok(Math.abs(geist.width - before.width) / before.width < 0.15, 'two sans faces stay close in width');
  } finally { await page.close(); }
});
