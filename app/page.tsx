"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CircleMarker, Map as LeafletMap } from "leaflet";

type GeoPoint = { lat: number; lng: number };
type ImagePoint = { x: number; y: number };
type ControlPoint = { id: string; geo: GeoPoint; image: ImagePoint };
type Affine = { lng: [number, number, number]; lat: [number, number, number]; rmsMeters: number };
type Pending = { geo?: GeoPoint; image?: ImagePoint };

const OSHKOSH: [number, number] = [43.9844, -88.5569];

function solve3(matrix: number[][], values: number[]) {
  const a = matrix.map((row, index) => [...row, values[index]]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];
    if (Math.abs(a[col][col]) < 1e-12) return null;
    const divisor = a[col][col];
    for (let j = col; j < 4; j += 1) a[col][j] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j < 4; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return [a[0][3], a[1][3], a[2][3]] as [number, number, number];
}

function fitAffine(points: ControlPoint[]): Affine | null {
  if (points.length < 3) return null;
  const normal = Array.from({ length: 3 }, () => [0, 0, 0]);
  const lngValues = [0, 0, 0];
  const latValues = [0, 0, 0];
  points.forEach(({ image, geo }) => {
    const row = [image.x, image.y, 1];
    for (let i = 0; i < 3; i += 1) {
      lngValues[i] += row[i] * geo.lng;
      latValues[i] += row[i] * geo.lat;
      for (let j = 0; j < 3; j += 1) normal[i][j] += row[i] * row[j];
    }
  });
  const lng = solve3(normal, lngValues);
  const lat = solve3(normal, latValues);
  if (!lng || !lat) return null;
  const meanLat = points.reduce((sum, point) => sum + point.geo.lat, 0) / points.length;
  const metersPerLng = 111_320 * Math.cos((meanLat * Math.PI) / 180);
  const squaredError = points.reduce((sum, point) => {
    const predicted = imageToGeo(point.image, { lng, lat, rmsMeters: 0 });
    const dx = (predicted.lng - point.geo.lng) * metersPerLng;
    const dy = (predicted.lat - point.geo.lat) * 111_320;
    return sum + dx * dx + dy * dy;
  }, 0);
  return { lng, lat, rmsMeters: Math.sqrt(squaredError / points.length) };
}

function imageToGeo(point: ImagePoint, affine: Affine): GeoPoint {
  return {
    lng: affine.lng[0] * point.x + affine.lng[1] * point.y + affine.lng[2],
    lat: affine.lat[0] * point.x + affine.lat[1] * point.y + affine.lat[2],
  };
}

function geoToImage(point: GeoPoint, affine: Affine): ImagePoint | null {
  const a = affine.lng[0];
  const b = affine.lng[1];
  const d = affine.lat[0];
  const e = affine.lat[1];
  const lng0 = point.lng - affine.lng[2];
  const lat0 = point.lat - affine.lat[2];
  const determinant = a * e - b * d;
  if (Math.abs(determinant) < 1e-16) return null;
  return { x: (lng0 * e - b * lat0) / determinant, y: (a * lat0 - lng0 * d) / determinant };
}

export default function Home() {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const imageStageRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const controlLayersRef = useRef<CircleMarker[]>([]);
  const gpsLayerRef = useRef<CircleMarker | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayImageRef = useRef<HTMLImageElement | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [imageSize, setImageSize] = useState<ImagePoint | null>(null);
  const [points, setPoints] = useState<ControlPoint[]>([]);
  const [pending, setPending] = useState<Pending>({});
  const [gps, setGps] = useState<GeoPoint | null>(null);
  const [tracking, setTracking] = useState(false);
  const [opacity, setOpacity] = useState(0.66);
  const [notice, setNotice] = useState("Ladda upp AirVenture-kartan för att börja.");

  const affine = useMemo(() => fitAffine(points), [points]);
  const gpsImage = useMemo(() => (gps && affine ? geoToImage(gps, affine) : null), [gps, affine]);

  const addPoint = useCallback((geo: GeoPoint, image: ImagePoint) => {
    setPoints((current) => [...current, { id: crypto.randomUUID(), geo, image }]);
    setPending({});
    setNotice("Punktparet har lagts till. Välj nästa punkt på båda kartorna.");
  }, [setPending, setPoints, setNotice]);

  const chooseGeo = useCallback((geo: GeoPoint) => {
    setPending((current) => {
      if (current.image) {
        addPoint(geo, current.image);
        return {};
      }
      setNotice("Kartpunkten är vald. Klicka på samma plats i AirVenture-kartan.");
      return { ...current, geo };
    });
  }, [addPoint, setPending, setNotice]);

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !mapElementRef.current) return;
      leafletRef.current = L;
      const map = L.map(mapElementRef.current, { zoomControl: true }).setView(OSHKOSH, 15);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 20,
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);
      map.on("click", (event) => chooseGeo({ lat: event.latlng.lat, lng: event.latlng.lng }));
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 0);
    });
    return () => {
      cancelled = true;
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [chooseGeo]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    controlLayersRef.current.forEach((layer) => layer.remove());
    controlLayersRef.current = points.map((point, index) =>
      L.circleMarker([point.geo.lat, point.geo.lng], {
        radius: 8,
        color: "#071f2b",
        weight: 3,
        fillColor: "#ffbf47",
        fillOpacity: 1,
      }).bindTooltip(String(index + 1), { permanent: true, direction: "center", className: "map-label" }).addTo(map),
    );
  }, [points]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    gpsLayerRef.current?.remove();
    gpsLayerRef.current = null;
    if (gps) {
      gpsLayerRef.current = L.circleMarker([gps.lat, gps.lng], {
        radius: 9,
        color: "white",
        weight: 3,
        fillColor: "#e4472e",
        fillOpacity: 1,
      }).bindTooltip("GPS", { direction: "top" }).addTo(map);
    }
  }, [gps]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!overlayCanvasRef.current) {
      const canvas = document.createElement("canvas");
      canvas.className = "leaflet-affine-overlay";
      map.getPanes().overlayPane.appendChild(canvas);
      overlayCanvasRef.current = canvas;
    }
    const canvas = overlayCanvasRef.current;
    const redraw = () => {
      const size = map.getSize();
      const scale = window.devicePixelRatio || 1;
      canvas.width = size.x * scale;
      canvas.height = size.y * scale;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.clearRect(0, 0, size.x, size.y);
      if (!affine || !imageSize || !overlayImageRef.current) return;
      const origin = map.latLngToContainerPoint(imageToGeo({ x: 0, y: 0 }, affine));
      const right = map.latLngToContainerPoint(imageToGeo({ x: imageSize.x, y: 0 }, affine));
      const bottom = map.latLngToContainerPoint(imageToGeo({ x: 0, y: imageSize.y }, affine));
      ctx.globalAlpha = opacity;
      ctx.setTransform(
        ((right.x - origin.x) / imageSize.x) * scale,
        ((right.y - origin.y) / imageSize.x) * scale,
        ((bottom.x - origin.x) / imageSize.y) * scale,
        ((bottom.y - origin.y) / imageSize.y) * scale,
        origin.x * scale,
        origin.y * scale,
      );
      ctx.drawImage(overlayImageRef.current, 0, 0, imageSize.x, imageSize.y);
    };
    map.on("move zoom resize", redraw);
    redraw();
    return () => { map.off("move zoom resize", redraw); };
  }, [affine, imageSize, opacity, imageUrl]);

  function loadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      overlayImageRef.current = image;
      setImageSize({ x: image.naturalWidth, y: image.naturalHeight });
      setImageUrl(url);
      setImageName(file.name);
      setPoints([]);
      setPending({});
      setNotice("Kartan är laddad. Klicka på en tydlig plats i vardera panelen.");
    };
    image.src = url;
  }

  function chooseImage(event: React.MouseEvent<HTMLDivElement>) {
    if (!imageSize || !imageStageRef.current) return;
    const bounds = imageStageRef.current.getBoundingClientRect();
    const scale = Math.min(bounds.width / imageSize.x, bounds.height / imageSize.y);
    const renderedWidth = imageSize.x * scale;
    const renderedHeight = imageSize.y * scale;
    const x = (event.clientX - bounds.left - (bounds.width - renderedWidth) / 2) / scale;
    const y = (event.clientY - bounds.top - (bounds.height - renderedHeight) / 2) / scale;
    if (x < 0 || y < 0 || x > imageSize.x || y > imageSize.y) return;
    const image = { x, y };
    if (pending.geo) addPoint(pending.geo, image);
    else {
      setPending((current) => ({ ...current, image }));
      setNotice("Bildpunkten är vald. Klicka på samma plats i OpenStreetMap.");
    }
  }

  function toggleTracking() {
    if (!navigator.geolocation) {
      setNotice("Den här webbläsaren saknar stöd för GPS-position.");
      return;
    }
    if (tracking && watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      setTracking(false);
      setNotice("GPS-spårningen är pausad.");
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude };
        setGps(next);
        setTracking(true);
      },
      () => setNotice("Kunde inte läsa GPS-positionen. Kontrollera platsbehörigheten."),
      { enableHighAccuracy: true, maximumAge: 3000 },
    );
    setNotice("GPS-spårningen är aktiv.");
  }

  function exportCalibration() {
    if (!affine || !imageSize) return;
    const payload = JSON.stringify({ version: 1, imageName, imageSize, controlPoints: points, affine }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${imageName.replace(/\.[^.]+$/, "") || "airventure-map"}-calibration.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importCalibration(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        const data = JSON.parse(text);
        if (!Array.isArray(data.controlPoints) || data.controlPoints.length < 3) throw new Error();
        setPoints(data.controlPoints);
        setNotice("Kalibreringen är importerad. Ladda samma kartbild om den inte redan visas.");
      } catch {
        setNotice("Filen kunde inte läsas som en AirVenture-kalibrering.");
      }
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AirVenture 2026 · kartverkstad</p>
          <h1>Para ihop kartan med verkligheten</h1>
        </div>
        <div className={`calibration-pill ${affine ? "ready" : ""}`}>
          <span />
          {affine ? `Kalibrerad · ±${affine.rmsMeters.toFixed(1)} m` : `${points.length}/3 grundpunkter`}
        </div>
      </header>

      <section className="intro-row">
        <p>{notice}</p>
        <div className="actions">
          <label className="button primary">
            <input type="file" accept="image/*" onChange={loadImage} />
            {imageUrl ? "Byt kartbild" : "Ladda kartbild"}
          </label>
          <label className="button">
            <input type="file" accept="application/json" onChange={importCalibration} />
            Importera
          </label>
          <button className="button" disabled={!affine} onClick={exportCalibration}>Exportera</button>
          <button className={`button ${tracking ? "active" : ""}`} onClick={toggleTracking}>
            {tracking ? "Pausa GPS" : "Visa min GPS"}
          </button>
        </div>
      </section>

      <section className="workspace">
        <article className="map-card">
          <div className="card-heading">
            <div><span className="step">1</span><div><h2>Verklig karta</h2><p>Klicka på en tydlig referenspunkt</p></div></div>
            <span className="source">OpenStreetMap</span>
          </div>
          <div className="map-frame" ref={mapElementRef} />
        </article>

        <article className="map-card">
          <div className="card-heading">
            <div><span className="step">2</span><div><h2>AirVenture-karta</h2><p>Klicka på exakt samma plats</p></div></div>
            <span className="source">{imageName || "Ingen bild laddad"}</span>
          </div>
          <div className={`image-stage ${imageUrl ? "has-image" : ""}`} ref={imageStageRef} onClick={chooseImage}>
            {imageUrl ? <img src={imageUrl} alt="Uppladdad AirVenture-karta" draggable={false} /> : (
              <label className="drop-zone">
                <input type="file" accept="image/*" onChange={loadImage} />
                <span className="upload-icon">↥</span>
                <strong>Ladda upp kartan</strong>
                <small>PNG, JPG eller WEBP</small>
              </label>
            )}
            {imageSize && imageUrl && (
              <svg className="image-overlay" viewBox={`0 0 ${imageSize.x} ${imageSize.y}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                {points.map((point, index) => (
                  <g className="svg-control" key={point.id} transform={`translate(${point.image.x} ${point.image.y})`}>
                    <circle r="18" />
                    <text y="1">{index + 1}</text>
                  </g>
                ))}
                {pending.image && (
                  <g className="svg-control svg-pending" transform={`translate(${pending.image.x} ${pending.image.y})`}>
                    <circle r="18" />
                    <text y="1">?</text>
                  </g>
                )}
                {gpsImage && (
                  <g className="svg-gps" transform={`translate(${gpsImage.x} ${gpsImage.y})`}>
                    <circle className="gps-pulse" r="28" />
                    <circle className="gps-core" r="14" />
                  </g>
                )}
              </svg>
            )}
          </div>
        </article>
      </section>

      <section className="lower-grid">
        <article className="control-panel">
          <div className="panel-title"><div><h2>Referenspunkter</h2><p>Tre punkter räcker; 5–8 väl spridda punkter ger bättre kontroll.</p></div><strong>{points.length}</strong></div>
          {points.length === 0 ? <div className="empty-points">Punktparen visas här när du har klickat i båda kartorna.</div> : (
            <div className="point-list">
              {points.map((point, index) => (
                <div className="point-row" key={point.id}>
                  <span className="point-number">{index + 1}</span>
                  <div><strong>{point.geo.lat.toFixed(6)}, {point.geo.lng.toFixed(6)}</strong><small>Bildpixel {Math.round(point.image.x)}, {Math.round(point.image.y)}</small></div>
                  <button aria-label={`Ta bort punkt ${index + 1}`} onClick={() => setPoints((current) => current.filter((item) => item.id !== point.id))}>×</button>
                </div>
              ))}
            </div>
          )}
        </article>

        <aside className="quality-panel">
          <h2>Resultat</h2>
          <div className="metric"><span>Modell</span><strong>Affin transformation</strong></div>
          <div className="metric"><span>Kontrollpunkter</span><strong>{points.length}</strong></div>
          <div className="metric"><span>RMS-fel</span><strong>{affine ? `${affine.rmsMeters.toFixed(1)} m` : "—"}</strong></div>
          <label className="opacity-control">
            <span><span>Överlagring</span><strong>{Math.round(opacity * 100)}%</strong></span>
            <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
          </label>
          <p className="quality-note">Sprid punkterna runt kartans kanter. Undvik att lägga alla längs samma väg eller rullbana.</p>
        </aside>
      </section>
    </main>
  );
}
