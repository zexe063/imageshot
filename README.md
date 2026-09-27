# ImageShot

A local screenshot editor and Chrome/Edge extension, with area, visible-page, and full-page capture.

## Run and build

```sh
npm ci
npm run dev
npm run build
```

The development server runs the editor and popup preview. Webpage capture requires the built extension:

1. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this project's `dist` folder.
3. Pin ImageShot to the toolbar. After rebuilding, reload the extension on the extensions page.

## Capture

1. Open the webpage to capture, then click ImageShot or press **Alt + Shift + S**.
2. Choose **Visible page** for the current viewport, **Full page** for the whole document, or **Select area** and drag around a region. **Esc** cancels an area selection.
3. The image opens in the editor. Keep the tab active and its size and display scale unchanged while a full-page capture runs, and finish the save from the editor afterwards.

Captures and editor drafts stay in local IndexedDB. The capture history retains the newest twelve screenshots. Capturing a page does not upload it.

## Annotating

Choose **Line** (**A**) and drag to point at something. The **Arrow** panel switches the body between three shapes:

- **Straight** — the default, a single line from end to end.
- **Curved** — a bow that leaves the chord between the two ends, by up to half the arrow's length to either side.
- **Bent** — a right-angled body that runs along the row it starts on, rounds the corner, then finishes down the tip's column.

**Head** picks what an arrow ends in: **Open** (two strokes), **Solid** (a filled dart), **Dot**, or **None**, and whether it points at one end or **Both ends**. A head that is not pinned follows the stroke weight, the way it always has, and the size field takes over the moment it is set. The head always sits square to the direction the body arrives from, so it tilts into a bow and points down a bent arrow's last leg.

**Bend** slides the bow (curved) or the corner rounding (bent) from -100% to 100%. A selected bent arrow also shows a round handle on its own body with a dashed guide back to the chord, and dragging that handle bends the arrow directly. A bent arrow can also turn **Across** or **Down** first, which is what decides which corner of its box it goes around. The style, bend and head last used carry over to the next arrow, so a series of callouts matches without revisiting the panel.

**Shift + A** cycles the arrow body, and **[ ]** step the bend, so a callout can be shaped without leaving the keyboard. Both are in the shortcuts sheet under **?**.

The canvas, the pointer hit test and the exported image all read the same arrow geometry, so a bowed arrow is picked and exported exactly where it is drawn. Bodies are stroked with native Bézier and arc commands rather than sampled points, so a long bow stays smooth at any zoom or export size, and a bent corner is a true quarter circle filleted along its legs. Arrows saved before this feature have no bend and keep rendering as straight open-headed lines.

## PDF export

Open **Export**, choose **PDF**, and leave **Page size** on **Full image** for one continuous page at a readable width. The default keeps the page up to A4 width and lets its height follow the image's proportions, without stretching or cropping. The complete image is embedded losslessly at its export resolution, with annotations and transparency preserved.

Choose **Original size** to size the page from the image at 96 pixels per inch; wide captures produce wider pages. Choose **A4** to fit the complete image proportionally onto a standard sheet. The orientation follows the image; unused space stays white. Long screenshots appear smaller when fitted onto one A4 page. **Scale** changes the embedded image resolution without changing the PDF page size. Use **1×** to preserve the original pixels; increasing scale does not restore detail absent from the source image.

Very long pages are reduced proportionally to the PDF reader's supported page dimensions while retaining all embedded pixels. **Copy image (PNG)** copies a raster image; use **Export PDF** to save the PDF file.

## Supported bounds

Browser settings and extension-store pages cannot be captured. A full-page capture is limited to 40 screenshot tiles and approximately 56 MB of source image data, and an area selection expires after two minutes.

A page too tall for a single canvas is not refused. Chrome cannot hold a canvas past 32,767 pixels on a side, and past roughly 48 megapixels it runs the tab short of memory, so ImageShot composes a larger capture at a reduced scale (typically 70-90%) and says so when the image opens. The stored tiles keep their original resolution, so **Select area** still gives a full-resolution crop of any part of the page.

## Verify

```sh
npx playwright install chromium
npm test
npm run build
```

The browser tests cover editor interactions and export, full-page stitching, horizontal overflow, sticky and fixed element restoration, area selection and cancellation, the browser screenshot rate limit, error recovery, and local storage.
