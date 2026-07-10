# AirVenture Map Lab

A browser-based georeferencing workbench for the EAA AirVenture grounds map.
It pairs recognizable points in OpenStreetMap with the same points in an event
map image, calculates an affine transformation, and previews the transformed
image over the real map.

## Current prototype

- Upload a PNG, JPG, or WEBP event map locally in the browser.
- Click matching reference points in either order.
- Fit an affine transformation from three or more point pairs.
- Show RMS residual error in metres.
- Preview the map image as a rotatable/skewable overlay on OpenStreetMap.
- Adjust overlay opacity.
- Track browser GPS on both the real and event maps.
- Import and export calibration data as JSON.
- Responsive two-panel desktop/tablet workspace.

The uploaded map image never leaves the browser in this version. Exported JSON
contains the image name, image dimensions, control points, and transformation,
but not the copyrighted map image itself.

## Local development

```bash
npm install
npm run dev
```

Production validation:

```bash
npm run lint
npm run build
```

## Calibration workflow

1. Upload the AirVenture map image.
2. Choose a distinct feature in OpenStreetMap, such as a runway intersection,
   road junction, or building corner.
3. Click the same feature in the event map.
4. Repeat with points spread around the full image. Three points are the
   mathematical minimum; five to eight are recommended.
5. Check the RMS error and inspect the semitransparent overlay.
6. Export the calibration JSON when the result is satisfactory.

## Next milestones

- Add a project format that bundles calibration and normalized point-of-interest data.
- Import exhibitor/event datasets and place searchable features on the map.
- Add offline caching for the PWA visit mode.
- Evaluate a higher-order transform if the official artwork contains local distortion.
- Add calibration-point residual vectors and leave-one-out validation.
