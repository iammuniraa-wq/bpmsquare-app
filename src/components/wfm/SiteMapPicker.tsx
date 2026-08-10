"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { c } from "@/lib/theme";

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

const inp: React.CSSProperties = {
  flex: 1, padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const btn: React.CSSProperties = {
  padding: "8px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8,
  border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer", whiteSpace: "nowrap",
};

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Recenters the map when lat/lng change from outside the map (typed
// coordinates, or a resolved address), without fighting the user's own
// pan/zoom otherwise.
function Recenter({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (lat != null && lng != null) map.setView([lat, lng], Math.max(map.getZoom(), 15));
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

  const [address, setAddress] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function searchAddress() {
    if (!address.trim() || searching) return;
    setSearching(true);
    setSearchMsg(null);
    try {
      const res = await fetch(`/api/wfm/geocode?address=${encodeURIComponent(address.trim())}`);
      const json = await res.json();
      if (!res.ok) { setSearchMsg({ tone: "err", text: json.error ?? "Could not find that address" }); return; }
      onChange(json.lat, json.lng);
      setSearchMsg({ tone: "ok", text: `Found: ${json.formatted_address} — drag the pin if it's not quite right.` });
    } catch {
      setSearchMsg({ tone: "err", text: "Network error" });
    } finally {
      setSearching(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          style={inp}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchAddress(); } }}
          placeholder="Type an address and press Search — e.g. Hosapete, Karnataka"
        />
        <button type="button" style={{ ...btn, opacity: searching ? 0.6 : 1 }} disabled={searching} onClick={searchAddress}>
          {searching ? "Searching…" : "Search"}
        </button>
      </div>
      {searchMsg && (
        <div style={{ fontSize: 11.5, marginBottom: 8, color: searchMsg.tone === "ok" ? "#10b981" : "#ef4444" }}>
          {searchMsg.text}
        </div>
      )}
      <div style={{ height: 260, borderRadius: 8, overflow: "hidden", border: `1px solid ${c.line}` }}>
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
      <div style={{ fontSize: 11, color: c.hint, marginTop: 6 }}>
        Search an address to jump there, then click the map or drag the pin to fine-tune the exact spot.
      </div>
    </div>
  );
}
