import { NextResponse } from "next/server";
import { conn } from "@/lib/chain";
import { loadGlobalFeed } from "@/lib/indexer";

export const revalidate = 0;
export const dynamic = "force-dynamic";

/** Public feed of every Oven Mitt receipt written to Cookie Chain, by anyone.
 *  Read straight off the chain: there is no database behind this app. */
export async function GET() {
  try {
    const c = conn();
    const [entries, slot] = await Promise.all([
      loadGlobalFeed(c, 40),
      c.getSlot().catch(() => 0),
    ]);
    return NextResponse.json({ ok: true, slot, entries: entries.slice(0, 12) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "rpc unavailable", entries: [] },
      { status: 200 },
    );
  }
}
