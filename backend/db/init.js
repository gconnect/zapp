import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const dbPath = path.resolve("./db/zapp.sqlite");
const schemaPath = path.resolve("./db/schema.sql");

console.log("📦 Initializing database...");

const db = new Database(dbPath);

// Load schema
const schema = fs.readFileSync(schemaPath, "utf8");

db.exec(schema);

console.log("✅ Database initialized successfully");
db.close();