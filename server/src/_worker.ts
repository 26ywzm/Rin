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

export type DB = DrizzleD1Database<typeof schema> & { execute?: any };

async function initDatabase(db: DB) {
    // 创建 users 表
    await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        github_id TEXT,
        username TEXT,
        avatar_url TEXT,
        role TEXT DEFAULT 'user',
        permission TEXT DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`);

    // 创建 feeds 表
    await db.execute(`
    CREATE TABLE IF NOT EXISTS feeds (
        id INTEGER PRIMARY KEY,
        alias TEXT,
        title TEXT,
        content TEXT NOT NULL,
        summary TEXT DEFAULT '',
        listed INTEGER DEFAULT 1,
        draft INTEGER DEFAULT 1,
        uid TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
    );`);

    // 创建其他表（feed_hashtags, comments, hashtags, friends 等）
    await db.execute(`
    CREATE TABLE IF NOT EXISTS feed_hashtags (
        feed_id INTEGER NOT NULL,
        hashtag_id INTEGER NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
    );`);

    await db.execute(`
    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY NOT NULL,
        feed_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
    );`);

    // ...可根据需要继续添加 moments, visits, info, friends 等表

    // 确保第一个用户为 admin
    const users = await db.execute(`SELECT id FROM users LIMIT 1`);
    if (users.length === 0) {
        await db.execute(`
            INSERT INTO users (id, username, role, permission)
            VALUES ('1', 'admin', 'admin', '1')
        `);
    }
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const db = drizzle(env.DB, { schema });
        Container.set(envToken, env);
        Container.set(dbToken, db);

        // 初始化数据库
        await initDatabase(db);

        const exist = Container.has("cache");
        if (!exist) {
            Container.set("cache", new CacheImpl());
            Container.set("server.config", new CacheImpl("server.config"));
            Container.set("client.config", new CacheImpl("client.config"));
        }

        return await new Elysia({ aot: false })
            .use(app())
            .handle(request);
    },

    async scheduled(_controller: ScheduledController | null, env: Env, ctx: ExecutionContext) {
        const db = drizzle(env.DB, { schema });
        Container.set(envToken, env);
        Container.set(dbToken, db);

        const exist = Container.has("cache");
        if (!exist) {
            Container.set("cache", new CacheImpl());
            Container.set("server.config", new CacheImpl("server.config"));
            Container.set("client.config", new CacheImpl("client.config"));
        }

        await friendCrontab(env, ctx);
        await rssCrontab(env);
    },
};
