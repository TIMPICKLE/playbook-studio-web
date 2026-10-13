import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { handleApi } from "../../../server/api.mjs";
export const dynamic = "force-dynamic";
async function route(request: Request) { return handleApi(request, env, await getChatGPTUser()); }
export const GET = route;
export const POST = route;
export const PUT = route;
export const PATCH = route;
export const DELETE = route;
