"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet's default marker icon references image paths relative to the
// package, which bundlers (Next/webpack) don't resolve -- point it at the
// same version's files on unpkg instead. Standard workaround, no local
// asset needed.
const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const DEFAULT_CENTER: [number, number] = [20.5937, 78.9629]; // India, for an empty/new site

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Recenters the map when lat/lng change from outside the map (typed
// coordinates), without fighting the user's own pan/zoom otherwise.
function Recenter({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (lat != null && lng != null) map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

export default function SiteMapPicker({
  lat, lng, onChange,
}: {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
}) {
  const center: [number, number] = lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER;

  return (
    <div style={{ height: 260, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)" }}>
      <MapContainer center={center} zoom={lat != null ? 15 : 4} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToPlace onPick={onChange} />
        <Recenter lat={lat} lng={lng} />
        {lat != null && lng != null && (
          <Marker
            position={[lat, lng]}
            icon={markerIcon}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const m = e.target as L.Marker;
                const pos = m.getLatLng();
                onChange(pos.lat, pos.lng);
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
