import { drizzle, DrizzleD1Database } from "drizzle-orm/d1";
import { Elysia } from "elysia";
import 'reflect-metadata';
import Container from "typedi";
import type { Env } from "./db/db";
import * as schema from './db/schema';
import { app } from "./server";
import { friendCrontab } from "./services/friends";
import { rssCrontab } from "./services/rss";
import { CacheImpl } from "./utils/cache";
import { dbToken, envToken } from "./utils/di";

export type DB = DrizzleD1Database<typeof import("./db/schema")>

async function initContainer(env: Env) {
    try {
        if (!Container.has(envToken)) Container.set(envToken, env);
        if (!Container.has(dbToken)) Container.set(dbToken, drizzle(env.DB, { schema }));
        if (!Container.has("cache")) {
            Container.set("cache", new CacheImpl());
            Container.set("server.config", new CacheImpl("server.config"));
            Container.set("client.config", new CacheImpl("client.config"));
        }
    } catch (err) {
        console.error("Container init failed:", err);
        throw err;
    }
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        try {
            await initContainer(env);
            return await new Elysia({ aot: false })
                .use(app())
                .handle(request);
        } catch (err: any) {
            console.error("Fetch handler error:", err);
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
    },
    async scheduled(_controller: ScheduledController | null, env: Env, ctx: ExecutionContext) {
        try {
            await initContainer(env);
            // 定时任务也捕获错误
            try { await friendCrontab(env, ctx); } catch (e) { console.error("friendCrontab error:", e); }
            try { await rssCrontab(env); } catch (e) { console.error("rssCrontab error:", e); }
        } catch (err) {
            console.error("Scheduled handler error:", err);
        }
    },
}
