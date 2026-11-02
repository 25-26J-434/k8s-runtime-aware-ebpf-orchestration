import { proxyRequest } from "@/lib/api/server/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const handle = async (req: Request, ctx: Ctx) => proxyRequest(req, (await ctx.params).path);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
