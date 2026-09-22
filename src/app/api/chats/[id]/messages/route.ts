import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { errorJson, json } from "@/lib/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const cid = Number(id);
    const body = (await req.json()) as { role: string; content: string };
    const rows = await db
      .insert(messages)
      .values({ chatId: cid, role: body.role, content: body.content ?? "" })
      .returning();
    await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, cid));
    return json(rows[0]);
  } catch (e) {
    return errorJson(e);
  }
}
