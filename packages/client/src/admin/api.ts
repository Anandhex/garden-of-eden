import type {
  AdminCard,
  AdminClock,
  AdminCrowd,
  AdminEvent,
  AdminEventQuery,
  AdminEventsPage,
  AdminGossip,
  AdminHealth,
  AdminKnowers,
  AdminOverview,
  AdminNewsChain,
  AdminPinned,
  AdminRoads,
  AdminPlayerView,
  AdminSearchResult,
  AdminTimeRequest,
  AdminTimeResponse,
} from "@millbrook/shared";

/** The admin page's calls (N17). Everything is a GET except the time controls. */

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

const params = (o: Record<string, string | number | undefined>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

export const api = {
  clock: () => get<AdminClock>("clock"),
  overview: () => get<AdminOverview>("overview"),
  health: () => get<AdminHealth>("health"),
  events: (q: AdminEventQuery = {}) => get<AdminEventsPage>(`events${params({ ...q })}`),
  event: (ref: string) => get<AdminEvent>(`event${params({ ref })}`),
  search: (q: string, o: { kind?: string; site?: string } = {}) => get<AdminSearchResult>(`search${params({ q, ...o })}`),
  card: (ref: string) => get<AdminCard>(`card${params({ ref })}`),
  pinned: (refs: string[]) => get<AdminPinned>(`pinned${params({ refs: refs.join(",") })}`),
  player: () => get<AdminPlayerView>("player"),
  roads: () => get<AdminRoads>("roads"),
  gossip: () => get<AdminGossip>("gossip"),
  knowers: (ref: string) => get<AdminKnowers>(`knowers${params({ ref })}`),
  chain: (news: string, site: string) => get<AdminNewsChain>(`chain${params({ news, site })}`),
  crowd: (site: string) => get<AdminCrowd>(`crowd${params({ site })}`),
  async time(req: AdminTimeRequest): Promise<AdminTimeResponse> {
    const res = await fetch("/api/admin/time", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
    return (await res.json()) as AdminTimeResponse;
  },
};
