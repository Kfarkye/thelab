import { requireEnv } from "@/lib/env";

export type GeocodeResult = {
  latitude: number;
  longitude: number;
};

type GeocodeApiResponse = {
  status?: string;
  results?: Array<{
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  }>;
};

function readLocation(response: GeocodeApiResponse): GeocodeResult | null {
  const location = response.results?.[0]?.geometry?.location;
  if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") {
    return null;
  }
  return {
    latitude: location.lat,
    longitude: location.lng,
  };
}

export async function geocodeCityState(city: string | null, state: string | null): Promise<GeocodeResult | null> {
  const cleanCity = String(city || "").trim();
  const cleanState = String(state || "").trim();
  if (!cleanCity || !cleanState) return null;

  const key = requireEnv("GOOGLE_MAPS_API_KEY");
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", `${cleanCity}, ${cleanState}, USA`);
  url.searchParams.set("key", key);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GEOCODING_HTTP_${response.status}`);
  }

  const body = await response.json() as GeocodeApiResponse;
  if (body.status !== "OK") {
    throw new Error(`GEOCODING_${body.status || "UNKNOWN"}`);
  }
  return readLocation(body);
}
