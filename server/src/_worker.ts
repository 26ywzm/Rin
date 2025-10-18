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

export type DB = DrizzleD1Database<typeof schema> & {
    execute?: any;
}

// 初始化数据库表和默认 admin 用户
async function initDB(db: DB) {
    // 创建 users 表
    await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            github_id TEXT,
            username TEXT,
            avatar_url TEXT,
            role TEXT DEFAULT 'user',
            permission INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 你可以根据 server/sql/*.sql 的顺序添加其他表
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS hashtags (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS feed_hashtags (
            feed_id INTEGER NOT NULL,
            hashtag_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY,
            feed_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS friends (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            desc TEXT,
            avatar TEXT,
            url TEXT,
            uid TEXT NOT NULL,
            accepted INTEGER DEFAULT 0,
            health TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 插入默认 admin 用户，如果还没有
    const adminExists = await db.execute(`SELECT COUNT(*) as count FROM users WHERE role='admin'`);
    const count = adminExists?.results?.[0]?.count || 0;
    if (count === 0) {
        await db.execute(`
            INSERT INTO users (id, username, role, permission, created_at)
            VALUES ('1', 'admin', 'admin', 1, CURRENT_TIMESTAMP)
        `);
        console.log('默认 admin 用户已创建: username=admin, role=admin');
    }
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const db = drizzle(env.DB, { schema });
        Container.set(envToken, env);
        Container.set(dbToken, db);

        // 初始化数据库
        await initDB(db);

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
